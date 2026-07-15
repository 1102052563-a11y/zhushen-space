import { describe, it, expect } from 'vitest';
import { computeOffset, bandOf, canonWorldName, SEVERITY_POINTS } from './chaosWorld';

describe('computeOffset（剧情偏移度：逐偏移点严重度非线性求和·封顶100）', () => {
  it('无偏移点 → 0 · 微澜', () => {
    expect(computeOffset([])).toEqual({ offset: 0, band: '微澜' });
    expect(computeOffset(null)).toEqual({ offset: 0, band: '微澜' });
  });

  it('严重度分值按 SEVERITY_POINTS 累加', () => {
    // 一处彻底颠覆(3)=40 → 改道
    expect(computeOffset([{ 原著节点: 'a', 主角改动: 'b', 严重度: 3 }]).offset).toBe(SEVERITY_POINTS[3]);
    // 一处轻微(1)=8 → 微澜
    const r = computeOffset([{ 原著节点: 'a', 主角改动: 'b', 严重度: 1 }]);
    expect(r.offset).toBe(8);
    expect(r.band).toBe('微澜');
  });

  it('一处剧变 > 多处细节扰动（非线性）', () => {
    const oneBig = computeOffset([{ 原著节点: '', 主角改动: '', 严重度: 3 }]).offset;   // 40
    const manySmall = computeOffset([1, 1, 1].map(() => ({ 原著节点: '', 主角改动: '', 严重度: 1 }))).offset;  // 24
    expect(oneBig).toBeGreaterThan(manySmall);
  });

  it('累加超过 100 时封顶 100（崩坏）', () => {
    const nodes = [3, 3, 3].map(() => ({ 原著节点: '', 主角改动: '', 严重度: 3 }));   // 120 → 100
    const r = computeOffset(nodes);
    expect(r.offset).toBe(100);
    expect(r.band).toBe('崩坏');
  });

  it('严重度越界/脏值被夹到 0~3', () => {
    expect(computeOffset([{ 原著节点: '', 主角改动: '', 严重度: 9 }]).offset).toBe(SEVERITY_POINTS[3]);
    expect(computeOffset([{ 原著节点: '', 主角改动: '', 严重度: -5 }]).offset).toBe(0);
    expect(computeOffset([{ 原著节点: '', 主角改动: '', 严重度: NaN as any }]).offset).toBe(0);
  });
});

describe('bandOf（偏移分档）', () => {
  it('分档边界', () => {
    expect(bandOf(0)).toBe('微澜');
    expect(bandOf(19)).toBe('微澜');
    expect(bandOf(20)).toBe('涟漪');
    expect(bandOf(40)).toBe('改道');
    expect(bandOf(60)).toBe('剧变');
    expect(bandOf(80)).toBe('崩坏');
    expect(bandOf(100)).toBe('崩坏');
  });
});

describe('canonWorldName（世界名归一·分组键兼展示名）', () => {
  it('收敛空白', () => {
    expect(canonWorldName('  生化危机  ')).toBe('生化危机');
    expect(canonWorldName('Resident  Evil')).toBe('Resident Evil');   // 不小写·仅并空格
  });

  it('去掉尾部装饰后缀 → 同世界归并', () => {
    expect(canonWorldName('生化危机世界')).toBe('生化危机');
    expect(canonWorldName('生化危机')).toBe('生化危机');
    expect(canonWorldName('海贼王位面')).toBe('海贼王');
  });

  it('全为后缀时不清空（回退原串）', () => {
    expect(canonWorldName('世界')).toBe('世界');
  });
});
