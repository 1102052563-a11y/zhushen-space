import { describe, it, expect } from 'vitest';
import {
  buyChipsQuote, cashOutQuote,
  settleSicbo, rouletteColor, settleRoulette, ladderPotAt,
  settleGladiatorBet, handValue, isBlackjack, settleBlackjack, soulStake,
  type SicboRoll,
} from './casinoEngine';

const c = (rank: number, suit = 0) => ({ rank, suit });
const roll = (dice: [number, number, number]): SicboRoll => ({ dice, sum: dice[0] + dice[1] + dice[2], isTriple: dice[0] === dice[1] && dice[1] === dice[2] });

describe('筹码兑换 quote（扣抽水后向下取整）', () => {
  it('买/兑现', () => {
    expect(buyChipsQuote(100, 0.1)).toEqual({ chips: 90, spend: 100 });
    expect(buyChipsQuote(100, 0)).toEqual({ chips: 100, spend: 100 });
    expect(cashOutQuote(100, 0.1)).toEqual({ coins: 90, chips: 100 });
  });
  it('负数夹 0', () => expect(buyChipsQuote(-5, 0.1)).toEqual({ chips: 0, spend: 0 }));
});

describe('骰宝 settleSicbo（净筹码变动）', () => {
  it('押大·点11(非豹子) → 赢本金', () => {
    expect(settleSicbo({ kind: 'big', amount: 10 }, roll([5, 5, 1]))).toMatchObject({ win: true, profit: 10 });
  });
  it('押小·点11 → 输', () => {
    expect(settleSicbo({ kind: 'small', amount: 10 }, roll([5, 5, 1]))).toMatchObject({ win: false, profit: -10 });
  });
  it('豹子通杀大小注', () => {
    expect(settleSicbo({ kind: 'big', amount: 10 }, roll([3, 3, 3]))).toMatchObject({ win: false, profit: -10 });
  });
  it('押豹子中 → 30 倍', () => {
    expect(settleSicbo({ kind: 'triple', amount: 10 }, roll([3, 3, 3]))).toMatchObject({ win: true, profit: 300, payoutOdds: 30 });
  });
  it('押单点·出现两次 → 2:1', () => {
    expect(settleSicbo({ kind: 'single', point: 4, amount: 10 }, roll([4, 4, 1]))).toMatchObject({ win: true, profit: 20 });
  });
});

describe('轮盘 rouletteColor / settleRoulette', () => {
  it('颜色', () => {
    expect(rouletteColor(0)).toBe('green');
    expect(rouletteColor(1)).toBe('red');
    expect(rouletteColor(2)).toBe('black');
  });
  it('红注开红 → 赢；开黑 → 输', () => {
    expect(settleRoulette({ kind: 'red', amount: 10 }, 1)).toMatchObject({ win: true, profit: 10 });
    expect(settleRoulette({ kind: 'red', amount: 10 }, 2)).toMatchObject({ win: false, profit: -10 });
  });
  it('开 0 通杀平赔注', () => {
    expect(settleRoulette({ kind: 'red', amount: 10 }, 0)).toMatchObject({ win: false, profit: -10 });
  });
  it('直注命中 → 35 倍', () => {
    expect(settleRoulette({ kind: 'straight', number: 17, amount: 10 }, 17)).toMatchObject({ win: true, profit: 350 });
  });
  it('单双/大小', () => {
    expect(settleRoulette({ kind: 'odd', amount: 10 }, 3).win).toBe(true);
    expect(settleRoulette({ kind: 'high', amount: 10 }, 19).win).toBe(true);
    expect(settleRoulette({ kind: 'low', amount: 10 }, 18).win).toBe(true);
  });
});

describe('翻倍梯子 ladderPotAt = bet × 2^step', () => {
  it('彩池', () => {
    expect(ladderPotAt(10, 0)).toBe(10);
    expect(ladderPotAt(10, 3)).toBe(80);
  });
});

describe('角斗场 settleGladiatorBet', () => {
  it('押中 → 注×(赔率−1)；押错 → −注', () => {
    expect(settleGladiatorBet(0, 100, 0, [2, 2])).toEqual({ win: true, profit: 100 });
    expect(settleGladiatorBet(0, 100, 1, [2, 2])).toEqual({ win: false, profit: -100 });
  });
});

describe('21点 handValue / isBlackjack / settleBlackjack', () => {
  it('点数（A 软硬、花牌=10）', () => {
    expect(handValue([c(10), c(5)])).toEqual({ total: 15, soft: false });
    expect(handValue([c(1), c(5)])).toEqual({ total: 16, soft: true });   // 软16
    expect(handValue([c(1), c(10)])).toEqual({ total: 21, soft: true });  // 黑杰克
    expect(handValue([c(13), c(12), c(5)])).toEqual({ total: 25, soft: false }); // 爆
  });
  it('isBlackjack 仅两张 21', () => {
    expect(isBlackjack([c(1), c(13)])).toBe(true);
    expect(isBlackjack([c(1), c(5), c(5)])).toBe(false);
  });
  it('结算', () => {
    expect(settleBlackjack([c(1), c(13)], [c(10), c(7)], 100, false)).toEqual({ outcome: 'blackjack', profit: 150 });
    expect(settleBlackjack([c(10), c(10), c(5)], [c(10), c(7)], 100, false)).toEqual({ outcome: 'bust', profit: -100 });
    expect(settleBlackjack([c(10), c(10)], [c(10), c(10)], 100, false)).toEqual({ outcome: 'push', profit: 0 });
    expect(settleBlackjack([c(10), c(10)], [c(10), c(8)], 100, false)).toEqual({ outcome: 'win', profit: 100 });
    expect(settleBlackjack([c(10), c(10)], [c(10), c(8)], 100, true)).toEqual({ outcome: 'win', profit: 200 }); // 加倍
  });
});

describe('魂赌 soulStake', () => {
  it('按 kind 取，未知兜底首项(魂币)', () => {
    expect(soulStake('item').kind).toBe('item');
    expect(soulStake('talent').kind).toBe('talent');
    expect(soulStake('xxx' as never).kind).toBe('soulcoin');
  });
});
