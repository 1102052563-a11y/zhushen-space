import { describe, it, expect } from 'vitest';
import {
  computeMaxHp, computeMaxEp, effectiveResource,
  realmFromLevel, normalizeTier, trueAttr, lvFromRealm,
  attrCapForTier, gearMaxHpBonus, gearMaxHpPctBonus, fullMaxHp,
} from './derivedStats';
import type { PlayerAttrs } from '../store/playerStore';

// 六维构造器（只关心被测字段，其余给默认值）
const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p } as PlayerAttrs);

describe('computeMaxHp / computeMaxEp（HP=体质×20, EP=智力×15）', () => {
  it('按系数换算', () => {
    expect(computeMaxHp(A({ con: 5 }))).toBe(100);
    expect(computeMaxHp(A({ con: 10 }))).toBe(200);
    expect(computeMaxEp(A({ int: 5 }))).toBe(75);
    expect(computeMaxEp(A({ int: 10 }))).toBe(150);
  });
  it('缺省/0 边界', () => {
    expect(computeMaxHp(undefined)).toBe(100); // 默认 con 5
    expect(computeMaxEp(undefined)).toBe(75);  // 默认 int 5
    expect(computeMaxHp(A({ con: 0 }))).toBe(0);
  });
});

describe('effectiveResource（当前值显示口径）', () => {
  it('从未设过 → 视为满', () => expect(effectiveResource(undefined, undefined, 200)).toBe(200));
  it('有值则原样保留', () => expect(effectiveResource(50, undefined, 200)).toBe(50));
  it('夹到 [0, max]', () => {
    expect(effectiveResource(300, undefined, 200)).toBe(200);
    expect(effectiveResource(-10, undefined, 200)).toBe(0);
  });
});

describe('realmFromLevel（等级→阶位）', () => {
  it('阶位边界', () => {
    expect(realmFromLevel(1)).toBe('一阶');
    expect(realmFromLevel(10)).toBe('一阶');
    expect(realmFromLevel(11)).toBe('二阶');
    expect(realmFromLevel(90)).toBe('九阶');
    expect(realmFromLevel(100)).toBe('绝强');
    expect(realmFromLevel(140)).toBe('巅峰至强');
    expect(realmFromLevel(141)).toBe('无上之境');
  });
  it('非法等级兜底为一阶', () => expect(realmFromLevel(0)).toBe('一阶'));
});

describe('normalizeTier（AI 任意阶位串→合法阶位）', () => {
  it('提取合法阶位', () => {
    expect(normalizeTier('三阶中期')).toBe('三阶');
    expect(normalizeTier('巅峰至强')).toBe('巅峰至强');
    expect(normalizeTier('至强者')).toBe('至强');
  });
  it('修仙词/空 → 空串', () => {
    expect(normalizeTier('结丹')).toBe('');
    expect(normalizeTier('')).toBe('');
    expect(normalizeTier(undefined)).toBe('');
  });
});

describe('trueAttr（每 80 普通 = 1 真实）', () => {
  it('floor(v/80)', () => {
    expect(trueAttr(80)).toBe(1);
    expect(trueAttr(79)).toBe(0);
    expect(trueAttr(160)).toBe(2);
    expect(trueAttr(0)).toBe(0);
    expect(trueAttr(-5)).toBe(0);
  });
});

describe('lvFromRealm（从 realm 串提 Lv）', () => {
  it('提取等级', () => {
    expect(lvFromRealm('一阶·Lv.8|身份')).toBe(8);
    expect(lvFromRealm('Lv.12')).toBe(12);
  });
  it('取不到默认 1', () => {
    expect(lvFromRealm('无')).toBe(1);
    expect(lvFromRealm(undefined)).toBe(1);
  });
});

describe('attrCapForTier（基础六维上限，取阶位/等级较高者）', () => {
  it('按阶位', () => {
    expect(attrCapForTier('一阶')).toBe(50);
    expect(attrCapForTier('五阶')).toBe(320);
  });
  it('阶位与等级取较高上限', () => {
    expect(attrCapForTier('三阶', 5)).toBe(120);    // 三阶120 > 一阶(lv5)50
    expect(attrCapForTier(undefined, 15)).toBe(80); // 二阶
  });
  it('都取不到 → Infinity（不夹）', () => expect(attrCapForTier()).toBe(Infinity));
});

describe('装备「上限加成」解析（只认明写"上限/最大值"，不认回复/伤害类）', () => {
  it('平值加成', () => {
    expect(gearMaxHpBonus([{ effect: '生命值上限+50' }])).toBe(50);
    expect(gearMaxHpBonus([{ effect: '回复100生命' }])).toBe(0); // 回复≠上限
    expect(gearMaxHpBonus([])).toBe(0);
  });
  it('百分比加成', () => {
    expect(gearMaxHpPctBonus([{ effect: '生命上限+10%' }])).toBe(10);
    expect(gearMaxHpPctBonus([{ effect: '造成10%生命值伤害' }])).toBe(0); // 伤害≠上限
  });
});

describe('fullMaxHp（无加成时 = computeMaxHp，叠加装备上限）', () => {
  it('纯六维', () => {
    expect(fullMaxHp(A({ con: 5 }))).toBe(100);
    expect(fullMaxHp(A({ con: 10 }))).toBe(200);
  });
  it('叠加装备平值上限', () => {
    expect(fullMaxHp(A({ con: 5 }), [{ effect: '生命值上限+50' }])).toBe(150);
  });
});
