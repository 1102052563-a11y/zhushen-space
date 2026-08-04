/*
  账本三护栏（v5.6 世界引擎「资产账本」的**取其精华**版）
  ────────────────────────────────────────────────────────
  卡里那套完整记账（多币种四点闭环 + 反偷懒配额 + 产能分流 + nextFixedSettle + 配装占用…）
  是全卡工程量最大的一块，但**契合度最低**——乐园流的核心循环是闯关，不是经营模拟。
  所以只取三条**通用**护栏，用在既有的领地仓库 / 玩家产业上：

    ① **周期门禁**：距上次结算不足 N（世界小时/回合）且无重大事件 → 整块不输出（省 token）
    ② **四点闭环 Pass/Fail**：期初 + 流入 − 流出 ± 自然增减 = 期末，对不上就标红、不给净值
    ③ **常备收支对称**：「正文未写成交 ≠ 无收入」——运转中的产业必须给出基线收入或零收入原因

  三条都是**确定性**的，与既有的"前端算死、AI 只叙述"一脉相承。
  真要做完整经营玩法，再回头抄卡里的完整版。
*/
import { parseGameMinutes } from './gameClock';

/* ── ① 周期门禁 ───────────────────────────────────────────── */

/** 卡里是 24h；这里可调，任务世界短所以默认也给 24（世界时间） */
export const DEFAULT_GATE_HOURS = 24;
/** 时间解析不出时的回合兜底（同传闻的思路：绝不让门禁永远关着） */
export const FALLBACK_GATE_TURNS = 6;

export interface GateInput {
  lastSettleTime?: string;   // 上次结算的世界时间
  lastSettleTurn?: number;
  nowTime?: string;
  nowTurn?: number;
  /** 重大结算事件（大额交易/开张/战损/收购/人事调度/制度变更/灾害…）。⚠ 主角**个人**钱包变动不算 */
  majorEvent?: boolean;
  gateHours?: number;
}

export interface GateVerdict {
  due: boolean;
  reason: string;
  /** 距上次结算的小时数（解析不出为 null） */
  gapHours: number | null;
}

/**
 * 是否该出完整账目。不到期 → 调用方应**整块跳过**（不输出、不调 API）。
 * 重大事件可越过时间门禁；时间解析不出时回落回合兜底。
 */
export function settlementDue(input: GateInput): GateVerdict {
  const gate = input.gateHours ?? DEFAULT_GATE_HOURS;
  if (input.majorEvent) return { due: true, reason: '发生重大结算事件，越过时间门禁', gapHours: null };

  const a = parseGameMinutes(input.lastSettleTime);
  const b = parseGameMinutes(input.nowTime);
  if (a != null && b != null) {
    const gapHours = Math.max(0, Math.round((b - a) / 60));
    return gapHours >= gate
      ? { due: true, reason: `距上次结算已 ${gapHours}h（≥${gate}h）`, gapHours }
      : { due: false, reason: `距上次结算仅 ${gapHours}h（<${gate}h），沿用上次账目`, gapHours };
  }
  const turns = (input.nowTurn ?? 0) - (input.lastSettleTurn ?? 0);
  return turns >= FALLBACK_GATE_TURNS
    ? { due: true, reason: `时间无法解析，按回合兜底：已过 ${turns} 回合`, gapHours: null }
    : { due: false, reason: `时间无法解析，按回合兜底：仅过 ${turns} 回合（<${FALLBACK_GATE_TURNS}）`, gapHours: null };
}

/* ── ② 四点闭环 ───────────────────────────────────────────── */

export interface ClosureInput {
  label: string;
  opening: number;   // 期初
  inflow: number;    // 流入
  outflow: number;   // 流出
  natural?: number;  // 自然增减（牲口/作物/人口…可为负）
  closing: number;   // 期末
}

export interface ClosureResult {
  label: string;
  pass: boolean;
  expected: number;
  actual: number;
  diff: number;
  line: string;
}

/** 浮点容差：账目通常是整数，给一点余量防 0.1+0.2 之类 */
export const CLOSURE_EPS = 0.51;

