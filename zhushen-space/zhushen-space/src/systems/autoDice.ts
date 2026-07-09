import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useItems, gradeToNum } from '../store/itemStore';
import { useDice } from '../store/diceStore';
import { attrCapForTier } from './derivedStats';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { playerStatusAttrDelta } from './statusAttrs';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus } from '../store/adventureTeamStore';
import {
  resolve, buildCheckResultBlock, CRIT_MULT, ATTR_KEYS, ATTR_LABELS, strengthScoreFromBio, rollDie,
  type AttrKey, type Difficulty, type OutcomeLevel, type DiceMode, type ResolveResult, type DiceAttrs, type EquipItemLite,
} from './diceEngine';
import { aiJudge, buildJudgeBlock, aiFullRoll, buildAiFullBlock } from './diceJudge';
import { detectAutoAction, detectDifficulty } from './autoDiceDetect';

/* ════════════════════════════════════════════
   自动检定（发送即判定）—— hybrid：关键词门 + 可选 AI 精修
   - 玩家开启「自动检定」后，正常发送消息即触发；无需再开骰子面板手动摇。
   - 判定链路：① 关键词门（cheap gate·detectAutoAction）命中才 roll → ② 前端确定性 resolve（复用 diceEngine，
     与手动面板 computeFe 同口径）→ ③ judgeMode='ai' 时再 aiJudge 精修（失败自动回退前端结果）。
   - 结果 = 一段 `<检定结果>` 块（对读者隐藏·只随本回合喂正文 API）+ 一张 DiceCardData（气泡下弹骰子卡）。
   - 仅主角、仅非对抗（对抗需锁定具体对手，自动模式暂不做）；对抗/自选属性走手动 DicePanel。
   设计沿用 `摇骰子判定-集成指导.md` + 参考「轮回乐园插件」的发送即注入 ROLL 机制。
════════════════════════════════════════════ */

/** 骰子卡数据（挂在 ChatMessage.dice 上，驱动用户气泡下方的骰子结果卡渲染） */
export interface DiceCardData {
  actorName: string;
  action: string;
  attrLabel: string;
  mode: DiceMode;
  chosen: number;        // 取用的那颗骰点
  modsTotal: number;     // 修正合计（d20 用；d100 展示成功率即可）
  dc: number;            // d20=DC / d100=目标成功率
  P: number;             // 成功率%
  level: OutcomeLevel;
  success: boolean;
  multiplier: number;    // 后果倍率（大失败=反噬幅度）
  usedAI: boolean;       // 是否 AI 裁定（否=纯前端确定性）
  reasoning?: string;    // AI 裁定依据（≤60字）
  consequences?: string[];
  calcNote?: string;     // AI 全包模式：AI 的数值推演摘要（有则替代 d20/d100 算式行）
}

export interface AutoDiceOut {
  block: string;         // 注入正文 API 的 `<检定结果>` 文本（读者不可见）
  card: DiceCardData;    // 渲染骰子卡
}

/* ── 面板序列化（供 AI 裁判读；六维用有效值·含装备加成，技能/天赋/装备附效果描述，让 AI 判定能吃到「具体干什么」） ── */
const clip = (s: any, n = 70): string => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
/** 把一组条目渲染成带效果描述的项目符号块（无则「无」） */
const effList = (arr: any[] | undefined, head: (x: any) => string): string => {
  const xs = (arr ?? []).map((x) => { const h = head(x); const e = clip(x?.effect || x?.desc); return e ? `${h}：${e}` : h; }).filter(Boolean);
  return xs.length ? '\n  - ' + xs.join('\n  - ') : '无';
};
const skillLine = (arr: any[] | undefined): string => effList(arr, (s) => `${s.name}${s.level ? `·${s.level}` : ''}${s.skillType ? `[${s.skillType}]` : ''}`);
const talentLine = (arr: any[] | undefined): string => effList(arr, (t) => `${t.name}${t.rarity ? `·${t.rarity}` : ''}`);
const itemLine = (arr: any[] | undefined): string =>
  effList((arr ?? []).filter((it) => it?.equipped), (it) => `${it.name}(${it.category}${it.gradeDesc ? `·${it.gradeDesc}` : ''})`);
const equippedOf = (arr: any[] | undefined): EquipItemLite[] =>
  (arr ?? []).filter((it) => it?.equipped).map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc) }));

/** 主角有效六维（含装备/技能/天赋六维加成·夹本阶上限）——判定与 AI 面板同源，修 ai-full 只看基础值、看不到装备加成的盲点 */
function playerEffAttrs(): DiceAttrs {
  const profile = usePlayer.getState().profile;
  const pchar = useCharacters.getState().characters['B1'];
  const items = useItems.getState().items;
  return effectiveAttrs(
    withAttrDelta(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), playerStatusAttrDelta()),
    pchar?.skills ?? [], pchar?.traits ?? [], items.filter((it: any) => it.equipped), attrCapForTier(profile.tier, profile.level),
  ) as DiceAttrs;
}

function buildPlayerSheet(): string {
  const profile = usePlayer.getState().profile;
  const pchar = useCharacters.getState().characters['B1'];
  const items = useItems.getState().items;
  const a = playerEffAttrs();
  return [
    `姓名:${profile.name || '主角'} 阶位:${profile.tier || ''}Lv.${profile.level} 强度:${profile.bioStrength || '—'}`,
    `六维(有效值·含装备/技能/天赋加成):${ATTR_KEYS.map((k) => `${ATTR_LABELS[k]}${a[k]}`).join(' ')}`,
    `技能:${skillLine(pchar?.skills)}`,
    `天赋:${talentLine(pchar?.traits)}`,
    `装备:${itemLine(items)}`,
    `状态:${(profile as any).status || '正常'}`,
  ].join('\n');
}

