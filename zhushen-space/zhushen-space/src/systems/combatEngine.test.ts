import { describe, it, expect } from 'vitest';
import { playerControlled, checkEnd, currentActorId, aliveIds, settleAction, tickRoundStart, assembleBattle, advanceTurn, effectiveSkillCost, previewAction, rollInitiative, buildCombatant, damagePipeline } from './combatEngine';
import { pickEnemyAction, telegraphIntent, enemyArchetype } from './enemyAI';
import { buildBattleRecord } from './battleRecord';
import { BATTLEFIELD_AFFIXES } from './battlefield';
import { useCharacters } from '../store/characterStore';
import { useNpc } from '../store/npcStore';
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

describe('damagePipeline（伤害修正管线·三处收拢的单一来源）', () => {
  it('基础链与普攻断言同源：base20 def10 → round(20×2)−round(10×0.6)=34', () => {
    expect(damagePipeline({ base: 20, atkTier: 20, defTier: 10 }).dmg).toBe(34);
  });
  it('不传 rng 不掷暴击：crit=false、critDmg 单列 =34×(1.5+0.5)=68（预览场景）', () => {
    const r = damagePipeline({ base: 20, atkTier: 20, defTier: 10, critChance: 1, critMult: 0.5 });
    expect(r.crit).toBe(false); expect(r.dmg).toBe(34); expect(r.critDmg).toBe(68);
  });
  it('传 rng 且命中暴击 → dmg=critDmg=51', () => {
    const r = damagePipeline({ base: 20, atkTier: 20, defTier: 10, critChance: 0.3, rng: () => 0.1 });
    expect(r.crit).toBe(true); expect(r.dmg).toBe(51);
  });
  it('critChance=0 时不消耗 rng（保持 settleAction 内 rng 调用序列与旧实现一致）', () => {
    let calls = 0;
    damagePipeline({ base: 20, atkTier: 20, defTier: 10, rng: () => { calls++; return 0; } });
    expect(calls).toBe(0);
  });
  it('破防保底：高防目标至少吃减防前伤害的 8%', () => {
    expect(damagePipeline({ base: 20, atkTier: 20, defTier: 9999 }).dmg).toBe(Math.ceil(40 * 0.08));
  });
  it('力量层/穿透走同一链：力量5层→54；穿透50%→77', () => {
    expect(damagePipeline({ base: 20, atkTier: 20, defTier: 10, strengthStacks: 5 }).dmg).toBe(54);
    expect(damagePipeline({ base: 40, atkTier: 40, defTier: 10, pierce: 0.5 }).dmg).toBe(77);
  });
});

describe('治疗/护盾/回能 flat-only 锚定（高阶挠痒兜底·对齐 burn 思想）', () => {
  const cast = (effects: any[], startHp = 50) => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_x', name: '包扎', numeric: { combat: { cost: 0, target: 'self', effects } } }], traits: [] } } } as any);
    const state = mkState([mkC('B1', 'player', startHp), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    return settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_x', targetIds: [] }).state.participants['B1'];
  };
  it('heal 纯 flat 过小 → 按攻击档六成兜底：max(round(5×2), round(20×0.6×2)=24)=24', () => {
    expect(cast([{ tag: 'heal', flat: 5 }]).curHp).toBe(74);
  });
  it('heal 大 flat 尊重原文：flat500 → 直接奶满（夹上限）', () => {
    expect(cast([{ tag: 'heal', flat: 500 }]).curHp).toBe(200);
  });
  it('heal 写了 mult 即尊重（刻意小奶不被抬）：mult0.3 → round(0.3×20×2)=12', () => {
    expect(cast([{ tag: 'heal', mult: 0.3 }]).curHp).toBe(62);
  });
  it('block 纯 flat 过小 → 按防御档六成兜底：max(round(5×2), round(10×0.6×2)=12)=12', () => {
    expect(cast([{ tag: 'block', flat: 5 }]).curShield).toBe(12);
  });
  it('restore 过小即兜（旧实现 flat=5 就不兜了）：maxEp1000×8%=80 远超 flat5', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_r', name: '回气', numeric: { combat: { cost: 0, target: 'self', effects: [{ tag: 'restore', flat: 5 }] } } }], traits: [] } } } as any);
    const state = mkState([mkC('B1', 'player', 50, { curEp: 500 }), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player', 1000), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_r', targetIds: [] });
    // 技能自身先耗 EP=max(平数值兜底8, maxEp1000×无品级缺省6%=60)=60，restore 兜底=maxEp1000×8%=80：500−60+80=520
    expect(out.state.participants['B1'].curEp).toBe(520);
  });
});

