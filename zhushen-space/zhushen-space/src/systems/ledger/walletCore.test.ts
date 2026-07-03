import { describe, it, expect, beforeEach } from 'vitest';
import { walletAdjust, walletSet, walletSeed, walletBalances, walletWatchdog, reconcileWallet, walletReset, walletSnapshot, walletRestore } from './walletCore';

beforeEach(() => walletReset());

describe('walletCore（Step 10 货币事件核心·影子+对账）', () => {
  it('adjust 复刻 itemStore：max(0, cur+delta)（零行为差）', () => {
    walletAdjust('乐园币', 100);
    walletAdjust('乐园币', -30);
    expect(walletBalances()['乐园币']).toBe(70);
    walletAdjust('乐园币', -999);   // 透支 → 夹到 0
    expect(walletBalances()['乐园币']).toBe(0);
  });

  it('幂等键治双计：同 id 记两次 = 一次', () => {
    walletAdjust('乐园币', 100, { id: '结算奖励#w5' });
    walletAdjust('乐园币', 100, { id: '结算奖励#w5' });   // 复读/重试同一奖励
    expect(walletBalances()['乐园币']).toBe(100);          // 不是 200
  });

  it('无 id 的同额可合法重复（不误去重）', () => {
    walletAdjust('乐园币', 100);
    walletAdjust('乐园币', 100);   // 买两次各 100
    expect(walletBalances()['乐园币']).toBe(200);
  });

  it('set 合并', () => {
    walletSet({ 灵魂钱币: 5, 技能点: 2 });
    expect(walletBalances()['灵魂钱币']).toBe(5);
    expect(walletBalances()['技能点']).toBe(2);
  });

  it('对账看门狗抓漂移：核心 vs live 不一致', () => {
    walletAdjust('乐园币', 100);
    expect(reconcileWallet({ 乐园币: 300 })).toEqual([{ key: '乐园币', core: 100, live: 300 }]);   // 绕过闸门被改成 300
    expect(reconcileWallet({ 乐园币: 100 })).toEqual([]);   // 一致→无漂移
  });

  it('看门狗抓负余额（set 绕过夹取）', () => {
    walletSet({ 乐园币: -50 });
    expect(walletWatchdog()).toEqual(['货币为负：乐园币=-50']);
  });

  it('seed 播种（迁移）', () => {
    walletSeed({ 乐园币: 888, 魂币: 12 });
    expect(walletBalances()).toEqual({ 乐园币: 888, 魂币: 12 });
  });

  it('快照往返 + 幂等窗口保留', () => {
    walletAdjust('乐园币', 100, { id: 'x' });
    const snap = walletSnapshot();
    walletReset();
    expect(walletBalances()['乐园币'] ?? 0).toBe(0);
    walletRestore(snap);
    expect(walletBalances()['乐园币']).toBe(100);
    walletAdjust('乐园币', 100, { id: 'x' });   // 老 id 仍去重
    expect(walletBalances()['乐园币']).toBe(100);
  });
});
