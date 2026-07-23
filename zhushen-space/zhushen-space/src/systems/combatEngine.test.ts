import { describe, it, expect } from 'vitest';
import { playerControlled, checkEnd, currentActorId, aliveIds, settleAction, tickRoundStart, assembleBattle, advanceTurn, effectiveSkillCost, previewAction, rollInitiative, buildCombatant } from './combatEngine';
import { pickEnemyAction, telegraphIntent, enemyArchetype } from './enemyAI';
import { buildBattleRecord } from './battleRecord';
import { BATTLEFIELD_AFFIXES } from './battlefield';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
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

describe('保护（guard 伤害重定向）', () => {
  it('B1 保护 C2 → 敌人打 C2 的伤害改由 B1 承受', () => {
    const blocks = { B1: mkB('主角', 'player'), C2: mkB('队友', 'player'), E1: mkB('敌', 'enemy') };
    const state = mkState([mkC('B1', 'player', 200), mkC('C2', 'player', 200), mkC('E1', 'enemy', 200)], blocks);
    const g = settleAction({ state, actorId: 'B1', kind: 'protect', targetIds: ['C2'] });
    expect(g.state.participants['C2'].guardedBy).toBe('B1');
    const atk = settleAction({ state: g.state, actorId: 'E1', kind: 'attack', targetIds: ['C2'] });
    expect(atk.state.participants['C2'].curHp).toBe(200);             // 队友未掉血（伤害被改道）
    expect(atk.state.participants['B1'].curHp).toBeLessThan(200);     // 主角替挡受创
  });
});

describe('整场战斗循环（端到端·必中确定性·0 API）', () => {
  it('主角普攻 + 敌人本地 AI 自动应战 → 收敛出胜负并产出 BATTLE_RECORD', () => {
    useCharacters.setState({ characters: {} as any });   // 无技能：双方走普攻
    const blocks: Record<string, CombatStatBlock> = {
      B1: { side: 'player', name: '主角', attrs: { str: 30, agi: 20, con: 20, int: 10, cha: 10, luck: 10 }, level: 5, tier: '二阶', bioStrength: 'T2', patk: 40, pdef: 15, matk: 20, mdef: 10, maxHp: 200, maxEp: 100 },
      E1: { side: 'enemy', name: '木桩怪', attrs: { str: 12, agi: 8, con: 12, int: 4, cha: 4, luck: 3 }, level: 1, tier: '一阶', bioStrength: 'T1', patk: 12, pdef: 5, matk: 5, mdef: 5, maxHp: 90, maxEp: 50 },
    };
    let battle = assembleBattle(blocks, { reason: '测试', location: '试炼场', endConditions: ['击败敌人'] }, false);
    let victor: Side | null = checkEnd(battle);
    let guard = 0;
    while (!victor && guard < 200) {
      const actor = currentActorId(battle)!;
      const isPlayer = battle.initialState[actor]?.side === 'player';
      const action = isPlayer ? { kind: 'attack' as const, targetIds: aliveIds(battle, 'enemy') } : pickEnemyAction(battle, actor);
      const out = settleAction({ state: battle, actorId: actor, kind: action.kind, targetIds: action.targetIds, skillId: (action as any).skillId });
      battle = out.state;
      victor = checkEnd(battle);
      if (!victor) battle = advanceTurn(battle, false);
      guard += 1;
    }
    expect(victor).toBe('player');           // 主角远强于木桩 → 必胜
    expect(guard).toBeLessThan(200);          // 循环收敛、不死锁
    const rec = buildBattleRecord(battle, victor);
    expect(rec).toMatch(/^BATTLE_RECORD: /);
    expect(rec).toContain('结果=胜');
    expect(rec).toMatch(/敌方=\[木桩怪:KO\]/);
  });
});

