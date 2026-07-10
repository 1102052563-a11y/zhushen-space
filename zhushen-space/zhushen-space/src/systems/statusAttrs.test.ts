import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayer, type StatusEffect } from '../store/playerStore';
import { sumStatusAttrs, playerStatusAttrDelta, applyItemActiveBuff } from './statusAttrs';

/* 限时状态·六维加成（发动/服药类临时增益）：存续期折进有效六维、到点由 expireStatuses 自动撤销。
   治用户报"装备主动/需发动的属性被常驻算进状态栏"——临时的走限时状态、不进基础 attrs。 */
const st = (attrs: any, extra: Partial<StatusEffect> = {}): StatusEffect =>
  ({ id: Math.random().toString(36).slice(2), name: 'x', startTurn: 0, addedAt: 0, attrs, ...extra });

describe('statusAttrs · 限时状态六维', () => {
  beforeEach(() => { usePlayer.getState().setStatusEffects([]); });

  it('sumStatusAttrs 累加多条（增益 + 减益都计入）', () => {
    expect(sumStatusAttrs([st({ con: 15, agi: 10 }), st({ con: 5, cha: -12 })])).toEqual({ con: 20, agi: 10, cha: -12 });
    expect(sumStatusAttrs([])).toEqual({});
    expect(sumStatusAttrs([st(undefined)])).toEqual({});   // 无 attrs 的状态被跳过
  });

  it('playerStatusAttrDelta 读主角当前限时状态', () => {
    usePlayer.getState().setStatusEffects([st({ str: 8 })]);
    expect(playerStatusAttrDelta()).toEqual({ str: 8 });
    usePlayer.getState().setStatusEffects([]);
    expect(playerStatusAttrDelta()).toEqual({});
  });

  it('applyItemActiveBuff：从 activeEffect 解析六维 + 回合数并登记为限时状态', () => {
    const ok = applyItemActiveBuff({ name: '余烬之源·炼金壶', activeEffect: '使用后获得持续3回合的「余烬血脉」状态：体质+15、敏捷+10、魅力-12' });
    expect(ok).toBe(true);
    const list = usePlayer.getState().profile.statusEffects;
    expect(list.length).toBe(1);
    expect(list[0].attrs).toEqual({ con: 15, agi: 10, cha: -12 });
    expect(list[0].durationTurns).toBe(3);
    expect(list[0].name).toBe('余烬血脉');   // 取「」里的状态名
    expect(playerStatusAttrDelta()).toEqual({ con: 15, agi: 10, cha: -12 });
  });

  it('applyItemActiveBuff：无 activeEffect → 不登记', () => {
    expect(applyItemActiveBuff({ name: '空', activeEffect: '' })).toBe(false);
    expect(applyItemActiveBuff({ name: '空' })).toBe(false);
    expect(usePlayer.getState().profile.statusEffects.length).toBe(0);
  });

  it('applyItemActiveBuff：未写回合数 → 默认 3 回合（保证自动过期）', () => {
    applyItemActiveBuff({ name: 'x', activeEffect: '力量+5' });
    expect(usePlayer.getState().profile.statusEffects[0].durationTurns).toBe(3);
  });

  it('applyItemActiveBuff：显式 activeDuration 覆盖默认/文本（治"变身写10回合却只生效3回合"）', () => {
    applyItemActiveBuff({ name: '魔神变身符', activeEffect: '变身为魔神形态：力量+50', activeDuration: '10回合' });
    const e = usePlayer.getState().profile.statusEffects[0];
    expect(e.durationTurns).toBe(10);
    expect(e.durationDesc).toBe('10回合');
    expect(e.attrs).toEqual({ str: 50 });
  });

  it('applyItemActiveBuff：activeDuration 优先于 activeEffect 文本里的回合数', () => {
    applyItemActiveBuff({ name: 'x', activeEffect: '持续3回合：体质+8', activeDuration: '12回合' });
    expect(usePlayer.getState().profile.statusEffects[0].durationTurns).toBe(12);
  });
});
