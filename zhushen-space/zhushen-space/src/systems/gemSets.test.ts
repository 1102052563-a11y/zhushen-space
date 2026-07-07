import { describe, it, expect } from 'vitest';
import {
  setForGem, activeGemSets, gemSetAttrDelta, gemSetPassive, gemSetEquipEntry, gemSetSummaryLine,
  parseGeneratedSets, normalizeSetDef, DEFAULT_GEM_SETS, type GemSetDef,
} from './gemSets';
import type { SocketedGem } from '../store/itemStore';

const SETS = DEFAULT_GEM_SETS;
const gem = (attr: string, set?: string): SocketedGem => ({
  gemId: 'g' + attr + Math.random(), name: attr + '晶', tier: '紫色', slot: '通用', attr, statText: '', high: false, set,
});
const equip = (gems: SocketedGem[], equipped = true) => ({ equipped, gems });

describe('setForGem（按套装 members 归属·非写死）', () => {
  it('攻击类 → 裂空杀阵(rift)', () => {
    for (const a of ['力量', '武器锋利度', '无视防御', '暴击率', '暴击伤害', '会心一击']) expect(setForGem(a, SETS)).toBe('rift');
  });
  it('防御/元素/敏/财 各归其位', () => {
    expect(setForGem('体质', SETS)).toBe('bulwark');
    expect(setForGem('智力', SETS)).toBe('element');
    expect(setForGem('敏捷', SETS)).toBe('gale');
    expect(setForGem('幸运', SETS)).toBe('fortune');
    expect(setForGem('采掘', SETS)).toBe('fortune');
  });
  it('未匹配任何套装 members → 空串（不归套）', () => expect(setForGem('无名属性', SETS)).toBe(''));
  it('自定义套装列表 → 按其 members 归属', () => {
    const custom: GemSetDef[] = [{ key: 'x', name: '测试套', emoji: '🔮', theme: '自定义', desc: '', members: ['暴击率'], tiers: [{ need: 2, bonus: '力量+5' }] }];
    expect(setForGem('暴击率', custom)).toBe('x');
    expect(setForGem('体质', custom)).toBe('');   // 不在自定义 members 里
  });
});

describe('activeGemSets（跨已装备装备统计·2/4/6 阶梯）', () => {
  it('少于 2 件不成套', () => expect(activeGemSets([equip([gem('力量', 'rift')])], SETS)).toEqual([]));
  it('2 件 → 仅 2 件套激活', () => {
    const sets = activeGemSets([equip([gem('力量', 'rift'), gem('暴击率', 'rift')])], SETS);
    expect(sets).toHaveLength(1);
    expect(sets[0].key).toBe('rift');
    expect(sets[0].tiers.find((t) => t.need === 2)!.active).toBe(true);
    expect(sets[0].tiers.find((t) => t.need === 4)!.active).toBe(false);
  });
  it('6 件（跨多件装备）→ 全档激活', () => {
    const gems = Array.from({ length: 6 }, () => gem('力量', 'rift'));
    const sets = activeGemSets([equip(gems.slice(0, 3)), equip(gems.slice(3))], SETS);
    expect(sets[0].count).toBe(6);
    expect(sets[0].tiers.every((t) => t.active)).toBe(true);
  });
  it('只统计已装备装备', () => expect(activeGemSets([equip([gem('力量', 'rift'), gem('暴击率', 'rift')], false)], SETS)).toEqual([]));
  it('旧档无 set 字段 / 指向已删套装 → 按属性用当前 sets 回填', () => {
    const sets = activeGemSets([equip([gem('力量'), gem('暴击伤害', 'DELETED')])], SETS);
    expect(sets[0]?.key).toBe('rift');
    expect(sets[0]?.count).toBe(2);
  });
});

describe('套装加成从自由文本派生（parseAttrBonus 六维 + inferPassiveFromSkill 被动）', () => {
  const sixRift = [equip(Array.from({ length: 6 }, () => gem('力量', 'rift')))];
  it('裂空杀阵满 6 件：暴击率/暴伤/穿透 + 力量', () => {
    const p = gemSetPassive(sixRift, SETS);
    expect(p.critChance).toBeCloseTo(0.08);
    expect(p.critMult).toBeCloseTo(0.30);
    expect(p.pierce).toBeCloseTo(0.30);
    expect(gemSetAttrDelta(sixRift, SETS).str).toBe(25);
  });
  it('仅 2 件：只有暴击率', () => {
    const p = gemSetPassive([equip([gem('力量', 'rift'), gem('暴击率', 'rift')])], SETS);
    expect(p.critChance).toBeCloseTo(0.08);
    expect(p.critMult).toBeUndefined();
  });
  it('不灭壁垒 6 件：减伤累加、体质累加', () => {
    const six = [equip(Array.from({ length: 6 }, () => gem('体质', 'bulwark')))];
    expect(gemSetPassive(six, SETS).dmgTakenPct).toBeCloseTo(-0.30);
    expect(gemSetAttrDelta(six, SETS).con).toBe(35);
  });
  it('gemSetEquipEntry 六维打包成【套装加成】·摘要含名与件数', () => {
    expect(gemSetEquipEntry(sixRift, SETS)?.effect).toContain('力量+25');
    const line = gemSetSummaryLine([equip([gem('力量', 'rift'), gem('暴击率', 'rift')])], SETS);
    expect(line).toContain('裂空杀阵');
    expect(line).toContain('2件');
  });
});

describe('AI 生成解析（parseGeneratedSets / normalizeSetDef）', () => {
  it('解析 JSON 数组套装（含代码块围栏与尾逗号容错）', () => {
    const raw = '```json\n[{"name":"焚天","emoji":"🐉","theme":"元素","desc":"龙焰","members":["烈焰附魔","智力"],"tiers":[{"need":2,"bonus":"智力+12"},{"need":4,"bonus":"造成伤害+15%",}]}]\n```';
    const out = parseGeneratedSets(raw);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('焚天');
    expect(out[0].tiers).toHaveLength(2);
    expect(out[0].members).toContain('烈焰附魔');
  });
  it('生成的套装装上后其文本 token 真正生效', () => {
    const parsed = parseGeneratedSets('[{"name":"暴徒","emoji":"💥","theme":"攻","members":["暴击率"],"tiers":[{"need":2,"bonus":"暴击率+10%，力量+9"}]}]');
    const custom: GemSetDef[] = [{ ...parsed[0], key: 'gen1' }];
    const two = [equip([gem('暴击率', 'gen1'), gem('暴击率', 'gen1')])];
    expect(gemSetPassive(two, custom).critChance).toBeCloseTo(0.10);
    expect(gemSetAttrDelta(two, custom).str).toBe(9);
  });
  it('缺 name 或 tiers → 丢弃', () => {
    expect(normalizeSetDef({ emoji: '💎' })).toBeNull();
    expect(normalizeSetDef({ name: '空档', tiers: [] })).toBeNull();
  });
  it('非 JSON → 空数组', () => expect(parseGeneratedSets('抱歉我无法生成')).toEqual([]));
});