describe('settleAction（被动修正·系统 C）', () => {
  const atk = (b1Passive?: any, c1Passive?: any, c1Hp = 100) => {
    useCharacters.setState({ characters: {} as any });
    const B1 = { ...mkB('主角', 'player'), passive: b1Passive };
    const C1 = { ...mkB('敌', 'enemy'), passive: c1Passive };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', c1Hp)], { B1, C1 });
    return settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
  };
  it('增伤 dmgDealtPct +0.5：base20×2×1.5=60 −6 =54 → 100→46', () => {
    expect(atk({ dmgDealtPct: 0.5 }).state.participants['C1'].curHp).toBe(46);
  });
  it('减伤 dmgTakenPct -0.5（守方被动）：20×2×0.5=20 −6 =14 → 100→86', () => {
    expect(atk(undefined, { dmgTakenPct: -0.5 }).state.participants['C1'].curHp).toBe(86);
  });
  it('穿透 pierce 1.0 无视防御：40 −0 =40 → 100→60', () => {
    expect(atk({ pierce: 1 }).state.participants['C1'].curHp).toBe(60);
  });
  it('暴击 critChance 1 必暴：34 ×(1.5+0.5)=68 → 100→32，日志含暴击', () => {
    const out = atk({ critChance: 1, critMult: 0.5 });
    expect(out.state.participants['C1'].curHp).toBe(32);
    expect(out.logLines.join('')).toMatch(/暴击/);
  });
  it('多段 extraHits +1：deal 技能命中两次 = 34×2=68 → 100→32', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_d', name: '连斩', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } }], traits: [] } } as any });
    const B1 = { ...mkB('主角', 'player'), passive: { extraHits: 1 } };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_d', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(32);
  });
});

describe('effectiveSkillCost（P0·EP 消耗按品级×maxEp 百分比锚定）', () => {
  it('高 EP 池：极境技按 30% maxEp 计费（平数值不再形同免费）', () => {
    expect(effectiveSkillCost({ id: 's', name: '灭世', level: '极境' } as any, 10000)).toBe(3000);
  });
  it('authored 数值更大时尊重原文', () => {
    expect(effectiveSkillCost({ id: 's', name: '小技', level: '普通', cost: '消耗500EP' } as any, 1000)).toBe(500);
  });
  it('低 EP 池回退品级平数值：稀有=max(10, 50×8%)=10', () => {
    expect(effectiveSkillCost({ id: 's', name: '小技', level: '稀有' } as any, 50)).toBe(10);
  });
  it('结算侧生效：极境技在 EP 不足时退化普攻', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_big', name: '灭世斩', level: '极境', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 3.0 }] } } }], traits: [] } } as any });
    const state = mkState([mkC('B1', 'player', 100, { curEp: 20 }), mkC('C1', 'enemy', 200)], { B1: mkB('主角', 'player', 1000), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_big', targetIds: ['C1'] });
    expect(out.logLines.join('')).toMatch(/法力不足/);   // 需 30%×1000=300 EP，只有 20 → 退化普攻
    expect(out.state.participants['C1'].curHp).toBe(200 - 34);   // 普攻 34
  });
});

describe('DoT/荆棘锚定攻击档（P0·平数值在高阶 HP 池前形同装饰的修复）', () => {
  it('中毒毒性单位=施毒者攻击档3%：atk1000 → 每层30，3层下回合掉90', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_p', name: '毒袭', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'poison', stacks: 3 }] } } }], traits: [] } } as any });
    const B1 = { ...mkB('主角', 'player'), patk: 1000 };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 500)], { B1, C1: { ...mkB('敌', 'enemy'), maxHp: 500 } });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_p', targetIds: ['C1'] });
    const st = out.state.participants['C1'].status.find((x) => x.name === '中毒');
    expect(st?.combat?.poisonUnit).toBe(30);
    expect(st?.combat?.poisonStacks).toBe(3);
    out.state.round = 2;
    tickRoundStart(out.state);
    expect(out.state.participants['C1'].curHp).toBe(500 - 90);
  });
  it('旧档中毒无 poisonUnit → 视为 1（兼容不变）', () => {
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'p', name: '中毒', tone: 'debuff', startTurn: 1, combat: { poisonStacks: 3 }, addedAt: 0 } as any] });
    const s = mkState([c1], { C1: mkB('敌', 'enemy') });
    s.round = 2;
    tickRoundStart(s);
    expect(s.participants['C1'].curHp).toBe(97);
  });
  it('荆棘反弹=层数×攻击档4%：atk500·2层 → 40', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_t', name: '棘甲', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'thorns', stacks: 2 }] } } }], traits: [] } } as any });
    const B1 = { ...mkB('主角', 'player'), patk: 500 };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_t', targetIds: [] });
    expect(out.state.participants['B1'].status.find((x) => x.name === '荆棘')?.combat?.thorns).toBe(40);
  });
  it('燃烧 flat 过小时按攻击档12%兜底：atk1000·flat5 → 120/回合', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_b', name: '烈焰斩', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'burn', flat: 5, turns: 2 }] } } }], traits: [] } } as any });
    const B1 = { ...mkB('主角', 'player'), patk: 1000 };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_b', targetIds: ['C1'] });
    expect(out.state.participants['C1'].status.find((x) => x.name === '燃烧')?.combat?.dotPerRound).toBe(120);
  });
});

