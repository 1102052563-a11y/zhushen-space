// 战斗·纯助手（战斗系统重置后）：API 链/预设、HP/EP 结算写回、战斗结束据 BATTLE_RECORD 一次润色、离线兜底文本。
// 战斗中 0 次 API（敌人本地 AI=systems/enemyAI，逐动作不再调 AI）；applyCombatVitals 同时被演化管线复用，故抽成共享模块。
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useCombat } from '../store/combatStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { playerMaxHp, playerMaxEp } from './playerVitals';
import type { BattleState, Side } from '../store/combatStore';
import { apiChatFallback } from './apiChat';
import { COMBAT_NARRATE_RULE } from '../promptRules';
import { buildBattleRecord } from './battleRecord';
import { COMBAT_WRITING_GUIDE_RULE } from './combatWritingGuide';   // 内嵌·据《战斗写作指导》世界书

export function combatChain() {
  const ss = useSettings.getState();
  const C = useCombat.getState();
  const legacyApi = C.combatUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : C.combatApi;
  return resolveApiChain('combat', legacyApi);
}
export function combatPreset() { return useCombat.getState().getActivePreset(); }

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

// 战斗总结：把整场战斗压成 BATTLE_RECORD → AI 据 COMBAT_NARRATE_RULE 一次性润色成正文（数值已落库，AI 不再改数值）。
export async function runBattleSummaryPhase(state: BattleState, victor: Side | null): Promise<string> {
  try {
    // 战斗叙事提示词 = 自定义预设(可空) + 叙事铁则 + 内嵌《战斗写作指导》(思维链/物理具现化/镜头感/力量标尺)
    const sys = (combatPreset().summaryPrompt?.trim() || '') + '\n\n' + COMBAT_NARRATE_RULE + '\n\n' + COMBAT_WRITING_GUIDE_RULE;
    const record = buildBattleRecord(state, victor);
    const { content } = await apiChatFallback(combatChain(), [{ role: 'system', content: sys }, { role: 'user', content: record }]);
    // 先剥掉 <think_battle> 内部推演（连内容），再去残留标签
    return (content || '')
      .replace(/<think_battle>[\s\S]*?<\/think_battle>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .trim();
  } catch { return ''; }
}
