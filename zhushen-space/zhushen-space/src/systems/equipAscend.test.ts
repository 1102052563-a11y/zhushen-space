import { describe, it, expect } from 'vitest';
import { nextGradeOf, ascendCost, targetScoreFor, planAscendPayment, isAscendable } from './equipAscend';
import { gradeMidPark, SOUL_TO_PARK } from './itemPricing';
import { ITEM_GRADES, scoreToGradeNum, gradeToNum } from '../store/itemStore';

describe('nextGradeOf（沿 15 档阶梯一次 +1 档）', () => {
  it('逐档递进、名称对齐 ITEM_GRADES', () => {
    expect(nextGradeOf('紫色')).toMatchObject({ from: '紫色', to: '暗紫色', toNum: 5 });
    expect(nextGradeOf('史诗级')).toMatchObject({ to: '圣灵级', toNum: 11 });
  });
  it('创世顶格 → null（无法再进阶）', () => expect(nextGradeOf('创世')).toBeNull());
  it('带后缀的品级文字也能识别', () => expect(nextGradeOf('暗金·三孔')?.to).toBe('传说级'));
  it('isAscendable：只认装备类且未顶格', () => {
    expect(isAscendable({ category: '武器', gradeDesc: '蓝色' })).toBe(true);
    expect(isAscendable({ category: '材料', gradeDesc: '蓝色' })).toBe(false);
    expect(isAscendable({ category: '武器', gradeDesc: '创世' })).toBe(false);
  });
});

describe('ascendCost 锚定公允价表（防"进阶比买还便宜"套利）', () => {
  it('费用＝档位价值增量的一半，且逐档递增', () => {
    for (let t = 3; t <= ITEM_GRADES.length; t++) {
      expect(ascendCost(t)).toBeGreaterThan(ascendCost(t - 1));
    }
    const delta = gradeMidPark(11) - gradeMidPark(10);
    expect(ascendCost(11)).toBe(Math.round(delta * 0.5));
  });
  it('★ 各档费用都落在「目标档公允价」的 20%~60%（与强化打满 +16 的 25~60% 同量级）', () => {
    for (let t = 4; t <= 13; t++) {
      const ratio = ascendCost(t) / gradeMidPark(t);
      expect(ratio).toBeGreaterThan(0.2);
      expect(ratio).toBeLessThan(0.6);
    }
  });
  it('★ 圣灵级进阶不再是白菜价：旧曲线 18 万，现应 ≥ 1000 万乐园币', () => {
    expect(ascendCost(11)).toBeGreaterThan(10_000_000);
  });
  it('武器分类系数使其略贵于防具', () => {
    expect(ascendCost(9, '武器')).toBeGreaterThan(ascendCost(9, '防具'));
  });
  it('越界钳位：目标档 ≤1 视为 2、>15 视为 15', () => {
    expect(ascendCost(0)).toBe(ascendCost(2));
    expect(ascendCost(99)).toBe(ascendCost(15));
  });
});

describe('targetScoreFor（评分必须落回目标档，否则被 normalizeGradeLabel 钳降）', () => {
  it('1~14 档：评分反查回同一档', () => {
    for (let t = 1; t <= 14; t++) expect(scoreToGradeNum(targetScoreFor(t))).toBe(t);
  });
  it('创世(15)：评分不由自动落档承载，但要高到触发 keepGenesis（≥起源档）', () => {
    expect(scoreToGradeNum(targetScoreFor(15))).toBeGreaterThanOrEqual(13);
  });
  it('评分与品级名自洽（gradeToNum 与 scoreToGradeNum 同档）', () => {
    for (let t = 2; t <= 14; t++) expect(gradeToNum(ITEM_GRADES[t - 1])).toBe(t);
  });
});

describe('planAscendPayment（乐园币优先·魂币补缺口·找零退回）', () => {
  it('乐园币充足 → 只扣乐园币', () => {
    expect(planAscendPayment(5000, { park: 9000, soul: 3 })).toEqual({ parkDelta: -5000, soulDelta: 0 });
  });
  it('乐园币不足 → 花光乐园币 + 魂币向上取整补，找零退回乐园币', () => {
    const p = planAscendPayment(SOUL_TO_PARK + 50_000, { park: 20_000, soul: 5 })!;
    expect(p.soulDelta).toBe(-2);                       // 缺口 180,000 → 需 2 魂币(300,000)
    expect(p.parkDelta).toBe(-20_000 + 120_000);        // 找零 120,000 退回
    // 结算恒等式：净支出（折乐园币）＝ 费用
    expect(-p.parkDelta + -p.soulDelta * SOUL_TO_PARK).toBe(SOUL_TO_PARK + 50_000);
  });
  it('恰好整数魂币 → 无找零', () => {
    const p = planAscendPayment(SOUL_TO_PARK * 3, { park: 0, soul: 3 })!;
    expect(p).toEqual({ parkDelta: 0, soulDelta: -3 });
  });
  it('两币合计仍不够 → null（前端据此禁用按钮）', () => {
    expect(planAscendPayment(SOUL_TO_PARK * 10, { park: 100, soul: 2 })).toBeNull();
  });
  it('圣灵级进阶：五阶玩家(百万级身家)付不起、魂币玩家付得起', () => {
    const cost = ascendCost(11);
    expect(planAscendPayment(cost, { park: 1_000_000, soul: 0 })).toBeNull();
    expect(planAscendPayment(cost, { park: 0, soul: 200 })).not.toBeNull();
  });
});
