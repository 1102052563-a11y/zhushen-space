import { describe, it, expect } from 'vitest';
import { playerControlled, checkEnd, currentActorId, aliveIds, settleAction, tickRoundStart } from './combatEngine';
import { useCharacters } from '../store/characterStore';
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

describe('settleAction（动作分支·无 store 依赖）', () => {
  it('defend：进入防御姿态 + 回 EP，且不改原 state（克隆）', () => {
    const actor = mkC('B1', 'player', 100, { curEp: 10 });
    const state = mkState([actor, mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player', 100), C1: mkB('敌', 'enemy', 100) });
    const out = settleAction({ state, actorId: 'B1', kind: 'defend', targetIds: [] });
    expect(out.state.participants['B1'].defending).toBe(true);
    expect(out.state.participants['B1'].curEp).toBeGreaterThan(10);   // 防御回 EP
    expect(state.participants['B1'].defending).toBeFalsy();           // 原 state 未被改（structuredClone）
  });
  it('flee：标记离场并移出出手顺序', () => {
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'C1', kind: 'flee', targetIds: [] });
    expect(out.state.participants['C1'].left).toBe(true);
    expect(out.state.order).not.toContain('C1');
  });
});

describe('settleAction（标签 VM·必中结算）', () => {
  it('被控制(cannotAct) → 本回合无法行动，不伤害目标', () => {
    const actor = mkC('B1', 'player', 100, { status: [{ id: 's1', name: '眩晕', combat: { cannotAct: true } } as any] });
    const state = mkState([actor, mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(100);          // 没出手，敌人零掉血
    expect(out.logLines.join('')).toMatch(/无法行动|被控制/);
  });

  it('普攻必中·伤害确定：(patk20×2)−(pdef10×0.6)=34 → 100→66', () => {
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(66);
    expect(state.participants['C1'].curHp).toBe(100);              // 原 state 未变（克隆）
  });

  it('护盾(格挡)先吸收：盾 50 吃下 34 伤害 → 盾 16、血不掉', () => {
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100, { curShield: 50 })], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curShield).toBe(16);
    expect(out.state.participants['C1'].curHp).toBe(100);
  });

  it('防御姿态承伤减半：34→17', () => {
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100, { defending: true })], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(83);   // 100 − round(34×0.5)=17
  });

  it('易伤(目标)放大受伤 ×1.5：34→51', () => {
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'v', name: '易伤', tone: 'debuff', combat: { vulnerable: true } } as any] });
    const state = mkState([mkC('B1', 'player', 100), c1], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    // base20 ×1.5(易伤)=30 → ×2(scale)=60 → −6(def)=54 → 100−54=46
    expect(out.state.participants['C1'].curHp).toBe(46);
  });
});

describe('tickRoundStart（中毒按层掉血并递减）', () => {
  it('中毒 3 层 → 掉 3 血、层数降到 2', () => {
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'p', name: '中毒', tone: 'debuff', startTurn: 1, combat: { poisonStacks: 3 }, addedAt: 0 } as any] });
    const s = mkState([mkC('B1', 'player', 100), c1], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    s.round = 2;
    tickRoundStart(s);
    expect(s.participants['C1'].curHp).toBe(97);
    expect(s.participants['C1'].status[0].combat!.poisonStacks).toBe(2);
  });
  it('中毒最后一层耗尽后移除', () => {
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'p', name: '中毒', tone: 'debuff', startTurn: 1, combat: { poisonStacks: 1 }, addedAt: 0 } as any] });
    const s = mkState([c1], { C1: mkB('敌', 'enemy') });
    s.round = 2;
    tickRoundStart(s);
    expect(s.participants['C1'].curHp).toBe(99);
    expect(s.participants['C1'].status.find((x) => x.name === '中毒')).toBeUndefined();
  });
});

describe('settleAction（技能·numeric.combat 标签端到端）', () => {
  it('block 标签技能 → 自身按防御档凝盾：(pdef10×2)×scale2=40', () => {
    useCharacters.setState({
      characters: { B1: { skills: [{ id: 'S_block', name: '铁壁', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'block', mult: 2.0 }] } } }], traits: [] } } as any,
    });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_block', targetIds: [] });
    expect(out.state.participants['B1'].curShield).toBe(40);
  });

  it('deal+poison 技能 → 敌人扣血且染毒', () => {
    useCharacters.setState({
      characters: { B1: { skills: [{ id: 'S_pz', name: '毒刃', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }, { tag: 'poison', stacks: 3 }] } } }], traits: [] } } as any,
    });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_pz', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBeLessThan(100);
    expect(out.state.participants['C1'].status.find((x) => x.name === '中毒')?.combat?.poisonStacks).toBe(3);
  });
});