describe('previewAction（P0·预览=结算镜像）', () => {
  it('普攻预览与实际结算一致（34）', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const pv = previewAction(state, 'B1', 'C1', undefined);
    expect(pv?.kind).toBe('damage');
    expect(pv?.total).toBe(34);
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(100 - out.state.participants['C1'].curHp).toBe(pv!.total);
  });
  it('目标缺省=首个存活敌人；攻方被动增伤计入（54）', () => {
    useCharacters.setState({ characters: {} as any });
    const B1 = { ...mkB('主角', 'player'), passive: { dmgDealtPct: 0.5 } } as any;
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') });
    const pv = previewAction(state, 'B1', undefined, undefined);
    expect(pv?.targetId).toBe('C1');
    expect(pv?.total).toBe(54);
  });
  it('block 技能预览=按目标防御档凝盾（40）', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const pv = previewAction(state, 'B1', undefined, { id: 'S_blk', name: '铁壁', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'block', mult: 2.0 }] } } } as any);
    expect(pv?.kind).toBe('block');
    expect(pv?.total).toBe(40);
  });
  it('意图预告=真实决策：telegraph 显示的目标/数字与敌人实际出手一致', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('E1', 'enemy', 100)], { B1: mkB('主角', 'player'), E1: mkB('敌', 'enemy') });
    const it0 = telegraphIntent(state, 'E1');
    const act = pickEnemyAction(state, 'E1');
    expect(act.kind).toBe('attack');
    const pv = previewAction(state, 'E1', act.targetIds[0], undefined);
    expect(it0.label).toContain(`~${pv!.total}`);   // 预告数字=预演数字
    const out = settleAction({ state, actorId: 'E1', kind: act.kind, targetIds: act.targetIds });
    expect(100 - out.state.participants['B1'].curHp).toBe(pv!.total);   // 实际掉血=预告数字
  });
});

