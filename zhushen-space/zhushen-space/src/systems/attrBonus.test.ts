import { describe, it, expect } from 'vitest';
import { parseAttrRequirement, unmetRequirements } from './attrBonus';
import type { PlayerAttrs } from '../store/playerStore';

const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p });

describe('parseAttrRequirement（装备需求→六维门槛，取每项最大值）', () => {
  it('名在前·各种写法', () => {
    expect(parseAttrRequirement('力量 5点')).toEqual({ str: 5 });
    expect(parseAttrRequirement('智力50')).toEqual({ int: 50 });
    expect(parseAttrRequirement('敏捷 18')).toEqual({ agi: 18 });
    expect(parseAttrRequirement('力量10可发挥最大威力')).toEqual({ str: 10 });
  });
  it('数在前 / 多项并存', () => {
    expect(parseAttrRequirement('50点力量')).toEqual({ str: 50 });
    expect(parseAttrRequirement('力量20、敏捷15')).toEqual({ str: 20, agi: 15 });
  });
  it('别名归一（体魄=体质 / 智慧=智力）', () => {
    expect(parseAttrRequirement('体魄 30')).toEqual({ con: 30 });
    expect(parseAttrRequirement('智慧 40')).toEqual({ int: 40 });
  });
  it('无需求 / 空 / 百分比不计', () => {
    expect(parseAttrRequirement('无')).toEqual({});
    expect(parseAttrRequirement('')).toEqual({});
    expect(parseAttrRequirement(undefined)).toEqual({});
    expect(parseAttrRequirement('暴击+10%')).toEqual({});
  });
});

describe('unmetRequirements（未达标项；空数组＝可穿戴）', () => {
  it('满足 → 空', () => {
    expect(unmetRequirements('力量 5', A({ str: 10 }))).toEqual([]);
    expect(unmetRequirements('无', A({}))).toEqual([]);
    expect(unmetRequirements(undefined, A({}))).toEqual([]);
  });
  it('恰好达标（>=）→ 可穿戴', () => {
    expect(unmetRequirements('智力50', A({ int: 50 }))).toEqual([]);
  });
  it('不足 → 列出缺口', () => {
    expect(unmetRequirements('智力50', A({ int: 5 }))).toEqual([{ key: 'int', label: '智力', need: 50, have: 5 }]);
  });
  it('多项部分不足 → 只列不足项', () => {
    const r = unmetRequirements('力量20、敏捷15', A({ str: 25, agi: 8 }));
    expect(r).toEqual([{ key: 'agi', label: '敏捷', need: 15, have: 8 }]);
  });
});