describe('NPC 叙事状态六维折进战斗（npcStatusAttrDelta 接线·与 B1 对称）', () => {
  it('statusEffects 的六维减益让 NPC 六维与攻防同步下降', () => {
    useCharacters.setState({ characters: {} as any });
    const base = { name: '断臂剑客', realm: '一阶·Lv.5', attrs: { str: 30, agi: 20, con: 20, int: 10, cha: 10, luck: 10 }, items: [] };
    useNpc.setState({ npcs: { C9: { ...base, statusEffects: [{ id: 'st1', name: '重伤', attrs: { str: -10 } }] } } } as any);
    const hurt = buildCombatant('C9', 'enemy');
    useNpc.setState({ npcs: { C9: { ...base, statusEffects: [] } } } as any);
    const fine = buildCombatant('C9', 'enemy');
    expect(fine.attrs.str - hurt.attrs.str).toBe(10);
    expect(hurt.patk).toBeLessThan(fine.patk);
  });
});

describe('佩戴称号进战斗被动（equippedTitleAbilities 接线）', () => {
  it('equipped 称号的 effect 文本被推断进 passive；未佩戴的不算', () => {
    useCharacters.setState({ characters: { TT: { skills: [], traits: [], titles: [
      { name: '斩神者', effect: '暴击率+20%，造成伤害+10%', equipped: true },
      { name: '尘封', effect: '暴击率+50%', equipped: false },
    ] } } } as any);
    const b = buildCombatant('TT', 'enemy', { isTransient: true, name: '冠者', attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 }, tier: '一阶' });
    expect(b.passive?.critChance ?? 0).toBeCloseTo(0.21);   // 称号 20% + luck5×0.2%=1%
    expect(b.passive?.dmgDealtPct ?? 0).toBeCloseTo(0.1);
  });
});

