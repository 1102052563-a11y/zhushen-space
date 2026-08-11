import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useMap } from '../store/mapStore';
import { useOutfits } from '../store/outfitStore';
import { useJoy } from '../store/joyStore';
import { useEnhance } from '../store/enhanceStore';
import { useShop } from '../store/shopStore';
import * as imageDb from './imageDb';
import { allMapImgs, hydrateMapImgs, mapImageKey, clearMapImgCache } from './mapImages';
import { allOutfitImgs, hydrateOutfitImgs, clearOutfitImgCache, outfitImageKey } from './outfitImages';
import { allTrainImgs, hydrateTrainImgs, clearTrainImgCache, trainImageKey } from './trainImages';
import { useTraining } from '../store/trainingStore';
import { logWarn } from '../utils/log';

/* ════════════════════════════════════════════
   图片同步：把各 store 内存里的 avatar/image（dataURL）镜像到 IndexedDB；
   启动时反向回填到 store。localStorage 不再存图（见各 store 的 partialize）。
   快照域 key（snapshotImages 全量携带 → 读档「先清后回填」、新游戏清空，见 isSnapshotImageKey）：
     player / npc:<id> / item:<itemId> / npcitem:<ownerId>:<itemId>（store 镜像）
     + map:<worldKey>:<nodeId> / outfit:<charId>:<outfitId>（内存缓存域，见 mapImages/outfitImages）
   全局配置域 key（**不进快照**·读档/新游戏一律保留）：joy-girl:<id> / enhance-boss:<id> /
     shop-sign:|shop-good:|shop-girl:|shop-smith:<id>——名册/店铺定义不随档回滚也不随新游戏清，
     图与实体同生命周期；此前被 clearAllImg 无差别清光=「人还在图没了」（2026-08-11 修）。
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
  // 🧭 地点图（内存缓存镜像，见 systems/mapImages）：并进快照 → 存档带图、读档不丢
  for (const [k, v] of allMapImgs()) if (v) m.set(k, v);
  // 👗 穿搭参考图（内存缓存镜像，见 systems/outfitImages）：并进快照 → 新游戏后再读旧档/跨设备导入衣柜图不丢
  for (const [k, v] of allOutfitImgs()) if (v) m.set(k, v);
  // 🔗 调教场景图（内存缓存镜像，见 systems/trainImages）：并进快照 → 随存档携带
  for (const [k, v] of allTrainImgs()) if (v) m.set(k, v);
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
  try { hydrateMapImgs(all); } catch (e) { logWarn('imageSync.hydrateMap', e); }   // 🧭 地点图回填进内存缓存（面板显示 + 存档快照都吃它）
  try { hydrateOutfitImgs(all); } catch (e) { logWarn('imageSync.hydrateOutfit', e); }   // 👗 穿搭参考图回填进内存缓存（存档快照吃它；面板/生图线仍按需 getImg）
  try { hydrateTrainImgs(all); } catch (e) { logWarn('imageSync.hydrateTrain', e); }   // 🔗 调教场景图回填进内存缓存（面板缩略图墙 + 存档快照都吃它）
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

/** 现存实体的图片 key 全集（**只要实体存在就算 live**，不管这次 store 有没有回填到 avatar 字段）。
    孤儿判定/清理都用它：比 collect()(仅含"当前有图的") 更保守，绝不误删"NPC 还在、只是这次没回填到头像"的角色的图。
    key 规则须与各写入方一致——文件头注释的**两域清单全都要列**（快照域＋全局配置域），
    缺谁谁被「清理孤儿图」误删（outfit/joy/enhance/shop 此前全漏，2026-08-11 修）。 */
