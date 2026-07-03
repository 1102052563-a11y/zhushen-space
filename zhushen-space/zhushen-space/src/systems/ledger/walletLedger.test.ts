import { describe, it, expect, beforeEach } from 'vitest';
import { walletReset, walletAdjust, walletSeed, walletLedger } from './walletCore';

// 乐园币流水：每笔增减 + 缘由 + 当时余额，折叠事件溯源日志算 running balance，最新在前。
describe('walletLedger（货币流水·带缘由）', () => {
  beforeEach(() => walletReset());

  it('★每笔增减带缘由 + running balance，最新在前；seed 基线不列', () => {
    walletSeed({ 乐园币: 100 });                          // 基线 100（不算流水）
    walletAdjust('乐园币', 50, { reason: '击杀掉落' });    // →150
    walletAdjust('乐园币', -20, { reason: '购买药水' });   // →130
    const led = walletLedger('乐园币');
    expect(led.length).toBe(2);                            // seed 不计
    expect(led[0]).toMatchObject({ delta: -20, reason: '购买药水', balance: 130 });   // 最新在前
    expect(led[1]).toMatchObject({ delta: 50, reason: '击杀掉落', balance: 150 });
  });

  it('按货币类型过滤（乐园币 / 灵魂钱币 各自独立）', () => {
    walletAdjust('乐园币', 10, { reason: 'a' });
    walletAdjust('灵魂钱币', 5, { reason: 'b' });
    expect(walletLedger('乐园币').map((t) => t.reason)).toEqual(['a']);
    expect(walletLedger('灵魂钱币').map((t) => t.reason)).toEqual(['b']);
  });

  it('缺省缘由 → 显示「未标注」', () => {
    walletAdjust('乐园币', 10);
    expect(walletLedger('乐园币')[0].reason).toBe('未标注');
  });

  it('零变动不记流水', () => {
    walletAdjust('乐园币', 0, { reason: '空操作' });
    expect(walletLedger('乐园币').length).toBe(0);
  });

  it('★running balance 与内核同口径（余额钳到 0·delta 记实际变化）', () => {
    walletSeed({ 乐园币: 10 });
    walletAdjust('乐园币', -100, { reason: '超支' });   // 10-100 → 钳到 0
    const t = walletLedger('乐园币')[0];
    expect(t.balance).toBe(0);
    expect(t.delta).toBe(-10);   // 实际只扣掉了 10（从 10 到 0）
  });

  it('limit 截断保留最近 N 笔', () => {
    for (let i = 1; i <= 5; i++) walletAdjust('乐园币', 1, { reason: `第${i}笔` });
    const led = walletLedger('乐园币', 3);
    expect(led.length).toBe(3);
    expect(led[0].reason).toBe('第5笔');   // 最新
    expect(led[2].reason).toBe('第3笔');   // 最近3笔里最旧
  });
});