/** 期初 + 流入 − 流出 ± 自然增减 = 期末 */
export function checkClosure(i: ClosureInput): ClosureResult {
  const expected = i.opening + i.inflow - i.outflow + (i.natural ?? 0);
  const diff = Math.round((i.closing - expected) * 100) / 100;
  const pass = Math.abs(diff) < CLOSURE_EPS;
  const nat = i.natural ? ` ${i.natural >= 0 ? '+' : '−'}自然${Math.abs(i.natural)}` : '';
  return {
    label: i.label, pass, expected, actual: i.closing, diff,
    line: `${pass ? '✅' : '❌'} ${i.label}：期初${i.opening} +流入${i.inflow} −流出${i.outflow}${nat} = ${expected}`
      + (pass ? `（期末 ${i.closing}）` : `，但期末记作 ${i.closing}　**差 ${diff > 0 ? '+' : ''}${diff}**`),
  };
}

/** 批量核账。任一 Fail → `ok=false`，调用方应**标记「待补明细」而不是给出净值**（卡里的硬规则）。 */
export function checkAll(items: ClosureInput[]): { ok: boolean; results: ClosureResult[]; report: string } {
  const results = items.map(checkClosure);
  const ok = results.every((r) => r.pass);
  const report = results.map((r) => r.line).join('\n')
    + (ok ? '' : '\n⚠ 存在对不上的科目 → 本期不给净值汇总，标记「待补明细」');
  return { ok, results, report };
}

/* ── ③ 常备收支对称 ───────────────────────────────────────── */

export interface RecurringInput {
  /** 该产业本期是否在运转（有产线/未封存/未停业） */
  running: boolean;
  /** 本期已记录的收入合计 */
  revenue: number;
  /** 设施的基线收入锚点（店铺租金/客栈房费/通行费…），按周期计 */
  baseIncome?: number;
  /** 若收入为 0，必须给的理由（全停工/封存/全部入库未售/赊销未结/停租） */
  zeroReason?: string;
}

export interface RecurringVerdict {
  ok: boolean;
  /** 该补记的基线收入（>0 时调用方应据此补一笔或要求 AI 补） */
  suggested: number;
  reason: string;
}

/**
 * 「**正文未写成交 ≠ 无收入**」——卡里治 LLM 记账偷懒最有效的一条。
 * 产业在运转却收入为 0 且给不出合格理由 → 判 Fail，并按 baseIncome 给出应补的基线。
 */
export function checkRecurringIncome(i: RecurringInput): RecurringVerdict {
  if (!i.running) return { ok: true, suggested: 0, reason: '未运转，无收入合理' };
  if (i.revenue > 0) return { ok: true, suggested: 0, reason: '已有收入记录' };
  if ((i.zeroReason ?? '').trim().length >= 4) {
    return { ok: true, suggested: 0, reason: `零收入有合格理由：${i.zeroReason}` };
  }
  const base = Math.max(0, i.baseIncome ?? 0);
  return {
    ok: false,
    suggested: base,
    reason: base > 0
      ? `运转中却零收入且无理由 → 应按基线补记 ${base}`
      : '运转中却零收入且无理由 → 必须写明原因（全停工/封存/全部入库未售/赊销未结）',
  };
}

/** 注入提示词的一段：把三条护栏说给 AI 听（供产业/领地类阶段复用） */
export const LEDGER_GUARD_HINT = `【记账三护栏（前端会核账·对不上会被标红）】
1. **周期门禁**：距上次结算不足一个周期且无重大事件（大额交易/开张/战损/收购/人事调度/制度变更/灾害）→ 本期不必重报账目。⚠ 主角**个人**钱包变动不算重大事件。
2. **四点闭环**：任何科目都要能对上 \`期初 + 流入 − 流出 ± 自然增减 = 期末\`。对不上就标「待补明细」，**不要硬给一个净值**。
3. **常备收支对称**：**正文没写成交 ≠ 没有收入**。产业只要在运转，就该按设施基线或产出估算记一笔收入；确实为零，必须写明原因（全停工/封存/全部入库未售/赊销未结/停租）。`;
