import { describe, it, expect } from 'vitest';
import {
  DIPLO_LEVELS, DEFAULT_DIPLO, diploIndex, diploName, normDiplo,
  CHAIN_TEMPLATES, templateOf, templateFor, canTransition, normException,
  intervene, forceSettle, parseLegacyRelations, formatEdges, buildDiplomacyInjection,
} from './diplomacy';

const I = diploIndex;

describe('diplomacy · 档位原语', () => {
  it('八级顺序（低→高下标）与默认中立', () => {
    expect(DIPLO_LEVELS).toHaveLength(8);
    expect(DIPLO_LEVELS[0]).toBe('世仇');
    expect(DIPLO_LEVELS[7]).toBe('血盟');
    expect(diploName(DEFAULT_DIPLO)).toBe('中立');
  });

  it('normDiplo 容忍近义写法，认不出返回 null（=不改）', () => {
    expect(normDiplo('盟友')).toBe(I('盟友'));
    expect(normDiplo('同盟')).toBe(I('盟友'));
    expect(normDiplo('结盟关系')).toBe(I('盟友'));
    expect(normDiplo('敌视')).toBe(I('敌对'));
    expect(normDiplo('交好')).toBe(I('友好'));
    expect(normDiplo('说不清')).toBeNull();
    expect(normDiplo('')).toBeNull();
  });

  it('diploName 夹取越界', () => {
    expect(diploName(-3)).toBe('世仇');
    expect(diploName(99)).toBe('血盟');
  });
});

describe('diplomacy · 事件链模板', () => {
  it('全部模板都是 3 阶段（轮回乐园特化·卡里是 5）', () => {
    expect(CHAIN_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of CHAIN_TEMPLATES) expect(t.stages).toHaveLength(3);
  });

  it('templateFor 按 from/to 找链', () => {
    expect(templateFor(I('中立'), I('友好'))?.key).toBe('trade');
    expect(templateFor(I('盟友'), I('血盟'))?.key).toBe('marriage');
    expect(templateFor(I('敌对'), I('世仇'))?.key).toBe('war');
    expect(templateFor(I('血盟'), I('世仇'))?.key).toBe('betray');
    expect(templateFor(I('世仇'), I('血盟'))).toBeNull();   // 没有一步登天的模板
  });

  it('templateOf 按 key 取', () => {
    expect(templateOf('truce')?.label).toBe('停战谈判');
    expect(templateOf('nope')).toBeNull();
  });
});

describe('diplomacy · 闸门（核心）', () => {
  it('同档/相邻一档 → 直接放行（日常摩擦与一次合作是常态）', () => {
    expect(canTransition(I('中立'), I('中立')).ok).toBe(true);
    expect(canTransition(I('中立'), I('友好')).ok).toBe(true);
    expect(canTransition(I('中立'), I('冷淡')).ok).toBe(true);
  });

  it('⚠ 跨 ≥2 档且无已完结事件链 → 拒绝，回落到渐变 1 档', () => {
    const v = canTransition(I('中立'), I('盟友'));
    expect(v.ok).toBe(false);
    expect(v.fallback).toBe(I('友好'));      // 朝目标方向只走 1 档
    expect(v.reason).toContain('贸易协定');
  });

  it('事件链已完结 → 放行到目标档', () => {
    const v = canTransition(I('中立'), I('盟友'), { chainDone: 'trade' });
    expect(v.ok).toBe(true);
    expect(v.fallback).toBe(I('盟友'));
  });

  it('链 key 对不上（走了别的链）→ 仍拒绝', () => {
    expect(canTransition(I('中立'), I('盟友'), { chainDone: 'war' }).ok).toBe(false);
  });

  it('例外直降只对**降级**生效；升级永远要走链', () => {
    const down = canTransition(I('血盟'), I('世仇'), { exception: 'betray' });
    expect(down.ok).toBe(true);
    const up = canTransition(I('世仇'), I('血盟'), { exception: 'betray' });
    expect(up.ok).toBe(false);
  });

  it('normException 识别三种例外', () => {
    expect(normException('其核心人物被杀于城门')).toBe('kill');
    expect(normException('遭到重大背叛')).toBe('betray');
    expect(normException('公开宣战')).toBe('declare');
    expect(normException('闹了点小矛盾')).toBeNull();
  });
});

