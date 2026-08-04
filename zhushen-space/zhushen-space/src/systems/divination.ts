/*
  命运罗盘 · 占卜池（v5.6 世界引擎 task0「占卜池」的轮回乐园实装）
  ────────────────────────────────────────────────────────────────
  作用：**用外部随机性打破 LLM 的模式坍缩**。
  没有它，AI 推演世界事件会反复写同一类走向（阴谋→危机→反转）；塔罗/易经的语义足够宽，
  能把"这件事接下来往哪走"从模型的表达偏好里拽出来。三层各管一个尺度：

    宏观层 = 易经卦象  → 长期命运气候 / 世界底色 / 主题张力
    发展层 = 大阿卡那  → 当前阶段推进趋势 / 冲突指向 / 转折可能
    细节层 = 小阿卡那  → 噪声与局部信号 / 偶发征兆 / 短暂情绪

  ⚠⚠ 轮回乐园关键改动（与卡里不同）：
    卡里把卦象/塔罗**原文写进会注入正文的字段**。在轮回乐园会直接破沉浸——
    赛博世界跳出「䷿·未济」、西幻世界跳出「星币五」，玩家一眼出戏。
    因此本实装：**占卜结果只作演化阶段的内部随机锚，永不进正文注入**。
    演化 AI 读到它 → 据它决定走向 → 只把**中文走向描述**写回事件字段。
    原文仍然存下来（保证同一事件的命运气候稳定、跨读档不跳），UI 侧作"命运罗盘"徽章给玩家看——
    玩家/系统视角看得见，世界内的 NPC 一无所知，这个分野本身就很无限流。

  确定性：种子绑 **世界记录 id + 事件 id**（不绑回合号）——同一事件的卦象跨回合/回退/重放都不变。
*/
import { makeRng, hashStr } from './autonomyCorpus';

/* ── 牌库 ───────────────────────────────────────────────── */

export const MAJOR_ARCANA = [
  '愚者', '魔术师', '女祭司', '女皇', '皇帝', '教皇', '恋人', '战车',
  '力量', '隐者', '命运之轮', '正义', '倒吊人', '死神', '节制', '恶魔',
  '高塔', '星星', '月亮', '太阳', '审判', '世界',
] as const;

export const MINOR_ARCANA = [
  '权杖王牌', '权杖二', '权杖三', '权杖四', '权杖五', '权杖六', '权杖七', '权杖八',
  '权杖九', '权杖十', '权杖侍从', '权杖骑士', '权杖王后', '权杖国王',
  '圣杯王牌', '圣杯二', '圣杯三', '圣杯四', '圣杯五', '圣杯六', '圣杯七', '圣杯八',
  '圣杯九', '圣杯十', '圣杯侍从', '圣杯骑士', '圣杯王后', '圣杯国王',
  '宝剑王牌', '宝剑二', '宝剑三', '宝剑四', '宝剑五', '宝剑六', '宝剑七', '宝剑八',
  '宝剑九', '宝剑十', '宝剑侍从', '宝剑骑士', '宝剑王后', '宝剑国王',
  '星币王牌', '星币二', '星币三', '星币四', '星币五', '星币六', '星币七', '星币八',
  '星币九', '星币十', '星币侍从', '星币骑士', '星币王后', '星币国王',
] as const;