describe('BOSS 多阶段（通用·叙事强敌）', () => {
  it('assembleBattle 自动判定：非 transient 单体巨血敌自动配两阶段；transient（raid/竞技场）不配', () => {
    const battle = assembleBattle({ B1: mkB('主角', 'player'), BOSS: { ...mkB('魔王', 'enemy'), maxHp: 1000 } }, { reason: 't', location: 'l', endConditions: [] });
    expect(battle.initialState['BOSS'].bossPhases?.length).toBe(2);   // 1000 ≥ 200×1.5
    const battle2 = assembleBattle({ B1: mkB('主角', 'player'), BOSS: { ...mkB('讨伐BOSS', 'enemy'), maxHp: 1000, isTransient: true } }, { reason: 't', location: 'l', endConditions: [] });
    expect(battle2.initialState['BOSS'].bossPhases).toBeUndefined();
    const battle3 = assembleBattle({ B1: mkB('主角', 'player'), C1: mkB('杂兵', 'enemy') }, { reason: 't', location: 'l', endConditions: [] });
    expect(battle3.initialState['C1'].bossPhases).toBeUndefined();    // 同级敌不 BOSS 化
  });
  it('压过 70% 线 → 转阶段获得力量+【阶段】日志；同阈值不重复触发', () => {
    useCharacters.setState({ characters: {} as any });
    const boss = { ...mkB('魔王', 'enemy'), maxHp: 1000, bossPhases: [{ hpPct: 0.7, announce: '魔王气势暴涨！', strength: 3 }] };
    const state = mkState([mkC('B1', 'player', 100), mkC('BOSS', 'enemy', 705)], { B1: mkB('主角', 'player'), BOSS: boss });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['BOSS'] });   // 705−34=671 < 700
    expect(out.logLines.join('')).toMatch(/【阶段】魔王气势暴涨/);
    expect(out.state.participants['BOSS'].status.some((s) => s.combat?.strengthStacks === 3)).toBe(true);
    expect(out.state.participants['BOSS'].phasesFired).toEqual([0.7]);
    const out2 = settleAction({ state: out.state, actorId: 'B1', kind: 'attack', targetIds: ['BOSS'] });
    expect(out2.logLines.join('')).not.toMatch(/【阶段】/);
  });
  it('狂暴阶段：清减益+按 maxHp 比例获盾；战报「关键」段收录', () => {
    useCharacters.setState({ characters: {} as any });
    const boss = { ...mkB('魔王', 'enemy'), maxHp: 1000, bossPhases: [{ hpPct: 0.35, announce: '魔王彻底狂暴了！', cleanse: true, strength: 5, shieldPct: 0.1 }] };
    const bossC = mkC('BOSS', 'enemy', 360, { status: [{ id: 'w', name: '虚弱', tone: 'debuff', combat: { weak: true } } as any] });
    const state = mkState([mkC('B1', 'player', 100), bossC], { B1: mkB('主角', 'player'), BOSS: boss });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['BOSS'] });   // 360−34=326 < 350
    const c = out.state.participants['BOSS'];
    expect(c.status.some((s) => s.tone === 'debuff')).toBe(false);
    expect(c.curShield).toBe(100);   // 1000×10%
    const st = out.state;
    st.log.push({ id: 'k1', round: 1, type: 'action', text: out.logLines.join(' / '), timestamp: 0 } as any);
    expect(buildBattleRecord(st, 'player')).toMatch(/狂暴/);
  });
  it('DoT 压线也转阶段（tickRoundStart）', () => {
    const boss = { ...mkB('魔王', 'enemy'), maxHp: 1000, bossPhases: [{ hpPct: 0.7, announce: '爆气！', strength: 2 }] };
    const bossC = mkC('BOSS', 'enemy', 705, { status: [{ id: 'b', name: '燃烧', tone: 'debuff', startTurn: 1, combat: { dotPerRound: 10 }, addedAt: 0 } as any] });
    const s = mkState([mkC('B1', 'player', 100), bossC], { B1: mkB('主角', 'player'), BOSS: boss });
    s.round = 2;
    tickRoundStart(s);   // 705−10=695 < 700
    expect(s.participants['BOSS'].phasesFired).toEqual([0.7]);
    expect(s.log.some((e) => /【阶段】爆气/.test(e.text || ''))).toBe(true);
  });
});

