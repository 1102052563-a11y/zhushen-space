import { ITEM_GRADES } from '../store/itemStore';
import type { InventoryItem, ItemCategory } from '../store/itemStore';
import { gradeToNum, gradeName } from './craftEngine';

/* ════════════════════════════════════════════
   开箱系统 · 确定性引擎（纯逻辑，无 React）
   —— 前端拍板"这是不是宝箱 / 本箱最高能开出到哪一档 / 开几件 / 逐件品级、建议类别"，
      AI 只在护栏内把每件产物的完整信息填出来（品级被锁死，绝不越级爆品）。
   这是"AI 不许凭空拔高数值"铁律的代码护栏：不同等级的宝箱有不同的产出上限
   （capGrade = 宝箱自身品级），逐件产物的品级一律 ≤ 该上限。
   设计对齐 craftEngine / casinoGacha 的确定性范式。
════════════════════════════════════════════ */

/* ── 一、宝箱识别（储存空间里哪些物品算"可开的宝箱"）── */
// 名称/子类型/标签命中这些词即认作宝箱（AI 剧情掉落的宝箱多是这类命名）。
const CHEST_WORDS = [
  '宝箱', '宝盒', '宝匣', '宝袋', '百宝', '藏宝', '财宝箱',
  '箱子', '礼盒', '礼包', '大礼包', '盲盒', '福袋', '锦囊', '囊袋',
  '战利品箱', '补给箱', '奖励箱', '秘宝', '遗宝', '宝库钥', 'loot',
  '箱', '匣',   // 兜底：多数宝箱名以「…箱/…匣」结尾
];
// 这些大类是"实打实的装备/道具"，绝不当宝箱开（避免把武器「破魔之匣」这类误判）。
const CHEST_EXCLUDE_CATS = new Set<string>(['武器', '防具', '饰品', '宝石', '载具']);
// 名称里含这些词说明它是件"具体装备/法器"而非容器，排除掉（治「储物戒/百宝囊是件法宝」等边界）。
const NOT_CHEST_HINT = ['戒指', '手镯', '项链', '护符'];

/** 判断一件背包物品是否是"可开启的宝箱"（默认过滤用；面板另有「显示全部」兜底，可强开任意物）。*/
export function isChest(it?: InventoryItem | null): boolean {
  if (!it) return false;
  if (it.equipped) return false;
  if (CHEST_EXCLUDE_CATS.has(String(it.category ?? ''))) return false;
  const hay = `${it.name ?? ''} ${it.subType ?? ''} ${(it.tags ?? []).join(' ')}`;
  if (NOT_CHEST_HINT.some((w) => (it.name ?? '').includes(w))) return false;
  return CHEST_WORDS.some((w) => hay.includes(w));
}

/* ── 二、宝箱品级 → 本次可开出的最高档（"不同等级宝箱最高能开出的物品"）──
   首选宝箱自身 gradeDesc 的品级；没标品级时按名称里的"箱质"关键词推断；再不行给一个保守默认档。 */
const NAME_TIER_HINTS: Array<[RegExp, number]> = [
  [/(创世|开天)/, 15],
  [/(永恒|无尽|轮回)/, 14],
  [/(起源|本源|世界之)/, 13],
  [/(不朽|不灭)/, 12],
  [/(圣灵|神圣|圣)/, 11],
  [/(史诗)/, 10],
  [/(传说|神话|远古|古神|太古)/, 9],
  [/(暗金|帝王|王级|至尊|皇)/, 8],
  [/(黄金|金)/, 7],
  [/(铂金|白金|璀璨|华丽)/, 6],
  [/(白银|水晶|钻石|精致)/, 5],
  [/(紫|秘银|魔法|奥术)/, 4],
  [/(青铜|铜|蓝)/, 3],
  [/(木|绿|寻常|普通)/, 2],
  [/(破旧|简陋|粗糙|白)/, 1],
];
function inferGradeFromName(name?: string): number {
  const s = String(name ?? '');
  for (const [re, g] of NAME_TIER_HINTS) if (re.test(s)) return g;
  return 0;
}

/** 宝箱自身品级序号（1..15）。优先 gradeDesc，其次名称推断，最后保守默认「蓝色(3)」。*/
export function chestGradeNum(it?: InventoryItem | null): number {
  if (!it) return 3;
  const byGrade = gradeToNum(it.gradeDesc);   // 命中 ITEM_GRADES 里的品级名
  if (byGrade > 0) return byGrade;
  const byName = inferGradeFromName(it.name);
  if (byName > 0) return byName;
  return 3;   // 未标品级的"神秘宝箱" → 当作蓝色档普通宝箱
}

