/* 📣 战报卡构建（借鉴Zsd比赛战报·纯函数）：竞技场挑战 / 讨伐 BOSS 战结束后，
   从 BattleState 确定性提取 回合数/最痛一击/MVP/险胜标记，拼成战斗频道的战报帖数据。
   发帖与观众议论（AI 上色）由 App 侧完成；本模块零 store 写入、可单测。 */
import type { BattleState, Side } from '../store/combatStore';
import type { ChannelBattleReport } from '../store/channelStore';

export function buildBattleReport(opts: {
  arena: string;          // 赛场名（如 新秀赛区竞技场 / 组队讨伐）
  a: string;              // 甲方（主角名 / 讨伐队）
  b: string;              // 乙方（对手·含名次 / BOSS 名）
  victor: Side | null;
  state: BattleState;
  note?: string;          // 结算附注（晋升第N名等），原样并入
}): ChannelBattleReport {
  const { state } = opts;
  const nameOf = (id: string) => state.initialState[id]?.name ?? id;
  // MVP = 全场输出最高者（stats.dealt）；无人有输出则缺省
  let mvp: string | undefined; let best = 0;
  for (const id of state.order) {
    const dealt = state.participants[id]?.stats?.dealt ?? 0;
    if (dealt > best) { best = dealt; mvp = nameOf(id); }
  }
  const mh = state.maxHit;
  // 险胜：主角胜但残血 <15%（与 battleRecord 的"濒死险胜"同判据）
  const b1c = state.participants['B1']; const b1b = state.initialState['B1'];
  const narrow = opts.victor === 'player' && !!b1c && !!b1b && b1c.curHp > 0 && b1c.curHp / Math.max(1, b1b.maxHp) < 0.15;
  const noteBits = [opts.note?.trim(), narrow ? '九死一生的险胜' : ''].filter(Boolean) as string[];
  return {
    arena: opts.arena, a: opts.a, b: opts.b,
    result: opts.victor === 'player' ? 'A胜' : opts.victor === 'enemy' ? 'B胜' : '平/中止',
    rounds: state.round || undefined,
    maxHit: mh ? `${nameOf(mh.actorId)}以${mh.label}对${nameOf(mh.targetId)}造成${mh.dmg}点伤害` : undefined,
    mvp,
    note: noteBits.join('；') || undefined,
  };
}

/* 战报帖正文（卡片之外的文字版：进频道 content，也作舆论回注/AI 议论的素材） */
export function formatBattleReportContent(r: ChannelBattleReport): string {
  const winner = r.result === 'A胜' ? r.a : r.result === 'B胜' ? r.b : null;
  const bits = [
    `【${r.arena}·战报】${r.a} VS ${r.b}——${winner ? `${winner} 获胜` : '未分胜负'}`,
    r.rounds ? `历时${r.rounds}回合` : '',
    r.mvp ? `MVP：${r.mvp}` : '',
    r.maxHit ? `最痛一击：${r.maxHit}` : '',
    r.note || '',
  ].filter(Boolean);
  return bits.join('。') + '。';
}

/* 战报帖基础热度（确定性）：名次越高对局越受关注；讨伐 BOSS 战固定高热。玩家点赞仍可再 +1。 */
export function reportBaseHeat(kind: 'arena' | 'raid', rank?: number): number {
  if (kind === 'raid') return 620;
  const r = Math.max(1, rank ?? 500);
  return Math.max(80, Math.min(950, Math.round(920 - r * 0.9)));
}
