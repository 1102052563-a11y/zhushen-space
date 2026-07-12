import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useDice } from '../store/diceStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import type { DiceMode, Difficulty, OutcomeLevel, ResolveResult, AttrKey } from './diceEngine';
import { ATTR_KEYS, ATTR_LABELS, DIFFICULTIES } from './diceEngine';

/* ════════════════════════════════════════════
   AI 裁判（方案1：骰子锚定 + AI 裁判，失败回退前端确定性结果）
   - 前端先掷骰算出 fe(ResolveResult)，把掷点/成功率/DC 当锚点 + 兜底
   - 把锚点 + 角色/对手面板 + 行动发给判定 AI（独立 dice API），AI 按 rubric 裁定成败/等级/后果
   - 只读裁判、纯文本面板序列化由 autoDice 提供；本文件负责拼提示词、调用、解析、兜底
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

/* ════════════════════════════════════════════
   AI 全包模式（方案2·仿「轮回乐园插件」StoryGuide 的 ROLL 决策）：
   把「要不要检定 + 全部数值修正 + 成败」都交给 AI 估算——前端只掷一颗诚实骰点(RNG 不作弊)传给 AI，
   修正/难度线/成败全由 AI 从面板自行推算。放弃代码确定性（数值不再可复现），换 AI 对情境的自由裁量。
   与前端 `resolve()` 的确定性引擎并行；judgeMode='ai-full' 时启用，AI 失败回退前端确定性。
════════════════════════════════════════════ */
const AI_FULL_SYSTEM = `你是轮回乐园 TRPG 的【全权裁判】。给你【玩家行动】+【角色面板】+【本次骰点】，由你**自行**判断是否需要检定，并**自行估算全部数值修正**后裁定结果。只输出 JSON，不要任何额外文字或 markdown。

【第一步·判断是否需要检定 needRoll】
- needRoll=false：日常/闲聊/情感表达/心理活动、必定成功或毫无难度的行为。
- needRoll=true：战斗/攻防、说服/欺骗/威吓、有风险或难度的动作（撬锁/攀爬/潜行）、知识或感知检定。

【第二步·若 needRoll=true，你自行完成全部计算】
1. 从【角色面板】判断本次最相关的属性（力量/敏捷/体质/智力/魅力/幸运其一）与相关技能/天赋/装备/状态。
2. **自行估算修正合计**：能力越强、品级越高加值越大（D~SSS 递增，如百分骰尺度约 D+3…SSS+27、d20 尺度约 D+1…SSS+6）；属性扬长避短（远超同侪给正、孱弱给负）；负面天赋/不利状态扣分；堆数量无意义，只取最相关的几项。
3. **确定成功线**（相对该角色的难度）：d20 目标 DC 约 简单10/普通13/困难16/极难20/几乎不可能25；d100 成功率 P 约 简单85/普通65/困难45/极难25/几乎不可能10（可按角色强弱与情境±微调）。
4. **对照骰点裁定**：本次骰点由系统给出、不可更改，以它为准绳，不得无视它强行让玩家成功；必须保留判失败/大失败的可能。
   - d100：骰点≤P 成功、>P 失败；≤5 必大成功、≥96 必大失败。
   - d20：（骰点+修正）≥DC 成功；自然20 必大成功、自然1 必大失败；超出 DC≥10 视为碾压成功。
5. level 只能取：大成功 / 碾压成功 / 困难成功 / 成功 / 失败 / 大失败。后果须符合成败：大成功给额外收益，大失败给反噬。

【只输出此 JSON】
- 无需检定：{"needRoll": false}
- 需检定：{"needRoll": true, "attr": "判定属性(如 敏捷)", "level": "成功", "success": true, "reasoning": "≤60字中文裁定依据", "consequences": ["简短后果1","简短后果2"], "calc": "修正与成功线的简短算式(如 敏捷+潜行技能≈+7，骰点42≤成功率65 → 成功)"}`;