/** 采集主角当前全部修正后掷骰（确定性）——与手动面板 computeFe 的非对抗分支同口径 */
function computeAutoFe(attrKey: AttrKey, difficulty: Difficulty): ResolveResult {
  const profile = usePlayer.getState().profile;
  const pchar = useCharacters.getState().characters['B1'];
  const items = useItems.getState().items;
  const s = useDice.getState().settings;
  const pskills = pchar?.skills ?? [];
  const ptalents = pchar?.traits ?? [];
  const attrs = playerEffAttrs();
  return resolve({
    mode: s.mode, attrs, attrKey, difficulty,
    skills: pskills, talents: ptalents, equipped: equippedOf(items),
    favorTier: null, extraMod: 0, includeLuck: s.includeLuck, advantage: 'norm',
    opposed: false, myStrengthScore: strengthScoreFromBio(profile.bioStrength, profile.level),
    diffBase: s.diffOverride, tuning: s.tuning,
  });
}

/**
 * 自动检定主流程。返回 null = 本回合不判定（未开启 / 未命中关键词 / 系统回合 / 已手动注入）。
 * 命中则：掷骰（+可选 AI 精修）→ 记历史 → 返回 { block, card }。
 */
export async function runAutoDice(text: string): Promise<AutoDiceOut | null> {
  const dice = useDice.getState();
  const s = dice.settings;
  if (!s.enabled || !s.autoMode) return null;
  const t = String(text || '').trim();
  if (!t) return null;
  if (/<检定结果>/.test(t)) return null;                              // 玩家已手动注入过 → 不重复
  if (/【结算任务】|【进入世界|【结束世界|【回归乐园】/.test(t)) return null;  // 系统回合跳过
  const hit = detectAutoAction(t);
  if (!hit) return null;                                             // 关键词门：日常/闲聊/情感 → 不 roll

  const difficulty = detectDifficulty(t);
  const profile = usePlayer.getState().profile;
  const actorName = profile.name || '主角';

  // ── AI 全包模式：一次调用同时判 needRoll + 估全部数值 + 裁成败（前端只掷诚实骰点，其余全交 AI；放弃确定性）。
  //   AI 调用/解析失败 → out.usedAI=false，落到下方前端确定性路径兜底。 ──
  if (s.judgeMode === 'ai-full') {
    const roll = rollDie(s.mode === 'd20' ? 20 : 100);
    const out = await aiFullRoll({ mode: s.mode, actorName, action: t, difficulty, playerSheet: buildPlayerSheet(), roll });
    if (out.usedAI) {
      if (!out.needRoll) return null;                    // AI 判无需检定 → 不注入
      const lv = out.level;
      const mult = CRIT_MULT[lv] ?? 1;
      const aLabel = out.attr || ATTR_LABELS[hit.attrKey];
      const blk = buildAiFullBlock({ actorName, attr: aLabel, difficulty, mode: s.mode, roll, level: lv, reasoning: out.reasoning, consequences: out.consequences });
      try {
        useDice.getState().addHistory({
          actorName, actionText: t, attrLabel: aLabel, difficulty, opposed: false,
          mode: s.mode, dice: [roll], chosen: roll, total: roll, dc: 0, P: 0,
          level: lv, success: out.success, multiplier: mult, backlash: lv === '大失败',
        });
      } catch { /* 历史记录失败不影响判定 */ }
      const c: DiceCardData = {
        actorName, action: t, attrLabel: aLabel, mode: s.mode, chosen: roll,
        modsTotal: 0, dc: 0, P: 0, level: lv, success: out.success, multiplier: mult,
        usedAI: true, reasoning: out.reasoning || undefined,
        consequences: out.consequences.length ? out.consequences : undefined,
        calcNote: out.calc || (s.mode === 'd20' ? `d20:${roll}` : `d100:${roll}`),
      };
      return { block: blk, card: c };
    }
    // AI 失败 → 继续走前端确定性兜底
  }

  const attrLabel = ATTR_LABELS[hit.attrKey];
  const fe = computeAutoFe(hit.attrKey, difficulty);

  let level: OutcomeLevel = fe.level;
  let success = fe.success;
  let usedAI = false;
  let reasoning: string | undefined;
  let consequences: string[] | undefined;
  let block: string;

  if (s.judgeMode === 'ai') {
    const out = await aiJudge({
      mode: fe.mode, actorName, action: t, attrLabel,
      difficulty, opposed: false, playerSheet: buildPlayerSheet(), fe,
    });
    level = out.level; success = out.success; usedAI = out.usedAI;
    reasoning = out.reasoning || undefined;
    consequences = out.consequences.length ? out.consequences : undefined;
    block = buildJudgeBlock({ actorName, attrLabel, difficulty, opposed: false, fe, out });
  } else {
    block = buildCheckResultBlock({ actorName, actionText: t, attrLabel, difficulty, opposed: false, res: fe });
  }

  const multiplier = CRIT_MULT[level] ?? 1;
  try {
    useDice.getState().addHistory({
      actorName, actionText: t, attrLabel, difficulty, opposed: false,
      mode: fe.mode, dice: fe.dice, chosen: fe.chosen, total: fe.total, dc: fe.dc, P: fe.P,
      level, success, multiplier, backlash: level === '大失败',
    });
  } catch { /* 历史记录失败不影响判定 */ }

  const card: DiceCardData = {
    actorName, action: t, attrLabel, mode: fe.mode, chosen: fe.chosen,
    modsTotal: fe.mods.total, dc: fe.dc, P: fe.P, level, success, multiplier,
    usedAI, reasoning, consequences,
  };
  return { block, card };
}