describe('敌 AI 三小件（濒死吃药/会保护/AoE 择优）', () => {
  it('濒死且无治疗技 → 用背包恢复道具（意图预告同步）', () => {
    useCharacters.setState({ characters: {} as any });
    useNpc.setState({ npcs: { C1: { name: '残兵', items: [{ id: 'it1', name: '回春药剂', effect: '回复300生命', quantity: 1 }] } } } as any);
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 20)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const act = pickEnemyAction(state, 'C1');
    expect(act.kind).toBe('item');
    expect(act.itemId).toBe('it1');
    expect(act.targetIds).toEqual(['C1']);
    expect(telegraphIntent(state, 'C1').label).toContain('回春药剂');
  });
  it('药量耗尽/无药 → 不再出 item 动作', () => {
    useCharacters.setState({ characters: {} as any });
    useNpc.setState({ npcs: { C1: { name: '残兵', items: [{ id: 'it1', name: '回春药剂', effect: '回复300生命', quantity: 0 }] } } } as any);
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 20)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    expect(pickEnemyAction(state, 'C1').kind).not.toBe('item');
  });
  it('小弟保护残血 BOSS：caster 原型按种子概率挺身（确定性·多种子至少一中）', () => {
    useCharacters.setState({ characters: {} as any });
    useNpc.setState({ npcs: {} } as any);
    const bossB = { ...mkB('魔王', 'enemy'), maxHp: 2000 };
    const minion = { ...mkB('小弟', 'enemy'), attrs: { str: 10, agi: 10, con: 10, int: 50, cha: 10, luck: 10 } };
    const mk = (bid: string) => {
      const s = mkState([mkC('B1', 'player', 100), mkC('BOSS', 'enemy', 500), mkC('C2', 'enemy', 200)], { B1: mkB('主角', 'player'), BOSS: bossB, C2: minion });
      (s as any).battleId = bid;
      return s;
    };
    const acts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((bid) => pickEnemyAction(mk(bid), 'C2'));
    const prot = acts.find((a) => a.kind === 'protect');
    expect(prot).toBeTruthy();                          // caster protP=0.5，8 个种子至少一中
    expect(prot!.targetIds).toEqual(['BOSS']);          // 保的是高价值残血者
  });
  it('对面≥3人 → 优先 AoE 攻击技', () => {
    useCharacters.setState({ characters: { C1: { skills: [
      { id: 'S_single', name: '突刺', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.2 }] } } },
      { id: 'S_aoe', name: '横扫', numeric: { combat: { cost: 0, target: 'allEnemy', effects: [{ tag: 'deal', mult: 0.8, target: 'allEnemy' }] } } },
    ], traits: [] } } } as any);
    useNpc.setState({ npcs: {} } as any);
    const state = mkState(
      [mkC('C1', 'enemy', 200), mkC('B1', 'player', 100), mkC('P2', 'player', 100), mkC('P3', 'player', 100)],
      { C1: mkB('敌将', 'enemy'), B1: mkB('主角', 'player'), P2: mkB('随从A', 'player'), P3: mkB('随从B', 'player') },
    );
    const act = pickEnemyAction(state, 'C1');
    expect(act.kind).toBe('skill');
    expect(act.skillId).toBe('S_aoe');
  });
});

describe('detonate 引爆（P3·DoT 收口）', () => {
  const burnPoisonTarget = () => mkC('C1', 'enemy', 200, { status: [
    { id: 'b', name: '燃烧', tone: 'debuff', startTurn: 1, durationTurns: 3, combat: { dotPerRound: 10 }, addedAt: 0 } as any,
    { id: 'p', name: '中毒', tone: 'debuff', combat: { poisonStacks: 3, poisonUnit: 5 }, addedAt: 0 } as any,
  ] });
  it('引爆=燃烧剩余总量+毒层总量 ×1.5 真伤并清除：(10×3+3×5)×1.5=68', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_det', name: '引爆术', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'detonate' }] } } }], traits: [] } } } as any);
    const state = mkState([mkC('B1', 'player', 100), burnPoisonTarget()], { B1: mkB('主角', 'player'), C1: { ...mkB('敌', 'enemy'), maxHp: 200 } });
    const pv = previewAction(state, 'B1', 'C1', useCharacters.getState().characters['B1'].skills[0] as any);
    expect(pv?.total).toBe(68);   // 预览=结算镜像
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_det', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(132);   // 200−68
    expect(out.state.participants['C1'].status.some((s) => s.combat?.dotPerRound || s.combat?.poisonStacks)).toBe(false);   // DoT 已清
    expect(out.logLines.join('')).toMatch(/引爆/);
  });
  it('目标无 DoT → 不产生伤害，日志提示', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_det', name: '引爆术', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'detonate' }] } } }], traits: [] } } } as any);
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 200)], { B1: mkB('主角', 'player'), C1: { ...mkB('敌', 'enemy'), maxHp: 200 } });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_det', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(200);
    expect(out.logLines.join('')).toMatch(/没有找到可引爆/);
  });
});

