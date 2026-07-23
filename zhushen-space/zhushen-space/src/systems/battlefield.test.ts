import { describe, it, expect } from 'vitest';
import { deriveBattlefieldAffixes, skillElement, bfElementMult, bfNum, bfRecordText, BATTLEFIELD_AFFIXES } from './battlefield';

describe('deriveBattlefieldAffixes（天气/地点 → 确定性词缀）', () => {
  it('暴雨 → 雨幕', () => {
    expect(deriveBattlefieldAffixes('暴雨', '').map((a) => a.id)).toEqual(['rain']);
  });
  it('酷暑 + 沼泽 → 灼日 + 瘴泽（天气1+地点1）', () => {
    expect(deriveBattlefieldAffixes('酷暑难耐', '毒龙沼泽深处').map((a) => a.id)).toEqual(['scorch', 'swamp']);
  });
  it('无天气 + 火山口 → 熔野', () => {
    expect(deriveBattlefieldAffixes('', '火山口边缘').map((a) => a.id)).toEqual(['volcano']);
  });
  it('平淡输入 → 无词缀', () => {
    expect(deriveBattlefieldAffixes('晴', '街道')).toEqual([]);
    expect(deriveBattlefieldAffixes(undefined, undefined)).toEqual([]);
  });
  it('确定性：同输入必同输出', () => {
    const a = deriveBattlefieldAffixes('雷雨', '废墟工事');
    const b = deriveBattlefieldAffixes('雷雨', '废墟工事');
    expect(a).toEqual(b);
    expect(a.map((x) => x.id)).toEqual(['rain', 'ruins']);
  });
});

describe('skillElement（技能文本 → 元素通道）', () => {
  it('炎爆术 → 火；冰霜新星 → 水冰；奔雷诀 → 雷；蚀骨毒针 → 毒；裂风斩 → 风', () => {
    expect(skillElement('炎爆术')).toBe('火');
    expect(skillElement('冰霜新星')).toBe('水冰');
    expect(skillElement('奔雷诀')).toBe('雷');
    expect(skillElement('蚀骨毒针')).toBe('毒');
    expect(skillElement('裂风斩')).toBe('风');
  });
  it('无元素关键词 → null（普攻/物理技不受词缀元素倍率影响）', () => {
    expect(skillElement('黑虎掏心')).toBeNull();
    expect(skillElement('')).toBeNull();
  });
});

describe('bfElementMult / bfNum / bfRecordText', () => {
  const rain = BATTLEFIELD_AFFIXES.rain;
  const ley = BATTLEFIELD_AFFIXES.ley;
  const barren = BATTLEFIELD_AFFIXES.barren;
  it('雨幕对火技 ×0.7、对雷技 ×1.2、对无元素 =1', () => {
    expect(bfElementMult([rain], '炎爆术').mult).toBeCloseTo(0.7);
    expect(bfElementMult([rain], '炎爆术').by).toBe('雨幕');
    expect(bfElementMult([rain], '奔雷诀').mult).toBeCloseTo(1.2);
    expect(bfElementMult([rain], '黑虎掏心').mult).toBe(1);
    expect(bfElementMult(undefined, '炎爆术').mult).toBe(1);
  });
  it('数值键取乘积：灵潮×荒芜 回蓝 = 1.5×0.7', () => {
    expect(bfNum([ley, barren], 'epRegenMult')).toBeCloseTo(1.05);
    expect(bfNum([], 'epRegenMult')).toBe(1);
    expect(bfNum(undefined, 'blockMult')).toBe(1);
  });
  it('战报环境段：有词缀给文本、无词缀 null', () => {
    expect(bfRecordText([rain])).toContain('雨幕');
    expect(bfRecordText([])).toBeNull();
    expect(bfRecordText(undefined)).toBeNull();
  });
});
