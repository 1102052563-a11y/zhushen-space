import { describe, it, expect } from 'vitest';
import {
  applyDamageModifiers, strengthBonus, dexterityBonus,
  normalizeEffects, inferEffectsFromSkill, parseCombatSpec, isCombatTag, TAG_REGISTRY, ALL_TAGS,
} from './combatTags';

describe('applyDamageModifiers（§4 伤害修正链：虚弱→+力量→易伤）', () => {
  it('无修正 = base', () => expect(applyDamageModifiers({ base: 100 })).toBe(100));
  it('虚弱 ×0.75', () => expect(applyDamageModifiers({ base: 100, attackerWeak: true })).toBe(75));
  it('力量为加法', () => expect(applyDamageModifiers({ base: 100, strengthBonus: 20 })).toBe(120));
  it('易伤 ×1.5', () => expect(applyDamageModifiers({ base: 100, targetVulnerable: true })).toBe(150));
  it('顺序：虚弱先乘、力量后加、易伤最后乘', () => {
    // 100×0.75=75 → +20=95 → ×1.5=142.5 → round 143
    expect(applyDamageModifiers({ base: 100, attackerWeak: true, strengthBonus: 20, targetVulnerable: true })).toBe(143);
  });
  it('负 base 夹到 0', () => expect(applyDamageModifiers({ base: -5 })).toBe(0));
});

describe('strengthBonus / dexterityBonus（层数×档×10%）', () => {
  it('力量 2 层 × 攻击档 50 = 10', () => expect(strengthBonus(2, 50)).toBe(10));
  it('敏捷 3 层 × 防御档 40 = 12', () => expect(dexterityBonus(3, 40)).toBe(12));
  it('0 层 = 0', () => { expect(strengthBonus(0, 99)).toBe(0); expect(strengthBonus(undefined, 99)).toBe(0); });
});

describe('isCombatTag / 注册表自洽', () => {
  it('合法/非法 tag 判定', () => {
    expect(isCombatTag('deal')).toBe(true);
    expect(isCombatTag('地形改造')).toBe(false);
    expect(isCombatTag(123)).toBe(false);
  });
  it('ALL_TAGS 每个都在注册表里且 emoji/label 齐全', () => {
    for (const t of ALL_TAGS) { expect(TAG_REGISTRY[t]).toBeTruthy(); expect(TAG_REGISTRY[t].label).toBeTruthy(); expect(TAG_REGISTRY[t].emoji).toBeTruthy(); }
  });
});

describe('normalizeEffects（AI 输出校验：丢非法 tag、夹紧参数、补 chance）', () => {
  it('保留合法、丢弃非法 tag', () => {
    const out = normalizeEffects([{ tag: 'deal', mult: '1.5' }, { tag: 'bogus', mult: 9 }, { tag: 'poison', stacks: 3 }]);
    expect(out.map((e) => e.tag)).toEqual(['deal', 'poison']);
    expect(out[0].mult).toBe(1.5);   // 字符串数字被转换
    expect(out[0].chance).toBe(1);    // 默认必中
    expect(out[1].stacks).toBe(3);
  });
  it('非数组 → 空', () => expect(normalizeEffects('x')).toEqual([]));
  it('夹紧越界参数', () => {
    const out = normalizeEffects([{ tag: 'deal', mult: 999, times: 999 }]);
    expect(out[0].mult).toBeLessThanOrEqual(20);
    expect(out[0].times).toBeLessThanOrEqual(20);
  });
});

describe('inferEffectsFromSkill（旧档无 numeric.combat 时关键词兜底）', () => {
  it('伤害百分比 → deal 倍率', () => {
    const eff = inferEffectsFromSkill({ name: '火球术', damage: '法术攻击180%' });
    expect(eff[0].tag).toBe('deal');
    expect(eff[0].mult).toBeCloseTo(1.8);
  });
  it('治疗类 → 仅 heal（不附带攻击）', () => {
    const eff = inferEffectsFromSkill({ name: '治疗术', effect: '回复生命' });
    expect(eff).toHaveLength(1);
    expect(eff[0].tag).toBe('heal');
  });
  it('中毒攻击 → deal + poison', () => {
    const eff = inferEffectsFromSkill({ name: '毒刃', effect: '挥砍并使目标中毒', damage: '攻击力120%' });
    const tags = eff.map((e) => e.tag);
    expect(tags).toContain('deal');
    expect(tags).toContain('poison');
  });
  it('护盾类 → block（无 deal）', () => {
    const eff = inferEffectsFromSkill({ name: '铁壁', effect: '获得格挡护盾' });
    expect(eff.map((e) => e.tag)).toContain('block');
    expect(eff.some((e) => e.tag === 'deal')).toBe(false);
  });
  it('无任何线索 → 默认一次普通 deal', () => {
    const eff = inferEffectsFromSkill({ name: '某招' });
    expect(eff[0].tag).toBe('deal');
  });
});

describe('parseCombatSpec（有 numeric.combat 用之，否则兜底）', () => {
  it('读取合法 numeric.combat', () => {
    const spec = parseCombatSpec({ name: 'x', numeric: { combat: { cost: 12, target: 'enemy', effects: [{ tag: 'deal', mult: 2 }, { tag: 'vulnerable', stacks: 2 }] } } });
    expect(spec.cost).toBe(12);
    expect(spec.target).toBe('enemy');
    expect(spec.effects.map((e) => e.tag)).toEqual(['deal', 'vulnerable']);
  });
  it('numeric.combat 非法 effects → 退回关键词兜底', () => {
    const spec = parseCombatSpec({ name: '斩击', damage: '攻击力150%', numeric: { combat: { effects: [{ tag: 'nope' }] } } });
    expect(spec.effects.length).toBeGreaterThan(0);
    expect(spec.effects[0].tag).toBe('deal');
  });
  it('读取 AI 输出的顶层 combat 字段（addSkill 透传）', () => {
    const spec = parseCombatSpec({ name: '冰封', combat: { cost: 10, target: 'enemy', effects: [{ tag: 'deal', mult: 1.2 }, { tag: 'stun', turns: 1 }] } } as any);
    expect(spec.cost).toBe(10);
    expect(spec.effects.map((e) => e.tag)).toEqual(['deal', 'stun']);
  });
});
