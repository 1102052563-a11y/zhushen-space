import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useItems, gradeToNum } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useDice } from '../store/diceStore';
import { attrCapForTier } from './derivedStats';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { playerStatusAttrDelta } from './statusAttrs';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus } from '../store/adventureTeamStore';
import {
  resolve, buildCheckResultBlock, CRIT_MULT, ATTR_KEYS, ATTR_LABELS, strengthScoreFromBio, rollDie,
  resolveTargeted, targetTierBase,
  type AttrKey, type Difficulty, type OutcomeLevel, type DiceMode, type ResolveResult, type DiceAttrs, type EquipItemLite, type TargetedResult,
} from './diceEngine';
import { aiClassifyActions } from './diceJudge';
import { detectAutoActions, detectDifficulty } from './autoDiceDetect';

/* ════════════════════════════════════════════
   自动检定（发送即判定）—— hybrid：关键词门 + 按行为类型判属性 + 可多行为多摇
   - 玩家开启「自动检定」后，正常发送消息即触发。
   - 关键词门（detectAutoActions·多命中）决定「要不要 roll」（命中才继续；AI 模式也靠它省调用）。
   - 属性判定：frontend 模式按关键词直接定属性（可多类→多摇·最多2）；ai/ai-full 模式一次调用 aiClassifyJudge
     让 AI 挑对口属性并裁定（治「赠送礼物被当力量」等关键词误判 + 多行为分别摇），失败回退前端确定性多摇。
   - 结果 = 多段 `<检定结果>` 块（对读者隐藏·只喂正文 API）+ 多张 DiceCardData（气泡下弹）。
   - 仅主角、仅非对抗。手动骰子面板已移除，检定统一走自动模式。
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
  calcNote?: string;     // AI 模式：数值推演摘要（有则替代 d20/d100 算式行）
  rerolls?: number;      // 有限重掷：本次因失败额外掷了几次（0/undefined=没重掷；仅 frontend）
  targetTier?: string;   // 目标阶级感知判定：目标的强度阶级（有目标才有）
}

export interface AutoDiceOut {
  block: string;           // 注入正文 API 的 `<检定结果>` 文本（读者不可见·可含多段）
  cards: DiceCardData[];   // 渲染骰子卡（一段行动可多类行为 → 多张卡·最多2）
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

/** 是否开启检定审核窗（自动检定出结果后先弹窗给玩家重掷/编辑，确认才进正文） */
export const isDiceReviewOn = (): boolean => !!useDice.getState().settings.diceReview;

/** 结果好坏排序（好→坏），用于「有限重掷·取最好一次」 */
const LEVEL_ORDER: OutcomeLevel[] = ['大成功', '碾压成功', '极难成功', '困难成功', '成功', '失败', '大失败'];
const levelRank = (lv: OutcomeLevel): number => { const i = LEVEL_ORDER.indexOf(lv); return i < 0 ? 99 : i; };

/** 中文属性标签 → 六维键（AI 分类返回中文，前端读属性值/算修正用） */
const LABEL_TO_KEY: Record<string, AttrKey> = { 力量: 'str', 敏捷: 'agi', 体质: 'con', 智力: 'int', 魅力: 'cha', 幸运: 'luck' };

/** 在场角色简述（名+阶位/强度）——喂 AI 分类器帮它认目标阶级 */
function onSceneBrief(): string {
  try {
    const npcs = useNpc.getState().npcs;
    const list = Object.values(npcs).filter((n: any) => n?.onScene && !n?.isDead).slice(0, 8);
    return list.map((n: any) => `${n.name || n.id}（${n.realm || n.bioStrength || '?'}）`).join('、');
  } catch { return ''; }
}

/** 目标阶级感知判定拼 `<检定结果>` 块 */
function buildTargetedBlock(actorName: string, attr: string, targetTier: string, difficulty: Difficulty, res: TargetedResult): string {
  const mult = res.backlash ? '（大失败·反噬）' : res.multiplier !== 1 ? `（后果×${res.multiplier}）` : '';
  return `<检定结果> ${actorName}（${attr}）对【${targetTier}】·难度${difficulty} → ${res.level}${mult}（d100:${res.roll} ${res.success ? '≤' : '>'} 阈值${res.threshold}%｜属性${res.attrVal} vs DC${res.dc}=${targetTier}基准×${res.coeff}） </检定结果>`;
}

const FOLLOW_LINE = '（以上为系统判定结果，请让本回合剧情严格服从各项成败、等级与后果，不要推翻。）';

/**
 * 自动检定主流程。返回 null = 本回合不判定（未开启 / 未命中关键词 / 系统回合 / 已手动注入 / AI 判无需检定）。
 * 命中则：按行为类型判属性（可多类→多摇·最多2）→ 记历史 → 返回 { block, cards }。
 */
