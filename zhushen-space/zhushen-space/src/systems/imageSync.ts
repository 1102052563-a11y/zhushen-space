import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import * as imageDb from './imageDb';
import { logWarn } from '../utils/log';

/* ════════════════════════════════════════════
   图片同步：把各 store 内存里的 avatar/image（dataURL）镜像到 IndexedDB；
   启动时反向回填到 store。localStorage 不再存图（见各 store 的 partialize）。
   key：player / npc:<id> / item:<itemId> / npcitem:<ownerId>:<itemId>
════════════════════════════════════════════ */

/** 扫描当前所有 store 的图片字段 → key→dataURL */
function collect(): Map<string, string> {
  const m = new Map<string, string>();
  const pf = usePlayer.getState().profile;
  if (pf.avatar) m.set('player', pf.avatar);
  for (const r of Object.values(useNpc.getState().npcs)) {
    if (r.avatar) m.set('npc:' + r.id, r.avatar);
    for (const it of r.items ?? []) if ((it as any).image) m.set('npcitem:' + r.id + ':' + it.id, (it as any).image);
  }
  for (const it of useItems.getState().items) if (it.image) m.set('item:' + it.id, it.image);
  return m;
}

/** 当前各 store 图片快照（存档用，始终最新，不依赖防抖落库）*/
export function snapshotImages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of collect()) out[k] = v;
  return out;
}

let last = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function syncNow(): void {
  const cur = collect();
  // 新增/变化 → put；消失 → del
  for (const [k, v] of cur) if (last.get(k) !== v) imageDb.putImg(k, v).catch((e) => logWarn('imageSync.putImg', e));   // 写失败(多为配额)→图没落库,出声方便排查
  for (const k of last.keys()) if (!cur.has(k)) imageDb.delImg(k).catch((e) => logWarn('imageSync.delImg', e));
  last = cur;
}
function scheduleSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(syncNow, 800);   // 防抖，避免流式/批量写时频繁落库
}

/** 启动时：从 IndexedDB 回填图片到各 store（partialize 后 localStorage 已无图）；
    并把 store 里现有的图（可能来自旧版 localStorage）迁移进 IndexedDB，避免被 partialize 抹掉后丢失。*/
export async function hydrateImages(): Promise<void> {
  let all: Record<string, string> = {};
  try { all = await imageDb.getAllImg(); } catch (e) { logWarn('imageSync.hydrate', e); }   // 读失败→图回填不了(全没图),不该静默
  if (!all || Object.keys(all).length === 0) {
    // IndexedDB 为空：把 store 现有图（旧 localStorage 迁移过来的）全量写入 IndexedDB
    last = new Map();
    syncNow();
    return;
  }

  // 主角
  if (all['player']) { try { usePlayer.getState().setProfile({ avatar: all['player'] }); } catch { /* */ } }
  // NPC 头像 + 持有物图
  const npc = useNpc.getState();
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('npc:')) {
      const id = k.slice(4);
      if (npc.npcs[id]) try { npc.upsertNpc(id, { avatar: v }); } catch { /* */ }
    } else if (k.startsWith('npcitem:')) {
      const rest = k.slice(8);
      const sep = rest.indexOf(':');
      if (sep > 0) { const owner = rest.slice(0, sep); const itemId = rest.slice(sep + 1); try { npc.updateNpcItem?.(owner, itemId, { image: v }); } catch { /* */ } }
    }
  }
  // 玩家物品
  const items = useItems.getState();
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('item:')) { const id = k.slice(5); if (items.items.some((it) => it.id === id)) try { items.updateItem(id, { image: v }); } catch { /* */ } }
  }
  // 回填后再全量推一次：把 store 里有、但 IndexedDB 还没有的图（旧 localStorage 残留）一并迁入
  last = new Map();
  syncNow();
}

/** 订阅各 store 变化，自动镜像图片到 IndexedDB（防抖）*/
export function initImageSync(): void {
  usePlayer.subscribe(scheduleSync);
  useNpc.subscribe(scheduleSync);
  useItems.subscribe(scheduleSync);
}
