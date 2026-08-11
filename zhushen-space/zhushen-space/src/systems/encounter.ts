/* ════════════════════════════════════════════
   随机邂逅（借鉴 色色灵感状态栏V3.2 的 ACCIDENT_EVENTS + $占位符$ 填充思路）
   - 零 API：点按钮 → 按世界时代取事件池（古代/现代/混合）→ 随机抽一条 →
     $地点$/$在场人物$/$不在场人物$/$物品$ 从各 store 现场填充 → 填入输入框（玩家可编辑再发送）。
   - 事件池在 src/data/encounterEvents.ts（46KB·动态 import，不进主包）。
   - 素材缺位（如没有在场 NPC）→ 换抽不含该占位符的事件，绝不输出残破句。
   UI 入口：ChatComposer.EncounterButton（🧭）。
════════════════════════════════════════════ */
import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useItems, isResourcePseudoItem } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useWorldRecord } from '../store/worldRecordStore';

export type EncounterEra = 'ancient' | 'modern' | 'mixed';

const ANCIENT_RE = /王朝|皇朝|宗门|江湖|武林|驿站|驿道|马车|镖局|城主|王都|领主|骑士|城邦|中世纪|剑与魔法|王国|贵族|银两|铜钱|客栈|仙|修士|部落|祭司/g;
const MODERN_RE = /现代|都市|城市|手机|电话|地铁|汽车|公交|高铁|学校|高中|大学|公司|职场|网络|电脑|便利店|公寓|警察|新闻|电视|咖啡|地下铁|写字楼|直播/g;

/** 按世界名+世界观文本粗判时代（判不出=混合池） */
export function guessEra(): EncounterEra {
  try {
    const M = useMisc.getState();
    const recs = (useWorldRecord.getState() as any).records ?? [];
    const active = recs.find((r: any) => r?.status === 'active');
    const text = [M.worldName ?? '', active?.worldviewText ?? '', JSON.stringify(active?.worldview ?? '')].join(' ');
    const a = (text.match(ANCIENT_RE) ?? []).length;
    const m = (text.match(MODERN_RE) ?? []).length;
    if (a >= m + 2) return 'ancient';
    if (m >= a + 2) return 'modern';
    return 'mixed';
  } catch { return 'mixed'; }
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const shortName = (s: string): string => String(s ?? '').split('|')[0].trim();
/** 地点取尾段短名（「新宿区-御苑」→「御苑」），读起来才像目的地 */
const shortLoc = (s: string): string => {
  const t = String(s ?? '').trim();
  const seg = t.split(/[-—·>→/]/).map((x) => x.trim()).filter(Boolean);
  return seg[seg.length - 1] || t;
};

/** 抽一条可完整填充的邂逅事件（素材不够的占位符→换抽；20 次抽不中=放宽用无占位符事件） */
export async function rollEncounter(): Promise<string | null> {
  const { ENCOUNTER_ANCIENT, ENCOUNTER_MODERN } = await import('../data/encounterEvents');
  const era = guessEra();
  const pool = era === 'ancient' ? ENCOUNTER_ANCIENT : era === 'modern' ? ENCOUNTER_MODERN : [...ENCOUNTER_ANCIENT, ...ENCOUNTER_MODERN];
  if (!pool.length) return null;

  // 素材备料（各自 try 住，缺谁只影响含该占位符的事件）
  let loc = '';
  try { loc = shortLoc(usePlayer.getState().profile.location) || (useMisc.getState().worldName ?? '').trim(); } catch { /* */ }
  let onScene: string[] = [], offScene: string[] = [];
  try {
    const npcs = Object.values(useNpc.getState().npcs ?? {}) as any[];
    const named = npcs.filter((n) => n && !n.isDead && !n.archived && n.name && n.name !== n.id);
    onScene = named.filter((n) => n.onScene).map((n) => shortName(n.name));
    offScene = named.filter((n) => !n.onScene && !n.frozenAt).map((n) => shortName(n.name));
  } catch { /* */ }
  let items: string[] = [];
  try {
    items = ((useItems.getState() as any).items ?? [])
      .filter((it: any) => it && !it.archived && !isResourcePseudoItem(it))
      .map((it: any) => String(it.name));
  } catch { /* */ }

  const material: Record<string, string[]> = {
    地点: loc ? [loc] : [],
    在场人物: onScene,
    不在场人物: offScene,
    物品: items,
  };

  const fillable = (ev: string): boolean => {
    for (const m of ev.matchAll(/\$([^$]+)\$/g)) {
      const arr = material[m[1]];
      if (!arr || !arr.length) return false;
    }
    return true;
  };
  const fill = (ev: string): string => ev.replace(/\$([^$]+)\$/g, (_, key: string) => pick(material[key] ?? ['']) ?? '');

  for (let i = 0; i < 20; i++) {
    const ev = pick(pool);
    if (fillable(ev)) return fill(ev);
  }
  // 素材太少（开局无NPC无物品）→ 退到完全无占位符的事件
  const plain = pool.filter((ev) => !/\$[^$]+\$/.test(ev));
  return plain.length ? pick(plain) : null;
}