export interface AiFullInput {
  mode: DiceMode;
  actorName: string;
  action: string;
  difficulty?: Difficulty;
  playerSheet: string;
  roll: number;              // 前端已掷好的骰点（d20:1-20 / d100:1-100）
}
export interface AiFullOutcome {
  needRoll: boolean;
  attr?: string;             // AI 选定的判定属性（中文标签，展示用）
  level: OutcomeLevel;
  success: boolean;
  reasoning: string;
  consequences: string[];
  calc?: string;             // AI 的数值推演摘要（展示在骰子卡上）
  usedAI: boolean;           // false = 调用/解析失败（调用方应回退前端确定性）
  error?: string;
}

const AI_FULL_MISS: AiFullOutcome = { needRoll: false, level: '成功', success: false, reasoning: '', consequences: [], usedAI: false };

/** AI 全包：一次调用同时判 needRoll + 估全部数值 + 裁成败。失败/解析失败 → usedAI:false（调用方回退前端）。 */
export async function aiFullRoll(inp: AiFullInput): Promise<AiFullOutcome> {
  try {
    const d = useDice.getState();
    const ss = useSettings.getState();
    const legacy = d.diceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : d.diceApi;
    const chain = resolveApiChain('dice', legacy);
    const anchor = inp.mode === 'd20' ? `d20=${inp.roll}（范围1-20）` : `d100=${inp.roll}（范围1-100）`;
    const user = [
      `玩家行动：${inp.action.trim() || '（未填，凭面板与情境裁定）'}`,
      `骰子模式：${inp.mode}`,
      `本次骰点：${anchor}（不可更改，以此为准绳）`,
      inp.difficulty ? `建议难度：${inp.difficulty}` : '',
      `【角色面板】\n${inp.playerSheet}`,
      '请自行判断是否需要检定并估算全部数值，只输出 JSON。',
    ].filter(Boolean).join('\n');
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: AI_FULL_SYSTEM }, { role: 'user', content: user }],
      { timeoutMs: 45000, extra: { temperature: 0.5 } },
    );
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') return { ...AI_FULL_MISS, error: '解析失败' };
    if (obj.needRoll === false) return { needRoll: false, level: '成功', success: false, reasoning: '', consequences: [], usedAI: true };
    let level = String(obj.level || '').trim() as OutcomeLevel;
    if (!LEVELS.includes(level)) level = '成功';
    const success = typeof obj.success === 'boolean' ? obj.success : level !== '失败' && level !== '大失败';
    const consequences = Array.isArray(obj.consequences)
      ? obj.consequences.map((x: any) => String(x)).filter(Boolean)
      : obj.consequences ? [String(obj.consequences)] : [];
    return {
      needRoll: true, attr: obj.attr ? String(obj.attr).slice(0, 12) : undefined,
      level, success, reasoning: String(obj.reasoning || '').slice(0, 200), consequences,
      calc: obj.calc ? String(obj.calc).slice(0, 120) : undefined, usedAI: true,
    };
  } catch (e: any) {
    return { ...AI_FULL_MISS, error: e?.message ?? '请求失败' };
  }
}

/** 把 AI 全包裁定拼成注入主提示词的 `<检定结果>` 块 */
export function buildAiFullBlock(opts: {
  actorName: string; attr: string; difficulty?: Difficulty; mode: DiceMode;
  roll: number; level: OutcomeLevel; reasoning: string; consequences: string[];
}): string {
  const { actorName, attr, difficulty, mode, roll, level, reasoning, consequences } = opts;
  const head = `${actorName}（${attr}）${difficulty ? ` 难度=${difficulty}` : ''}`;
  const anchor = mode === 'd20' ? `d20:${roll}` : `d100:${roll}`;
  const lines = [
    `<检定结果> ${head} → ${level}（AI 全权裁定·骰点 ${anchor}）`,
    reasoning ? `裁定：${reasoning}` : '',
    consequences.length ? `后果：${consequences.join('；')}` : '',
    `</检定结果>`,
    `（以上为系统判定结果，请让本回合剧情严格服从该成败、等级与后果，不要推翻。）`,
  ].filter(Boolean);
  return lines.join('\n');
}

