import { describe, it, expect } from 'vitest';
import {
  tierWindow, tierBounds, templateFromRatio, clampToTierWindow,
  nominalTierNum, bioInnate, bioPower, bioStrengthLabel, tierVitalMult,
} from './bioStrength';
import { lvFromRealm } from './derivedStats';
import type { PlayerAttrs } from '../store/playerStore';

const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p } as PlayerAttrs);

/* ⚠ 回归：一阶世界(学园默示录)的土著「毒岛冴子」被 AI 写成 realm="二阶·Lv.86"，面板显示 资质T8·真神。
   病理：Lv.86 → realmFromLevel=九阶 → nominalTierNum 的 max(二阶, 九阶)=9 → bioInnate 拿九阶区间[301,500]
   量她 ~65 的峰值 → 占用率负 → clamp 到 0 → 掉进 tierWindow(9)=[8,11] 的**地板 T8·真神**。
   T8 既非"她很强"、恰恰是"她触底"，且会连锁：HP×32(tierVitalMult) + T8 注回提示词让 NPC 演化真按真神养她。
   守卫落在 lvFromRealm（阶位·等级同源同时写、矛盾必是 AI 幻觉 → 以阶位为准）。 */
describe('回归·毒岛冴子（二阶·Lv.86 → 曾误判 T8·真神）', () => {
  const realm = '二阶·Lv.86|藤美学园3年级学生';
  const saeko = A({ str: 62, agi: 65, con: 58, int: 55, cha: 60 });   // 正常二阶水平(峰值65·二阶上限80)
  const lv = () => lvFromRealm(realm);

  it('名义阶位锁回二阶，不被 Lv.86 顶成九阶', () => {
    expect(nominalTierNum(realm, lv())).toBe(2);
  });
  it('资质档回到二阶窗口内的合理档，不再是 T8·真神', () => {
    const innate = bioInnate(saeko, realm, lv())!;
    expect(innate.num).toBeLessThanOrEqual(4);           // 二阶窗口 [1,4]
    expect(innate.label).not.toContain('真神');
  });
  it('资质档 与 战力档 不再撕裂（同一副六维不该差 6 档）', () => {
    const innate = bioInnate(saeko, realm, lv())!;
    const power = bioPower(saeko, realm, lv())!;
    expect(Math.abs(innate.num - power.num)).toBeLessThanOrEqual(1);
  });
  it('HP 倍率回到 ×1，不再 ×32', () => {
    expect(tierVitalMult(bioInnate(saeko, realm, lv())!.num)).toBe(1);
  });
});

describe('tierWindow（本阶可出现的档位区间）', () => {
  it('[min(9,t-1), min(9,t+2)]', () => {
    expect(tierWindow(1)).toEqual([0, 3]);
    expect(tierWindow(5)).toEqual([4, 7]);
    expect(tierWindow(13)).toEqual([12, 15]); // 巅峰至强：扩展档窗口(不再封顶 T9)
    expect(tierWindow(14)).toEqual([13, 16]); // 无上：可达 T16无上
  });
});

describe('tierBounds（阶位 → 单属性 [下限,上限]）', () => {
  it('下限 = 上一阶上限+1（一阶特例 5）', () => {
    expect(tierBounds(1)).toEqual([5, 50]);
    expect(tierBounds(2)).toEqual([51, 80]);
    expect(tierBounds(3)).toEqual([81, 99]);
  });
});

describe('templateFromRatio（预算占用率 → 模板档 0..6）', () => {
  it('边界', () => {
    expect(templateFromRatio(0.20)).toBe(0);
    expect(templateFromRatio(0.30)).toBe(1);
    expect(templateFromRatio(0.50)).toBe(2);
    expect(templateFromRatio(0.70)).toBe(3);
    expect(templateFromRatio(0.90)).toBe(4);
    expect(templateFromRatio(1.00)).toBe(5);
    expect(templateFromRatio(1.50)).toBe(6); // 超满配靠外源
  });
});

describe('clampToTierWindow（档位夹进本阶窗口）', () => {
  it('夹到 [lo,hi]', () => {
    expect(clampToTierWindow(5, 1)).toBe(3);  // 一阶窗口 [0,3]
    expect(clampToTierWindow(-1, 1)).toBe(0);
    expect(clampToTierWindow(2, 1)).toBe(2);
  });
});

describe('nominalTierNum（阶位串/等级 → 序号，取较高者）', () => {
  it('阶位与等级取较高', () => {
    expect(nominalTierNum('三阶')).toBe(3);
    expect(nominalTierNum('五阶', 1)).toBe(5);
    expect(nominalTierNum(undefined, 15)).toBe(2); // realmFromLevel(15)=二阶
  });
});

describe('bioInnate（资质档·峰值口径）', () => {
  it('一阶单属性顶到 50 → 该阶最高档 T3·勇士', () => {
    expect(bioInnate(A({ str: 50 }), '一阶', 1)?.label).toBe('T3·勇士');
  });
  it('一阶全 5 → 最低档 T0·杂鱼', () => {
    expect(bioInnate(A({}), '一阶', 1)?.label).toBe('T0·杂鱼');
  });
  it('无基础六维 → null', () => {
    expect(bioInnate(undefined, '一阶', 1)).toBeNull();
  });
});

describe('bioStrengthLabel（资质/战力合成展示）', () => {
  const t3 = bioInnate(A({ str: 50 }), '一阶', 1);
  const t0 = bioInnate(A({}), '一阶', 1);
  it('两档相同只显一个', () => expect(bioStrengthLabel(t3, t3)).toBe('T3·勇士'));
  it('两档不同显「资质X / 战力Y」', () => expect(bioStrengthLabel(t0, t3)).toBe('资质T0·杂鱼 / 战力T3·勇士'));
  it('都为空 → 空串', () => expect(bioStrengthLabel(null, null)).toBe(''));
  it('只有一档 → 显该档', () => expect(bioStrengthLabel(t3, null)).toBe('T3·勇士'));
});

describe('bioPower 越阶封顶(C·封顶名义阶位) + B扩展档', () => {
  it('三阶角色有效六维到绝强级 → 战力封顶在名义阶位三阶(T5·领主)，不出现真神/源初', () => {
    const p = bioPower(A({ con: 955 }), '三阶', 25);
    expect(p?.tierNum).toBe(3);        // 封顶在名义阶位三阶(MAX_CROSS_TIER=0)
    expect(p?.label).toBe('T5·领主');  // 三阶顶档
  });
  it('bioStrengthLabel：战力封顶名义阶位、无等效阶位前缀（三阶资质战力合一显 T5·领主）', () => {
    const innate = bioInnate(A({ con: 99 }), '三阶', 25);
    const power = bioPower(A({ con: 955 }), '三阶', 25);
    expect(bioStrengthLabel(innate, power)).toBe('T5·领主');
  });
  it('绝强角色(名义即绝强)真到顶 → 战力达新档 T12·至尊(B·不再封顶源初)', () => {
    const p = bioPower(A({ con: 1000 }), '绝强', 95);
    expect(p?.num).toBeGreaterThan(9);   // 突破 T9 天花板
    expect(p?.realm).toBe('绝强');
  });
});