export const ICHING: ReadonlyArray<{ name: string; symbol: string }> = [
  { name: '乾', symbol: '䷀' }, { name: '坤', symbol: '䷁' }, { name: '屯', symbol: '䷂' }, { name: '蒙', symbol: '䷃' },
  { name: '需', symbol: '䷄' }, { name: '讼', symbol: '䷅' }, { name: '师', symbol: '䷆' }, { name: '比', symbol: '䷇' },
  { name: '小畜', symbol: '䷈' }, { name: '履', symbol: '䷉' }, { name: '泰', symbol: '䷊' }, { name: '否', symbol: '䷋' },
  { name: '同人', symbol: '䷌' }, { name: '大有', symbol: '䷍' }, { name: '谦', symbol: '䷎' }, { name: '豫', symbol: '䷏' },
  { name: '随', symbol: '䷐' }, { name: '蛊', symbol: '䷑' }, { name: '临', symbol: '䷒' }, { name: '观', symbol: '䷓' },
  { name: '噬嗑', symbol: '䷔' }, { name: '贲', symbol: '䷕' }, { name: '剥', symbol: '䷖' }, { name: '复', symbol: '䷗' },
  { name: '无妄', symbol: '䷘' }, { name: '大畜', symbol: '䷙' }, { name: '颐', symbol: '䷚' }, { name: '大过', symbol: '䷛' },
  { name: '坎', symbol: '䷜' }, { name: '离', symbol: '䷝' }, { name: '咸', symbol: '䷞' }, { name: '恒', symbol: '䷟' },
  { name: '遁', symbol: '䷠' }, { name: '大壮', symbol: '䷡' }, { name: '晋', symbol: '䷢' }, { name: '明夷', symbol: '䷣' },
  { name: '家人', symbol: '䷤' }, { name: '睽', symbol: '䷥' }, { name: '蹇', symbol: '䷦' }, { name: '解', symbol: '䷧' },
  { name: '损', symbol: '䷨' }, { name: '益', symbol: '䷩' }, { name: '夬', symbol: '䷪' }, { name: '姤', symbol: '䷫' },
  { name: '萃', symbol: '䷬' }, { name: '升', symbol: '䷭' }, { name: '困', symbol: '䷮' }, { name: '井', symbol: '䷯' },
  { name: '革', symbol: '䷰' }, { name: '鼎', symbol: '䷱' }, { name: '震', symbol: '䷲' }, { name: '艮', symbol: '䷳' },
  { name: '渐', symbol: '䷴' }, { name: '归妹', symbol: '䷵' }, { name: '丰', symbol: '䷶' }, { name: '旅', symbol: '䷷' },
  { name: '巽', symbol: '䷸' }, { name: '兑', symbol: '䷹' }, { name: '涣', symbol: '䷺' }, { name: '节', symbol: '䷻' },
  { name: '中孚', symbol: '䷼' }, { name: '小过', symbol: '䷽' }, { name: '既济', symbol: '䷾' }, { name: '未济', symbol: '䷿' },
];

/** 逆位概率（照搬卡里的 0.35） */
export const REVERSED_P = 0.35;

export interface Divination {
  /** 宏观层：`䷿·未济` */
  macro: string;
  /** 发展层：`皇帝(逆位)、节制、力量(逆位)` */
  dev: string;
  /** 细节层：`星币五、星币四、权杖侍从(逆位)` */
  detail: string;
}

/* 无放回抽 count 张 + 逆位判定 */
function drawCards(rng: () => number, pool: readonly string[], count: number): string[] {
  const idx = pool.map((_, i) => i);
  const out: string[] = [];
  for (let i = 0; i < count && idx.length; i++) {
    const k = Math.floor(rng() * idx.length);
    const card = pool[idx.splice(k, 1)[0]];
    out.push(rng() < REVERSED_P ? `${card}(逆位)` : card);
  }
  return out;
}

/**
 * 抽一组占卜（确定性：同 seed 必得同结果）。
 * @param seed 建议用 `divinationSeed(worldId, eventId)`——绑事件而非回合，回退/重放不跳。
 */
export function drawDivination(seed: number): Divination {
  const rng = makeRng(seed >>> 0);
  const hex = ICHING[Math.floor(rng() * ICHING.length)];
  return {
    macro: `${hex.symbol}·${hex.name}`,
    dev: drawCards(rng, MAJOR_ARCANA, 3).join('、'),
    detail: drawCards(rng, MINOR_ARCANA, 3).join('、'),
  };
}