/* ════════════════════════════════════════════
   AI 分类裁判（一次调用·多结果）：读行动+面板，识别最多 2 个需检定的行为，各挑对口属性+难度、
   用给定骰点裁成败。治「关键词误判属性」（如"赠送礼物"被当力量）+ 支持一段行动多类行为分别摇。
   ai / ai-full 模式共用（都是 AI 挑属性+裁定，只一次调用出多结果）。
════════════════════════════════════════════ */
const AI_CLASSIFY_SYSTEM = `你是轮回乐园 TRPG 的【判定裁判】。读【玩家行动】+【角色面板】，识别其中**需要检定的行为**（最多2个；日常/闲聊/情感/必成之事→0个），为每个行为挑**最对口的属性**与相对难度，并用给定骰点裁定成败。只输出 JSON，不要额外文字或 markdown。

【属性对口（务必按行为语义挑，切勿默认力量）】
- 力量：砍杀/搏斗/格挡/推举/破开/硬闯/抢夺等发力对抗。
- 敏捷：闪避/潜行/攀爬/逃脱/偷取/轻功等身法。
- 体质：硬抗/耐毒/负重/憋气/久战等耐受。
- 智力：破解/推理/施法/观察/鉴定/参悟/布阵等心智。
- 魅力：说服/交涉/欺骗/威吓/求情/**赠送礼物·馈赠·打赏·贿赂·示好·邀请·魅惑**/讨价等社交。
- 幸运：碰运气/赌/祈祷/抽取等。

【裁定】第1个行为用骰点1、第2个用骰点2，结合属性/技能/天赋/难度：
- d100：骰点≤成功率P→倾向成功，≤5必大成功，≥96必大失败；>P倾向失败。
- d20：（骰点+修正）≥DC→成功，自然20必大成功，自然1必大失败。
- 以骰点为准绳，不得无视它强行成功；必须保留判失败/大失败的可能。
- level 只能取：大成功 / 碾压成功 / 困难成功 / 成功 / 失败 / 大失败。

【只输出此 JSON】
- 无需检定：{"behaviors": []}
- 需检定：{"behaviors": [{"attr":"魅力","difficulty":"普通","level":"成功","success":true,"reasoning":"≤50字依据","consequences":["简短后果"],"calc":"可选·数值推演摘要"}]}
- behaviors 最多 2 个；只列真正需要随机检定的行为，纯叙事/情感不列。`;

export interface JudgedBehavior {
  attr: string;          // 判定属性中文标签（力量/敏捷/体质/智力/魅力/幸运）
  difficulty?: string;
  level: OutcomeLevel;
  success: boolean;
  reasoning?: string;
  consequences?: string[];
  roll: number;          // 该行为用的骰点
  calc?: string;
}
export interface ClassifyJudgeInput {
  mode: DiceMode;
  actorName: string;
  action: string;
  difficulty?: Difficulty;
  playerSheet: string;
  rolls: number[];       // 前端预掷的骰点（≤2，按行为顺序取用）
}
export interface ClassifyJudgeOut {
  behaviors: JudgedBehavior[];
  usedAI: boolean;       // false = 调用/解析失败（调用方回退前端确定性）
  error?: string;
}

const ATTR_LABEL_SET = new Set(['力量', '敏捷', '体质', '智力', '魅力', '幸运']);

