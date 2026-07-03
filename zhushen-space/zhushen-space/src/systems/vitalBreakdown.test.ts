import { describe, it, expect } from 'vitest';
import { computeVitalBreakdown, fullMaxHp, fullMaxEp } from './derivedStats';
import type { PlayerAttrs } from '../store/playerStore';

const A: PlayerAttrs = { str: 5, agi: 5, con: 10, int: 10, cha: 5, luck: 5 };   // 默认 HP=体×20=200 / EP=智×15=150

describe('computeVitalBreakdown（HP/EP 上限构成明细）', () => {
  it('★合计严格等于 fullMaxHp（六维 + 平值 + 百分比）', () => {
    const skills = [{ name: '钢铁之躯', attrBonus: '生命上限+100' }];
    const traits = [{ name: '巨魔血脉', attrBonus: '最大生命+6%' }];
    const bd = computeVitalBreakdown('hp', A, [], skills, traits, 1);
    expect(bd.attrBase).toBe(200);
    expect(bd.flatItems).toEqual([{ name: '钢铁之躯', source: '技能', amount: 100 }]);
    expect(bd.pctItems).toEqual([{ name: '巨魔血脉', source: '天赋', pct: 6 }]);
    expect(bd.pctAdd).toBe(18);   // (200+100)×6% = 18
    expect(bd.total).toBe(318);
    expect(bd.total).toBe(fullMaxHp(A, [], skills, traits, 1));   // 与真实上限同口径
  });

  it('★装备平值上限加成逐件列出，合计=fullMaxHp', () => {
    const equipped = [{ name: '龙鳞甲', attrBonus: '生命上限+500' }, { name: '智慧法杖', attrBonus: '法力上限+300' }];
    const hp = computeVitalBreakdown('hp', A, equipped, [], [], 1);
    expect(hp.flatItems).toEqual([{ name: '龙鳞甲', source: '装备', amount: 500 }]);   // 只算 HP 类
    expect(hp.total).toBe(fullMaxHp(A, equipped as any, [], [], 1));
    const ep = computeVitalBreakdown('ep', A, equipped, [], [], 1);
    expect(ep.flatItems).toEqual([{ name: '智慧法杖', source: '装备', amount: 300 }]);   // EP 类
    expect(ep.total).toBe(fullMaxEp(A, equipped as any, [], [], 1));
  });

  it('★四阶真实倍率×5 计入六维换算', () => {
    const bd = computeVitalBreakdown('hp', A, [], [], [], 5);
    expect(bd.realMult).toBe(5);
    expect(bd.attrBase).toBe(1000);   // 200×5
    expect(bd.total).toBe(fullMaxHp(A, [], [], [], 5));
  });

  it('EP 百分比同理', () => {
    const traits = [{ name: '灵能觉醒', attrBonus: '最大法力+20%' }];
    const bd = computeVitalBreakdown('ep', A, [], [], traits, 1);
    expect(bd.attrBase).toBe(150);
    expect(bd.pctItems).toEqual([{ name: '灵能觉醒', source: '天赋', pct: 20 }]);
    expect(bd.pctAdd).toBe(30);   // 150×20%
    expect(bd.total).toBe(180);
    expect(bd.total).toBe(fullMaxEp(A, [], [], traits, 1));
  });

  it('无任何加成 → 只有六维换算，flat/pct/cross 皆空', () => {
    const bd = computeVitalBreakdown('hp', A, [], [], [], 1);
    expect(bd.flatItems).toEqual([]);
    expect(bd.pctItems).toEqual([]);
    expect(bd.crossItems).toEqual([]);
    expect(bd.total).toBe(bd.attrBase);
    expect(bd.total).toBe(fullMaxHp(A, [], [], [], 1));
  });

  it('★多来源混合（装备平值 + 技能平值 + 天赋百分比）合计始终=fullMaxHp', () => {
    const equipped = [{ name: '守护指环', attrBonus: '生命上限+250' }];
    const skills = [{ name: '生命强化', attrBonus: '生命上限+150' }];
    const traits = [{ name: '不朽之躯', attrBonus: '最大生命+10%' }];
    const bd = computeVitalBreakdown('hp', A, equipped, skills, traits, 1);
    expect(bd.flatTotal).toBe(400);   // 250+150
    expect(bd.pctTotal).toBe(10);
    expect(bd.total).toBe(fullMaxHp(A, equipped as any, skills, traits, 1));
  });
});
