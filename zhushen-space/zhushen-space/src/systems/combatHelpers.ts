// 战斗·纯助手（从 App.tsx 抽出 P4 第1步）：API 链/预设、战斗快照、HP/EP 结算写回、离线兜底文本。
// 只读/写 store + 入参，无组件 state/ref/effect 耦合。applyCombatVitals 同时被演化管线复用，故抽成共享模块。
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useCombat } from '../store/combatStore';
import { useCharacters } from '../store/characterStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { playerMaxHp, playerMaxEp } from './playerVitals';
import { aliveIds } from './combatEngine';
import type { BattleState, Side, CombatActionKind } from '../store/combatStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { COMBAT_NPC_ACTION_RULE, COMBAT_RESULT_RULE, COMBAT_SUMMARY_RULE } from '../promptRules';
export function combatChain() {
  const ss = useSettings.getState();
  const C = useCombat.getState();
  const legacyApi = C.combatUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : C.combatApi;
  return resolveApiChain('combat', legacyApi);
}
export function combatPreset() { return useCombat.getState().getActivePreset(); }
export function fetchActorSkills(id: string): string {
  const ch = useCharacters.getState().characters[id];
  return (ch?.skills ?? []).filter((s: any) => !/被动/.test(s.skillType ?? '')).map((s: any) => `${s.id}=${s.name}${s.level ? `(${s.level})` : ''}`).join('、');
}
export function combatSnapshot(state: BattleState, actorId: string): string {
  const lines: string[] = [`回合 ${state.round} · 出手者 ${state.initialState[actorId]?.name ?? actorId}（${actorId}）`];
  for (const id of state.order) {
    const c = state.participants[id]; const b = state.initialState[id];
    if (!c || !b) continue;
    lines.push(`${b.side === 'player' ? '我方' : '敌方'} ${id} ${b.name} HP${Math.max(0, c.curHp)}/${b.maxHp} EP${Math.max(0, c.curEp)}/${b.maxEp}${c.left ? ' [已离场]' : c.curHp <= 0 ? ' [倒地]' : ''}`);
  }
  const side: Side = state.participants[actorId]?.side ?? 'player';
  lines.push(`可选敌方目标 id：${aliveIds(state, side === 'player' ? 'enemy' : 'player').join('、') || '无'}`);
  lines.push(`可选友方目标 id：${aliveIds(state, side).join('、') || '无'}`);
  lines.push(`本角色技能：${fetchActorSkills(actorId) || '无'}`);
  return lines.join('\n');
}
export function combatFinalVitals(state: BattleState): { hp: Record<string, number>; ep: Record<string, number> } {
  const hp: Record<string, number> = {}, ep: Record<string, number> = {};
  for (const id of Object.keys(state.participants)) {
    if (id !== 'B1' && state.initialState[id]?.isTransient) continue;   // 临时敌不写回档案
    hp[id] = Math.max(0, Math.round(state.participants[id].curHp));
    ep[id] = Math.max(0, Math.round(state.participants[id].curEp));
  }
  return { hp, ep };
}
export function applyCombatVitals(v: { hp: Record<string, number>; ep: Record<string, number> }) {
  for (const id of Object.keys(v.hp)) {
    if (id === 'B1') {
      // 防截断 + 存储上限保真：先把 maxHp/maxMp 抬到真实上限(playerMaxHp/EP=六维+装备+技能树/天赋上限加成，与面板同口径)，
      // 再写 hp/mp——避免旧的低上限把战斗写回的 HP 夹掉。当前值＝战斗结算结果（忠于战斗，不补血）。
      const g = useGame.getState();
      g.setPlayerField('maxHp', Math.max(g.player.maxHp ?? 0, playerMaxHp()));
      g.setPlayerField('maxMp', Math.max(g.player.maxMp ?? 0, playerMaxEp()));
      g.setPlayerField('hp', v.hp[id]); g.setPlayerField('mp', v.ep[id]);
    }
    else if (useNpc.getState().npcs[id]) { useNpc.getState().upsertNpc(id, { hp: v.hp[id], mp: v.ep[id] }); }
  }
}
// 离线/无 API 时的战斗结果兜底文本（供写入输入框）
export function buildCombatResultFallback(state: BattleState, victor: Side | null): string {
  const npcs = useNpc.getState().npcs;
  const enemyNames = state.context.enemyTeam.map((id) => state.initialState[id]?.name || npcs[id]?.name || id).join('、') || '对手';
  const head = victor === 'player' ? `我方击败了${enemyNames}` : victor === 'enemy' ? `我方不敌${enemyNames}，落败` : `与${enemyNames}的战斗结束`;
  let lines = state.log.filter((e) => e.type === 'action').map((e) => e.narration || e.text).filter(Boolean) as string[];
  lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);   // 去相邻重复
  if (lines.length > 12) lines = [...lines.slice(0, 3), `……（中略 ${lines.length - 11} 个回合）……`, ...lines.slice(-8)];   // 长战斗只留首尾，免刷屏输入框
  return `【战斗结果】${head}。\n${lines.join('\n')}`;
}

