/* ════════════════════════════════════════════
   本地敌人 AI（战斗系统重置 Step 3）—— 纯前端启发式决策，**0 次 API**。
   取代旧的 combatHelpers.runNpcActionPhase（每回合调 LLM）。决策**确定性**：
   随机源用 battleId+round+actorId 播种，保证联机房主/来宾算出一致结果。
   也用于 AI 托管的玩家方队友（side='player' 时 foes=敌方）。
   设计文档：指导/战斗系统-重置-设计.md §6
════════════════════════════════════════════ */
import type { BattleState, CombatActionKind, Side } from '../store/combatStore';
import { aliveIds } from './combatEngine';
import { parseCombatSpec, type CombatSpec, type CombatTag } from './combatTags';
import { useCharacters } from '../store/characterStore';

export interface EnemyAction { kind: CombatActionKind; targetIds: string[]; skillId?: string; line?: string }

/* 确定性 PRNG（FNV1a 播种 + LCG），同样的战况必出同样的决策 */
function seeded(str: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const ATTACK_TAGS = new Set<CombatTag>(['deal', 'execute', 'pierce', 'lifesteal']);
const HEAL_TAGS = new Set<CombatTag>(['heal']);
const BUFF_TAGS = new Set<CombatTag>(['strength', 'dexterity', 'block', 'regen', 'thorns', 'restore', 'cleanse']);
const CONTROL_TAGS = new Set<CombatTag>(['stun', 'silence', 'vulnerable', 'weak', 'poison', 'sunder', 'taunt', 'dispel']);

/* 为当前行动的 AI 角色（敌方或托管队友）选这一回合的动作。 */
export function pickEnemyAction(state: BattleState, actorId: string): EnemyAction {
  const actor = state.participants[actorId];
  const block = state.initialState[actorId];
  if (!actor || !block) return { kind: 'defend', targetIds: [] };
  if (actor.charging) return { kind: 'charge', targetIds: actor.charging.targetIds };   // 蓄力中：继续灌注/释放

  const side: Side = block.side;
  const enemySide: Side = side === 'player' ? 'enemy' : 'player';
  const foes = aliveIds(state, enemySide);
  if (foes.length === 0) return { kind: 'defend', targetIds: [] };
  const allies = aliveIds(state, side);

  const rng = seeded(`${state.battleId}|${state.round}|${actorId}`);
  const skills = (useCharacters.getState().characters[actorId]?.skills ?? []).filter((s: any) => !/被动|光环/.test(s?.skillType ?? ''));
  const specOf = (s: any): CombatSpec => parseCombatSpec(s);
  const usable = skills.filter((s: any) => (actor.cooldowns[s.id] ?? 0) <= 0 && actor.curEp >= (specOf(s).cost ?? 0));
  const hasTag = (sp: CombatSpec, set: Set<CombatTag>) => sp.effects.some((e) => set.has(e.tag));
  const findUsable = (pred: (sp: CombatSpec) => boolean) => usable.find((s: any) => pred(specOf(s)));

  // 嘲讽：被嘲讽则强制打施法者（若仍在场）
  const taunt = actor.status.find((s) => s.combat?.taunt && s.source && foes.includes(s.source));
  const forcedTarget = taunt?.source;

  // 选目标：被嘲讽优先；否则 60% 集火残血、40% 随机
  function pickTarget(): string {
    if (forcedTarget) return forcedTarget;
    if (rng() < 0.6) {
      return [...foes].sort((a, b) => {
        const ra = state.participants[a].curHp / Math.max(1, state.initialState[a]?.maxHp ?? 1);
        const rb = state.participants[b].curHp / Math.max(1, state.initialState[b]?.maxHp ?? 1);
        return ra - rb;
      })[0];
    }
    return foes[Math.floor(rng() * foes.length)];
  }

  const hpRatio = actor.curHp / Math.max(1, block.maxHp);

  // 1. 濒死自救：有治疗先奶自己
  if (hpRatio < 0.25) {
    const healS = findUsable((sp) => hasTag(sp, HEAL_TAGS));
    if (healS) return { kind: 'skill', skillId: healS.id, targetIds: [actorId] };
  }
  // 2. 奶受伤友军（辅助定位）
  const wounded = allies
    .map((id) => ({ id, r: state.participants[id].curHp / Math.max(1, state.initialState[id]?.maxHp ?? 1) }))
    .filter((x) => x.r < 0.5).sort((a, b) => a.r - b.r)[0];
  if (wounded) {
    const healS = findUsable((sp) => hasTag(sp, HEAL_TAGS));
    if (healS) return { kind: 'skill', skillId: healS.id, targetIds: [wounded.id] };
  }
  // 3. 自身无增益 → 60% 概率先强化（纯增益、不带攻击的技）
  if (!actor.status.some((s) => s.tone === 'buff') && rng() < 0.6) {
    const buffS = findUsable((sp) => hasTag(sp, BUFF_TAGS) && !hasTag(sp, ATTACK_TAGS));
    if (buffS) return { kind: 'skill', skillId: buffS.id, targetIds: [actorId] };
  }
  // 4. 目标无减益 → 50% 概率上控制/减益
  const target = pickTarget();
  const targetClean = !(state.participants[target]?.status ?? []).some((s) => s.tone === 'debuff');
  if (targetClean && rng() < 0.5) {
    const ctrlS = findUsable((sp) => hasTag(sp, CONTROL_TAGS));
    if (ctrlS) return { kind: 'skill', skillId: ctrlS.id, targetIds: [target] };
  }
  // 5. 攻击技（随机挑一个可用攻击技）
  const atk = usable.filter((s: any) => hasTag(specOf(s), ATTACK_TAGS));
  if (atk.length) { const pick = atk[Math.floor(rng() * atk.length)]; return { kind: 'skill', skillId: pick.id, targetIds: [target] }; }
  // 6. 普攻兜底
  return { kind: 'attack', targetIds: [target] };
}
