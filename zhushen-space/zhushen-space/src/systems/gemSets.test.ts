import { describe, it, expect } from 'vitest';
import {
  setForGem, activeGemSets, gemSetAttrDelta, gemSetPassive, gemSetEquipEntry, gemSetSummaryLine, GEM_SETS,
} from './gemSets';
import type { SocketedGem } from '../store/itemStore';

const gem = (attr: string, set?: string): SocketedGem => ({
  gemId: 'g' + attr + Math.random(), name: attr + '晶', tier: '紫色', slot: '通用', attr, statText: '', high: false, set,
});
const equip = (gems: SocketedGem[], equipped = true) => ({ equipped, gems });

describe('setForGem（宝石属性 → 唯一套装归属）', () => {
  it('攻击类 → 裂空杀阵(rift)', () => {
    for (const a of ['力量', '武器锋利度', '无视防御', '暴击率', '暴击伤害', '会心一击']) expect(setForGem(a)).toBe('rift');
  });
  it('防御类 → 不灭壁垒(bulwark)', () => {
    for (const a of ['体质', '生命', '基础防御', '伤害减免', '格挡', '全抗性']) expect(setForGem(a)).toBe('bulwark');
  });
  it('元素/敏/财 各归其位', () => {
    expect(setForGem('智力')).toBe('element');
    expect(setForGem('烈焰附魔')).toBe('element');
    expect(setForGem('敏捷')).toBe('gale');
    expect(setForGem('急速')).toBe('gale');
    expect(setForGem('幸运')).toBe('fortune');
    expect(setForGem('采掘')).toBe('fortune');
  });
  it('未知属性回退聚宝天工', () => expect(setForGem('无名属性')).toBe('fortune'));
  it('每颗内置宝石属性都能映射到已定义套装', () => {
    const keys = new Set(GEM_SETS.map((s) => s.key));
    for (const s of GEM_SETS) expect(keys.has(s.key)).toBe(true);
  });
});

describe('activeGemSets（跨已装备装备统计·2/4/6 阶梯）', () => {
  it('少于 2 件不成套', () => {
    expect(activeGemSets([equip([gem('力量', 'rift')])])).toEqual([]);
  });
  it('2 件 → 仅 2 件套激活', () => {
    const sets = activeGemSets([equip([gem('力量', 'rift'), gem('暴击率', 'rift')])]);
    expect(sets).toHaveLength(1);
    expect(sets[0].key).toBe('rift');
    expect(sets[0].count).toBe(2);
    expect(sets[0].tiers.find((t) => t.need === 2)!.active).toBe(true);
    expect(sets[0].tiers.find((t) => t.need === 4)!.active).toBe(false);
  });
  it('6 件（跨多件装备）→ 全档激活', () => {
    const gems = Array.from({ length: 6 }, () => gem('力量', 'rift'));
    const sets = activeGemSets([equip(gems.slice(0, 3)), equip(gems.slice(3))]);
    expect(sets[0].count).toBe(6);
    expect(sets[0].tiers.every((t) => t.active)).toBe(true);
  });
  it('只统计已装备装备（未装备的宝石不计）', () => {
    const sets = activeGemSets([equip([gem('力量', 'rift'), gem('暴击率', 'rift')], false)]);
    expect(sets).toEqual([]);
  });
  it('旧档无 set 字段 → 按属性回填统计', () => {
    const sets = activeGemSets([equip([gem('力量'), gem('暴击伤害')])]);   // set 未填
    expect(sets[0]?.key).toBe('rift');
    expect(sets[0]?.count).toBe(2);
  });
});

describe('套装加成汇总（六维 attrs + 战斗被动 passive）', () => {
  const sixRift = [equip(Array.from({ length: 6 }, () => gem('力量', 'rift')))];
  it('裂空杀阵满 6 件：暴击率/暴伤/穿透 + 力量', () => {
    const p = gemSetPassive(sixRift);
    expect(p.critChance).toBeCloseTo(0.08);
    expect(p.critMult).toBeCloseTo(0.30);
    expect(p.pierce).toBeCloseTo(0.30);
    expect(gemSetAttrDelta(sixRift).str).toBe(25);
  });
  it('仅 2 件：只有暴击率，无暴伤/穿透', () => {
    const two = [equip([gem('力量', 'rift'), gem('暴击率', 'rift')])];
    const p = gemSetPassive(two);
    expect(p.critChance).toBeCloseTo(0.08);
    expect(p.critMult).toBeUndefined();
    expect(p.pierce).toBeUndefined();
  });
  it('不灭壁垒 6 件：减伤累加、体质累加', () => {
    const six = [equip(Array.from({ length: 6 }, () => gem('体质', 'bulwark')))];
    expect(gemSetPassive(six).dmgTakenPct).toBeCloseTo(-0.30);   // -0.12 + -0.18
    expect(gemSetAttrDelta(six).con).toBe(35);                    // 15 + 20
  });
});

describe('gemSetEquipEntry / summary', () => {
  it('六维套装加成包成【套装加成】effect 条目', () => {
    const entry = gemSetEquipEntry([equip(Array.from({ length: 6 }, () => gem('力量', 'rift')))]);
    expect(entry?.effect).toContain('力量+25');
    expect(entry?.effect).toContain('套装加成');
  });
  it('无激活套装六维 → null', () => {
    expect(gemSetEquipEntry([equip([gem('力量', 'rift')])])).toBeNull();
  });
  it('摘要行含套装名与件数', () => {
    const line = gemSetSummaryLine([equip([gem('力量', 'rift'), gem('暴击率', 'rift')])]);
    expect(line).toContain('裂空杀阵');
    expect(line).toContain('2件');
  });
});
