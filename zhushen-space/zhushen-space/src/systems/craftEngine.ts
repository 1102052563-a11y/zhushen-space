import { ITEM_GRADES } from '../store/itemStore';
import type { ItemCategory } from '../store/itemStore';

/* ════════════════════════════════════════════
   合成工坊 · 确定性引擎（纯逻辑，无 React）
   —— 前端拍板"能不能合 / 成功档 / 产出品级上限 / 词缀预算"，AI 只在护栏内填风味。
   这是"AI 不许凭空乱加数值"铁律的代码护栏：产出品级 ≤ 投入最高品级 +（成功度至多一档），
   AI 拿到的是被锁死的 category + gradeDesc + 词缀条数，越级/注水会被前端夹回。
   设计见记忆 craft-station-feature（仿 enhanceEngine/casinoEngine 的确定性范式）。
════════════════════════════════════════════ */

/** 玩家投入工坊的一份材料（背包物品 id + 本次投入数量的快照）*/
export interface CraftInput {
  itemId: string;
  name: string;
  qty: number;
  gradeDesc?: string;
  category?: string;
  subType?: string;
}

/** 一个合成门类的静态定义（10 个门类＝一张数据表，通用管线按此驱动）*/
export interface CraftMode {
  id: string;
  icon: string;
  name: string;
  blurb: string;            // UI 一句话说明
  inputHint: string;        // 建议投入什么（软提示，不硬性拦）
  prefCats: string[];       // 选料面板默认过滤到的分类（[] = 不过滤；可切"显示全部"）
  outCategory: ItemCategory | '';  // 产出主分类（'' = 由 AI 按结果判定，见 outHint）
  outHint: string;          // 产出说明（含 category='' 时可选的类别）
  minInputs: number;        // 至少几"种"材料
  multiOut?: boolean;       // 逆向：一件拆成多件（分解）
  cotFocus: string;         // 注入合理性 COT ② 的门类侧重
  wbSeed: string;           // 世界书 matchCtx 关键词种子
}

