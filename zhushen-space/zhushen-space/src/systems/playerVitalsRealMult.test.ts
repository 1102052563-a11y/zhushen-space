import { describe, it, expect, beforeEach } from 'vitest';
import { playerMaxHp, playerMaxEp } from './playerVitals';
import { realAttrMult } from './derivedStats';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';

// 治"血条与<状态结算>对不上"：playerMaxHp/Ep 曾硬传 realMult=1，而血条/属性面板/战斗用 realAttrMult(tier,level)
// (四阶起×5)。四阶+主角的"钳制上限"因此偏低，把正文当前 HP/EP 钳下去。修复后两处口径一致。
describe('playerMaxHp/Ep 的真实倍率随阶位（治血条与状态结算对不上）', () => {
  beforeEach(() => {
    useItems.setState({ items: [] } as any);   // 清空装备，隔离出"六维×realMult"这一项
    usePlayer.setState((s) => ({ profile: { ...s.profile, attrs: { str: 5, agi: 5, con: 10, int: 10, cha: 5, luck: 5 }, realAttrs: {}, level: 1, tier: '一阶' } }));
  });

  it('四阶主角的 HP/EP 上限 = 一阶的 realAttrMult 倍（纯六维、无装备时正好 ×5）', () => {
    const hp1 = playerMaxHp(), ep1 = playerMaxEp();
    usePlayer.setState((s) => ({ profile: { ...s.profile, tier: '四阶' } }));
    const hp4 = playerMaxHp(), ep4 = playerMaxEp();

    const mult = realAttrMult('四阶', 1) / realAttrMult('一阶', 1);   // 动态取，避免硬编码 5
    expect(mult).toBeGreaterThan(1);                                  // 四阶确实放大
    expect(hp4 / hp1).toBeCloseTo(mult, 5);
    expect(ep4 / ep1).toBeCloseTo(mult, 5);
    expect(hp4).toBeGreaterThan(hp1);
  });

  it('一阶(idx<3)真实倍率=1，不放大', () => {
    const hp1 = playerMaxHp();
    usePlayer.setState((s) => ({ profile: { ...s.profile, tier: '三阶' } }));   // 三阶仍 idx<3
    expect(playerMaxHp()).toBe(hp1);
  });
});

// 治用户报"真实体质好像真的不生效·没有计入血量计算"：真实属性点直加(realAttrs)只进了属性面板/战斗，
// 却漏出了 HP/EP 上限计算（playerMaxHp/Ep 只用 基础+技能树+团队，未并入 realAttrs）。修复后与 buildCombatant 同口径。
describe('真实属性点直加(realAttrs) 计入 HP/EP 上限', () => {
  beforeEach(() => {
    useItems.setState({ items: [] } as any);
    usePlayer.setState((s) => ({ profile: { ...s.profile, attrs: { str: 5, agi: 5, con: 10, int: 10, cha: 5, luck: 5 }, realAttrs: {}, level: 1, tier: '一阶' } }));
  });

  it('★真实体质直加 realAttrs.con → HP 上限相应增加（+5体质×20=+100）', () => {
    const before = playerMaxHp();   // con10×20 = 200
    usePlayer.setState((s) => ({ profile: { ...s.profile, realAttrs: { con: 5 } } }));
    expect(playerMaxHp()).toBe(before + 5 * 20);
  });

  it('★真实智力直加 realAttrs.int → EP 上限相应增加（+4智力×15=+60）', () => {
    const before = playerMaxEp();   // int10×15 = 150
    usePlayer.setState((s) => ({ profile: { ...s.profile, realAttrs: { int: 4 } } }));
    expect(playerMaxEp()).toBe(before + 4 * 15);
  });

  it('★四阶：realAttrs.con 随真实倍率×5一并放大（+5×20×5=+500）', () => {
    usePlayer.setState((s) => ({ profile: { ...s.profile, tier: '四阶' } }));
    const without = playerMaxHp();   // 10×20×5 = 1000
    usePlayer.setState((s) => ({ profile: { ...s.profile, realAttrs: { con: 5 } } }));
    expect(playerMaxHp()).toBe(without + 5 * 20 * realAttrMult('四阶', 1));
  });
});