/* ── 三、开箱产出计划（喂给 AI 的"开几件、逐件品级上限、建议类别"）── */
export interface ChestSlot {
  category: ItemCategory | string;   // 建议类别（AI 可按宝箱主题微调为更贴切的合法类别）
  gradeDesc: string;                 // 该件产物的品级（已锁死，AI 不得越级）
  gradeNum: number;
  note: string;                      // 该槽说明（主奖/附带）
}
export interface ChestLootPlan {
  chestId: string;
  chestName: string;
  chestGrade: number;   // 宝箱自身品级序号
  capGrade: number;     // 本次可开出的最高品级序号（= chestGrade）
  capName: string;      // 最高品级名
  count: number;        // 开出几件
  slots: ChestSlot[];
}

function randInt(a: number, b: number): number { return a + Math.floor(Math.random() * (b - a + 1)); }

/** 按上限档定"开几件"：越高档的宝箱开得越多。*/
function rollCount(cap: number): number {
  if (cap <= 3) return randInt(1, 2);
  if (cap <= 6) return randInt(2, 3);
  if (cap <= 9) return randInt(2, 4);
  if (cap <= 12) return randInt(3, 4);
  return randInt(3, 5);
}

/* 建议类别加权池：装备/材料/消耗品为主，宝石/工具/特殊物品较少。
   再按宝箱名/子类型里的主题词偏置（武器箱多出武器、药箱多出消耗品…）。*/
type CatWeight = [ItemCategory, number];
const BASE_POOL: CatWeight[] = [
  ['武器', 3], ['防具', 3], ['饰品', 2], ['材料', 3], ['消耗品', 3], ['宝石', 2], ['工具', 1], ['特殊物品', 1],
];
function themedPool(chest: InventoryItem): CatWeight[] {
  const s = `${chest.name ?? ''} ${chest.subType ?? ''} ${(chest.tags ?? []).join(' ')} ${chest.intro ?? ''}`;
  const pool = BASE_POOL.map(([c, w]) => [c, w] as CatWeight);
  const boost = (cat: ItemCategory, mul: number) => { const e = pool.find((p) => p[0] === cat); if (e) e[1] = Math.round(e[1] * mul); };
  if (/(武器|兵器|军械|刀|剑|枪|弓)/.test(s)) boost('武器', 3);
  if (/(防具|护甲|铠|盾|甲胄)/.test(s)) boost('防具', 3);
  if (/(装备|军备)/.test(s)) { boost('武器', 2); boost('防具', 2); boost('饰品', 2); }
  if (/(饰品|戒|项链|护符|首饰)/.test(s)) boost('饰品', 3);
  if (/(丹|药|补给|消耗|口粮|食)/.test(s)) boost('消耗品', 3);
  if (/(材料|矿|锻造|合成|工料)/.test(s)) boost('材料', 3);
  if (/(宝石|晶|珠)/.test(s)) boost('宝石', 3);
  if (/(工具|机关|装置|器械)/.test(s)) boost('工具', 3);
  return pool;
}
function pickWeighted(pool: CatWeight[]): ItemCategory {
  const total = pool.reduce((a, [, w]) => a + Math.max(0, w), 0) || 1;
  let r = Math.random() * total;
  for (const [c, w] of pool) { r -= Math.max(0, w); if (r <= 0) return c; }
  return pool[0][0];
}

/**
 * 开箱掷计划（开启时掷一次、锁进 session；确认前不动任何东西）。
 * - capGrade = 宝箱自身品级：本箱产物一律 ≤ 此档，绝不越级。
 * - 第 1 件是"主奖"：品级 = cap 或 cap-1；其余是"附带"：品级 = cap-1..cap-3（下探至白色）。
 * - 每件的建议类别按主题加权抽取（AI 可微调为更贴切的合法类别）。
 */
export function rollChestPlan(chest: InventoryItem): ChestLootPlan {
  const chestGrade = chestGradeNum(chest);
  const cap = Math.max(1, Math.min(ITEM_GRADES.length, chestGrade));
  const count = rollCount(cap);
  const pool = themedPool(chest);
  const slots: ChestSlot[] = Array.from({ length: count }, (_, i) => {
    const g = i === 0
      ? Math.max(1, cap - randInt(0, 1))      // 主奖：贴着上限
      : Math.max(1, cap - randInt(1, 3));     // 附带：略低于上限
    const cat = pickWeighted(pool);
    return { category: cat, gradeDesc: gradeName(g), gradeNum: g, note: i === 0 ? '本箱主奖（贴近品级上限）' : '附带产物（略低于上限）' };
  });
  return {
    chestId: chest.id, chestName: chest.name, chestGrade,
    capGrade: cap, capName: gradeName(cap), count, slots,
  };
}