/* ── 10 门类数据表（全世界可用，全部含扩展）── */
export const CRAFT_MODES: CraftMode[] = [
  {
    id: 'forge', icon: '🔨', name: '锻造', blurb: '矿石金属 → 武器·防具·饰品',
    inputHint: '矿石 / 金属 / 魔材 / 兽骨 / 旧装备残件',
    prefCats: ['材料', '武器', '防具', '饰品'], outCategory: '', outHint: '武器 / 防具 / 饰品（按材料与倾向判定其一）',
    minInputs: 1,
    cotFocus: '这些金属/魔材的属性能否熔铸相容、料量够不够成型；淬火与配比是否合理。',
    wbSeed: '锻造 熔炉 矿石 金属 淬火 铭纹 兵器 铸造',
  },
  {
    id: 'cook', icon: '🍲', name: '烹饪', blurb: '食材 → 食物·药膳（限时增益）',
    inputHint: '肉 / 蔬果 / 香料 / 灵植 / 蛋奶',
    prefCats: ['材料', '消耗品'], outCategory: '消耗品', outHint: '食物 / 药膳（食用后获得限时增益 buff）',
    minInputs: 1,
    cotFocus: '食材搭配是否成菜、火候与调味逻辑是否通；同类增益叠加更强、一道菜一般只主打一种效果。',
    wbSeed: '烹饪 食材 火候 调味 药膳 饱腹 增益 料理',
  },
  {
    id: 'alchemy', icon: '⚗', name: '炼丹', blurb: '草药精华 → 丹药·药剂',
    inputHint: '草药 / 精华 / 矿粉 / 兽血 / 灵液',
    prefCats: ['材料', '消耗品'], outCategory: '消耗品', outHint: '丹药 / 药剂（恢复 / 增益 / 解毒等消耗品）',
    minInputs: 1,
    cotFocus: '药性君臣佐使是否相配、有无相冲相克，火候过猛有炸炉/丹毒之虞。',
    wbSeed: '炼丹 丹炉 草药 药性 火候 丹毒 药剂 恢复',
  },
  {
    id: 'talisman', icon: '📜', name: '符箓', blurb: '材料 → 一次性符·技能卡',
    inputHint: '符纸 / 灵墨 / 兽血 / 晶粉 / 本源碎片',
    prefCats: ['材料', '消耗品'], outCategory: '消耗品', outHint: '符箓 / 卡片（一次性触发某效果的消耗品）',
    minInputs: 1,
    cotFocus: '所刻本源与承载媒介能否共鸣、能量是否稳定；符成一次性还是可复用。',
    wbSeed: '符箓 符纸 灵墨 卡片 本源 一次性 咒 阵纹',
  },
  {
    id: 'fuse', icon: '♾', name: '魂铸融合', blurb: '任意 2+ 物 → 质变新物',
    inputHint: '任意两件及以上物品（越契合越可能质变）',
    prefCats: [], outCategory: '', outHint: '武器 / 防具 / 饰品 / 特殊物品（按融合结果判定）',
    minInputs: 2,
    cotFocus: '两种本源能相互共鸣质变，还是相互排斥湮灭；融合是升华、嵌合还是产生全新概念。',
    wbSeed: '融合 魂铸 嵌合 质变 本源 共鸣 升华',
  },
  {
    id: 'inscribe', icon: '✦', name: '铭刻附魔', blurb: '装备 + 符文材料 → 附魔重铸',
    inputHint: '1 件装备 + 符文 / 精华 / 词条材料',
    prefCats: ['武器', '防具', '饰品', '材料'], outCategory: '', outHint: '与投入装备同类的附魔升级版（保留本体、注入新词缀/效果）',
    minInputs: 2,
    cotFocus: '符文属性与装备本体是否契合、附魔会强化还是排斥其原有词条；铭刻是否稳定。',
    wbSeed: '铭刻 附魔 符文 词缀 重铸 灌注 强化',
  },
  {
    id: 'artifice', icon: '⚙', name: '炼器机关', blurb: '材料 → 傀儡·道具·召唤物',
    inputHint: '金属 / 核心 / 零件 / 能源 / 灵材',
    prefCats: ['材料', '工具'], outCategory: '工具', outHint: '工具 / 机关 / 傀儡 / 召唤道具（主神空间造物）',
    minInputs: 1,
    cotFocus: '结构与动力是否自洽、能源够不够驱动；机关的功能是否由零件合理推导得出。',
    wbSeed: '炼器 机关 傀儡 造物 核心 能源 齿轮 召唤',
  },
  {
    id: 'tame', icon: '🐣', name: '御兽契灵', blurb: '材料 + 精魂 → 随从·契灵凭证',
    inputHint: '精魂 / 兽核 / 血脉 / 契约媒介 / 灵材',
    prefCats: ['材料', '特殊物品'], outCategory: '特殊物品', outHint: '契灵凭证 / 随从契约（凭此可召出一名随从或宠物）',
    minInputs: 1,
    cotFocus: '精魂与媒介能否结契、血脉是否稳定、契灵的形态由投入之物合理推导。',
    wbSeed: '御兽 契灵 精魂 随从 宠物 契约 血脉',
  },
  {
    id: 'salvage', icon: '♻', name: '分解提炼', blurb: '装备/物品 → 拆回材料',
    inputHint: '1 件要拆解的装备 / 物品',
    prefCats: ['武器', '防具', '饰品', '特殊物品', '工具'], outCategory: '材料', outHint: '数份材料（品级不超过被拆物）', multiOut: true,
    minInputs: 1,
    cotFocus: '这件物品由什么构成、拆解能回收哪些材料；越精良拆出的材料越多越好，但有损耗。',
    wbSeed: '分解 提炼 拆解 回收 材料 熔毁 精炼',
  },
  {
    id: 'crystal', icon: '💎', name: '炼晶', blurb: '材料/宝石 → 凝炼宝石',
    inputHint: '晶石 / 宝石 / 精华 / 元素结晶',
    prefCats: ['材料', '宝石'], outCategory: '宝石', outHint: '一枚可镶嵌的宝石（属性由投入材料决定）',
    minInputs: 1,
    cotFocus: '元素/精华能否凝晶、纯度够不够；晶体属性由投入之物的性质推导。',
    wbSeed: '炼晶 宝石 结晶 镶嵌 纯度 元素',
  },
];

export function craftMode(id: string): CraftMode {
  return CRAFT_MODES.find((m) => m.id === id) ?? CRAFT_MODES[0];
}

/* ── 品级 ↔ 序号（1..15）。取"命中的最高档"，天然处理 暗紫色>紫色 这类子串包含 ── */
export function gradeToNum(gradeDesc?: string): number {
  const g = String(gradeDesc ?? '');
  let best = 0;
  ITEM_GRADES.forEach((name, i) => { if (g.includes(name)) best = Math.max(best, i + 1); });
  return best;   // 0 = 未标注品级（材料/消耗品常见）
}
export function gradeName(num: number): string {
  const i = Math.min(ITEM_GRADES.length, Math.max(1, Math.round(num))) - 1;
  return ITEM_GRADES[i];
}

export type CraftTier = 'perfect' | 'success' | 'flawed' | 'fail';

export interface CraftQuality {
  tier: CraftTier;
  roll: number;
  baseGrade: number;     // 投入材料最高品级序号（未知→1 白色）
  ceilingGrade: number;  // 产出品级上限序号
  ceilingName: string;   // 产出品级上限名
  affixBudget: number;   // 词缀预算条数
  label: string;         // 中文档位标签
  note: string;          // 一句话说明
}