describe('战场词缀（P1·环境入数值）', () => {
  const withBf = (s: BattleState, ids: string[]) => { (s as any).battlefieldAffixes = ids.map((id) => (BATTLEFIELD_AFFIXES as any)[id]); return s; };

  it('雨幕压火：火系技能伤害 ×0.7（20×2×0.7=28 −6 =22），且预览镜像一致', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_f', name: '烈焰斩', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } }], traits: [] } } as any });
    const state = withBf(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') }), ['rain']);
    const pv = previewAction(state, 'B1', 'C1', (useCharacters.getState().characters as any)['B1'].skills[0]);
    expect(pv?.total).toBe(22);
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_f', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(78);
    expect(out.logLines.join('')).toMatch(/雨幕-30%/);   // 结算日志标注环境修正
  });
  it('普攻无元素 → 词缀不影响（仍 34）', () => {
    useCharacters.setState({ characters: {} as any });
    const state = withBf(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') }), ['rain']);
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(66);
  });
  it('雨幕压燃烧：燃烧 DoT 每回合减半（10→5）', () => {
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'b', name: '燃烧', tone: 'debuff', startTurn: 1, combat: { dotPerRound: 10 }, addedAt: 0 } as any] });
    const s = withBf(mkState([c1], { C1: mkB('敌', 'enemy') }), ['rain']);
    s.round = 2;
    tickRoundStart(s);
    expect(s.participants['C1'].curHp).toBe(95);
  });
  it('灵潮助回蓝：每回合回蓝 ×1.5（6→9）', () => {
    const c1 = mkC('C1', 'enemy', 100, { curEp: 50 });
    const s = withBf(mkState([c1], { C1: mkB('敌', 'enemy') }), ['ley']);
    s.round = 2;
    tickRoundStart(s);
    expect(s.participants['C1'].curEp).toBe(59);
  });
  it('断壁助盾：block 护盾获取 ×1.2（40→48），预览一致', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_blk', name: '铁壁', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'block', mult: 2.0 }] } } }], traits: [] } } as any });
    const state = withBf(mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') }), ['ruins']);
    const pv = previewAction(state, 'B1', undefined, (useCharacters.getState().characters as any)['B1'].skills[0]);
    expect(pv?.total).toBe(48);
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_blk', targetIds: [] });
    expect(out.state.participants['B1'].curShield).toBe(48);
  });
  it('先攻敏捷倍率：agi100 时 ×0.5 必然低于 ×1（区间不重叠）', () => {
    const b = { ...mkB('疾风', 'enemy'), attrs: { str: 10, agi: 100, con: 10, int: 10, cha: 10, luck: 10 } } as CombatStatBlock;
    expect(rollInitiative(b, 0.5)).toBeLessThan(rollInitiative(b, 1));   // [53,56] < [103,106]
  });
  it('assembleBattle 烘焙词缀 + 战报带环境段', () => {
    useCharacters.setState({ characters: {} as any });
    const blocks: Record<string, CombatStatBlock> = { B1: mkB('主角', 'player'), E1: mkB('敌', 'enemy') };
    const battle = assembleBattle(blocks, { reason: 't', location: '废墟', endConditions: [], battlefieldAffixes: [(BATTLEFIELD_AFFIXES as any).ruins] }, false);
    expect(battle.battlefieldAffixes?.[0]?.id).toBe('ruins');
    const rec = buildBattleRecord(battle, 'player');
    expect(rec).toMatch(/环境=\[断壁/);
  });
});

describe('P2 打磨（破防保底/幸运暴击/先攻种子/行为原型）', () => {
  it('破防保底 8%：高防坦克不再永远只掉 1 点（preDef40 vs pdef200 → 4），预览一致', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: { ...mkB('敌', 'enemy'), pdef: 200 } });
    const pv = previewAction(state, 'B1', 'C1', undefined);
    expect(pv?.total).toBe(4);   // ceil(40×0.08)
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(96);
  });
  it('幸运→暴击率：luck50 → +10%（每点0.2%·上限15%）', () => {
    useCharacters.setState({ characters: {} as any });
    const b = buildCombatant('LK', 'enemy', { isTransient: true, name: '幸运儿', attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 50 }, tier: '一阶' });
    expect(b.passive?.critChance ?? 0).toBeCloseTo(0.1);
    const b2 = buildCombatant('LK2', 'enemy', { isTransient: true, name: '天命', attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 999 }, tier: '一阶' });
    expect(b2.passive?.critChance ?? 0).toBeCloseTo(0.15);   // 封顶
  });
  it('先攻可注入种子随机：rand()=0.5 → agi + int×0.3 + 1.5 精确可复现', () => {
    expect(rollInitiative(mkB('x', 'player'), 1, () => 0.5)).toBeCloseTo(10 + 3 + 1.5);
  });
  it('行为原型：智堡=caster / 力堡=striker / 均衡=balanced', () => {
    const mk = (str: number, agi: number, int: number) => ({ attrs: { str, agi, int } });
    expect(enemyArchetype(mk(10, 10, 100))).toBe('caster');
    expect(enemyArchetype(mk(100, 10, 10))).toBe('striker');
    expect(enemyArchetype(mk(10, 10, 10))).toBe('balanced');
  });
  it('settleAction 记录 lastSkillIds（最近两次施放）', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_blk', name: '铁壁', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'block', mult: 2.0 }] } } }], traits: [] } } as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const o1 = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_blk', targetIds: [] });
    expect(o1.state.participants['B1'].lastSkillIds).toEqual(['S_blk']);
    const o2 = settleAction({ state: o1.state, actorId: 'B1', kind: 'skill', skillId: 'S_blk', targetIds: [] });
    expect(o2.state.participants['B1'].lastSkillIds).toEqual(['S_blk', 'S_blk']);
  });
  it('不连放同技：同技连放两次且有替代 → 换招', () => {
    useCharacters.setState({
      characters: { E1: { skills: [
        { id: 'S_a', name: '横斩', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } },
        { id: 'S_b', name: '突刺', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.2 }] } } },
      ], traits: [] } } as any,
    });
    const e1 = mkC('E1', 'enemy', 100, {
      lastSkillIds: ['S_a', 'S_a'],
      status: [{ id: 'bf', name: '战意', tone: 'buff', combat: {} } as any],           // 有增益 → 跳过强化步
    });
    const b1 = mkC('B1', 'player', 100, { status: [{ id: 'db', name: '破绽', tone: 'debuff', combat: {} } as any] });   // 目标已有减益 → 跳过控场步
    const state = mkState([b1, e1], { B1: mkB('主角', 'player'), E1: mkB('敌', 'enemy') });
    const act = pickEnemyAction(state, 'E1');
    expect(act.kind).toBe('skill');
    expect(act.skillId).toBe('S_b');   // S_a 被"不连放"过滤
  });
});

