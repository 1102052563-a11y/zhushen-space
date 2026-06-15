import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useDice } from '../store/diceStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import type { DiceMode, Difficulty, OutcomeLevel, ResolveResult } from './diceEngine';

/* ════════════════════════════════════════════
   AI 裁判（方案1：骰子锚定 + AI 裁判，失败回退前端确定性结果）
   - 前端先掷骰算出 fe(ResolveResult)，把掷点/成功率/DC 当锚点 + 兜底
   - 把锚点 + 角色/对手面板 + 行动发给判定 AI（独立 dice API），AI 按 rubric 裁定成败/等级/后果
   - 只读裁判、纯文本面板序列化由 DicePanel 提供；本文件负责拼提示词、调用、解析、兜底
════════════════════════════════════════════ */

export interface JudgeInput {
  mode: DiceMode;
  actorName: string;
  action: string;
  attrLabel: string;
  difficulty?: Difficulty;
  opposed: boolean;
  opponentName?: string;
  playerSheet: string;       // 主角面板序列化（六维/技能/天赋/装备/状态）
  opponentSheet?: string;    // 对手面板序列化
  fe: ResolveResult;         // 前端锚定结果（掷点/P/DC）兼兜底
}

export interface JudgeOutcome {
  success: boolean;
  level: OutcomeLevel;
  reasoning: string;
  consequences: string[];
  usedAI: boolean;           // false = 回退到了前端结果
  error?: string;
}

const LEVELS: OutcomeLevel[] = ['大成功', '碾压成功', '极难成功', '困难成功', '成功', '失败', '大失败'];

const JUDGE_SYSTEM = `你是轮回乐园 TRPG 的【判定裁判】。依据【骰子结果】+【角色能力】+【难度/对手】严格裁定一次检定，只输出 JSON，不要任何额外文字或 markdown。

【铁律】
1. 掷点已定、不可更改（见下方"本次掷点"）。以掷点为准绳，不得无视它强行让玩家成功。
2. 百分骰：掷点≤成功率P→倾向成功，>P→倾向失败；掷点≤5 必判大成功；≥96 必判大失败。
   d20：自然20 必大成功、自然1 必大失败；否则(掷点+修正)≥DC→成功。
3. 可结合情境（行动是否合理、角色是否对口、对手强弱、剧情逻辑）在【相邻一档】内微调等级，但不能把失败硬判成成功；必须保留判失败/大失败的可能。
4. level 只能取：大成功 / 碾压成功 / 困难成功 / 成功 / 失败 / 大失败。
5. 后果须符合成败：大成功给额外收益，大失败给反噬。

【只输出此 JSON】
{"success": true, "level": "成功", "reasoning": "≤60字中文依据", "consequences": ["简短后果1","简短后果2"]}`;

function buildUserMsg(inp: JudgeInput): string {
  const anchor = inp.mode === 'd20'
    ? `d20=${inp.fe.chosen}，我方修正合计${inp.fe.mods.total >= 0 ? '+' : ''}${inp.fe.mods.total}，目标 DC=${inp.fe.dc}`
    : `d100=${inp.fe.chosen}，前端测算成功率 P=${inp.fe.P}%`;
  const head = inp.opposed
    ? `${inp.actorName}（${inp.attrLabel}）对抗 ${inp.opponentName || '对手'}`
    : `${inp.actorName}（${inp.attrLabel}）${inp.difficulty ? ` 难度=${inp.difficulty}` : ''}`;
  return [
    `本次检定：${head}`,
    `行动：${inp.action.trim() || '（未填，凭面板数据与情境裁定）'}`,
    `本次掷点：${anchor}`,
    `前端参考裁定（可在相邻档内调整）：${inp.fe.level}`,
    `【主角面板】\n${inp.playerSheet}`,
    inp.opposed && inp.opponentSheet ? `【对手面板】\n${inp.opponentSheet}` : '',
    '请裁定并只输出 JSON。',
  ].filter(Boolean).join('\n');
}

function extractJson(text: string): any {
  let t = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  return lenientJsonParse(t);
}

/** 前端兜底结果 */
function fallback(fe: ResolveResult, error?: string): JudgeOutcome {
  return {
    success: fe.success, level: fe.level,
    reasoning: error ? `（AI 判定失败，已回退前端确定性结果）` : '',
    consequences: [], usedAI: false, error,
  };
}

export async function aiJudge(inp: JudgeInput): Promise<JudgeOutcome> {
  try {
    const d = useDice.getState();
    const ss = useSettings.getState();
    const legacy = d.diceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : d.diceApi;
    const chain = resolveApiChain('dice', legacy);
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: buildUserMsg(inp) }],
      { timeoutMs: 45000, extra: { temperature: 0.5 } },
    );
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') return fallback(inp.fe, '解析失败');
    let level = String(obj.level || '').trim() as OutcomeLevel;
    if (!LEVELS.includes(level)) level = inp.fe.level;
    const success = typeof obj.success === 'boolean' ? obj.success : level !== '失败' && level !== '大失败';
    const consequences = Array.isArray(obj.consequences)
      ? obj.consequences.map((x: any) => String(x)).filter(Boolean)
      : obj.consequences ? [String(obj.consequences)] : [];
    return { success, level, reasoning: String(obj.reasoning || '').slice(0, 200), consequences, usedAI: true };
  } catch (e: any) {
    return fallback(inp.fe, e?.message ?? '请求失败');
  }
}

/** 把 AI 裁定拼成注入主提示词的 `<检定结果>` 块 */
export function buildJudgeBlock(opts: {
  actorName: string; attrLabel: string; difficulty?: Difficulty;
  opposed: boolean; opponentName?: string; fe: ResolveResult; out: JudgeOutcome;
}): string {
  const { actorName, attrLabel, difficulty, opposed, opponentName, fe, out } = opts;
  const head = opposed ? `${actorName}（${attrLabel}） vs ${opponentName || '对手'}` : `${actorName}（${attrLabel}）${difficulty ? ` 难度=${difficulty}` : ''}`;
  const anchor = fe.mode === 'd20' ? `d20:${fe.chosen}${fe.mods.total >= 0 ? '+' : ''}${fe.mods.total}=${fe.chosen + fe.mods.total} / DC${fe.dc}` : `d100:${fe.chosen} / P${fe.P}%`;
  const lines = [
    `<检定结果> ${head} → ${out.level}（掷骰 ${anchor}${out.usedAI ? '，AI 裁定' : ''}）`,
    out.reasoning ? `裁定：${out.reasoning}` : '',
    out.consequences.length ? `后果：${out.consequences.join('；')}` : '',
    `</检定结果>`,
    `（以上为系统判定结果，请让本回合剧情严格服从该成败、等级与后果，不要推翻。）`,
  ].filter(Boolean);
  return lines.join('\n');
}
