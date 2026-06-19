import { describe, it, expect } from 'vitest';
import {
  tierWindow, tierBounds, templateFromRatio, clampToTierWindow,
  nominalTierNum, bioInnate, bioStrengthLabel,
} from './bioStrength';
import type { PlayerAttrs } from '../store/playerStore';

const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p } as PlayerAttrs);

describe('tierWindow（本阶可出现的档位区间）', () => {
  it('[min(9,t-1), min(9,t+2)]', () => {
    expect(tierWindow(1)).toEqual([0, 3]);
    expect(tierWindow(5)).toEqual([4, 7]);
    expect(tierWindow(13)).toEqual([9, 9]); // 高阶封顶 9
  });
});

describe('tierBounds（阶位 → 单属性 [下限,上限]）', () => {
  it('下限 = 上一阶上限+1（一阶特例 5）', () => {
    expect(tierBounds(1)).toEqual([5, 50]);
    expect(tierBounds(2)).toEqual([51, 80]);
    expect(tierBounds(3)).toEqual([81, 120]);
  });
});

describe('templateFromRatio（预算占用率 → 模板档 0..6）', () => {
  it('边界', () => {
    expect(templateFromRatio(0.20)).toBe(0);
    expect(templateFromRatio(0.30)).toBe(1);
    expect(templateFromRatio(0.50)).toBe(2);
    expect(templateFromRatio(0.70)).toBe(3);
    expect(templateFromRatio(0.90)).toBe(4);
    expect(templateFromRatio(1.00)).toBe(5);
    expect(templateFromRatio(1.50)).toBe(6); // 超满配靠外源
  });
});

describe('clampToTierWindow（档位夹进本阶窗口）', () => {
  it('夹到 [lo,hi]', () => {
    expect(clampToTierWindow(5, 1)).toBe(3);  // 一阶窗口 [0,3]
    expect(clampToTierWindow(-1, 1)).toBe(0);
    expect(clampToTierWindow(2, 1)).toBe(2);
  });
});

describe('nominalTierNum（阶位串/等级 → 序号，取较高者）', () => {
  it('阶位与等级取较高', () => {
    expect(nominalTierNum('三阶')).toBe(3);
    expect(nominalTierNum('五阶', 1)).toBe(5);
    expect(nominalTierNum(undefined, 15)).toBe(2); // realmFromLevel(15)=二阶
  });
});

describe('bioInnate（资质档·峰值口径）', () => {
  it('一阶单属性顶到 50 → 该阶最高档 T3·勇士', () => {
    expect(bioInnate(A({ str: 50 }), '一阶', 1)?.label).toBe('T3·勇士');
  });
  it('一阶全 5 → 最低档 T0·杂鱼', () => {
    expect(bioInnate(A({}), '一阶', 1)?.label).toBe('T0·杂鱼');
  });
  it('无基础六维 → null', () => {
    expect(bioInnate(undefined, '一阶', 1)).toBeNull();
  });
});

describe('bioStrengthLabel（资质/战力合成展示）', () => {
  const t3 = bioInnate(A({ str: 50 }), '一阶', 1);
  const t0 = bioInnate(A({}), '一阶', 1);
  it('两档相同只显一个', () => expect(bioStrengthLabel(t3, t3)).toBe('T3·勇士'));
  it('两档不同显「资质X / 战力Y」', () => expect(bioStrengthLabel(t0, t3)).toBe('资质T0·杂鱼 / 战力T3·勇士'));
  it('都为空 → 空串', () => expect(bioStrengthLabel(null, null)).toBe(''));
  it('只有一档 → 显该档', () => expect(bioStrengthLabel(t3, null)).toBe('T3·勇士'));
});