/** 一次调用识别最多 2 个行为并各自裁定。失败 → usedAI:false（调用方回退前端关键词多摇）。 */
export async function aiClassifyJudge(inp: ClassifyJudgeInput): Promise<ClassifyJudgeOut> {
  try {
    const d = useDice.getState();
    const ss = useSettings.getState();
    const legacy = d.diceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : d.diceApi;
    const chain = resolveApiChain('dice', legacy);
    const rolls = (inp.rolls || []).slice(0, 2);
    const rollLine = rolls.map((r, i) => `骰点${i + 1}=${inp.mode === 'd20' ? 'd20' : 'd100'}:${r}`).join('，');
    const user = [
      `玩家行动：${inp.action.trim() || '（未填）'}`,
      `骰子模式：${inp.mode}`,
      `本次骰点（不可更改，第1个行为用骰点1、第2个用骰点2）：${rollLine}`,
      inp.difficulty ? `建议难度：${inp.difficulty}` : '',
      `【角色面板】\n${inp.playerSheet}`,
      '请识别需检定的行为（最多2个）并只输出 JSON。',
    ].filter(Boolean).join('\n');
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: AI_CLASSIFY_SYSTEM }, { role: 'user', content: user }],
      { timeoutMs: 45000, extra: { temperature: 0.4 } },
    );
    const obj = extractJson(content);
    const arr = Array.isArray(obj?.behaviors) ? obj.behaviors : Array.isArray(obj) ? obj : [];
    const behaviors: JudgedBehavior[] = [];
    for (let i = 0; i < arr.length && behaviors.length < 2; i++) {
      const b = arr[i];
      if (!b || typeof b !== 'object') continue;
      let level = String(b.level || '').trim() as OutcomeLevel;
      if (!LEVELS.includes(level)) level = '成功';
      const success = typeof b.success === 'boolean' ? b.success : level !== '失败' && level !== '大失败';
      const attrRaw = String(b.attr || '').trim();
      const attr = ATTR_LABEL_SET.has(attrRaw) ? attrRaw : (attrRaw || '力量');
      const cons = Array.isArray(b.consequences) ? b.consequences.map((x: any) => String(x)).filter(Boolean) : b.consequences ? [String(b.consequences)] : [];
      behaviors.push({
        attr, difficulty: b.difficulty ? String(b.difficulty) : undefined,
        level, success, reasoning: b.reasoning ? String(b.reasoning).slice(0, 200) : undefined,
        consequences: cons, roll: rolls[behaviors.length] ?? rolls[0] ?? 0,
        calc: b.calc ? String(b.calc).slice(0, 120) : undefined,
      });
    }
    return { behaviors, usedAI: true };
  } catch (e: any) {
    return { behaviors: [], usedAI: false, error: e?.message ?? '请求失败' };
  }
}

/* ════════════════════════════════════════════
   ✨AI建议：读行动+角色面板，建议该用哪个属性/难度/相关技能（仅填表，不掷骰）
════════════════════════════════════════════ */
const SUGGEST_SYSTEM = `你是检定参数助手。根据角色行动 + 面板，判断这次检定最该用哪个六维属性、相对难度，并指出相关技能（若有）。只输出 JSON，不要多余文字。
属性 attr 只能从这些英文键选一个：str(力量) / agi(敏捷) / con(体质) / int(智力) / cha(魅力) / luck(幸运)。
难度 difficulty 从 简单 / 普通 / 困难 / 极难 / 几乎不可能 选一个（相对该角色而言，不看绝对强度）。
输出：{"attr":"agi","difficulty":"困难","skill":"相关技能名，无则空","reason":"≤30字依据"}`;

export interface SuggestOutcome {
  attrKey?: AttrKey;
  difficulty?: Difficulty;
  skill?: string;
  reason?: string;
  error?: string;
}

function normAttr(v: any): AttrKey | undefined {
  const s = String(v ?? '').trim();
  if ((ATTR_KEYS as string[]).includes(s)) return s as AttrKey;
  return (Object.keys(ATTR_LABELS) as AttrKey[]).find((k) => ATTR_LABELS[k] === s);
}
function normDiff(v: any): Difficulty | undefined {
  const s = String(v ?? '').trim();
  return (DIFFICULTIES as string[]).includes(s) ? (s as Difficulty) : undefined;
}

export async function aiSuggest(inp: { action: string; playerSheet: string; onscene?: string }): Promise<SuggestOutcome> {
  try {
    const d = useDice.getState();
    const ss = useSettings.getState();
    const legacy = d.diceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : d.diceApi;
    const chain = resolveApiChain('dice', legacy);
    const user = `行动：${inp.action.trim() || '（未填）'}\n【主角面板】\n${inp.playerSheet}${inp.onscene ? `\n【在场角色】${inp.onscene}` : ''}\n请只输出 JSON。`;
    const { content } = await apiChatFallback(chain, [{ role: 'system', content: SUGGEST_SYSTEM }, { role: 'user', content: user }], { timeoutMs: 30000, extra: { temperature: 0.3 } });
    const obj = extractJson(content);
    if (!obj || typeof obj !== 'object') return { error: '解析失败' };
    return {
      attrKey: normAttr(obj.attr),
      difficulty: normDiff(obj.difficulty),
      skill: obj.skill ? String(obj.skill) : undefined,
      reason: obj.reason ? String(obj.reason).slice(0, 80) : undefined,
    };
  } catch (e: any) {
    return { error: e?.message ?? '请求失败' };
  }
}