export async function runAutoDice(text: string): Promise<AutoDiceOut | null> {
  const dice = useDice.getState();
  const s = dice.settings;
  if (!s.enabled || !s.autoMode) return null;
  const t = String(text || '').trim();
  if (!t) return null;
  if (/<检定结果>/.test(t)) return null;                              // 玩家已手动注入过 → 不重复
  if (/【结算任务】|【进入世界|【结束世界|【回归乐园】/.test(t)) return null;  // 系统回合跳过
  if (/【战斗结果】|已结算并写入面板/.test(t)) return null;            // 右侧⚔️战斗系统已结算的战报复盘（战斗内已骰过）→ 不再二次投骰
  const hits = detectAutoActions(t).slice(0, 2);                     // 关键词门（多命中·最多2类）：没命中=日常/闲聊 → 不 roll
  if (!hits.length) return null;

  const difficulty = detectDifficulty(t);
  const profile = usePlayer.getState().profile;
  const actorName = profile.name || '主角';
  const rerollMax = Math.max(0, Math.min(5, Math.floor(s.rerollOnFail || 0)));   // 有限重掷上限（仅 frontend 路径）

  const cards: DiceCardData[] = [];
  const blocks: string[] = [];

  // ── AI 模式（ai / ai-full）：一次调用 aiClassifyActions 只做分类（属性/事件难度/目标阶级），数值由前端算死。
  //    有目标 → 目标阶级感知 resolveTargeted（DC 随目标阶级缩放·治「掳走普通人却判输」）；无目标 → 相对难度 computeAutoFe。
  //    失败 → 落到下方前端关键词确定性多摇兜底。 ──
  if (s.judgeMode === 'ai' || s.judgeMode === 'ai-full') {
    const cls = await aiClassifyActions({ actorName, action: t, playerSheet: buildPlayerSheet(), onscene: onSceneBrief() });
    if (cls.usedAI) {
      if (!cls.behaviors.length) return null;                        // AI 判无需检定 → 不注入
      const attrs = playerEffAttrs();
      for (const b of cls.behaviors) {
        const attrKey = LABEL_TO_KEY[b.attr] ?? 'str';
        if (b.targetTier) {
          // 目标阶级感知·确定性 d100（DC=目标基准×事件系数，成功率=属性值/DC 比值公式）
          const roll = rollDie(100);
          const res = resolveTargeted({ attrVal: attrs[attrKey], targetBase: targetTierBase(b.targetTier), difficulty: b.difficulty, luck: attrs.luck, roll });
          blocks.push(buildTargetedBlock(actorName, b.attr, b.targetTier, b.difficulty, res));
          try {
            useDice.getState().addHistory({
              actorName, actionText: t, attrLabel: b.attr, difficulty: b.difficulty, opposed: false,
              mode: 'd100', dice: [res.roll], chosen: res.roll, total: res.roll, dc: res.dc, P: res.threshold,
              level: res.level, success: res.success, multiplier: res.multiplier, backlash: res.backlash,
            });
          } catch { /* 历史记录失败不影响判定 */ }
          cards.push({
            actorName, action: t, attrLabel: b.attr, mode: 'd100', chosen: res.roll,
            modsTotal: 0, dc: res.dc, P: res.threshold, level: res.level, success: res.success, multiplier: res.multiplier,
            usedAI: true, reasoning: b.reasoning, targetTier: b.targetTier,
            calcNote: `d100:${res.roll} ${res.success ? '≤' : '>'} 阈值${res.threshold}%（vs ${b.targetTier}）`,
          });
        } else {
          // 无目标 → 相对难度确定性（与 frontend 同口径）
          const fe = computeAutoFe(attrKey, b.difficulty);
          const mult = CRIT_MULT[fe.level] ?? 1;
          blocks.push(buildCheckResultBlock({ actorName, actionText: t, attrLabel: b.attr, difficulty: b.difficulty, opposed: false, res: fe }));
          try {
            useDice.getState().addHistory({
              actorName, actionText: t, attrLabel: b.attr, difficulty: b.difficulty, opposed: false,
              mode: fe.mode, dice: fe.dice, chosen: fe.chosen, total: fe.total, dc: fe.dc, P: fe.P,
              level: fe.level, success: fe.success, multiplier: mult, backlash: fe.level === '大失败',
            });
          } catch { /* 历史记录失败不影响判定 */ }
          cards.push({
            actorName, action: t, attrLabel: b.attr, mode: fe.mode, chosen: fe.chosen,
            modsTotal: fe.mods.total, dc: fe.dc, P: fe.P, level: fe.level, success: fe.success, multiplier: mult,
            usedAI: true, reasoning: b.reasoning,
          });
        }
      }
      return { block: blocks.join('\n\n') + '\n' + FOLLOW_LINE, cards };
    }
    // AI 失败 → 前端关键词确定性兜底（下面）
  }

  // ── 前端确定性（frontend 模式 / AI 失败兜底）：关键词命中的每类属性各摇一次（最多 2）。 ──
  for (const hit of hits) {
    const attrLabel = ATTR_LABELS[hit.attrKey];
    let fe = computeAutoFe(hit.attrKey, difficulty);
    // 有限重掷：失败且开了重掷 → 再掷，一成功即停；全失败保留最好一次。纯前端、零 API。
    let rerolls = 0;
    while (!fe.success && rerolls < rerollMax) {
      rerolls++;
      const next = computeAutoFe(hit.attrKey, difficulty);
      if (levelRank(next.level) < levelRank(fe.level)) fe = next;
    }
    const mult = CRIT_MULT[fe.level] ?? 1;
    blocks.push(buildCheckResultBlock({ actorName, actionText: t, attrLabel, difficulty, opposed: false, res: fe }));
    try {
      useDice.getState().addHistory({
        actorName, actionText: t, attrLabel, difficulty, opposed: false,
        mode: fe.mode, dice: fe.dice, chosen: fe.chosen, total: fe.total, dc: fe.dc, P: fe.P,
        level: fe.level, success: fe.success, multiplier: mult, backlash: fe.level === '大失败',
      });
    } catch { /* 历史记录失败不影响判定 */ }
    cards.push({
      actorName, action: t, attrLabel, mode: fe.mode, chosen: fe.chosen,
      modsTotal: fe.mods.total, dc: fe.dc, P: fe.P, level: fe.level, success: fe.success, multiplier: mult,
      usedAI: false, rerolls: rerolls || undefined,
    });
  }
  // buildCheckResultBlock 各自带服从提示，直接拼接即可（多段稍冗余但无害）。
  return cards.length ? { block: blocks.join('\n\n'), cards } : null;
}
