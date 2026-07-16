import { describe, it, expect } from 'vitest';
import { enhancedCombat, effectiveCombatStat, COMBAT_BONUS_PER_LEVEL } from './enhanceEngine';
import { parseCombatStat, computeDerived } from './derivedStats';
import type { PlayerAttrs } from '../store/playerStore';

const A = (o: Partial<PlayerAttrs> = {}): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...o });

/* 回归护栏：+N 强化必须进战力。
   曾经的 bug——enhancedCombat 只在背包/强化面板做「基础→强化」显示，而 computeDerived/战斗/AI 注入
   全读原始 item.combatStat，导致 +14 武器的 +140% 一点攻击都没加。effectiveCombatStat 是唯一取值口径。 */
describe('effectiveCombatStat：强化后的攻防要真的进衍生攻防', () => {
  it('+14 的 920-1150 → 2208-2760（与背包卡面显示逐字一致）', () => {
    expect(effectiveCombatStat({ combatStat: '攻击 920-1150', enhanceLevel: 14 })).toBe('攻击 2208-2760');
    expect(enhancedCombat('攻击 920-1150', 14)?.pct).toBe(140);
  });

  it('+0 / 无强化 / 无数值 → 原样返回基础值（不改存储值口径）', () => {
    expect(effectiveCombatStat({ combatStat: '攻击 920-1150', enhanceLevel: 0 })).toBe('攻击 920-1150');
    expect(effectiveCombatStat({ combatStat: '攻击 920-1150' })).toBe('攻击 920-1150');
    expect(effectiveCombatStat({ combatStat: '锋利无比', enhanceLevel: 14 })).toBe('锋利无比');
    expect(effectiveCombatStat(undefined)).toBeUndefined();
  });

  it('喂进 parseCombatStat：patk 取强化后均值 2484，而非基础 1035', () => {
    const gun = { combatStat: '攻击 920-1150', enhanceLevel: 14 };
    expect(parseCombatStat(gun.combatStat).patk).toBe(1035);                  // 基础均值（旧 bug 用的就是它）
    expect(parseCombatStat(effectiveCombatStat(gun)).patk).toBe(2484);        // 强化后均值
  });

  it('computeDerived 吃到强化：同一把枪 +0 → +14，物理攻击涨 1449', () => {
    const attrs = A({ str: 50, agi: 60 });
    const at = (lv: number) => computeDerived(attrs, 20, [
      { category: '武器', grade: 12, combatStat: effectiveCombatStat({ combatStat: '攻击 920-1150', enhanceLevel: lv })! },
    ]);
    expect(at(14).patk - at(0).patk).toBe(2484 - 1035);
  });

  it('降级即降：强化值由当前 enhanceLevel 实时算，不会在已放大的值上滚雪球', () => {
    const base = '攻击 100';
    const up = effectiveCombatStat({ combatStat: base, enhanceLevel: 10 });   // +100% → 200
    expect(up).toBe('攻击 200');
    // 掉回 +5 时仍以【基础值】为准 → 150，而非在 200 上再算
    expect(effectiveCombatStat({ combatStat: base, enhanceLevel: 5 })).toBe('攻击 150');
  });

  it('每级增幅 = COMBAT_BONUS_PER_LEVEL（改系数时本测试应同步更新）', () => {
    expect(COMBAT_BONUS_PER_LEVEL).toBe(0.10);
    expect(effectiveCombatStat({ combatStat: '攻击 100', enhanceLevel: 1 })).toBe('攻击 110');
  });
});