export function inputMaxGrade(inputs: CraftInput[]): number {
  return inputs.reduce((m, x) => Math.max(m, gradeToNum(x.gradeDesc)), 0);
}
export function inputTotalQty(inputs: CraftInput[]): number {
  return inputs.reduce((a, x) => a + Math.max(0, Math.floor(x.qty) || 0), 0);
}

/** 校验能否开合（只查数量/份数；分类只做软提示，不硬拦——全世界可用、材料本就模糊）*/
export function validateInputs(mode: CraftMode, inputs: CraftInput[]): { ok: boolean; why?: string } {
  const stacks = inputs.filter((x) => (Math.floor(x.qty) || 0) > 0);
  if (stacks.length < mode.minInputs) return { ok: false, why: `至少放入 ${mode.minInputs} 种材料` };
  if (inputTotalQty(stacks) <= 0) return { ok: false, why: '请设置材料数量' };
  return { ok: true };
}

const TIER_LABEL: Record<CraftTier, string> = {
  perfect: '✦ 完美（品级 +1）',
  success: '✓ 成功',
  flawed: '△ 瑕疵（降一档）',
  fail: '✗ 失败 · 黑暗产物',
};
const TIER_NOTE: Record<CraftTier, string> = {
  perfect: '手法与材料完美契合，产物升华了一档。',
  success: '合成顺利，产物如预期。',
  flawed: '火候/配比稍有偏差，产物带了点瑕疵、降了一档。',
  fail: '这组材料八字不合——炸了炉，成了一件古怪的黑暗产物。',
};

/**
 * 掷合成品质（开合时掷一次、锁进 session）。
 * 产出品级上限 = 投入最高品级 ±（成功度带来的至多一档）；绝不凭空越级。
 * 材料越多、种类越丰富 → 完美/成功概率略升。重新生成沿用此结果、只重掷 AI 风味。
 */
export function rollCraftQuality(inputs: CraftInput[], mode: CraftMode): CraftQuality {
  const base = inputMaxGrade(inputs) || 1;                 // 未标品级按白色
  const total = inputTotalQty(inputs);
  const variety = inputs.filter((x) => (Math.floor(x.qty) || 0) > 0).length;
  // 契合度加成：种类多 + 用料足 → 略提升上档概率（封顶 0.22）
  const bonus = Math.min(0.22, Math.max(0, variety - mode.minInputs) * 0.05 + Math.max(0, total - variety) * 0.015);
  const roll = Math.random();
  let tier: CraftTier;
  if (roll < 0.10 + bonus) tier = 'perfect';
  else if (roll < 0.72 + bonus) tier = 'success';
  else if (roll < 0.92) tier = 'flawed';
  else tier = 'fail';

  let ceil: number;
  if (tier === 'perfect') ceil = Math.min(ITEM_GRADES.length, base + 1);
  else if (tier === 'success') ceil = base;
  else if (tier === 'flawed') ceil = Math.max(1, base - 1);
  else ceil = 1;   // 失败 → 白色废料 / 黑暗产物

  const affixBudget = tier === 'fail' ? 0 : Math.max(0, Math.min(4, Math.floor(ceil / 3) + (tier === 'perfect' ? 1 : 0)));

  return {
    tier, roll, baseGrade: base, ceilingGrade: ceil, ceilingName: gradeName(ceil),
    affixBudget, label: TIER_LABEL[tier], note: TIER_NOTE[tier],
  };
}

/** 手工费（乐园币，随投入最高品级指数上涨；config.costMul 可调，设 0 则免费）*/
export function craftCost(inputs: CraftInput[], mul = 1): number {
  if (mul <= 0) return 0;
  const base = inputMaxGrade(inputs) || 1;
  return Math.round(200 * Math.pow(1.7, base - 1) * mul);
}

/** 产出槽（喂给 AI 的"你要生成几件、各是什么类别、品级上限多少"）。分解＝多件材料，其余＝一件。*/
export interface CraftSlot { category: string; gradeDesc: string; note: string }
export function craftOutputSlots(mode: CraftMode, q: CraftQuality): CraftSlot[] {
  if (mode.multiOut) {
    const n = q.tier === 'fail' ? 1 : q.baseGrade >= 8 ? 4 : q.baseGrade >= 4 ? 3 : 2;
    const g = gradeName(Math.max(1, q.ceilingGrade));
    return Array.from({ length: n }, () => ({ category: mode.outCategory || '材料', gradeDesc: g, note: '分解回收的材料' }));
  }
  return [{ category: mode.outCategory, gradeDesc: q.ceilingName, note: mode.outHint }];
}
