import { ITEM_GRADES, gradeToNum, type InventoryItem } from '../store/itemStore';
import { isEnhanceable } from './enhanceEngine';

/* ════════════════════════════════════════════
   品级进阶 · 确定性引擎（强化所「品级进阶」页签，纯逻辑无 React）
   —— 前端拍板"下一档是什么 / 花多少钱 / 评分落哪"，AI 只写进阶后的形态（EQUIP_ASCEND_RULE）。
   仿 abyssStore.applyAwaken（沿 ITEM_GRADES 一次+1档）+ enhanceEngine 的确定性范式。
   坑位提醒：addItem/normalizeGradeLabel 会按 score 钳品级（评分封顶只降不升）——
   进阶写回的 score 必须由 targetScoreFor 给出、落在目标档区间内，绝不采信 AI 的评分。
════════════════════════════════════════════ */

/** 各档评分区间中点（下标 = 档位-1；区间同 scoreToGradeNum / ITEM_GRADE_TABLE_RULE）。
 *  创世(15) 不由评分落档，给 ≥起源档 的高分让 normalizeGradeLabel 的 keepGenesis 兜住。*/
const GRADE_MID_SCORE = [6, 20, 50, 110, 205, 285, 355, 465, 615, 850, 1250, 2250, 5500, 10000, 12000];

/** 目标档位 → 落在该档评分区间内的代表评分（写回 item.score，防后续 normalizeGrades 钳回）。 */
export function targetScoreFor(gradeNum: number): number {
  const i = Math.max(1, Math.min(ITEM_GRADES.length, Math.round(gradeNum))) - 1;
  return GRADE_MID_SCORE[i];
}

export interface AscendStep { from: string; fromNum: number; to: string; toNum: number }
/** 当前品级 → 下一档（沿 ITEM_GRADES 一次+1档）；已顶格（创世）或无法识别品级返回 null。 */
export function nextGradeOf(gradeDesc?: string): AscendStep | null {
  const fromNum = gradeToNum(gradeDesc);
  if (fromNum < 1 || fromNum >= ITEM_GRADES.length) return null;
  return { from: ITEM_GRADES[fromNum - 1], fromNum, to: ITEM_GRADES[fromNum], toNum: fromNum + 1 };
}

/** 进阶费用（乐园币）：随目标档位指数上涨（同 craftCost/enhanceCost 的指数形状，越往上越贵）。 */
export function ascendCost(targetGradeNum: number): number {
  const t = Math.max(2, Math.min(ITEM_GRADES.length, Math.round(targetGradeNum)));
  return Math.round(300 * Math.pow(1.9, t - 1));
}

/** 可进阶：装备类（同强化口径）且未顶格。 */
export function isAscendable(item: Pick<InventoryItem, 'category' | 'gradeDesc'>): boolean {
  return isEnhanceable(item.category) && !!nextGradeOf(item.gradeDesc);
}

/** 进阶预览（runEquipAscendPhase 产出、确认才 confirmEquipAscend 落库扣费）。 */
export interface AscendPreview {
  itemId: string;
  from: string;        // 进阶前品级
  to: string;          // 进阶后品级（前端锁定）
  toNum: number;
  cost: number;        // 乐园币费用（前端定）
  name: string;        // 最终名（默认原名；玩家点名改名才会不同）
  renamed: boolean;
  combatStat?: string;
  attrBonus?: string;
  affix?: string;
  effect?: string;
  appearance?: string;
  intro?: string;
  notice?: string;     // AI 的 1-2 句进阶通报（进正文场外通报）
}
