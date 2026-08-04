/*
  因果权重 · 个体 vs 群体的力量结构判定（v5.6 世界引擎「因果权重自适应法则」的轮回乐园实装）
  ────────────────────────────────────────────────────────────────────────────────
  解决的问题：AI 推演世界后台时，最常见的逻辑崩坏是「凡人海啸推翻元婴」——
  一群一阶土著把四阶契约者围杀了，或者反过来，二阶主角在五阶世界横着走。

  做法沿用本仓一贯的「前端算死、AI 只叙述」：
    R = 有效战力比 = POWER_PER_TIER ^ (个体战力位 − 群体战力位)
  然后按 R 分四档给出**可判定**的叙事约束，随各演化阶段注入。

  ★ 为什么用「阶差指数」而不是属性上限之比：
    ATTR_CAP_BY_TIER 是**属性**上限（一阶50 → 四阶150，比值才 3），而真实战力还叠了
    真实属性×5、生物强度档 ×2^n 的 HP/EP 倍率、技能品级、装备品级……属性比 ≠ 战力比。
    与其假装精确，不如把「每高一阶 ≈ ×N 战力」显式写成一个**可调、可测、文档化**的常量。

  ★ 轮回乐园特化（比卡里多一档）：
    卡里只有三档，因为它假设个体永远强于群体。无限流必须有 `outmatched`（R<1）——
    低阶契约者进高阶世界会被碾，这恰恰是无限流最核心的张力，不能反过来被"主角光环"抹平。

  ★ 世界阶 vs 巅峰战力分开算（铁律 world-peak-power-can-exceed-tier）：
    「群体」基准取世界阶位；「本世界最强个体」另取巅峰战力文本里的最高阶名——
    巅峰可以超世界阶（原著顶点忠实还原），两者混为一谈会把"世界里有个超规格老怪"抹掉。
*/
import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';
import { highestTierIn } from './npcGrowthGuard';
import { BIO_TIER_NAMES, MAX_BIO_NUM } from './bioStrength';

/** 每高一阶 ≈ ×4 有效战力。唯一的可调旋钮——改它等于整体调"跨阶碾压"的烈度。
 *  校准：阶差 1→R=4（打得过但吃力）/ 2→16 / 3→64（要精心设局+重大代价）/ 5→1024（降维打击）。 */
export const POWER_PER_TIER = 4;

export type CrowdVerdict = 'dominate' | 'tactics_needed' | 'crowd_valid' | 'outmatched';

/** 阶位名/等级 → 阶序号 1..14（认不出按一阶）。与 bioStrength.nominalTierNum 同口径，但不依赖它以保持本模块轻量。 */
export function tierNumOf(tier?: string, level?: number): number {
  const it = TIERS.indexOf(normalizeTier(tier) as typeof TIERS[number]);
  const il = level != null ? TIERS.indexOf(realmFromLevel(Math.max(1, level)) as typeof TIERS[number]) : -1;
  const idx = Math.max(it, il);
  return idx < 0 ? 1 : idx + 1;
}

/** 'T7·半神' / 'T12' / 7 → 档位数字 0..16；认不出返回 null（不参与修正） */
export function bioNumOf(bio?: string | number): number | null {
  if (typeof bio === 'number') return Math.max(0, Math.min(MAX_BIO_NUM, Math.round(bio)));
  const s = String(bio ?? '');
  if (!s) return null;
  const m = /T\s*(\d{1,2})/i.exec(s);
  if (m) return Math.max(0, Math.min(MAX_BIO_NUM, Number(m[1])));
  const byName = BIO_TIER_NAMES.indexOf(s.replace(/^T\d*[·・]?/, '').trim() as typeof BIO_TIER_NAMES[number]);
  return byName >= 0 ? byName : null;
}

/**
 * 战力位 = 阶序号 + 生物强度微调。
 * 生物强度只做**阶内**修正（±0.75 阶封顶）：同为三阶，T5·领主 与 T1·兵卒 不该等价，
 * 但也绝不能让 bio 把人抬过一整阶——越阶由阶位字段负责，bio 只管阶内高低。
 */
export function powerIndex(tier?: string, level?: number, bio?: string | number): number {
  const t = tierNumOf(tier, level);
  const b = bioNumOf(bio);
  if (b == null) return t;
  // 该阶的"典型档"≈ tierWindow 中位（tierNum-1 .. tierNum+2 的中点 ≈ tierNum+0.5）
  const centre = t + 0.5;
  const delta = Math.max(-0.75, Math.min(0.75, (b - centre) * 0.25));
  return t + delta;
}

