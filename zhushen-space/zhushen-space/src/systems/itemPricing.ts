import { ITEM_GRADES, scoreToGradeNum, gradeToNum } from '../store/itemStore';

/* ════════════════════════════════════════════
   物品公允价·确定性估价引擎（公共频道交易用）
   - 按【品级(ITEM_GRADES 15 档) × 评分(score) × 分类(category) × 数量】机械算出公允价区间。
   - 与背包「货币兑换」一致：1 灵魂钱币(魂币) = 150,000 乐园币。
   - 给「频道报价锚点」(solicitQuotes) 与「挂单前端提示」(PostForm) 共用，
     让契约者对玩家离谱定价的拒绝/嘲笑/还价有确定性依据，而非 AI 凭空判。
   ⚠ 这是本游戏自有经济设定（非任何小说原文），是物价世界书的数值底座。
════════════════════════════════════════════ */

export const SOUL_TO_PARK = 150000; // 1 灵魂钱币 = 150,000 乐园币（同 BackpackModal 的 SOUL_RATE）

/* 各档「公允价」区间，统一以乐园币计（魂币档在展示层再换算回魂币）。
   下标 0..14 对齐 ITEM_GRADES：白/绿/蓝/紫/暗紫/淡金/金/暗金/传说/史诗/圣灵/不朽/起源/永恒/创世。
   低档承袭交易频道既有价表；淡金起进入魂币区间（按 1:150000 自洽，纠正旧表魂币数偏差）。 */
const GRADE_PARK_BAND: readonly [number, number][] = [
  [300, 800],                 // 1  白色
  [1_500, 2_500],             // 2  绿色
  [3_500, 6_000],             // 3  蓝色
  [8_000, 35_000],            // 4  紫色
  [40_000, 90_000],           // 5  暗紫色
  [120_000, 300_000],         // 6  淡金   (≈ 0.8–2 魂币)
  [300_000, 900_000],         // 7  金色   (≈ 2–6 魂币)
  [1_000_000, 3_000_000],     // 8  暗金   (≈ 7–20 魂币)
  [4_500_000, 12_000_000],    // 9  传说级 (≈ 30–80 魂币)
  [12_000_000, 30_000_000],   // 10 史诗级 (≈ 80–200 魂币)
  [30_000_000, 75_000_000],   // 11 圣灵级 (≈ 200–500 魂币)
  [75_000_000, 225_000_000],  // 12 不朽级 (≈ 500–1500 魂币)
  [225_000_000, 750_000_000], // 13 起源   (战略级·常以物换物)
  [750_000_000, 3_000_000_000],   // 14 永恒 (战略级·无常规标价)
  [3_000_000_000, 9_000_000_000], // 15 创世 (神话级·非卖品)
] as const;

/* 分类对公允价的系数：知识类(技能书/卷轴/图纸/天赋)更贵；消耗/材料更便宜；战斗装备略高。*/
export function categoryMult(category?: string): number {
  const c = (category || '').trim();
  if (/技能书|技能卷轴|知识卷轴|卷轴|图纸|配方|天赋碎片|天赋/.test(c)) return 1.8;
  if (/武器|法宝/.test(c)) return 1.15;
  if (/防具|饰品/.test(c)) return 1.0;
  if (/丹药|药剂|药水|消耗品|食物|食材/.test(c)) return 0.5;
  if (/材料|矿石|素材/.test(c)) return 0.45;
  return 1.0; // 特殊物品 / 其他物品
}

/** 评分优先、品级兜底地解析出 1..15 的档位。*/
export function resolveGradeNum(opts: { score?: string | number; gradeDesc?: string }): number {
  const byScore = scoreToGradeNum(opts.score); // 0 = 无评分
  const n = byScore > 0 ? byScore : gradeToNum(opts.gradeDesc); // gradeToNum ≥ 1
  return Math.min(15, Math.max(1, n));
}

