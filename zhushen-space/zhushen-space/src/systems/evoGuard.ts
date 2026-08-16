// ─────────────────────────────────────────────────────────────────────────────
// 演化守卫（P0·借鉴 world-backstage「世界背面」的工程骨架）
//
//  ① 世界纪元 epoch：切世界（enterWorld，不 reload）时 +1。演化管线开跑时抓一份，
//     epoch 变了 = 管线属于旧世界 → 未启动的阶段整段跳过、收尾对账不再执行，
//     防「旧世界的演化结果写进新世界」。（回退/重生成/读档走整页 reload，
//     在途阶段天然被杀，无需 epoch；epoch 只管不 reload 的切世界。）
//
//  ② 一致性哨兵：正文/演化与权威 store 冲突（时间倒退、发送屏障超时、切世界中止…）
//     只记录不拦截主流程 —— 写进 turnInsightStore.consistency，回合洞察面板可见，
//     是排查「数值乱跳 / 时间漂移 / 状态被旧结果覆盖」的黑匣子。
//
//  ③ 世界钟只进不退：比较两个自由中文时间串的先后（年 / 月日 / 第N日 / 钟点）。
//     只有「确定倒退」才拦；认不出格式 = unknown = 一律放行（宁放过不误杀）。
// ─────────────────────────────────────────────────────────────────────────────
import { useTurnInsight } from '../store/turnInsightStore';
import { useMisc } from '../store/miscStore';
import { extractMonthDay, dayOfYear, DAYS_IN_YEAR, cnNum } from './calendar';

// ── ① 世界纪元 ───────────────────────────────────────────────────────────────
let evoEpoch = 0;

export function currentEvoEpoch(): number { return evoEpoch; }
export function bumpEvoEpoch(reason?: string): number {
  evoEpoch++;
  if (reason) console.log(`[演化守卫] 世界纪元 +1（${reason}）→ ${evoEpoch}`);
  return evoEpoch;
}
export function evoEpochStale(captured: number): boolean { return captured !== evoEpoch; }

// ── ② 一致性哨兵 ─────────────────────────────────────────────────────────────
export type ConsistencyKind = 'time-regression' | 'barrier-timeout' | 'stale-phase-skip' | 'world-switch-abort' | 'evo-gate' | 'api-input-bloat';

export function reportConsistency(kind: ConsistencyKind, detail: string): void {
  try {
    const turn = useMisc.getState().turnCount || 0;
    useTurnInsight.getState().logConsistency({ turn, time: Date.now(), kind, detail });
    console.warn(`[一致性哨兵] ${kind}：${detail}`);
  } catch { /* 日志失败不影响主流程 */ }
}

// ── ③ 世界钟比较 ─────────────────────────────────────────────────────────────
export interface WorldTimeParts {
  year: number | null;                       // 「轮回历3年」「1943年6月6日」→ 3 / 1943（时长写法「还有2年」不算）
  md: { month: number; day: number } | null; // 复用世界历的 extractMonthDay（M月D日 / YYYY-M-D / 三月十五 / M/D）
  seq: number | null;                        // 「第3天」「第十日」——无历法世界的相对日计数
  clockMin: number | null;                   // 「14:30」「8点」「卯时」→ 当日分钟数
}

/* 十二时辰 → 起始整点（卯时=5-7 点取 6，粗粒度只用于同日先后比较） */
const SHICHEN: Record<string, number> = { 子: 0, 丑: 2, 寅: 4, 卯: 6, 辰: 8, 巳: 10, 午: 12, 未: 14, 申: 16, 酉: 18, 戌: 20, 亥: 22 };

/* 抠「历法年份」：只认年号写法（轮回历3年/1943年6月…），排除时长写法（还有2年/2年后/约3年）。
   认不准宁可返回 null——年份只是比较信号之一，漏了还有月日/第N日兜着。 */
