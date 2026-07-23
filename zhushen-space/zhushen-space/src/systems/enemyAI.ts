/* ════════════════════════════════════════════
   本地敌人 AI（战斗系统重置 Step 3）—— 纯前端启发式决策，**0 次 API**。
   取代旧的 combatHelpers.runNpcActionPhase（每回合调 LLM）。决策**确定性**：
   随机源用 battleId+round+actorId 播种，保证联机房主/来宾算出一致结果。
   也用于 AI 托管的玩家方队友（side='player' 时 foes=敌方）。
   设计文档：指导/战斗系统-重置-设计.md §6
════════════════════════════════════════════ */
import type { BattleState, CombatActionKind, Side } from '../store/combatStore';
import { aliveIds, effectiveSkillCost, previewAction } from './combatEngine';
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

/* 行为原型（P2）：由六维粗判出手倾向——智堡=法师(偏铺垫/控场)、力/敏堡=强袭(偏直攻)、其余均衡。
   只影响 buff/控制两步的概率阈值，仍走同一确定性 rng → 同战况同决策。导出供单测。 */
export function enemyArchetype(block: { attrs: { str: number; agi: number; int: number } }): 'caster' | 'striker' | 'balanced' {
  const { str, agi, int } = block.attrs;
  if (int >= Math.max(str, agi) * 1.2) return 'caster';
  if (Math.max(str, agi) >= int * 1.2) return 'striker';
  return 'balanced';
}

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
  const usable = skills.filter((s: any) => (actor.cooldowns[s.id] ?? 0) <= 0 && actor.curEp >= effectiveSkillCost(s, block.maxEp));   // 消耗与引擎同一来源（品级×maxEp 百分比锚定），避免选了付不起的技又退化普攻
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
  // 行为原型 → buff/控制两步的概率阈值（法师爱铺垫控场、强袭直奔咽喉）
  const arche = enemyArchetype(block);
  const buffP = arche === 'caster' ? 0.75 : arche === 'striker' ? 0.35 : 0.6;
  const ctrlP = arche === 'caster' ? 0.65 : arche === 'striker' ? 0.3 : 0.5;

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
  // 3. 自身无增益 → 按原型概率先强化（纯增益、不带攻击的技）
  if (!actor.status.some((s) => s.tone === 'buff') && rng() < buffP) {
    const buffS = findUsable((sp) => hasTag(sp, BUFF_TAGS) && !hasTag(sp, ATTACK_TAGS));
    if (buffS) return { kind: 'skill', skillId: buffS.id, targetIds: [actorId] };
  }
  // 4. 目标无减益 → 按原型概率上控制/减益
  const target = pickTarget();
  const targetClean = !(state.participants[target]?.status ?? []).some((s) => s.tone === 'debuff');
  if (targetClean && rng() < ctrlP) {
    const ctrlS = findUsable((sp) => hasTag(sp, CONTROL_TAGS));
    if (ctrlS) return { kind: 'skill', skillId: ctrlS.id, targetIds: [target] };
  }
  // 5. 攻击技（随机挑一个可用攻击技；同技连放两次后、有替代则换招——STS 式行动模式约束）
  let atk = usable.filter((s: any) => hasTag(specOf(s), ATTACK_TAGS));
  const rep = actor.lastSkillIds && actor.lastSkillIds.length >= 2 && actor.lastSkillIds[0] === actor.lastSkillIds[1] ? actor.lastSkillIds[0] : null;
  if (rep && atk.length > 1) atk = atk.filter((s: any) => s.id !== rep);
  if (atk.length) { const pick = atk[Math.floor(rng() * atk.length)]; return { kind: 'skill', skillId: pick.id, targetIds: [target] }; }
  // 6. 普攻兜底
  return { kind: 'attack', targetIds: [target] };
}

/* 敌人「意图预告」（面板头顶显示·**真实预告**·STS 式）：直接复用确定性 pickEnemyAction 预演本回合动作
   —— 同 state+同种子 ⇒ 与它真正出手时的决策完全一致；回合内战况变化（有人倒下/被嘲讽）时预告随渲染即时刷新。
   再用 previewAction 标出预计伤害数字，玩家可据此决定防御/保护/集火。 */
export function telegraphIntent(state: BattleState, actorId: string): { emoji: string; label: string; detail?: string } {
  const actor = state.participants[actorId];
  const block = state.initialState[actorId];
  if (!actor || !block || actor.curHp <= 0 || actor.left) return { emoji: '—', label: '' };
  if (actor.charging) return { emoji: '⚡', label: `蓄力·还${actor.charging.turnsLeft}回合`, detail: `正在蓄力「${actor.charging.name}」，${actor.charging.turnsLeft} 回合后释放——趁现在控制它可令大招溃散` };
  if (actor.status.some((s) => s.combat?.cannotAct)) return { emoji: '💫', label: '被控' };
  const act = pickEnemyAction(state, actorId);
  const nameOf = (id?: string) => (id ? (state.initialState[id]?.name ?? id) : '');
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
  if (act.kind === 'defend') return { emoji: '🛡️', label: '防御', detail: '将进入防御姿态：本回合承伤减半' };
  if (act.kind === 'flee') return { emoji: '🏃', label: '欲脱离' };
  const skill = act.kind === 'skill' ? (useCharacters.getState().characters[actorId]?.skills ?? []).find((s: any) => s.id === act.skillId) : undefined;
  const sp: CombatSpec | undefined = skill ? parseCombatSpec(skill) : undefined;
  const isAtk = act.kind === 'attack' || !!sp?.effects.some((e) => ATTACK_TAGS.has(e.tag));
  if (isAtk) {
    const pv = previewAction(state, actorId, act.targetIds[0], skill);
    const head = act.kind === 'attack' ? '普攻' : `「${short(String(skill?.name ?? '技能'), 6)}」`;
    if (pv?.chargeRounds) return { emoji: '⚡', label: `将蓄力${head}`, detail: `将开始蓄力${head}（${pv.chargeRounds} 回合），释放时预计 ~${pv.total} 伤害——趁蓄力控制它可打断` };
    const tgt = short(nameOf(pv?.targetId ?? act.targetIds[0]), 4);
    return {
      emoji: '⚔️', label: `${head}→${tgt}${pv ? ` ~${pv.total}` : ''}`,
      detail: pv ? `将以${head}攻击 ${nameOf(pv.targetId)}：预计 ~${pv.total} 伤害${pv.hits > 1 ? `（${pv.hits} 段）` : ''}${pv.critChance > 0 && pv.critTotal ? `，暴击则 ~${pv.critTotal}` : ''}——防御/保护可减半` : undefined,
    };
  }
  if (sp?.effects.some((e) => HEAL_TAGS.has(e.tag))) {
    return { emoji: '💚', label: `治疗→${short(nameOf(act.targetIds[0]), 4)}`, detail: `将施展「${skill?.name ?? ''}」治疗 ${nameOf(act.targetIds[0])}` };
  }
  if (sp?.effects.some((e) => CONTROL_TAGS.has(e.tag))) {
    return { emoji: '🕸️', label: `「${short(String(skill?.name ?? '控制'), 6)}」→${short(nameOf(act.targetIds[0]), 4)}`, detail: `将对 ${nameOf(act.targetIds[0])} 施放控制/减益「${skill?.name ?? ''}」` };
  }
  if (act.kind === 'skill') return { emoji: '✦', label: `施法「${short(String(skill?.name ?? ''), 6)}」`, detail: `将施展「${skill?.name ?? ''}」（增益/领域类）` };
  return { emoji: '⚔️', label: '进攻' };
}
