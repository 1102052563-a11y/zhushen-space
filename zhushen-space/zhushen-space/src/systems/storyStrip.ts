import { isMainQuest, type MiscTask } from '../store/miscStore';
import { collectStaleThreads } from './plotThreads';

/* ══════════ 楼层信息条（StoryStrip）· 取数层 ══════════
   借鉴 ST-SevenDaysCal「构画」的「楼内条」：把最该被看见的几条状态**贴在正文末尾**，
   而不是等玩家去点右侧 40+ 个面板。零新增 API、零新增演化阶段、零新增 store——
   纯把 miscStore(任务/双时间/天气) + tableStore(伏笔表) 已有的数据变现。

   本文件只做「store 原始数据 → 展示模型」的纯转换（可单测）；
   订阅与渲染在 components/StoryStrip.tsx。

   ⚠ 术语：只用本项目自己的词（任务 / 伏笔 / 世界时间），不引入插件的「点/线/面」命名。 */

// ─── 伏笔（读 tableStore.tables.foreshadowing）────────────────────────────────
// 行结构：[row_id, 伏笔, 埋下时间, 涉及对象, 状态, 预期回收, 说明]（content[0] 是表头行）
const FS_COL = { id: 0, title: 1, obj: 3, state: 4, expect: 5 } as const;
const TERMINAL_STATE = /已回收|已废弃/;

export interface ThreadBrief {
  rowId: string;
  title: string;
  state: string;      // 状态列（埋下 / 发展中 / …；可能留空）
  expect: string;     // 预期回收
  age: number | null; // 账龄（回合）；null 且 stale=true 表示「久远」（早于日志留存期）
  stale: boolean;     // 已进入催收账龄（与 <伏笔催收> 注入同一口径）
}

/** 活跃伏笔（状态非「已回收/已废弃」）；催收中的排最前（久远 > 账龄大 > 账龄小），其余保持表内顺序。
    账龄口径直接复用 plotThreads.collectStaleThreads —— 条上标⚠的那几条，正是这一轮注入给 AI 催收的那几条。 */
export function pickThreads(content: string[][] | undefined, turn: number, cap = 6): ThreadBrief[] {
  const rows = content?.slice(1) ?? [];
  const staleMap = new Map<string, number | null>();
  try {
    for (const t of collectStaleThreads(turn)) staleMap.set(t.rowId, t.age);
  } catch { /* 日志不可用（读档瞬间等）→ 全部按新鲜处理，条照样出，只是不标⚠ */ }

  const out: ThreadBrief[] = [];
  for (const row of rows) {
    const rowId = String(row?.[FS_COL.id] ?? '').trim();
    const title = String(row?.[FS_COL.title] ?? '').trim();
    if (!rowId || !title) continue;
    const state = String(row?.[FS_COL.state] ?? '').trim();
    if (TERMINAL_STATE.test(state)) continue;
    const stale = staleMap.has(rowId);
    out.push({
      rowId,
      title,
      state,
      expect: String(row?.[FS_COL.expect] ?? '').trim(),
      age: stale ? (staleMap.get(rowId) ?? null) : null,
      stale,
    });
  }
  // 催收权重：久远最大 → 账龄降序 → 未催收统一 -1（sort 稳定，故这批保持表内原顺序）
  const w = (t: ThreadBrief) => (!t.stale ? -1 : t.age === null ? Number.MAX_SAFE_INTEGER : t.age);
  out.sort((a, b) => w(b) - w(a));
  return out.slice(0, cap);
}

// ─── 任务（读 miscStore.tasks）───────────────────────────────────────────────

export interface QuestBrief {
  id: string;
  name: string;
  main: boolean;       // 主线
  locked: boolean;     // 玩家已锁定任务链
  prof: boolean;       // 职业任务
  ringGoal: string;    // 当前 active 环的目标；单环任务为 ''
  ringIdx: number;     // 当前环序号（1-based）；0=无环路线图
  ringTotal: number;   // 总环数；0=无环路线图
  progress: string;    // 上回合实质推进（杂项演化每轮更新）
  endTime: string;     // 截止（绝对游戏时间）
}

/** 当前正在执行的环：优先按 currentRing 对齐 idx，否则取第一个 status==='active'。 */
function activeRing(t: MiscTask) {
  const rings = t.rings;
  if (!Array.isArray(rings) || !rings.length) return null;
  const byIdx = typeof t.currentRing === 'number' ? rings.find((r) => r?.idx === t.currentRing) : undefined;
  return byIdx ?? rings.find((r) => r?.status === 'active') ?? null;
}

/** 进行中任务（miscStore.tasks 本身就只存未结算的）；主线排最前，其余保持既有顺序。 */
export function pickQuests(tasks: MiscTask[] | undefined, cap = 6): QuestBrief[] {
  const list = Array.isArray(tasks) ? tasks : [];
  const out: QuestBrief[] = list.map((t) => {
    const ring = activeRing(t);
    return {
      id: String(t?.id ?? ''),
      name: String(t?.name ?? '').trim(),
      main: isMainQuest(t),
      locked: !!t?.locked,
      prof: !!t?.prof,
      ringGoal: String(ring?.goal ?? '').trim(),
      ringIdx: Number(ring?.idx ?? 0) || 0,
      ringTotal: Array.isArray(t?.rings) ? t.rings.length : 0,
      progress: String(t?.progress ?? '').trim(),
      endTime: String(t?.endTime ?? '').trim(),
    };
  }).filter((q) => q.id && q.name);
  // 主线置顶（sort 稳定 → 同类保持原顺序）
  out.sort((a, b) => Number(b.main) - Number(a.main));
  return out.slice(0, cap);
}

// ─── 天气图标 ────────────────────────────────────────────────────────────────
// AI 写的天气是自由中文串（「小雨转阴」「血色沙暴」…），只做包含匹配 + 兜底，认不出返回 ''。
const WEATHER_GLYPHS: [RegExp, string][] = [
  [/雷|electric|暴风雨/, '⛈'],
  [/暴雨|大雨/, '🌧'],
  [/雨/, '🌦'],
  [/暴雪|大雪/, '❄'],
  [/雪/, '🌨'],
  [/雾|霾|瘴/, '🌫'],
  [/沙|尘暴/, '🌪'],
  [/风/, '🌬'],
  [/阴/, '☁'],
  [/多云|云/, '⛅'],
  [/晴|烈日/, '☀'],
  [/夜|星/, '🌙'],
];

export function weatherGlyph(weather: string | undefined): string {
  const w = String(weather ?? '').trim();
  if (!w) return '';
  for (const [re, glyph] of WEATHER_GLYPHS) if (re.test(w)) return glyph;
  return '🌡';   // 认不出的奇异天气（异界/概念天象）也给个占位，别让格子空掉
}
