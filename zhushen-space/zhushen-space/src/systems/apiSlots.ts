/* API 槽位排查 / 清除工具。
 *
 * 背景：一个 AI 接口（如某 vertex 逆向网关）可能**同时**存在于多个独立槽位——
 *   ① 公共槽：全局 API / 正文 API / 细纲 API / 取名 API（settingsStore）；
 *   ② 各功能「独立接口」：物品 / 主角 / NPC / 势力 / 领地 / 冒险团 / 万族 / 杂项 / 频道 / 记忆 /
 *      骰子 / 强化 / 合成 / 欢愉宫 / 战斗 / 竞技场 / 登场判断（各自 store 的 `xApi` 字段）；
 *   ③ 接口库路由条目（settingsStore.apiLibrary）。
 * 删掉其中一处（如接口库那条），其它槽位仍在——某功能路由被删空后会**回退到公共/独立槽**，
 * 于是「删了还在调用」。本工具集中扫描全部槽位、按地址/Key 关键词定位、一键清空，杜绝残留。
 *
 * 实现口径与 configExport 一致、**不硬编码字段名**：遍历各 store state 里「键=`api` 或以 `Api` 结尾、
 * 值是含 `baseUrl` 的对象」的 ApiConfig 字段；读写走 zustand getState/setState（自动持久化）。
 * 新加功能 / 接口自动纳入，无需改这里。 */
import type { ApiConfig, ApiEndpoint } from '../store/settingsStore';
import { useSettings } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useNpcEvo } from '../store/npcEvoStore';
import { useEntryJudge } from '../store/entryJudgeStore';
import { useFactionEvo } from '../store/factionEvoStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';
import { useCosmos } from '../store/cosmosStore';
import { useMisc } from '../store/miscStore';
import { useChannel } from '../store/channelStore';
import { useMemory } from '../store/memoryStore';
import { useDice } from '../store/diceStore';
import { useEnhance } from '../store/enhanceStore';
import { useCraft } from '../store/craftStore';
import { useJoy } from '../store/joyStore';
import { useCombat } from '../store/combatStore';
import { useArena } from '../store/arenaStore';

type ZStore = { getState: () => Record<string, unknown>; setState: (partial: Record<string, unknown>) => void };

// 覆盖所有含「独立/公共 AI 接口」的 store（与 configExport 同一批 + 竞技场）。缺哪个功能就在此补一行。
const STORES: { name: string; label: string; store: ZStore }[] = [
  { name: 'settings',  label: '综合设置',   store: useSettings as unknown as ZStore },
  { name: 'player',    label: '主角演化',   store: usePlayer as unknown as ZStore },
  { name: 'item',      label: '物品演化',   store: useItems as unknown as ZStore },
  { name: 'npc',       label: 'NPC演化',    store: useNpcEvo as unknown as ZStore },
  { name: 'entry',     label: '登场判断',   store: useEntryJudge as unknown as ZStore },
  { name: 'faction',   label: '势力演化',   store: useFactionEvo as unknown as ZStore },
  { name: 'territory', label: '领地演化',   store: useTerritory as unknown as ZStore },
  { name: 'team',      label: '冒险团演化', store: useTeam as unknown as ZStore },
  { name: 'cosmos',    label: '万族演化',   store: useCosmos as unknown as ZStore },
  { name: 'misc',      label: '杂项演化',   store: useMisc as unknown as ZStore },
  { name: 'channel',   label: '频道',       store: useChannel as unknown as ZStore },
  { name: 'memory',    label: '记忆',       store: useMemory as unknown as ZStore },
  { name: 'dice',      label: '骰子裁判',   store: useDice as unknown as ZStore },
  { name: 'enhance',   label: '装备强化',   store: useEnhance as unknown as ZStore },
  { name: 'craft',     label: '合成工坊',   store: useCraft as unknown as ZStore },
  { name: 'joy',       label: '欢愉宫',     store: useJoy as unknown as ZStore },
  { name: 'combat',    label: '战斗',       store: useCombat as unknown as ZStore },
  { name: 'arena',     label: '竞技场',     store: useArena as unknown as ZStore },
];

// settingsStore 里的公共槽字段友好名（缺省用「<功能>·独立接口」）
const PUBLIC_FIELD_LABEL: Record<string, string> = {
  api: '全局 API', textApi: '正文 API', outlineApi: '细纲 API', nmApi: '取名 API',
};

export interface ApiSlot {
  storeName: string;
  storeLabel: string;
  field: string;              // 'api' / 'textApi' / 'itemApi' … ；接口库条目为 'lib'
  label: string;              // 展示名，如「全局 API」/「主角演化·独立接口」/「接口库·Vertex (网关)」
  baseUrl: string;
  apiKey: string;
  modelId: string;
  isLibrary?: boolean;
  libId?: string;
}

function isApiField(k: string, v: unknown): v is ApiConfig {
  return (k === 'api' || /Api$/.test(k)) && !!v && typeof v === 'object' && typeof (v as ApiConfig).baseUrl === 'string';
}

/** 收集所有 API 槽位（公共 + 各功能独立 + 接口库条目）。 */
export function collectApiSlots(): ApiSlot[] {
  const slots: ApiSlot[] = [];
  for (const { name, label, store } of STORES) {
    let st: Record<string, unknown>;
    try { st = store.getState(); } catch { continue; }
    for (const k of Object.keys(st ?? {})) {
      const v = st[k];
      if (!isApiField(k, v)) continue;
      const pub = name === 'settings' && k in PUBLIC_FIELD_LABEL;
      slots.push({
        storeName: name, storeLabel: label, field: k,
        label: pub ? PUBLIC_FIELD_LABEL[k] : `${label}·独立接口`,
        baseUrl: String(v.baseUrl || ''), apiKey: String(v.apiKey || ''), modelId: String(v.modelId || ''),
      });
    }
  }
  // 接口库路由条目
  const lib: ApiEndpoint[] = (useSettings.getState().apiLibrary as ApiEndpoint[]) ?? [];
  for (const e of lib) {
    slots.push({
      storeName: 'settings', storeLabel: '接口库', field: 'lib',
      label: `接口库·${e.name || e.id}`,
      baseUrl: String(e.baseUrl || ''), apiKey: String(e.apiKey || ''), modelId: String(e.modelId || ''),
      isLibrary: true, libId: e.id,
    });
  }
  return slots;
}

/** baseUrl 或 apiKey 含关键词（不分大小写）。needle 空 → 不匹配。 */
export function slotMatches(s: ApiSlot, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  return s.baseUrl.toLowerCase().includes(n) || s.apiKey.toLowerCase().includes(n);
}

export function scanApiSlots(needle: string): ApiSlot[] {
  return collectApiSlots().filter((s) => slotMatches(s, needle));
}

/** 清空某槽：接口库条目 → 整条移除；公共/独立槽 → 把 baseUrl/apiKey/modelId 置空（temperature 等参数保留）。返回是否处理成功。 */
export function clearApiSlot(s: ApiSlot): boolean {
  if (s.isLibrary && s.libId) { useSettings.getState().removeApiEndpoint(s.libId); return true; }
  const entry = STORES.find((x) => x.name === s.storeName);
  if (!entry) return false;
  const cur = entry.store.getState()[s.field];
  if (!cur || typeof cur !== 'object') return false;
  entry.store.setState({ [s.field]: { ...cur, baseUrl: '', apiKey: '', modelId: '' } });
  return true;
}

/** 批量清空一组槽，返回成功数。 */
export function clearApiSlots(slots: ApiSlot[]): number {
  let n = 0;
  for (const s of slots) if (clearApiSlot(s)) n++;
  return n;
}
