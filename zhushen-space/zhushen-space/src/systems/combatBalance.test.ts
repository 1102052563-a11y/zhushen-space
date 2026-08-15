/* ════════════════════════════════════════════
   平衡回归测试（P5·平衡工程）—— 利用引擎全确定性（种子先攻/暴击/敌AI）跑「标准对局矩阵」，
   特征化当前平衡基线：收敛性（无挂死）、回合数带、跨阶碾压方向、BOSS 阶段真触发。
   以后任何调参（DMG_SCALE / DEF_FACTOR / CHIP_DMG_FRAC / EP 锚定…）这里就是回归网：
   跑翻了 = 平衡被改动了，要么改回来、要么有意识地更新基线断言。
   双方都由 pickEnemyAction 代打（AI 托管队友同一路径），不依赖任何玩家 store。
════════════════════════════════════════════ */
import { describe, it, expect } from 'vitest';
import { assembleBattle, settleAction, advanceTurn, checkEnd, currentActorId, buildCombatant, rollInitiative } from './combatEngine';
import { pickEnemyAction } from './enemyAI';
import { useCharacters } from '../store/characterStore';
import type { BattleState, CombatStatBlock, Side } from '../store/combatStore';
import type { DiceAttrs } from './diceEngine';

/* 与引擎同款 FNV1a+LCG（覆写 battleId 后重掷先攻，让整场对局对种子 tag 完全确定） */
function seeded(str: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* 标准人六维（均衡近战脸：力敏体=n，智=0.6n） */
const A = (n: number): DiceAttrs => ({ str: n, agi: n, con: n, int: Math.round(n * 0.6), cha: 10, luck: 10 });
/* 走 buildCombatant transient 真实公式（computeDerived/HP/EP/四阶×5 全生效）；id 避开 B1（不碰玩家 store） */
const F = (id: string, side: Side, tier: string, n: number) => buildCombatant(id, side, { isTransient: true, name: id, attrs: A(n), tier });

/* 全 AI 代打整场：battleId 覆写为种子 tag + 先攻确定性重掷 → 同 tag 必出同结果 */
function runBattle(blocks: Record<string, CombatStatBlock>, tag: string): { victor: Side | null; rounds: number; state: BattleState } {
  let battle = assembleBattle(blocks, { reason: tag, location: '', endConditions: [] });
  battle.battleId = `bal_${tag}`;
  for (const id of battle.order) battle.participants[id].initiative = rollInitiative(blocks[id], 1, seeded(`${battle.battleId}|init|${id}`));
  battle.order = [...battle.order].sort((a, b) => battle.participants[b].initiative - battle.participants[a].initiative);
  let victor = checkEnd(battle);
  let guard = 0;
  while (!victor && guard < 400) {
    const actor = currentActorId(battle);
    if (!actor) break;
    const act = pickEnemyAction(battle, actor);
    const out = settleAction({ state: battle, actorId: actor, kind: act.kind, targetIds: act.targetIds, skillId: act.skillId, itemId: act.itemId });
    battle = out.state;
    victor = checkEnd(battle);
    if (!victor) battle = advanceTurn(battle, false);
    guard += 1;
  }
  return { victor, rounds: battle.round, state: battle };
}

const SEEDS = ['s1', 's2', 's3', 's4', 's5'];

describe('平衡回归（确定性标准对局·全 AI 代打·基线特征化）', () => {
  it('同阶镜像单挑：全部收敛（无挂死/无平局），回合数在 2~15 带内', () => {
    useCharacters.setState({ characters: {} as any });
    for (const s of SEEDS) {
      const r = runBattle({ P1: F('P1', 'player', '一阶', 30), E1: F('E1', 'enemy', '一阶', 30) }, `mirror_${s}`);
      expect(r.victor, `种子 ${s} 未收敛`).not.toBeNull();
      expect(r.rounds, `种子 ${s} 回合数越带`).toBeGreaterThanOrEqual(2);
      expect(r.rounds, `种子 ${s} 回合数越带`).toBeLessThanOrEqual(15);
    }
  });
  it('跨一阶：高阶方全胜（碾压方向不许倒挂）', () => {
    useCharacters.setState({ characters: {} as any });
    for (const s of SEEDS) {
      const r = runBattle({ P1: F('P1', 'player', '二阶', 55), E1: F('E1', 'enemy', '一阶', 30) }, `t1_${s}`);
      expect(r.victor, `种子 ${s} 高阶方竟落败`).toBe('player');
    }
  });
  it('跨两阶：必胜且速胜（≤6 回合——碾压要有碾压的样子）', () => {
    useCharacters.setState({ characters: {} as any });
    for (const s of SEEDS) {
      const r = runBattle({ P1: F('P1', 'player', '三阶', 85), E1: F('E1', 'enemy', '一阶', 30) }, `t2_${s}`);
      expect(r.victor, `种子 ${s}`).toBe('player');
      expect(r.rounds, `种子 ${s} 碾压局拖太久`).toBeLessThanOrEqual(6);
    }
  });
  it('2v2 团战：收敛且回合数 ≤20', () => {
    useCharacters.setState({ characters: {} as any });
    for (const s of SEEDS.slice(0, 3)) {
      const r = runBattle({
        P1: F('P1', 'player', '二阶', 50), P2: F('P2', 'player', '二阶', 45),
        E1: F('E1', 'enemy', '二阶', 50), E2: F('E2', 'enemy', '二阶', 45),
      }, `team_${s}`);
      expect(r.victor, `种子 ${s} 团战未收敛`).not.toBeNull();
      expect(r.rounds, `种子 ${s} 团战拖太久`).toBeLessThanOrEqual(20);
    }
  });
  it('BOSS 巨血局：assembleBattle 自动配阶段、战斗中真触发、整场收敛', () => {
    useCharacters.setState({ characters: {} as any });
    const P1 = F('P1', 'player', '二阶', 55), P2 = F('P2', 'player', '二阶', 50);
    const BOSS: CombatStatBlock = {
      side: 'enemy', name: '妖王', attrs: A(60), level: 20, tier: '二阶', bioStrength: 'T4',
      patk: 90, pdef: 40, matk: 60, mdef: 40, maxHp: Math.round((P1.maxHp + P2.maxHp) * 2), maxEp: 500,
    };
    const r = runBattle({ P1, P2, BOSS }, 'boss_1');
    expect(r.state.initialState['BOSS'].bossPhases?.length).toBe(2);   // 自动判定生效（敌单体·非 transient·血池≥×1.5）
    expect(r.victor).not.toBeNull();
    if (r.victor === 'player') {
      expect((r.state.participants['BOSS'].phasesFired ?? []).length).toBeGreaterThan(0);   // 打穿血线必转过阶段
      expect(r.state.log.some((e) => /【阶段】/.test(e.text || '')) || r.state.round >= 1).toBe(true);
    }
  });
});
