import { describe, it, expect } from 'vitest';
import { parseAttrRequirement, unmetRequirements } from './attrBonus';
import type { PlayerAttrs } from '../store/playerStore';

const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p });

describe('parseAttrRequirement（装备需求→六维门槛，分 普通/真实 两桶，取每项最大值）', () => {
  it('普通尺度：名在前 / 数在前 / 别名', () => {
    expect(parseAttrRequirement('力量 5点')).toEqual({ normal: { str: 5 }, real: {} });
    expect(parseAttrRequirement('智力50')).toEqual({ normal: { int: 50 }, real: {} });
    expect(parseAttrRequirement('50点力量')).toEqual({ normal: { str: 50 }, real: {} });
    expect(parseAttrRequirement('体魄 30')).toEqual({ normal: { con: 30 }, real: {} });
    expect(parseAttrRequirement('力量20、敏捷15')).toEqual({ normal: { str: 20, agi: 15 }, real: {} });
  });
  it('真实尺度：带「真实」前缀 → real 桶', () => {
    expect(parseAttrRequirement('真实力量300')).toEqual({ normal: {}, real: { str: 300 } });
    expect(parseAttrRequirement('真实·魅力150')).toEqual({ normal: {}, real: { cha: 150 } });
    expect(parseAttrRequirement('300点真实力量')).toEqual({ normal: {}, real: { str: 300 } });
  });
  it('普通/真实混写 → 各归各桶', () => {
    expect(parseAttrRequirement('力量50、真实敏捷200')).toEqual({ normal: { str: 50 }, real: { agi: 200 } });
  });
  it('无需求 / 空 / 百分比不计', () => {
    expect(parseAttrRequirement('无')).toEqual({ normal: {}, real: {} });
    expect(parseAttrRequirement(undefined)).toEqual({ normal: {}, real: {} });
    expect(parseAttrRequirement('暴击+10%')).toEqual({ normal: {}, real: {} });
  });
});

describe('unmetRequirements（普通需求：真实属性玩家自动满足；真实需求：人人逐值比）', () => {
  it('普通玩家(一~三阶)：普通需求逐值比', () => {
    expect(unmetRequirements('力量 5', A({ str: 10 }), false)).toEqual([]);
    expect(unmetRequirements('智力50', A({ int: 50 }), false)).toEqual([]);   // 恰好达标(>=)
    expect(unmetRequirements('智力50', A({ int: 5 }), false)).toEqual([{ key: 'int', label: '智力', need: 50, have: 5, real: false }]);
  });
  it('真实属性玩家(四阶+)：普通需求自动满足（用户案例：150 真实魅力 穿 300 普通魅力）', () => {
    expect(unmetRequirements('魅力300', A({ cha: 150 }), true)).toEqual([]);
    expect(unmetRequirements('力量20、敏捷15', A({ str: 5, agi: 5 }), true)).toEqual([]);
  });
  it('真实尺度需求：真实属性玩家仍逐值比（写明「真实X」才卡）', () => {
    expect(unmetRequirements('真实魅力300', A({ cha: 150 }), true)).toEqual([{ key: 'cha', label: '魅力', need: 300, have: 150, real: true }]);
    expect(unmetRequirements('真实魅力300', A({ cha: 300 }), true)).toEqual([]);
  });
  it('无需求 → 可穿', () => {
    expect(unmetRequirements('无', A({}), true)).toEqual([]);
    expect(unmetRequirements(undefined, A({}), false)).toEqual([]);
  });
});