describe('once 触发限定（P3·背水一战类每场一次）', () => {
  it('selfLowHp+once：首次受击触发力量爆发，之后整场不再触发', () => {
    useCharacters.setState({ characters: {} as any });
    const trig = [{ on: 'onHurt', cond: 'selfLowHp', chance: 1, once: true, effect: { tag: 'strength', stacks: 5, turns: 3 } }];
    const C1 = { ...mkB('敌', 'enemy'), triggers: trig } as any;
    const s1 = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 70)], { B1: mkB('主角', 'player'), C1 });
    const out = settleAction({ state: s1, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });   // 70−34=36 → 18% ≤30% 触发
    expect(out.logLines.join('')).toMatch(/触发/);
    expect(out.state.participants['C1'].status.some((x) => x.combat?.strengthStacks === 5)).toBe(true);
    expect(out.state.participants['C1'].firedOnce).toEqual([0]);
    const out2 = settleAction({ state: out.state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });   // 仍残血但 once 已用
    expect(out2.logLines.join('')).not.toMatch(/触发/);
    expect(out2.state.participants['C1'].firedOnce).toEqual([0]);
  });
  it('normalizeTriggers 解析 once；背水一战文本推断出 once 触发器', async () => {
    const { normalizeTriggers, inferTriggersFromSkill } = await import('./combatTags');
    const t = normalizeTriggers([{ on: 'onHurt', cond: 'selfLowHp', once: true, effect: { tag: 'strength', stacks: 5 } }]);
    expect(t[0]?.once).toBe(true);
    const inf = inferTriggersFromSkill({ name: '背水一战', effect: '濒死时爆发出全部潜能' });
    expect(inf.some((x) => x.once && x.cond === 'selfLowHp')).toBe(true);
  });
});

describe('元素反应（P3·蒸汽/感电）', () => {
  it('蒸汽：水冰技打燃烧中目标 ×1.25 并淬灭燃烧（预览一致）', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_ice', name: '寒潮斩', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } }], traits: [] } } } as any);
    const c1 = mkC('C1', 'enemy', 100, { status: [{ id: 'b', name: '燃烧', tone: 'debuff', startTurn: 1, durationTurns: 3, combat: { dotPerRound: 10 }, addedAt: 0 } as any] });
    const state = mkState([mkC('B1', 'player', 100), c1], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const pv = previewAction(state, 'B1', 'C1', useCharacters.getState().characters['B1'].skills[0] as any);
    expect(pv?.total).toBe(44);   // round(20×2×1.25)=50 −6
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_ice', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(56);   // 100−44
    expect(out.state.participants['C1'].status.some((s) => /燃烧/.test(s.name || ''))).toBe(false);   // 燃烧被淬灭
    expect(out.logLines.join('')).toMatch(/蒸汽反应/);
  });
  it('感电：雷技打中毒目标 → 眩晕1回合，每场每目标限一次', () => {
    useCharacters.setState({ characters: { B1: { skills: [{ id: 'S_thunder', name: '雷击', numeric: { combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } }], traits: [] } } } as any);
    const c1 = mkC('C1', 'enemy', 300, { status: [{ id: 'p', name: '中毒', tone: 'debuff', combat: { poisonStacks: 5, poisonUnit: 2 }, addedAt: 0 } as any] });
    const state = mkState([mkC('B1', 'player', 100), c1], { B1: mkB('主角', 'player'), C1: { ...mkB('敌', 'enemy'), maxHp: 300 } });
    const out = settleAction({ state, actorId: 'B1', kind: 'skill', skillId: 'S_thunder', targetIds: ['C1'] });
    expect(out.logLines.join('')).toMatch(/感电反应/);
    expect(out.state.participants['C1'].status.some((s) => s.combat?.cannotAct)).toBe(true);
    expect(out.state.participants['C1'].shockedOnce).toBe(true);
    const out2 = settleAction({ state: out.state, actorId: 'B1', kind: 'skill', skillId: 'S_thunder', targetIds: ['C1'] });
    expect(out2.logLines.join('')).not.toMatch(/感电反应/);   // 每场一次
  });
});

