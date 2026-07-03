import { describe, it, expect } from 'vitest';
import { createEventCore } from './eventCore';

/* 用「钱包」域证明事件溯源内核的性质（对应真实 bug 类：货币双计/静默丢/读档丢/漂移）。 */
type WalletOp = 'deposit' | 'withdraw' | 'forceSet';
interface Wallet { balances: Record<string, number>; }

function makeWallet() {
  return createEventCore<Wallet, WalletOp, any>({
    initial: () => ({ balances: {} }),
    reduce: (s, ev) => {
      const b = { ...s.balances };
      const { currency, amount } = ev.payload;
      if (ev.op === 'deposit') b[currency] = (b[currency] ?? 0) + amount;
      else if (ev.op === 'withdraw') {
        const next = (b[currency] ?? 0) - amount;
        if (next < 0) throw new Error(`余额不足：${currency} ${b[currency] ?? 0} < ${amount}`);   // 抛错=拒绝
        b[currency] = next;
      } else if (ev.op === 'forceSet') b[currency] = amount;   // 模拟"绕过规则的坏写入"，供看门狗抓
      return { balances: b };
    },
    invariants: (s) => Object.entries(s.balances).filter(([, v]) => v < 0).map(([k, v]) => `余额为负：${k}=${v}`),
  });
}
const M = { turn: 1, source: 'test' };

describe('事件溯源内核 · 8 性质', () => {
  it('① 单一闸门 + fold：commit → 状态确定', () => {
    const w = makeWallet();
    const r = w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    expect(r.applied).toBe(1);
    expect(w.getState().balances['乐园币']).toBe(100);
  });

  it('② 幂等键治双计：同 id 提交两次 = 一次', () => {
    const w = makeWallet();
    const ev = { id: 'buy#1', op: 'deposit' as const, payload: { currency: '乐园币', amount: 100 } };
    w.commit([ev], M);
    const r2 = w.commit([ev], M);   // 复读/重试同一条
    expect(r2.applied).toBe(0);
    expect(r2.deduped).toBe(1);
    expect(w.getState().balances['乐园币']).toBe(100);   // 不是 200
  });

  it('②b 默认幂等键：同回合同命令自动去重', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '魂币', amount: 5 } }], M);
    const r = w.commit([{ op: 'deposit', payload: { currency: '魂币', amount: 5 } }], M);   // 无 id·同回合同 payload
    expect(r.deduped).toBe(1);
    expect(w.getState().balances['魂币']).toBe(5);
  });

  it('③ reduce 抛错=拒绝·不变量不破：透支被挡', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    const r = w.commit([{ op: 'withdraw', payload: { currency: '乐园币', amount: 200 } }], M);
    expect(r.applied).toBe(0);
    expect(r.rejected.length).toBe(1);
    expect(w.getState().balances['乐园币']).toBe(100);   // 未变
    expect(w.watchdog()).toEqual([]);                     // 无违规
  });

  it('④ 确定性重放：rebuild ≡ getState', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    w.commit([{ op: 'withdraw', payload: { currency: '乐园币', amount: 30 } }], { turn: 2, source: 'test' });
    w.commit([{ op: 'deposit', payload: { currency: '魂币', amount: 8 } }], { turn: 2, source: 'test' });
    expect(w.rebuild()).toEqual(w.getState());
  });

  it('⑤ 审计日志：每条应用事件带 seq/id/turn/source', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], { turn: 3, source: 'narrative' });
    const log = w.log();
    expect(log.length).toBe(1);
    expect(log[0]).toMatchObject({ seq: 1, op: 'deposit', turn: 3, source: 'narrative' });
    expect(typeof log[0].id).toBe('string');
  });

  it('⑥ 看门狗当场抓漂移：坏写入产生负余额被核对出', () => {
    const w = makeWallet();
    const r = w.commit([{ op: 'forceSet', payload: { currency: '乐园币', amount: -50 } }], M);   // reduce 允许，但违反不变量
    expect(r.violations).toEqual(['余额为负：乐园币=-50']);   // 提交即被抓，不是几周后才发现
    expect(w.watchdog()).toEqual(['余额为负：乐园币=-50']);
  });

  it('⑦ checkpoint 后仍确定性：压实不改状态', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    w.checkpoint();
    expect(w.log().length).toBe(0);
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 50 } }], { turn: 2, source: 'test' });
    expect(w.getState().balances['乐园币']).toBe(150);
    expect(w.rebuild()).toEqual(w.getState());
  });

  it('⑧ 快照往返：restore 后状态一致 + 幂等窗口保留', () => {
    const w = makeWallet();
    w.commit([{ id: 'e1', op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    const snap = w.snapshot();
    const w2 = makeWallet();
    w2.restore(snap);
    expect(w2.getState()).toEqual(w.getState());
    const r = w2.commit([{ id: 'e1', op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);   // 老 id 仍被去重
    expect(r.deduped).toBe(1);
    expect(w2.getState().balances['乐园币']).toBe(100);
  });

  it('外部拿到的 state 就地改不污染内核（深拷贝边界）', () => {
    const w = makeWallet();
    w.commit([{ op: 'deposit', payload: { currency: '乐园币', amount: 100 } }], M);
    const s = w.getState();
    s.balances['乐园币'] = 99999;   // 恶意就地改
    expect(w.getState().balances['乐园币']).toBe(100);   // 内核不受影响
  });
});