describe('道具威能锚定（P0）', () => {
  it('炸弹伤害下限=使用者攻击档×(0.5+品级×0.1)×2：atk1000·grade1 → 1200', () => {
    useCharacters.setState({ characters: {} as any });
    useItems.setState({ items: [{ id: 'bomb1', name: '小炸弹', category: '消耗品', quantity: 1, effect: '投掷爆炸' }] } as any);
    const B1 = { ...mkB('主角', 'player'), patk: 1000 };
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 5000)], { B1, C1: { ...mkB('敌', 'enemy'), maxHp: 5000 } });
    const out = settleAction({ state, actorId: 'B1', kind: 'item', itemId: 'bomb1', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(5000 - 1200);
    expect(out.consumedItem?.id).toBe('bomb1');
  });
  it('药剂回复下限=目标 maxHp 百分比：maxHp10000·grade1 → ≥8%', () => {
    useCharacters.setState({ characters: {} as any });
    useItems.setState({ items: [{ id: 'pot1', name: '治疗药剂', category: '消耗品', quantity: 1, effect: '回复生命' }] } as any);
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: { ...mkB('主角', 'player'), maxHp: 10000 }, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'item', itemId: 'pot1', targetIds: ['B1'] });
    expect(out.state.participants['B1'].curHp).toBe(100 + 800);   // 8%×10000=800（>品级50平数值）
  });
});

describe('settleAction（条件触发·系统 C）', () => {
  it('onHit 触发施加燃烧：普攻命中后敌人染上燃烧', () => {
    useCharacters.setState({ characters: {} as any });
    const B1 = { ...mkB('主角', 'player'), triggers: [{ on: 'onHit', chance: 1, effect: { tag: 'burn', flat: 10, turns: 2 } }] } as any;
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].status.find((s) => s.name === '燃烧')).toBeTruthy();
  });
  it('onKill 触发自愈：击杀残血敌人后主角回血', () => {
    useCharacters.setState({ characters: {} as any });
    const B1 = { ...mkB('主角', 'player'), maxHp: 300, triggers: [{ on: 'onKill', chance: 1, effect: { tag: 'heal', flat: 50 } }] } as any;
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 1)], { B1, C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBeLessThanOrEqual(0);
    expect(out.state.participants['B1'].curHp).toBeGreaterThan(100);
  });
  it('条件 targetLowHp：仅当目标残血才追加伤害', () => {
    useCharacters.setState({ characters: {} as any });
    const trig = [{ on: 'onHit', cond: 'targetLowHp', chance: 1, effect: { tag: 'deal', mult: 1.0 } }];
    const B1 = { ...mkB('主角', 'player'), triggers: trig } as any;
    const full = settleAction({ state: mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1, C1: mkB('敌', 'enemy') }), actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(full.logLines.join('')).not.toMatch(/追加/);            // 满血 → 条件不满足
    const low = settleAction({ state: mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 55)], { B1, C1: mkB('敌', 'enemy') }), actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(low.logLines.join('')).toMatch(/追加/);                  // 残血(≤30%) → 触发追加
  });
});