describe('资源爆发档（P3·嫁接主角⚡面板绑定的 numeric.resCost/resGate·扣点从面板挪进引擎）', () => {
  const rageSkill = { id: 'S_rage', name: '怒火斩', numeric: { resCost: { id: 'rage', amount: 5 }, combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } };
  const mkS = () => mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
  it('点数足够：引擎扣点+伤害爆发档 ×1.3（预览镜像一致）', async () => {
    const { useResource } = await import('../store/resourceStore');
    useCharacters.setState({ characters: { B1: { skills: [rageSkill], traits: [] } } } as any);
    useResource.setState({ resources: [{ id: 'rage', name: '怒气', cur: 10, max: 100 }] } as any);
    const pv = previewAction(mkS(), 'B1', 'C1', rageSkill as any);
    expect(pv?.total).toBe(46);   // round(20×2×1.3)=52 −6
    const out = settleAction({ state: mkS(), actorId: 'B1', kind: 'skill', skillId: 'S_rage', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(54);   // 100−46
    expect(out.logLines.join('')).toMatch(/爆发态/);
    expect(useResource.getState().resources[0].cur).toBe(5);   // 10−5（引擎扣，autoBattle 代打路径也一致）
    useResource.setState({ resources: [] } as any);
  });
  it('点数不足：退化普攻不扣（面板已拦，引擎兜底代打路径）；门槛 resGate 未达同退化', async () => {
    const { useResource } = await import('../store/resourceStore');
    useCharacters.setState({ characters: { B1: { skills: [rageSkill], traits: [] } } } as any);
    useResource.setState({ resources: [{ id: 'rage', name: '怒气', cur: 3, max: 100 }] } as any);
    const out = settleAction({ state: mkS(), actorId: 'B1', kind: 'skill', skillId: 'S_rage', targetIds: ['C1'] });
    expect(out.state.participants['C1'].curHp).toBe(66);   // 普攻 34
    expect(out.logLines.join('')).toMatch(/不足.*改为普通攻击/);
    expect(useResource.getState().resources[0].cur).toBe(3);   // 不扣
    const gateSkill = { id: 'S_gate', name: '怒涛斩', numeric: { resGate: { id: 'rage', amount: 80 }, combat: { cost: 0, target: 'enemy', effects: [{ tag: 'deal', mult: 1.0 }] } } };
    useCharacters.setState({ characters: { B1: { skills: [gateSkill], traits: [] } } } as any);
    const out2 = settleAction({ state: mkS(), actorId: 'B1', kind: 'skill', skillId: 'S_gate', targetIds: ['C1'] });
    expect(out2.logLines.join('')).toMatch(/未达.*门槛/);
    expect(useResource.getState().resources[0].cur).toBe(3);
    useResource.setState({ resources: [] } as any);
  });
});

describe('战斗统计与高光（P4）', () => {
  it('普攻埋点：攻方 dealt/守方 taken 累计 + 全场最痛一击', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 100)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });
    expect(out.state.participants['B1'].stats?.dealt).toBe(34);
    expect(out.state.participants['C1'].stats?.taken).toBe(34);
    expect(out.state.maxHit).toMatchObject({ actorId: 'B1', targetId: 'C1', dmg: 34 });
  });
  it('战报带 数据=/最痛= 段；主角濒死险胜进「关键」段', () => {
    useCharacters.setState({ characters: {} as any });
    const state = mkState([mkC('B1', 'player', 100), mkC('C1', 'enemy', 40)], { B1: mkB('主角', 'player'), C1: mkB('敌', 'enemy') });
    const out = settleAction({ state, actorId: 'B1', kind: 'attack', targetIds: ['C1'] });   // 40−34=6 仍存活
    const st = out.state;
    st.participants['B1'].curHp = 20;   // 主角 10% 血 → 险胜标记
    const rec = buildBattleRecord(st, 'player');
    expect(rec).toMatch(/数据=\[.*主角:输出34/);
    expect(rec).toMatch(/最痛=\[主角以普通攻击对敌造成34\]/);
    expect(rec).toMatch(/主角濒死险胜/);
  });
});