function extractCalendarYear(s: string): number | null {
  const re = /(\d{1,6})\s*年/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 2), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if (/[有余还約约近过了]/.test(before)) continue;   // 「还有2年」「近3年」= 时长
    if (/[后內内间半多]/.test(after)) continue;         // 「2年后」「3年间」= 时长
    return Number(m[1]);
  }
  return null;
}

export function parseWorldTime(text: string | undefined): WorldTimeParts {
  const s = String(text || '').trim();
  const out: WorldTimeParts = { year: null, md: null, seq: null, clockMin: null };
  if (!s) return out;
  out.year = extractCalendarYear(s);
  if (out.year == null) {   // 「2024-03-15」式：开头的 4 位数字当年份
    const ym = /^(\d{3,4})\s*[-/]/.exec(s);
    if (ym) out.year = Number(ym[1]);
  }
  out.md = extractMonthDay(s);
  let m: RegExpExecArray | null;
  if ((m = /第\s*(\d+|[一二两三四五六七八九十]+)\s*[天日]/.exec(s))) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : cnNum(m[1]);
    if (Number.isFinite(v)) out.seq = v;
  }
  if ((m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s))) out.clockMin = Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  else if ((m = /(\d{1,2})\s*点/.exec(s))) out.clockMin = Math.min(23, +m[1]) * 60;
  else if ((m = /([子丑寅卯辰巳午未申酉戌亥])\s*时/.exec(s))) out.clockMin = SHICHEN[m[1]] * 60;
  return out;
}

export type TimeOrder = 'forward' | 'same' | 'backward' | 'unknown';

/* 同一天内比钟点；缺任一侧钟点 = 视作同一时刻（date 已对上，不苛求） */
function clockOrder(p: WorldTimeParts, n: WorldTimeParts): TimeOrder {
  if (p.clockMin == null || n.clockMin == null) return 'same';
  if (n.clockMin > p.clockMin) return 'forward';
  if (n.clockMin < p.clockMin) return 'backward';
  return 'same';
}

/** 比较两个世界时间串的先后。只在信号确凿时给 forward/backward，其余 unknown（调用方只拦 backward）。 */
export function compareWorldTimes(prevText: string, nextText: string): TimeOrder {
  const p = parseWorldTime(prevText);
  const n = parseWorldTime(nextText);

  // 月日均可解析 → 主信号
  if (p.md && n.md) {
    if (p.year != null && n.year != null && p.year !== n.year) return n.year > p.year ? 'forward' : 'backward';
    const dp = dayOfYear(p.md.month, p.md.day);
    const dn = dayOfYear(n.md.month, n.md.day);
    if (dp === dn) return clockOrder(p, n);
    if (p.year != null && n.year != null) return dn > dp ? 'forward' : 'backward';   // 年份相同且明确 → 直接比序号
    // 年份未知：按 366 环判向（跨年 12月30→1月2 是向前；回跳超过半年按环绕当向前，宁放过不误杀）
    const d = (dn - dp + DAYS_IN_YEAR) % DAYS_IN_YEAR;
    return d <= DAYS_IN_YEAR / 2 ? 'forward' : 'backward';
  }

  // 第N日计数（无历法世界）
  if (p.seq != null && n.seq != null) {
    if (n.seq > p.seq) return 'forward';
    if (n.seq < p.seq) return 'backward';
    return clockOrder(p, n);
  }

  // 只剩年份可比（轮回历3年 → 轮回历2年）
  if (p.year != null && n.year != null && p.year !== n.year) return n.year > p.year ? 'forward' : 'backward';

  return 'unknown';
}

/** 世界钟只进不退：确定倒退 → 返回 true（调用方保留旧值），并记一致性日志；其余放行。 */
export function guardTimeAdvance(label: string, prev: string, next: string): boolean {
  if (!prev || !next || prev === next) return false;
  if (compareWorldTimes(prev, next) !== 'backward') return false;
  reportConsistency('time-regression', `${label}试图倒退：「${prev}」→「${next}」——已保留原值（真要回拨时间，请在 世界/杂项 面板手动改，手动编辑不经此闸）`);
  return true;
}
