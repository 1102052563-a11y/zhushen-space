import { describe, it, expect } from 'vitest';
import { resolveJob, resolveForm, resolveType, resolveStyle, generateNpcAttrs, generateLuck } from './npcAttrGen';

describe('resolveJob（花名 → 职业归类）', () => {
  it('命中关键词', () => {
    expect(resolveJob('刺客')).toBe('assassin');
    expect(resolveJob('元素法师')).toBe('mage');
    expect(resolveJob('战士')).toBe('warrior');
    expect(resolveJob('重装守护')).toBe('tank'); // '重装' 先于 warrior 命中 tank
  });
  it('未命中兜底 allrounder', () => {
    expect(resolveJob('随便什么')).toBe('allrounder');
    expect(resolveJob(undefined)).toBe('allrounder');
  });
});

describe('resolveForm（形态文本 → 归类，顺序敏感）', () => {
  it('具体形态优先', () => {
    expect(resolveForm('巨龙')).toBe('greatbeast');
    expect(resolveForm('亡灵')).toBe('undead');
    expect(resolveForm('幽灵')).toBe('spirit');  // 幽灵→spirit 先于 鬼→undead
    expect(resolveForm('史莱姆')).toBe('ooze');
  });
  it('默认人形；已是枚举值则直接返回', () => {
    expect(resolveForm('村民')).toBe('humanoid');
    expect(resolveForm('beast')).toBe('beast');  // 防二次解析退化
  });
});

describe('resolveType（类型标签 → 生成规格）', () => {
  it('封闭枚举标签', () => {
    expect(resolveType('武者战士')).toMatchObject({ arch: 'warrior', style: 'specialist' });
    expect(resolveType('凶兽魔兽')).toMatchObject({ arch: 'warrior', form: 'beast' });
    expect(resolveType('平民百姓')).toMatchObject({ arch: 'allrounder', mundane: true });
  });
  it('未识别退回职业归类', () => {
    expect(resolveType('zzz')).toEqual({ arch: 'allrounder' });
  });
});

describe('resolveStyle（流派：给则用，否则推导）', () => {
  it('显式优先', () => expect(resolveStyle('glass', 5, 'warrior')).toBe('glass'));
  it('高档/BOSS → dual', () => expect(resolveStyle(undefined, 5, 'warrior')).toBe('dual'));
  it('法系 → glass', () => expect(resolveStyle(undefined, 0, 'mage')).toBe('glass'));
  it('坦克/刺客 → specialist', () => expect(resolveStyle(undefined, 0, 'tank')).toBe('specialist'));
  it('低档 → low', () => expect(resolveStyle(undefined, 1, 'warrior')).toBe('low'));
  it('其余 → balanced', () => expect(resolveStyle(undefined, 3, 'warrior')).toBe('balanced'));
});

describe('generateNpcAttrs（机械生成六维·种子确定性）', () => {
  it('同种子+同入参 → 完全复现', () => {
    const opts = { bioTier: 'T3', tier: '一阶', type: '武者战士', seed: 'npc_x' };
    expect(generateNpcAttrs(opts)).toEqual(generateNpcAttrs(opts));
  });
  it('战士主属性=力量，且为五维峰值', () => {
    const a = generateNpcAttrs({ bioTier: 'T3', tier: '一阶', type: '武者战士', seed: 'w1' });
    expect(a.str).toBe(Math.max(a.str, a.agi, a.con, a.int, a.cha));
  });
  it('人形一阶：峰值落在 [min,cap]=[5,50]，副属性可低至 lowFloor(≥3)', () => {
    const a = generateNpcAttrs({ bioTier: 'T2', tier: '一阶', type: '武者战士', seed: 'w2' });
    const peak = Math.max(a.str, a.agi, a.con, a.int, a.cha);
    expect(peak).toBeGreaterThanOrEqual(5);    // 峰值≥本阶下限(定阶)
    expect(peak).toBeLessThanOrEqual(50);
    for (const k of ['str', 'agi', 'con', 'int', 'cha'] as const) {
      expect(a[k]).toBeGreaterThanOrEqual(3);   // 非主属性低地板：不受本阶下限约束
      expect(a[k]).toBeLessThanOrEqual(50);
    }
  });
  it('★二阶专精：仅主属性>50、副属性可远低（修复"二阶除幸运全>50"）', () => {
    const a = generateNpcAttrs({ bioTier: 'T2', tier: '二阶', type: '敏捷刺客', seed: 'sp2' });
    const dims = ['str', 'agi', 'con', 'int', 'cha'] as const;
    const peak = Math.max(...dims.map((k) => a[k]));
    expect(peak).toBeGreaterThan(50);          // 二阶峰值须落进 (50,80]
    expect(dims.filter((k) => a[k] > 50).length).toBeLessThanOrEqual(2);  // 旧bug=5；专精流应≤2
  });
  it('凡人档 → 常人低属性（不套战斗框架）', () => {
    const a = generateNpcAttrs({ bioTier: 'T3', tier: '一阶', type: '平民百姓', seed: 'civ1' });
    expect(a.str).toBeLessThanOrEqual(6);
    expect(a.cha).toBeLessThanOrEqual(9);
  });
});

describe('generateLuck（幸运·独立确定性生成）', () => {
  it('同种子复现', () => {
    expect(generateLuck({ mean5: 10, seed: 'L' })).toBe(generateLuck({ mean5: 10, seed: 'L' }));
  });
  it('常态落在 [0,20]', () => {
    const v = generateLuck({ mean5: 10, seed: 'L2' });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(20);
  });
  it('机械形态(无命数) → 0~2', () => {
    expect(generateLuck({ mean5: 50, form: 'construct', seed: 'L3' })).toBeLessThanOrEqual(2);
  });
});
