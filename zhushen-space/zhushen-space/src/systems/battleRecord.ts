/* ════════════════════════════════════════════
   战报压缩（战斗系统重置 Step 4）—— 把整场战斗日志压成**一行 BATTLE_RECORD**，
   交给正文 AI 据 COMBAT_NARRATE_RULE 一次性润色成衔接正文的战斗叙事（数值已落库，AI 不再改任何数值）。
   格式借 SillyTavern 卡 TGv3.2：结果/回合/我方/敌方/关键/处置。
   设计文档：指导/战斗系统-重置-设计.md §7
════════════════════════════════════════════ */
import type { BattleState, Side } from '../store/combatStore';
import { bfRecordText } from './battlefield';

/* 由 HP 占比映射成状态词（沉浸：正文不出数字，只出伤势） */
export function statusOf(curHp: number, maxHp: number, left?: boolean): string {
  if (left) return '撤退';
  if (curHp <= 0) return 'KO';
  const r = curHp / Math.max(1, maxHp);
  if (r < 0.15) return '濒死';
  if (r < 0.4) return '重伤';
  if (r < 0.8) return '轻伤';
  return '无伤';
}

/* 关键事件关键词：日志里含这些的动作明细才进战报「关键」段（去逐条流水账） */
const KEY_RE = /斩杀|眩晕|中毒|燃烧|易伤|虚弱|碎甲|沉默|嘲讽|护盾|领域|蓄力|轰然释放|反弹|净化|驱散|汲取|穿透|不死|锁血|残血不灭/;

/* 把战斗终局压成一行 BATTLE_RECORD: 结果=…|回合=…|我方=[…]|敌方=[…]|关键=[…]|处置=[…] */
export function buildBattleRecord(state: BattleState, victor: Side | null): string {
  const result = victor === 'player' ? '胜' : victor === 'enemy' ? '败' : '中止';
  const sideList = (side: Side) => state.order
    .filter((id) => state.initialState[id]?.side === side)
    .map((id) => {
      const c = state.participants[id]; const b = state.initialState[id];
      return `${b?.name ?? id}:${statusOf(c?.curHp ?? 0, b?.maxHp ?? 1, c?.left)}`;
    })
    .join(', ');

  let key = state.log
    .filter((e) => (e.type === 'action' || e.type === 'system') && KEY_RE.test(e.text || ''))
    .map((e) => (e.text || '').trim());
  key = key.filter((l, i) => i === 0 || l !== key[i - 1]);   // 去相邻重复
  if (key.length > 6) key = key.slice(-6);                    // 只留最近若干关键事件

  const enemies = state.order.filter((id) => state.initialState[id]?.side === 'enemy');
  const allEnemyDown = enemies.length > 0 && enemies.every((id) => (state.participants[id]?.curHp ?? 0) <= 0 || state.participants[id]?.left);
  const disposal = victor === 'player' ? (allEnemyDown ? '击倒敌方' : '敌方溃退')
    : victor === 'enemy' ? '我方落败' : '双方脱离';

  const fields = [
    `结果=${result}`,
    `回合=${state.round}`,
    `我方=[${sideList('player')}]`,
    `敌方=[${sideList('enemy')}]`,
    `关键=[${key.join(' / ') || '常规交锋'}]`,
    `处置=[${disposal}]`,
  ];
  const envTxt = bfRecordText(state.battlefieldAffixes);   // 战场词缀 → 润色叙事把环境写进描写（数值已结算）
  if (envTxt) fields.push(`环境=[${envTxt}]`);
  return `BATTLE_RECORD: ${fields.join(' | ')}`;
}
