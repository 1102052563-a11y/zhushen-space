import { describe, it, expect } from 'vitest';
import {
  estimateFairValue, priceVerdict, priceToPark, resolveGradeNum,
  formatFairRange, sumFairValues, SOUL_TO_PARK,
} from './itemPricing';

describe('resolveGradeNum（评分优先、品级兜底）', () => {
  it('有评分时按评分落档（覆盖品级文字）', () => {
    expect(resolveGradeNum({ score: '50', gradeDesc: '创世' })).toBe(3); // 50 → 蓝色档，压过创世
    expect(resolveGradeNum({ score: 5 })).toBe(1);   // 白色
    expect(resolveGradeNum({ score: 800 })).toBe(10); // 史诗级
  });
  it('无评分时按品级文字', () => {
    expect(resolveGradeNum({ gradeDesc: '蓝色' })).toBe(3);
    expect(resolveGradeNum({ gradeDesc: '金色' })).toBe(7);
    expect(resolveGradeNum({ gradeDesc: '起源' })).toBe(13);
  });
  it('缺失/非法 → 兜底白色(1)，并夹在 1..15', () => {
    expect(resolveGradeNum({})).toBe(1);
    expect(resolveGradeNum({ gradeDesc: '不存在的颜色' })).toBe(1);
  });
});

describe('estimateFairValue（公允价区间）', () => {
  it('蓝色无分类：3,500–6,000 乐园币', () => {
    const f = estimateFairValue({ gradeDesc: '蓝色' });
    expect([f.low, f.high]).toEqual([3500, 6000]);
    expect(f.currency).toBe('乐园币');
    expect(f.gradeName).toBe('蓝色');
    expect(f.strategic).toBe(false);
  });
  it('分类系数：武器 ×1.15、丹药 ×0.5、技能书 ×1.8', () => {
    expect(estimateFairValue({ gradeDesc: '蓝色', category: '武器' }).low).toBe(Math.round(3500 * 1.15));
    expect(estimateFairValue({ gradeDesc: '蓝色', category: '丹药' }).high).toBe(Math.round(6000 * 0.5));
    expect(estimateFairValue({ gradeDesc: '蓝色', category: '技能书' }).low).toBe(Math.round(3500 * 1.8));
  });
  it('数量按倍累计', () => {
    expect(estimateFairValue({ gradeDesc: '蓝色', qty: 3 }).low).toBe(3500 * 3);
  });
  it('金色 → 改用魂币展示（2–6 魂币）', () => {
    const f = estimateFairValue({ gradeDesc: '金色' });
    expect(f.currency).toBe('灵魂钱币');
    expect([f.lowDisp, f.highDisp]).toEqual([2, 6]);
  });
  it('起源(13)+ 标记战略级', () => {
    expect(estimateFairValue({ gradeDesc: '起源' }).strategic).toBe(true);
    expect(estimateFairValue({ gradeDesc: '永恒' }).strategic).toBe(true);
  });
});

describe('priceToPark（折算乐园币·跨币种比较）', () => {
  it('1 魂币 = 150,000 乐园币', () => {
    expect(SOUL_TO_PARK).toBe(150000);
    expect(priceToPark(2, '魂币')).toBe(300000);
    expect(priceToPark(2, '灵魂钱币')).toBe(300000);
    expect(priceToPark(100, '乐园币')).toBe(100);
  });
});

describe('priceVerdict（出售：玩家要价）', () => {
  const fair = estimateFairValue({ gradeDesc: '蓝色' }); // 3500–6000，mid 4750
  it('面议(无价) → unknown', () => {
    expect(priceVerdict('sell', 0, '乐园币', fair).verdict).toBe('unknown');
  });
  it('离谱虚高（>高位×3）→ absurdHigh', () => {
    expect(priceVerdict('sell', 100000, '乐园币', fair).verdict).toBe('absurdHigh');
  });
  it('偏高（>高位×1.4）→ high', () => {
    expect(priceVerdict('sell', 9000, '乐园币', fair).verdict).toBe('high');
  });
  it('接近公允 → fair', () => {
    expect(priceVerdict('sell', 5000, '乐园币', fair).verdict).toBe('fair');
  });
  it('贱卖（<低位×0.35）→ absurdLow', () => {
    expect(priceVerdict('sell', 1000, '乐园币', fair).verdict).toBe('absurdLow');
  });
});

describe('priceVerdict（求购：玩家预算）', () => {
  const fair = estimateFairValue({ gradeDesc: '金色' }); // 300k–900k 乐园币
  it('预算严重不足（<低位×0.3）→ absurdLow（卖家拒绝/嘲笑）', () => {
    expect(priceVerdict('buy', 1000, '乐园币', fair).verdict).toBe('absurdLow');
  });
  it('预算偏低 → low', () => {
    expect(priceVerdict('buy', 1, '灵魂钱币', fair).verdict).toBe('low'); // 1 魂币=150k < 300k×0.7
  });
  it('跨币种合理预算 → fair', () => {
    expect(priceVerdict('buy', 5, '灵魂钱币', fair).verdict).toBe('fair'); // 5 魂币=750k，落区间内
  });
  it('当冤大头（>高位×3）→ absurdHigh', () => {
    expect(priceVerdict('buy', 100, '灵魂钱币', fair).verdict).toBe('absurdHigh'); // 100 魂币=1500万 ≫ 900k×3
  });
});

describe('formatFairRange', () => {
  it('展示币种与千分位', () => {
    expect(formatFairRange(estimateFairValue({ gradeDesc: '蓝色' }))).toBe('3,500–6,000 乐园币');
    expect(formatFairRange(estimateFairValue({ gradeDesc: '金色' }))).toBe('2–6 灵魂钱币');
  });
});

describe('sumFairValues（套装求和）', () => {
  it('两件蓝色 → 公允价区间相加', () => {
    const sum = sumFairValues([estimateFairValue({ gradeDesc: '蓝色' }), estimateFairValue({ gradeDesc: '蓝色' })]);
    expect([sum.low, sum.high]).toEqual([7000, 12000]);
    expect(sum.currency).toBe('乐园币');
  });
  it('含高档 → 合计够大用魂币展示、strategic 传染', () => {
    const sum = sumFairValues([estimateFairValue({ gradeDesc: '金色' }), estimateFairValue({ gradeDesc: '起源' })]);
    expect(sum.currency).toBe('灵魂钱币');
    expect(sum.strategic).toBe(true);   // 起源为战略级
  });
  it('空数组兜底不崩', () => {
    expect(sumFairValues([]).low).toBeGreaterThan(0);
  });
});
