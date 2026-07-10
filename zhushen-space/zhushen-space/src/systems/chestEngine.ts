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
/** 物品演化给"可开启战利品箱"打的专属标签——isChest 的首选、最权威依据。
 *  ITEM_FIXED_FORMAT_RULE 已要求 AI 生成宝箱类物品时把它加进 tags、并设 subType=宝箱。*/
export const CHEST_TAG = '宝箱';

// 名称强匹配词（多字词·不含裸「箱/匣」，以免把 弹匣/残档匣/工具箱 之类误判为宝箱）——供未打标签的旧宝箱/AI 漏标时兜底。
const CHEST_NAME_WORDS = [
  '宝箱', '宝盒', '宝匣', '百宝箱', '百宝盒', '藏宝箱', '藏宝盒', '财宝箱', '聚宝盆',
  '战利品箱', '补给箱', '奖励箱', '奖励包', '礼盒', '礼包', '大礼包', '盲盒', '福袋', '锦囊', '宝袋',
  '遗宝箱', '秘宝箱', '宝箱钥', 'lootbox',
];
// 明显不是"可开启战利品箱"的盛装容器/物件——即使名字带箱/匣/包/袋也绝不算宝箱（治 弹匣/残档匣/工具箱 误判）。
const NOT_CHEST_WORDS = ['弹匣', '弹夹', '工具箱', '工具包', '储物', '背包', '行李', '箱笼', '信箱', '邮箱', '冰箱', '书箱', '药箱', '针剂', '烟盒', '饭盒'];
// 这些大类是"实打实的装备"，绝不当宝箱开。
const CHEST_EXCLUDE_CATS = new Set<string>(['武器', '防具', '饰品', '宝石', '载具']);

/** 判断一件背包物品是否是"可开启的宝箱"。
 *  首选：物品演化打的专属标签 CHEST_TAG（或 subType=宝箱）——最权威、绕过一切名称启发式；
 *  兜底：名称强匹配（旧存档里未打标签的宝箱 / AI 漏标时），并排除装备大类与明显非宝箱容器（弹匣/工具箱…）。
 *  面板另有「显示全部」兜底，可强开任意物。*/
export function isChest(it?: InventoryItem | null): boolean {
  if (!it) return false;
  if (it.equipped) return false;
  if ((it.tags ?? []).includes(CHEST_TAG)) return true;            // 首选：专属标签
  if (String(it.subType ?? '') === CHEST_TAG) return true;        // 首选：subType=宝箱
  if (CHEST_EXCLUDE_CATS.has(String(it.category ?? ''))) return false;
  const name = String(it.name ?? '');
  if (NOT_CHEST_WORDS.some((w) => name.includes(w))) return false;   // 弹匣/工具箱… 一律排除
  return CHEST_NAME_WORDS.some((w) => name.includes(w));            // 兜底：名称强匹配
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
  category: ItemCategory | string;   // 类别（locked=true 时锁死·AI 不得改；否则为建议·AI 可微调为更贴切的合法类别）
  gradeDesc: string;                 // 该件产物的品级（已锁死，AI 不得越级）
  gradeNum: number;
  note: string;                      // 该槽说明（主奖/附带）
  locked: boolean;                   // 类别是否锁定（宝箱明示内含品类时为 true，AI/前端都不得改类别）
}
export interface ChestLootPlan {
  chestId: string;
  chestName: string;
  chestGrade: number;   // 宝箱自身品级序号
  capGrade: number;     // 本次可开出的最高品级序号（= chestGrade）
  capName: string;      // 最高品级名
  count: number;        // 开出几件（含幸运额外件）
  slots: ChestSlot[];
  luck: number;         // 开启者幸运值（本次计入）
  luckBonus: number;    // 幸运加成系数 0~1（见 luckBonus 标准表）
  luckExtra: number;    // 幸运带来的额外产物件数
}

/* ── 幸运（六维·幸运）→ 开箱加成·标准表 ──
   「多少幸运多少加成」权威映射：分档给一个 0~1 的加成系数 B（幸运越高越接近 1，封顶 1）。
   六维幸运的量级随阶位差异极大（新人个位数、十四阶极值可达数千），故用分档而非线性，天然处理全区间。
   加成 B 只在【本箱品级上限之内】发力——绝不让幸运把产物开到超过宝箱品级（"最高可开"是硬上限）：
     ① 主奖顶到品级上限的概率 = 50% + 50%·B（B=1 时必顶档）；
     ② 附带产物的"降档量"按 B 往回收（幸运越高越贴近上限）；
     ③ 额外产物（气运加身·贴近上限的惊喜件）0~2 件，概率随 B 提升。 */
