import { describe, it, expect } from 'vitest';
import { parseAttrRequirement, unmetRequirements, stripConditionalAttrSegments, computeAttrBreakdown } from './attrBonus';
import type { PlayerAttrs } from '../store/playerStore';

const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p });

// 用户实测截图里的问题装备：吸血鬼煎药"使用后 60 分钟状态"才给的 体质+15/敏捷+10/魅力-12 被常驻加进了状态栏。
const YUJIN_AFFIX = [
  '【魂源重构】：内置 2 个炼金药剂槽位。药剂在消耗后将于每日 0 点由灵魂结晶自动重构注满；',
  '【槽位一·吸血鬼煎药】：使用后获得持续 60 分钟的「余烬血脉」状态：攻击附带 20% 吸血；受致命伤时触发 2 秒时间迟滞（伤害减免 90%，冷却 10 分钟）；副作用：魅力-12，面部浮现青紫色血管纹路；体质+15、敏捷+10、生命上限+15%；',
  '【槽位二·空】：未填充炼金药剂，可通过消耗稀有材料进行固化。',
].join('\n');

describe('stripConditionalAttrSegments（剔除"需发动/触发/限时状态"条件段落，只留常驻被动）', () => {
  it('含触发词的整条词缀被剔掉（体质+15/敏捷+10/魅力-12 随之消失）', () => {
    const kept = stripConditionalAttrSegments(YUJIN_AFFIX);
    expect(kept).not.toContain('体质+15');
    expect(kept).not.toContain('敏捷+10');
    expect(kept).not.toContain('魅力-12');
    expect(kept).toContain('槽位二');   // 无触发词的段落保留
  });
  it('常驻被动词缀原样保留', () => {
    const passive = '【坚甲】：体质+15，永久生效';
    expect(stripConditionalAttrSegments(passive)).toContain('体质+15');
  });
  it('同一条词缀里"使用后…；…；体质+15"整条判定：+15 不漏计为常驻', () => {
    const one = '【狂暴药剂】：使用后进入狂暴；力量+30；';
    expect(stripConditionalAttrSegments(one)).toBe('');   // 整条被剔
  });
});

describe('装备常驻六维加成：条件加成不计入、常驻计入、condBonus 手动豁免', () => {
  it('吸血鬼煎药：条件六维加成不再常驻加进有效属性（equip 部分为 0）', () => {
    const bd = computeAttrBreakdown(A({}), [], [], [{ affix: YUJIN_AFFIX } as any]);
    expect(bd.con.equip).toBe(0);
    expect(bd.agi.equip).toBe(0);
    expect(bd.cha.equip).toBe(0);
  });
  it('常驻被动装备仍照常计入', () => {
    const bd = computeAttrBreakdown(A({}), [], [], [{ affix: '【坚甲】：体质+15' } as any]);
    expect(bd.con.equip).toBe(15);
  });
  it('condBonus=true（玩家手动"需发动"）→ 整件六维加成一点都不计入', () => {
    const bd = computeAttrBreakdown(A({}), [], [], [{ affix: '体质+15、敏捷+10', condBonus: true } as any]);
    expect(bd.con.equip).toBe(0);
    expect(bd.agi.equip).toBe(0);
  });
  it('主动效果字段 activeEffect 里的六维加成天然不计入常驻（sumBonus 不读此字段）', () => {
    const bd = computeAttrBreakdown(A({}), [], [], [{ activeEffect: '发动后体质+50、力量+30' } as any]);
    expect(bd.con.equip).toBe(0);
    expect(bd.str.equip).toBe(0);
  });
});

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
