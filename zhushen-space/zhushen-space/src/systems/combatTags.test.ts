import { describe, it, expect } from 'vitest';
import {
  applyDamageModifiers, strengthBonus, dexterityBonus,
  normalizeEffects, inferEffectsFromSkill, parseCombatSpec, isCombatTag, TAG_REGISTRY, ALL_TAGS,
  normalizePassive, normalizeTriggers, inferPassiveFromSkill, inferTriggersFromSkill, aggregatePassives, aggregateTriggers, triggerPromptText,
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

/* ── 条件触发系统（C）数据层 ── */
describe('normalizePassive（被动修正校验·夹紧）', () => {
  it('合法字段保留', () => {
    const p = normalizePassive({ critChance: 0.3, critMult: 0.5, dmgDealtPct: 0.2, dmgTakenPct: -0.25, pierce: 0.4, cdr: 2, extraHits: 1 })!;
    expect(p.critChance).toBe(0.3); expect(p.dmgTakenPct).toBe(-0.25); expect(p.pierce).toBe(0.4); expect(p.extraHits).toBe(1); expect(p.cdr).toBe(2);
  });
  it('critChance 越界夹到 0~1', () => expect(normalizePassive({ critChance: 9 })!.critChance).toBe(1));
  it('空/无有效字段 → undefined', () => { expect(normalizePassive(null)).toBeUndefined(); expect(normalizePassive({ foo: 1 })).toBeUndefined(); });
});

describe('normalizeTriggers（触发器校验）', () => {
  it('合法触发器保留、补 chance 默认 1', () => {
    const t = normalizeTriggers([{ on: 'onHit', chance: 0.3, effect: { tag: 'burn', flat: 10, turns: 2 } }]);
    expect(t).toHaveLength(1); expect(t[0].on).toBe('onHit'); expect(t[0].chance).toBe(0.3); expect(t[0].effect.tag).toBe('burn');
  });
  it('非法 on / 非法 effect 丢弃', () => {
    expect(normalizeTriggers([{ on: 'whenever', effect: { tag: 'deal' } }])).toHaveLength(0);
    expect(normalizeTriggers([{ on: 'onKill', effect: { tag: 'bogus' } }])).toHaveLength(0);
  });
  it('cond 合法才保留', () => {
    expect(normalizeTriggers([{ on: 'onHit', cond: 'targetBurning', effect: { tag: 'deal', mult: 0.5 } }])[0].cond).toBe('targetBurning');
    expect(normalizeTriggers([{ on: 'onHit', cond: 'badcond', effect: { tag: 'deal', mult: 0.5 } }])[0].cond).toBeUndefined();
  });
});

describe('inferPassiveFromSkill（旧档关键词→被动）', () => {
  it('暴击率 +12% → critChance 0.12', () => expect(inferPassiveFromSkill({ name: '锐眼', effect: '暴击率+12%' })!.critChance).toBeCloseTo(0.12));
  it('受到伤害降低20% → dmgTakenPct -0.2', () => expect(inferPassiveFromSkill({ name: '铁骨', effect: '受到伤害降低20%' })!.dmgTakenPct).toBeCloseTo(-0.2));
  it('穿透30% → pierce 0.3', () => expect(inferPassiveFromSkill({ name: '破甲', effect: '穿透30%' })!.pierce).toBeCloseTo(0.3));
  it('无关文本 → undefined', () => expect(inferPassiveFromSkill({ name: '走路', effect: '日常行走' })).toBeUndefined());
});

describe('inferTriggersFromSkill（旧档关键词→触发器）', () => {
  it('命中30%概率燃烧 → onHit/burn', () => {
    const t = inferTriggersFromSkill({ name: '炎附', effect: '命中时30%概率使目标燃烧' });
    expect(t.some((x) => x.on === 'onHit' && x.effect.tag === 'burn')).toBe(true);
  });
  it('击杀回血 → onKill/heal', () => {
    const t = inferTriggersFromSkill({ name: '饮血', effect: '击杀后回复300点生命' });
    expect(t.some((x) => x.on === 'onKill' && x.effect.tag === 'heal')).toBe(true);
  });
});

describe('aggregatePassives / aggregateTriggers（聚合全部技能+天赋）', () => {
  it('暴击率累加、穿透取最大', () => {
    const agg = aggregatePassives([
      { name: 'a', combat: { passive: { critChance: 0.1, pierce: 0.2 } } } as any,
      { name: 'b', combat: { passive: { critChance: 0.15, pierce: 0.5 } } } as any,
    ]);
    expect(agg.critChance).toBeCloseTo(0.25);
    expect(agg.pierce).toBe(0.5);
  });
  it('聚合触发器（authored + 推断并入）', () => {
    const t = aggregateTriggers([
      { name: 'a', combat: { triggers: [{ on: 'onHit', effect: { tag: 'poison', stacks: 2 } }] } } as any,
      { name: 'b', effect: '击杀后回复100生命' } as any,
    ]);
    expect(t.length).toBeGreaterThanOrEqual(2);
  });
});

describe('triggerPromptText（提示词片段）', () => {
  it('含事件枚举与字段名', () => {
    const s = triggerPromptText();
    expect(s).toContain('onHit'); expect(s).toContain('onKill'); expect(s).toContain('targetBurning'); expect(s).toContain('passive');
  });
});