/** 事件级种子：绑「世界 + 事件」，**不绑回合** → 同一事件的命运气候永远稳定 */
export function divinationSeed(worldId: string, eventId: string): number {
  return hashStr(`${worldId || 'w'}::${eventId || 'e'}`);
}

/** 抽 n 组（供"本轮新事件从池子里各挑一组"的用法）。seed 相同则整池相同。 */
export function drawPool(seed: number, n = 5): Divination[] {
  const out: Divination[] = [];
  for (let i = 0; i < n; i++) out.push(drawDivination(hashStr(`${seed}#${i}`)));
  return out;
}

/* ── 注入（仅演化阶段·绝不进正文）───────────────────────── */

/** 三层语义说明。给演化 AI 看的解读指南，不含任何"照抄原文"要求。 */
export const DIVINATION_GUIDE = `【命运罗盘·解读指南（仅供你决定走向，**结论只能写成本世界语汇的中文描述**）】
· 宏观层（易经卦象）：这条线长期的命运气候、世界底色、主题张力。偏象征，可落在局势/情绪/宿命/秩序/灾兆/希望任一方向。
· 发展层（大阿卡那）：当前阶段的推进趋势、处境、关系变化、冲突指向、转折可能。可与宏观层呼应，也可彼此拉扯形成张力。
· 细节层（小阿卡那）：噪声与扰动——影响景物、动作、语气、偶发征兆、短暂情绪与微小偏转。
· 逆位＝该意象的受阻/反向/内耗面，不是简单的"坏"。`;

/** ⚠ 铁则：占卜术语绝不能出现在写回的内容里。这条随池子一起注入。 */
export const DIVINATION_SCRUB_RULE = `⚠ **禁止把占卜术语写进任何产出内容**：卦名、卦象符号（䷀-䷿）、塔罗牌名、"逆位"、"占卜/塔罗/大阿卡那/小阿卡那"等词，
一律**不得**出现在事件描述、脉络、传闻、任务、NPC 档案或正文里。罗盘只是你内部定走向的骰子——
产出必须是**本世界语汇的中文描述**（例如抽到「高塔(逆位)」→ 写「旧有秩序正在从内部松动，但尚未坍塌」，而不是写「高塔逆位」）。`;

/** 构建注入块：一组或多组占卜 + 解读指南 + 封词铁则。空数组返回空串。 */
export function buildDivinationInjection(list: Divination[], label = '本轮'): string {
  if (!list.length) return '';
  const rows = list.map((d, i) => `${list.length > 1 ? `${i + 1}. ` : ''}宏观:${d.macro}｜发展:${d.dev}｜细节:${d.detail}`);
  return `<命运罗盘>（${label}的走向锚·内部参考）\n${rows.join('\n')}\n${DIVINATION_GUIDE}\n${DIVINATION_SCRUB_RULE}\n</命运罗盘>`;
}

/* ── 兜底清洗（提示词失守时的机读护栏，同 scrubAbyss 的思路）────── */

const DIVINATION_TERMS = new RegExp(
  `[\\u4DC0-\\u4DFF]|(?:${[...MAJOR_ARCANA, ...MINOR_ARCANA].join('|')})(?:\\(逆位\\))?|逆位|大阿卡那|小阿卡那|塔罗|占卜池`,
  'g',
);

/** 文本里是否混进了占卜术语（AI 没守住封词铁则）——供落库前告警/清洗 */
export function hasDivinationLeak(text?: string): boolean {
  if (!text) return false;
  DIVINATION_TERMS.lastIndex = 0;
  return DIVINATION_TERMS.test(text);
}

/** 剥掉泄漏的占卜术语（保守：只删词，不改句子结构；连带清理因此产生的空括号与重复标点） */
export function scrubDivination(text: string): string {
  return (text ?? '')
    .replace(DIVINATION_TERMS, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[、，,]{2,}/g, '、')
    .replace(/^[、，,\s]+|[、，,\s]+$/g, '')
    .trim();
}