// ② NPC 行动决策（失败兜底=攻击最近敌人）
export async function runNpcActionPhase(state: BattleState, actorId: string): Promise<{ kind: CombatActionKind; targetIds: string[]; skillId?: string; line?: string }> {
  // 蓄力中的 NPC 自动继续灌注 / 释放
  const chg = state.participants[actorId]?.charging;
  if (chg) return { kind: 'charge', targetIds: chg.targetIds, line: '' };
  const side: Side = state.participants[actorId]?.side ?? 'enemy';
  const foes = aliveIds(state, side === 'player' ? 'enemy' : 'player');
  if (foes.length === 0) return { kind: 'defend', targetIds: [] };
  const fallback = { kind: 'attack' as CombatActionKind, targetIds: foes.slice(0, 1), line: '' };
  const retries = Math.max(0, useCombat.getState().config.retryCount ?? 0);
  const sys = (combatPreset().npcActionPrompt?.trim() || '') + '\n\n' + COMBAT_NPC_ACTION_RULE;
  const user = combatSnapshot(state, actorId);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { content } = await apiChatFallback(combatChain(), [{ role: 'system', content: sys }, { role: 'user', content: user }]);
      const d = lenientJsonParse(content);
      if (d && ['attack', 'skill', 'item', 'defend', 'flee'].includes(d.kind)) {
        let targetIds: string[] = Array.isArray(d.targetIds) ? d.targetIds.map(String).filter((t: string) => state.participants[t] && !state.participants[t].left) : [];
        if ((d.kind === 'attack' || d.kind === 'skill') && targetIds.length === 0) targetIds = fallback.targetIds;
        return { kind: d.kind, targetIds, skillId: d.skillId ? String(d.skillId) : undefined, line: d.line ? String(d.line) : '' };
      }
    } catch { /* 重试 */ }
  }
  return fallback;
}

// ③ 行动叙事（代码已结算；失败兜底=结算明细当叙事）
export async function runResultPhase(logLines: string[], actorId: string, line?: string): Promise<{ narration: string; dialogue?: string }> {
  const plain = logLines.join(' ');
  const retries = Math.max(0, useCombat.getState().config.retryCount ?? 0);
  const sys = (combatPreset().resultPrompt?.trim() || '') + '\n\n' + COMBAT_RESULT_RULE;
  const user = `# 出手者\n${useCombat.getState().battle.initialState[actorId]?.name ?? actorId}\n\n# 代码结算明细\n${plain}${line ? `\n\n# 出手者台词参考\n${line}` : ''}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { content } = await apiChatFallback(combatChain(), [{ role: 'system', content: sys }, { role: 'user', content: user }]);
      const d = lenientJsonParse(content);
      if (d && typeof d.narration === 'string' && d.narration.trim()) return { narration: d.narration.trim(), dialogue: d.dialogue ? String(d.dialogue) : line };
    } catch { /* 重试 */ }
  }
  return { narration: plain, dialogue: line };
}
// ④ 战斗总结 + 收尾
export async function runBattleSummaryPhase(state: BattleState, victor: Side | null): Promise<string> {
  try {
    const sys = (combatPreset().summaryPrompt?.trim() || '') + '\n\n' + COMBAT_SUMMARY_RULE;
    const logText = state.log.map((e) => [e.narration, e.dialogue ? `「${e.dialogue}」` : '', e.text].filter(Boolean).join(' ')).join('\n');
    const result = victor === 'player' ? '我方获胜' : victor === 'enemy' ? '我方落败' : '战斗结束';
    const { content } = await apiChatFallback(combatChain(), [{ role: 'system', content: sys }, { role: 'user', content: `# 最终结果\n${result}\n\n# 完整战斗日志\n${logText}` }]);
    return (content || '').replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
  } catch { return ''; }
}
