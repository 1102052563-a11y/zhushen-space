import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GATE_HOURS, FALLBACK_GATE_TURNS, settlementDue,
  CLOSURE_EPS, checkClosure, checkAll, checkRecurringIncome, LEDGER_GUARD_HINT,
} from './ledgerCheck';

describe('ledgerCheck · ① 周期门禁', () => {
  it('不足一个周期 → 不到期（整块跳过·省 token）', () => {
    const v = settlementDue({ lastSettleTime: '3年5月10日 08:00', nowTime: '3年5月10日 20:00' });
    expect(v.due).toBe(false);
    expect(v.gapHours).toBe(12);
    expect(v.reason).toContain('沿用上次账目');
  });

  it('够一个周期 → 到期', () => {
    const v = settlementDue({ lastSettleTime: '3年5月10日 08:00', nowTime: '3年5月11日 09:00' });
    expect(v.due).toBe(true);
    expect(v.gapHours).toBeGreaterThanOrEqual(DEFAULT_GATE_HOURS);
  });

  it('重大事件越过时间门禁', () => {
    const v = settlementDue({ lastSettleTime: '3年5月10日 08:00', nowTime: '3年5月10日 09:00', majorEvent: true });
    expect(v.due).toBe(true);
    expect(v.reason).toContain('重大结算事件');
  });

  it('时间解析不出 → 回合兜底（绝不永远关着）', () => {
    expect(settlementDue({ lastSettleTime: '朔月', nowTime: '望日', lastSettleTurn: 0, nowTurn: FALLBACK_GATE_TURNS - 1 }).due).toBe(false);
    const v = settlementDue({ lastSettleTime: '朔月', nowTime: '望日', lastSettleTurn: 0, nowTurn: FALLBACK_GATE_TURNS });
    expect(v.due).toBe(true);
    expect(v.gapHours).toBeNull();
  });

  it('自定义门禁小时数', () => {
    expect(settlementDue({ lastSettleTime: '3年5月10日 08:00', nowTime: '3年5月10日 20:00', gateHours: 6 }).due).toBe(true);
  });
});

describe('ledgerCheck · ② 四点闭环', () => {
  it('对得上 → Pass', () => {
    const r = checkClosure({ label: '粮仓', opening: 100, inflow: 50, outflow: 30, closing: 120 });
    expect(r.pass).toBe(true);
    expect(r.expected).toBe(120);
    expect(r.line).toContain('✅');
  });

  it('对不上 → Fail 并标出差额', () => {
    const r = checkClosure({ label: '粮仓', opening: 100, inflow: 50, outflow: 30, closing: 150 });
    expect(r.pass).toBe(false);
    expect(r.diff).toBe(30);
    expect(r.line).toContain('❌');
    expect(r.line).toContain('差 +30');
  });

  it('自然增减计入等式', () => {
    expect(checkClosure({ label: '牲口', opening: 20, inflow: 0, outflow: 5, natural: 3, closing: 18 }).pass).toBe(true);
    expect(checkClosure({ label: '牲口', opening: 20, inflow: 0, outflow: 5, natural: -3, closing: 12 }).pass).toBe(true);
  });

  it('浮点容差内算过', () => {
    expect(checkClosure({ label: '现金', opening: 0.1, inflow: 0.2, outflow: 0, closing: 0.3 }).pass).toBe(true);
    expect(CLOSURE_EPS).toBeGreaterThan(0);
  });

  it('⚠ 任一 Fail → 整体不给净值（卡里的硬规则）', () => {
    const r = checkAll([
      { label: 'A', opening: 10, inflow: 0, outflow: 0, closing: 10 },
      { label: 'B', opening: 10, inflow: 0, outflow: 0, closing: 99 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.report).toContain('待补明细');
  });

  it('全 Pass → 不出警告', () => {
    const r = checkAll([{ label: 'A', opening: 10, inflow: 5, outflow: 5, closing: 10 }]);
    expect(r.ok).toBe(true);
    expect(r.report).not.toContain('待补明细');
  });

  it('空清单视为通过', () => {
    expect(checkAll([]).ok).toBe(true);
  });
});

describe('ledgerCheck · ③ 常备收支对称（治"正文没写成交就记0收入"）', () => {
  it('没运转 → 零收入合理', () => {
    expect(checkRecurringIncome({ running: false, revenue: 0 }).ok).toBe(true);
  });

  it('有收入记录 → 通过', () => {
    expect(checkRecurringIncome({ running: true, revenue: 120 }).ok).toBe(true);
  });

  it('⚠ 运转中却零收入且无理由 → Fail，并按基线给出应补数', () => {
    const v = checkRecurringIncome({ running: true, revenue: 0, baseIncome: 80 });
    expect(v.ok).toBe(false);
    expect(v.suggested).toBe(80);
    expect(v.reason).toContain('应按基线补记');
  });

  it('零收入有合格理由 → 放行', () => {
    expect(checkRecurringIncome({ running: true, revenue: 0, zeroReason: '本期全部入库未售' }).ok).toBe(true);
  });

  it('理由太短（敷衍）不算合格', () => {
    expect(checkRecurringIncome({ running: true, revenue: 0, zeroReason: '无' }).ok).toBe(false);
  });

  it('无基线可循时要求写明原因', () => {
    const v = checkRecurringIncome({ running: true, revenue: 0 });
    expect(v.suggested).toBe(0);
    expect(v.reason).toContain('必须写明原因');
  });
});

describe('ledgerCheck · 提示词片段', () => {
  it('三条护栏都在，且点明"个人钱包不算重大事件"与"没写成交≠没收入"', () => {
    expect(LEDGER_GUARD_HINT).toContain('周期门禁');
    expect(LEDGER_GUARD_HINT).toContain('四点闭环');
    expect(LEDGER_GUARD_HINT).toContain('个人**钱包变动不算重大事件');
    expect(LEDGER_GUARD_HINT).toContain('没写成交 ≠ 没有收入');
  });
});
