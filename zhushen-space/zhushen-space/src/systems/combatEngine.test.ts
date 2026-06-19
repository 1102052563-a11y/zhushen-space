import { describe, it, expect } from 'vitest';
import { playerControlled, checkEnd, currentActorId, aliveIds, settleAction } from './combatEngine';
import type { BattleState, Combatant, CombatStatBlock, Side } from '../store/combatStore';

// ── 最小战斗态 fixture（只填被测函数会读的字段，其余宽松）──
const mkC = (id: string, side: Side, curHp: number, extra: Partial<Combatant> = {}): Combatant =>
  ({ id, side, initiative: 10, curHp, curEp: 50, curShield: 0, maxShield: 0, status: [], cooldowns: {}, ...extra });

const mkB = (name: string, side: Side, maxEp = 100): CombatStatBlock =>
  ({ side, name, attrs: { str: 10, agi: 10, con: 10, int: 10, cha: 10, luck: 10 }, level: 1, tier: '一阶', bioStrength: 'T2', patk: 20, pdef: 10, matk: 15, mdef: 10, maxHp: 200, maxEp });

const mkState = (cs: Combatant[], blocks: Record<string, CombatStatBlock> = {}) => ({
  active: true, battleId: 't', stage: 'awaiting_player', round: 1, turn: 0,
  order: cs.map((c) => c.id),
  participants: Object.fromEntries(cs.map((c) => [c.id, c])),
  initialState: blocks, context: {}, log: [], transientEntities: {},
  activeArrays: [], endReason: null, victor: null,
}) as unknown as BattleState;

describe('playerControlled（谁由玩家手动出手）', () => {
  it('主角 B1 / 联机 MP_* 恒为真', () => {
    expect(playerControlled('B1', 'enemy', false)).toBe(true);
    expect(playerControlled('MP_seat2', 'enemy', false)).toBe(true);
  });
  it('玩家方队友仅在「手动控队」开时', () => {
    expect(playerControlled('C1', 'player', true)).toBe(true);
    expect(playerControlled('C1', 'player', false)).toBe(false);
  });
  it('敌方不由玩家控', () => expect(playerControlled('C1', 'enemy', true)).toBe(false));
});

describe('checkEnd（胜负判定）', () => {
  it('敌方全灭 → player 胜', () => {
    expect(checkEnd(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 0)]))).toBe('player');
  });
  it('我方全灭 → enemy 胜', () => {
    expect(checkEnd(mkState([mkC('B1', 'player', 0), mkC('C1', 'enemy', 100)]))).toBe('enemy');
  });
  it('两方有活人 → null（未结束）', () => {
    expect(checkEnd(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)]))).toBeNull();
  });
  it('已离场(left)的不算活', () => {
    expect(checkEnd(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100, { left: true })]))).toBe('player');
  });
});

describe('currentActorId / aliveIds', () => {
  it('当前行动者 = order[turn]', () => {
    expect(currentActorId(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)]))).toBe('B1');
  });
  it('aliveIds 按方过滤、剔除阵亡/离场', () => {
    const s = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 0), mkC('C2', 'enemy', 50)]);
    expect(aliveIds(s, 'enemy')).toEqual(['C2']);
    expect(aliveIds(s, 'player')).toEqual(['B1']);
  });
});

describe('settleAction（结算·无 store 依赖的分支）', () => {
  it('defend：进入防御姿态 + 回 EP，且不改原 state（克隆）', () => {
    const actor = mkC('B1', 'player', 100, { curEp: 10 });
    const state = mkState([actor, mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player', 100), C1: mkB('敌', 'enemy', 100) });
    const out = settleAction({ state, actorId: 'B1', kind: 'defend', targetIds: [] });
    expect(out.state.participants['B1'].defending).toBe(true);
    expect(out.state.participants['B1'].curEp).toBeGreaterThan(10);   // 防御回 EP
    expect(state.participants['B1'].defending).toBeFalsy();           // 原 state 未被改（settleAction 内部 structuredClone）
  });
  it('flee：标记离场并移出出手顺序', () => {
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'C1', kind: 'flee', targetIds: [] });
    expect(out.state.participants['C1'].left).toBe(true);
    expect(out.state.order).not.toContain('C1');
  });
});