export interface FairValue {
  gradeNum: number;
  gradeName: string;
  low: number;       // 公允价下限（乐园币）
  high: number;      // 公允价上限（乐园币）
  mid: number;       // 公允价中位（乐园币）
  currency: '乐园币' | '灵魂钱币'; // 展示货币
  lowDisp: number;   // 展示货币下的下限
  highDisp: number;  // 展示货币下的上限
  strategic: boolean; // 起源(13)+ 战略级，常以物换物、无常规标价
}

/** 估算某物的公允价区间。*/
export function estimateFairValue(opts: {
  score?: string | number; gradeDesc?: string; category?: string; qty?: number;
}): FairValue {
  const gradeNum = resolveGradeNum(opts);
  const [bl, bh] = GRADE_PARK_BAND[gradeNum - 1];
  const mult = categoryMult(opts.category);
  const qty = Math.max(1, Number(opts.qty) || 1);
  const low = Math.round(bl * mult * qty);
  const high = Math.round(bh * mult * qty);
  const mid = Math.round((low + high) / 2);
  // 下限已达 1 魂币才用魂币展示（淡金多落乐园币、金色起落魂币）。
  const useSoul = low >= SOUL_TO_PARK;
  return {
    gradeNum, gradeName: ITEM_GRADES[gradeNum - 1],
    low, high, mid,
    currency: useSoul ? '灵魂钱币' : '乐园币',
    lowDisp: useSoul ? Math.max(1, Math.round(low / SOUL_TO_PARK)) : low,
    highDisp: useSoul ? Math.max(1, Math.round(high / SOUL_TO_PARK)) : high,
    strategic: gradeNum >= 13,
  };
}

/** 把任意货币的报价折算成乐园币，便于跨币种比较。*/
export function priceToPark(price: number, currency?: string): number {
  const isSoul = /魂|灵魂|soul/i.test(currency || '');
  return Math.max(0, Math.round(price || 0)) * (isSoul ? SOUL_TO_PARK : 1);
}

export type PriceVerdict = 'unknown' | 'fair' | 'high' | 'low' | 'absurdHigh' | 'absurdLow';

/** 判定玩家定价相对公允价的偏离。side: sell=玩家要价 / buy=玩家预算。*/
export function priceVerdict(
  side: 'sell' | 'buy', price: number, currency: string | undefined, fair: FairValue,
): { verdict: PriceVerdict; ratio: number } {
  if (!price || price <= 0) return { verdict: 'unknown', ratio: 0 }; // 面议
  const park = priceToPark(price, currency);
  const ratio = fair.mid > 0 ? park / fair.mid : 0;
  if (side === 'sell') {
    if (park > fair.high * 3) return { verdict: 'absurdHigh', ratio }; // 离谱虚高 → 买家嘲笑/拒绝
    if (park > fair.high * 1.4) return { verdict: 'high', ratio };     // 偏高
    if (park < fair.low * 0.35) return { verdict: 'absurdLow', ratio };// 贱卖（自己吃亏，买家偷着乐）
    return { verdict: 'fair', ratio };
  }
  // buy：预算
  if (park < fair.low * 0.3) return { verdict: 'absurdLow', ratio };   // 预算严重不足 → 卖家嘲笑/拒绝
  if (park < fair.low * 0.7) return { verdict: 'low', ratio };         // 预算偏低
  if (park > fair.high * 3) return { verdict: 'absurdHigh', ratio };   // 当冤大头（卖家偷着乐）
  return { verdict: 'fair', ratio };
}

/** 公允价区间的简短文案，如「3,500–6,000 乐园币」。*/
export function formatFairRange(fair: FairValue): string {
  const f = (n: number) => n.toLocaleString();
  return `${f(fair.lowDisp)}–${f(fair.highDisp)} ${fair.currency}`;
}

/** 判级 → 中文标签（提示/锚点共用）。*/
export const VERDICT_LABEL: Record<PriceVerdict, string> = {
  unknown: '面议',
  fair: '接近公允',
  high: '偏高',
  low: '预算偏低',
  absurdHigh: '离谱虚高',
  absurdLow: '严重偏离',
};