export function liveEntityImageKeys(): Set<string> {
  const s = new Set<string>(['player']);   // 主角恒存在
  for (const r of Object.values(useNpc.getState().npcs)) {
    if (!r?.id) continue;
    s.add('npc:' + r.id);
    for (const it of r.items ?? []) if ((it as any)?.id) s.add('npcitem:' + r.id + ':' + (it as any).id);
  }
  for (const it of useItems.getState().items) if (it?.id) s.add('item:' + it.id);
  // 🧭 地点图：只要节点还在图上（含归档）就算 live——与「实体存在即 live」的保守口径一致
  try {
    for (const [wk, wm] of Object.entries(useMap.getState().byWorld)) {
      for (const id of Object.keys(wm?.nodes ?? {})) s.add(mapImageKey(wk, id));
    }
  } catch { /* map store 未就绪则跳过（宁可少列，prune 侧有空库防呆） */ }
  // 👗 穿搭参考图：衣柜里穿搭还在就算 live（刻意不看 hasImage——标记漂了也不误删）
  try {
    for (const [charId, w] of Object.entries(useOutfits.getState().byChar)) {
      for (const o of w?.outfits ?? []) if (o?.id) s.add(outfitImageKey(charId, o.id));
    }
  } catch { /* 衣柜 store 未就绪则跳过 */ }
  // 🔗 调教场景图：图库里 shot 还在就算 live（随存档进度域）
  try {
    for (const [npcId, sess] of Object.entries(useTraining.getState().sessions)) {
      for (const shot of sess?.gallery ?? []) if (shot?.id) s.add(trainImageKey(npcId, shot.id));
    }
  } catch { /* 调教 store 未就绪则跳过 */ }
  // 🏮 全局配置域（欢愉宫美女/强化老板/玩家产业）：名册与店铺定义不随档回滚、不随新游戏清 → 实体在=图 live
  try { for (const g of useJoy.getState().settings?.girls ?? []) if (g?.id) s.add('joy-girl:' + g.id); } catch { /* */ }
  try { for (const b of useEnhance.getState().settings?.bosses ?? []) if (b?.id) s.add('enhance-boss:' + b.id); } catch { /* */ }
  try {
    // 前缀口径须与 shopStore 的 signKey/goodKey/girlKey/smithKey 一致
    for (const sh of useShop.getState().shops ?? []) {
      if (!sh?.id) continue;
      s.add('shop-sign:' + sh.id);
      s.add('shop-smith:' + sh.id);
      for (const g of sh.goods ?? []) if (g?.id) s.add('shop-good:' + g.id);
      for (const g of sh.girls ?? []) if (g?.id) s.add('shop-girl:' + g.id);
    }
  } catch { /* */ }
  return s;
}

/** 存档快照域 key 判定：这些域由 snapshotImages() 全量携带——读档「先清后回填」、新游戏清空。
    非快照域（joy-girl:/enhance-boss:/shop-*:）是全局配置的图：名册/店铺定义不随档回滚、不随新游戏清，
    按域清理时一律保留（否则又回到「人还在、图没了」）。 */
export function isSnapshotImageKey(k: string): boolean {
  return k === 'player' || k.startsWith('npc:') || k.startsWith('npcitem:') || k.startsWith('item:')
    || k.startsWith('map:') || k.startsWith('outfit:') || k.startsWith('train:');
}

/** 新游戏：清全部「随档进度域」图——imageDb 快照域 + 两个内存缓存（缓存不清的话，
    旧局的地点/衣柜图会随 collect() 泄漏进新局快照）。全局配置域（joy/enhance/shop）保留。 */
export async function clearSnapshotDomainImages(): Promise<void> {
  clearMapImgCache();
  clearOutfitImgCache();
  clearTrainImgCache();
  await imageDb.clearImagesWhere(isSnapshotImageKey);
}

/** 清理孤儿图片：删掉 IndexedDB(drpg-images) 里已不属于任何现存 主角/NPC/物品 的残留图。
    根因：dead/合并掉的 NPC、消耗掉的物品，其头像/图在 syncNow 的跨会话追踪里漏删，长档(上千回合)累积成 GB 级占用。
    ⚠防呆：当前既无 NPC 也无物品（store 未加载完 / 新档重置中）→ 直接跳过，绝不在"看起来空"时清库。 */
export async function pruneOrphanImages(): Promise<{ removed: number; freed: number; kept: number }> {
  const npcs = useNpc.getState().npcs, items = useItems.getState().items;
  if (Object.keys(npcs).length === 0 && items.length === 0) return { removed: 0, freed: 0, kept: 0 };   // 未就绪 → 别误删（宁可不清）
  return imageDb.pruneImagesExcept(liveEntityImageKeys());
}

/** 订阅各 store 变化，自动镜像图片到 IndexedDB（防抖）*/
export function initImageSync(): void {
  usePlayer.subscribe(scheduleSync);
  useNpc.subscribe(scheduleSync);
  useItems.subscribe(scheduleSync);
}