const LUCK_BONUS_TABLE: Array<[min: number, bonus: number]> = [
  [3000, 1.00],   // 气运满溢
  [1500, 0.88],
  [800, 0.75],
  [400, 0.60],
  [200, 0.45],
  [100, 0.30],
  [50, 0.20],
  [20, 0.10],
  [0, 0.00],      // 幸运<20：无加成
];
/** 幸运值 → 开箱加成系数 B（0~1）。见 LUCK_BONUS_TABLE 标准表。*/
export function luckBonus(luck?: number): number {
  const v = Math.max(0, Math.floor(Number(luck) || 0));
  for (const [min, bonus] of LUCK_BONUS_TABLE) if (v >= min) return bonus;
  return 0;
}
/** 幸运加成档位标签（UI 用）。*/
export function luckTierLabel(luck?: number): string {
  const b = luckBonus(luck);
  return b <= 0 ? '无' : b < 0.3 ? '微' : b < 0.6 ? '中' : b < 0.88 ? '高' : '极';
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
  const s = `${chest.name ?? ''} ${chest.subType ?? ''} ${(chest.tags ?? []).join(' ')} ${chest.intro ?? ''} ${chest.effect ?? ''}`;
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

/* ── 宝箱"声明的内含品类"锁定 ──
   若宝箱的【名称/子类型/标签】或【简介/效果】里明示了它只装某类物品，返回锁定的类别集合，开箱只出这些类别；
   否则返回 null（泛宝箱·走混合池·AI 可微调）。治"消耗品补给箱却开出装备"——身份(名称)优先于简介 flavor 判定。
   例：「消耗品补给箱」「军械箱」「材料宝箱」→ 锁定对应品类；「藏宝箱/百宝箱/福袋」无明示 → null。 */
const CAT_DECL: Array<[RegExp, ItemCategory[]]> = [
  [/消耗品|药剂|丹药|药箱|口粮|食盒|急救|恢复剂/, ['消耗品']],
  [/补给|物资|军需/, ['消耗品', '材料']],
  [/材料箱|材料包|材料宝箱|矿[箱包]|锻材|原料|工料/, ['材料']],
  [/军械|兵器|武器/, ['武器']],
  [/护甲|铠甲|防具/, ['防具']],
  [/首饰|饰品|珠宝/, ['饰品']],
  [/宝石|晶石|灵晶/, ['宝石']],
  [/工具箱|器械|装置箱/, ['工具']],
  [/载具|战车|坐骑/, ['载具']],
  [/装备|军备|披挂/, ['武器', '防具', '饰品']],
];
export function chestCategoryLock(it?: InventoryItem | null): ItemCategory[] | null {
  if (!it) return null;
  const idHay = `${it.name ?? ''} ${it.subType ?? ''} ${(it.tags ?? []).join(' ')}`;
  for (const [re, cats] of CAT_DECL) if (re.test(idHay)) return cats;   // 结构化身份（名称/子类型/标签）优先
  const descHay = `${it.intro ?? ''} ${it.effect ?? ''}`;
  for (const [re, cats] of CAT_DECL) if (re.test(descHay)) return cats;   // 再看简介/效果里的明示
  return null;
}

/**
 * 开箱掷计划（开启时掷一次、锁进 session；确认前不动任何东西）。
 * - capGrade = 宝箱自身品级：本箱产物一律 ≤ 此档，绝不越级。
 * - 第 1 件是"主奖"：品级 = cap 或 cap-1；其余是"附带"：品级 = cap-1..cap-3（下探至白色）。
 * - 类别：若宝箱明示内含品类（chestCategoryLock）→ 锁定只出该类（locked=true）；否则按主题加权抽取（AI 可微调）。
 */
export function rollChestPlan(chest: InventoryItem, luck = 0): ChestLootPlan {
  const chestGrade = chestGradeNum(chest);
  const cap = Math.max(1, Math.min(ITEM_GRADES.length, chestGrade));
  const B = luckBonus(luck);                 // 幸运加成系数 0~1
  const baseCount = rollCount(cap);
  const luckExtra = (Math.random() < B ? 1 : 0) + (Math.random() < B * 0.4 ? 1 : 0);   // 幸运额外件 0~2
  const count = baseCount + luckExtra;
  const lockSet = chestCategoryLock(chest);   // 宝箱声明的内含品类（治"消耗品箱却开出装备"）
  const pool: CatWeight[] = lockSet
    ? lockSet.map((c, i) => [c, Math.max(1, 3 - i)] as CatWeight)   // 锁定集合：靠前的类别权重更高
    : themedPool(chest);
  const slots: ChestSlot[] = Array.from({ length: count }, (_, i) => {
    let g: number;
    if (i === 0) {
      g = (Math.random() < 0.5 + 0.5 * B) ? cap : Math.max(1, cap - 1);   // 主奖：幸运越高越可能顶到品级上限
    } else if (i >= baseCount) {
      g = Math.max(1, cap - randInt(1, 2));                                // 幸运额外件：贴近上限的惊喜
    } else {
      const reduce = (Math.random() < B ? 1 : 0) + (Math.random() < B * 0.5 ? 1 : 0);   // 幸运把降档量往回收
      g = Math.max(1, Math.min(cap, cap - Math.max(0, randInt(1, 3) - reduce)));         // 附带：略低于上限，幸运越高越贴近
    }
    const cat = pickWeighted(pool);
    const note = i === 0 ? '本箱主奖（贴近品级上限）' : i >= baseCount ? '幸运额外产物（气运加身）' : '附带产物（略低于上限）';
    return { category: cat, gradeDesc: gradeName(g), gradeNum: g, note, locked: !!lockSet };
  });
  return {
    chestId: chest.id, chestName: chest.name, chestGrade,
    capGrade: cap, capName: gradeName(cap), count, slots,
    luck: Math.max(0, Math.floor(Number(luck) || 0)), luckBonus: B, luckExtra,
  };
}