describe('diplomacy · 玩家杠杆', () => {
  it('调解：敌对升一档；世仇不可调；非敌对无从调解', () => {
    expect(intervene(I('敌对'), 'mediate')).toMatchObject({ ok: true, next: I('紧张') });
    expect(intervene(I('世仇'), 'mediate').ok).toBe(false);
    expect(intervene(I('世仇'), 'mediate').reason).toContain('世仇不可调解');
    expect(intervene(I('友好'), 'mediate').ok).toBe(false);
  });

  it('挑拨：友好以上降一档；血盟需重大把柄', () => {
    expect(intervene(I('盟友'), 'incite')).toMatchObject({ ok: true, next: I('友好') });
    expect(intervene(I('血盟'), 'incite').ok).toBe(false);
    expect(intervene(I('血盟'), 'incite', { leverage: true })).toMatchObject({ ok: true, next: I('盟友') });
    expect(intervene(I('冷淡'), 'incite').ok).toBe(false);
  });

  it('代行：仅血盟，且不直接改档位', () => {
    const r = intervene(I('血盟'), 'proxy');
    expect(r.ok).toBe(true);
    expect(r.next).toBe(I('血盟'));
    expect(intervene(I('盟友'), 'proxy').ok).toBe(false);
  });
});

describe('diplomacy · 离世强制结算（不留悬案）', () => {
  it('推进 ≥2/3 → 视同达成', () => {
    expect(forceSettle(I('中立'), I('盟友'), 2).level).toBe(I('盟友'));
    expect(forceSettle(I('中立'), I('盟友'), 3).level).toBe(I('盟友'));
  });

  it('推进 1/3 → 折算渐变 1 档', () => {
    expect(forceSettle(I('中立'), I('盟友'), 1).level).toBe(I('友好'));
    expect(forceSettle(I('盟友'), I('世仇'), 1).level).toBe(I('友好'));   // 降级方向同理
  });

  it('几乎未推进 → 维持原状', () => {
    const r = forceSettle(I('中立'), I('盟友'), 0);
    expect(r.level).toBe(I('中立'));
    expect(r.note).toContain('维持原状');
  });
});

describe('diplomacy · 老档迁移与序列化', () => {
  it('解析自由文本 relations（这是升级前的存储格式）', () => {
    const e = parseLegacyRelations('F2:敌对;F3:同盟；F4：说不清');
    expect(e).toHaveLength(2);
    expect(e[0]).toEqual({ target: 'F2', level: I('敌对') });
    expect(e[1]).toEqual({ target: 'F3', level: I('盟友') });
  });

  it('空/垃圾输入不炸', () => {
    expect(parseLegacyRelations('')).toEqual([]);
    expect(parseLegacyRelations(undefined)).toEqual([]);
    expect(parseLegacyRelations('乱七八糟')).toEqual([]);
  });

  it('formatEdges 往返', () => {
    expect(formatEdges([{ target: 'F2', level: I('敌对') }])).toBe('F2:敌对');
  });

  it('注入块写明闸门与玩家杠杆；无边不出块', () => {
    expect(buildDiplomacyInjection([])).toBe('');
    expect(buildDiplomacyInjection([{ name: '漕帮', edges: [] }])).toBe('');
    const s = buildDiplomacyInjection([{ name: '漕帮', edges: [{ target: '盐帮', level: I('敌对') }] }]);
    expect(s).toContain('漕帮 → 盐帮:敌对');
    expect(s).toContain('跨级变动必须先走完对应事件链');
    expect(s).toContain('调解');
  });
});