/** 有效战力比 R = POWER_PER_TIER ^ 阶差。actor 高于 crowd → R>1。 */
export function powerRatio(actorIdx: number, crowdIdx: number): number {
  return Math.pow(POWER_PER_TIER, actorIdx - crowdIdx);
}

/**
 * R → 判定档。阈值照搬卡里的 1000 / 10 分界，并补 R<1 这一档。
 * - dominate       群体物理反抗成功率 = 0，只能靠规则死穴 / 更高存在 / 非直接对抗
 * - tactics_needed 可被「精心策划的群体战术 + 重大代价」克制
 * - crowd_valid    数量 / 组织度 / 资源正常生效
 * - outmatched     反过来：群体逻辑对该个体生效，他会被碾
 */
export function crowdVerdict(R: number): CrowdVerdict {
  if (R < 1) return 'outmatched';
  if (R >= 1000) return 'dominate';
  if (R >= 10) return 'tactics_needed';
  return 'crowd_valid';
}

export const VERDICT_TEXT: Record<CrowdVerdict, string> = {
  dominate: '降维打击：群体正面反抗成功率＝0。要撼动他，只能靠①同级或更高的个体介入 ②本世界设定里**明确存在**的规则死穴 ③他自身重伤/封印/枯竭 ④政治·经济·信仰等非直接对抗瓦解其存在基础。禁止"人多堆死"。',
  tactics_needed: '可被克制，但必须付出代价：需要精心策划的群体战术（地利/陷阱/消耗/人质/秘宝）＋重大伤亡或重大代价，绝非一拥而上。',
  crowd_valid: '群体逻辑正常生效：数量、组织度、资源、地利都能实打实影响结果。',
  outmatched: '⚠ 力量劣势方是他自己：群体/对手的逻辑对他生效。不得写成以弱胜强的爽文——除非有本世界设定内成立的具体依仗（秘宝/地利/援军/情报差），且要付出相应代价。',
};

export interface PowerReport {
  actorIdx: number;
  crowdIdx: number;
  R: number;
  verdict: CrowdVerdict;
  peakIdx: number | null;      // 本世界巅峰战力的阶序号（提不出则 null）
  vsPeak: 'above' | 'even' | 'below' | null;   // 主角相对该巅峰
  line: string;                // 一行机读结论，直接注入提示词
}

const fmtR = (R: number): string =>
  R >= 100 ? String(Math.round(R)) : R >= 1 ? R.toFixed(1) : R.toFixed(3);

const tierName = (idx: number): string => TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.round(idx) - 1))] ?? '一阶';

/**
 * 主角（或任一个体）对上「某世界的普通群体」的力量结构报告。
 *
 * @param actor  个体：阶位 / 等级 / 生物强度
 * @param world  世界：tier=世界阶位；peakPower=巅峰战力自由文本（从中扫最高阶名·可超世界阶）
 */
export function worldPowerReport(
  actor: { tier?: string; level?: number; bioStrength?: string },
  world: { tier?: string; peakPower?: string },
): PowerReport {
  const actorIdx = powerIndex(actor.tier, actor.level, actor.bioStrength);
  const crowdIdx = tierNumOf(world.tier);
  const R = powerRatio(actorIdx, crowdIdx);
  const verdict = crowdVerdict(R);

  const peakName = highestTierIn(world.peakPower || '');
  const peakIdx = peakName ? tierNumOf(peakName) : null;
  const vsPeak: PowerReport['vsPeak'] = peakIdx == null ? null
    : actorIdx - peakIdx >= 1 ? 'above' : peakIdx - actorIdx >= 1 ? 'below' : 'even';

  const peakBit = peakIdx == null ? ''
    : `｜本世界巅峰≈${tierName(peakIdx)}（${vsPeak === 'above' ? '低于主角' : vsPeak === 'below' ? '**高于主角·不可硬撼**' : '与主角相当'}）`;
  const line = `[因果权重] 个体≈${tierName(actorIdx)} vs 群体基准≈${tierName(crowdIdx)}｜R=${fmtR(R)} → ${verdict}${peakBit}`;

  return { actorIdx, crowdIdx, R, verdict, peakIdx, vsPeak, line };
}

/** 报告 → 注入用的完整段落（一行结论 + 该档的叙事约束）。传 null/undefined 返回空串。 */
export function formatPowerReport(rep?: PowerReport | null): string {
  if (!rep) return '';
  return `${rep.line}\n· ${VERDICT_TEXT[rep.verdict]}`;
}
