import { gradeToNum, ITEM_GRADES, type GemSlotKind, type SocketedGem, type InventoryItem } from '../store/itemStore';
import { setForGem, gemSetName, looseJson, type GemSetDef } from './gemSets';
import { useGemSets } from '../store/gemSetStore';

export const GEM_SLOTS: GemSlotKind[] = ['通用', '武器', '防具', '饰品'];

/* ════════════════════════════════════════════
   宝石生成引擎（gemEngine）
   - 宝石数值在「获得（商店刷新/合成产出）」时即烘焙进物品，镶嵌只套用、不再重算
   - 中低阶（白~暗金，品级档 1-8）：基础面板加成（六维 / 生命 / 法力 / 攻防）
   - 高阶（传说级+，档 ≥9）：质变战斗属性（真伤 / 破甲 / 锋利度 / 灵魂伤害 / 吸血 / 暴击 / 元素…）
   - 商店：选品级 → 刷新随机若干颗（各种效果，丰富）→ 乐园币购买入背包
   - 低阶六维加成（力量/敏捷/体质/智力/魅力/幸运）经 attrBonus.sumBonus 自动并入角色六维；
     生命/法力/攻防 与全部高阶效果为描述类，展示 + 战斗/正文 AI 读取
════════════════════════════════════════════ */

/** gradeToNum ≥ 9（传说级）起为高阶宝石 */
export const GEM_HIGH_FROM = 9;
export function isHighGem(grade?: string): boolean { return gradeToNum(grade) >= GEM_HIGH_FROM; }

type Rng = () => number;
const rint = (rng: Rng, lo: number, hi: number) => {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return a + Math.floor(rng() * (b - a + 1));
};
const pick = <T,>(rng: Rng, a: T[]): T => a[Math.floor(rng() * a.length)] ?? a[0];
function roundNice(n: number): number {
  if (n >= 10000) return Math.round(n / 100) * 100;
  if (n >= 1000) return Math.round(n / 10) * 10;
  return Math.max(1, Math.round(n));
}

type GemDef = { attr: string; slot: GemSlotKind; flavor: string; cat?: '战斗' | '功能' | '生活'; gen: (n: number, rng: Rng) => string };

/* 低阶（白~暗金）：基础面板加成。n = 品级档 1-8 */
const LOW_GEMS: GemDef[] = [
  { attr: '力量', slot: '通用', flavor: '蛮力', gen: (n, r) => `力量+${rint(r, Math.ceil(n * 0.6), n + 1)}` },
  { attr: '敏捷', slot: '通用', flavor: '迅捷', gen: (n, r) => `敏捷+${rint(r, Math.ceil(n * 0.6), n + 1)}` },
  { attr: '体质', slot: '通用', flavor: '磐石', gen: (n, r) => `体质+${rint(r, Math.ceil(n * 0.6), n + 1)}` },
  { attr: '智力', slot: '通用', flavor: '灵识', gen: (n, r) => `智力+${rint(r, Math.ceil(n * 0.6), n + 1)}` },
  { attr: '魅力', slot: '饰品', flavor: '魅惑', gen: (n, r) => `魅力+${rint(r, Math.ceil(n * 0.6), n + 1)}` },
  { attr: '幸运', slot: '饰品', flavor: '福运', gen: (n, r) => `幸运+${rint(r, Math.ceil(n * 0.5), n)}` },
  { attr: '生命', slot: '防具', flavor: '血元', gen: (n, r) => `生命+${roundNice(rint(r, n * 20, n * 40))}` },
  { attr: '法力', slot: '通用', flavor: '法元', gen: (n, r) => `法力+${roundNice(rint(r, n * 14, n * 28))}` },
  { attr: '基础攻击', slot: '武器', flavor: '锐击', gen: (n, r) => `基础攻击+${rint(r, n * 3, n * 6)}` },
  { attr: '基础防御', slot: '防具', flavor: '守护', gen: (n, r) => `基础防御+${rint(r, n * 2, n * 5)}` },
];

/* 高阶（传说+）：质变战斗属性。n = 品级档 9-15，t=n-8 为高阶档 1-7 */
const HIGH_GEMS: GemDef[] = [
  { attr: '武器锋利度', slot: '武器', flavor: '裂锋', gen: (n, r) => `锋利度+${rint(r, (n - 8) * 8, (n - 8) * 14)}（斩击更易撕裂护甲）` },
  { attr: '无视防御', slot: '武器', flavor: '裂甲', gen: (n, r) => `无视${Math.min(45, rint(r, 6 + (n - 8) * 2, 9 + (n - 8) * 3))}%防御` },
  { attr: '护甲穿透', slot: '武器', flavor: '洞穿', gen: (n, r) => `穿透${Math.min(50, rint(r, 8 + (n - 8) * 2, 12 + (n - 8) * 3))}%护甲` },
  { attr: '真实伤害', slot: '武器', flavor: '湮灭', gen: (n, r) => `攻击附带${rint(r, (n - 8) * 10, (n - 8) * 20)}点真实伤害（无视一切减免）` },
  { attr: '灵魂伤害', slot: '通用', flavor: '噬魂', gen: (n, r) => `造成${rint(r, 5 + (n - 8) * 2, 8 + (n - 8) * 3)}%灵魂伤害，直击神魂` },
  { attr: '生命吸取', slot: '武器', flavor: '嗜血', gen: (n, r) => `攻击吸取${rint(r, 4 + (n - 8) * 2, 6 + (n - 8) * 2)}%伤害为生命` },
  { attr: '暴击率', slot: '通用', flavor: '必杀', gen: (n, r) => `暴击率+${Math.min(40, rint(r, 5 + (n - 8) * 2, 8 + (n - 8) * 2))}%` },
  { attr: '暴击伤害', slot: '通用', flavor: '狂暴', gen: (n, r) => `暴击伤害+${rint(r, 15 + (n - 8) * 6, 25 + (n - 8) * 9)}%` },
  { attr: '烈焰附魔', slot: '武器', flavor: '烈焰', gen: (n, r) => `攻击附带${rint(r, (n - 8) * 9, (n - 8) * 16)}点烈焰伤害` },
  { attr: '霜寒附魔', slot: '武器', flavor: '霜寒', gen: (n, r) => `攻击附带${rint(r, (n - 8) * 8, (n - 8) * 15)}点冰霜伤害，并减速目标` },
  { attr: '惊雷附魔', slot: '武器', flavor: '惊雷', gen: (n, r) => `攻击附带${rint(r, (n - 8) * 9, (n - 8) * 17)}点雷电伤害，几率麻痹` },
  { attr: '伤害减免', slot: '防具', flavor: '金刚', gen: (n, r) => `受到伤害减免${Math.min(35, rint(r, 4 + (n - 8) * 2, 6 + (n - 8) * 2))}%` },
  { attr: '格挡', slot: '防具', flavor: '壁垒', gen: (n, r) => `${rint(r, 8 + (n - 8) * 2, 12 + (n - 8) * 3)}%几率格挡，大幅减免该次伤害` },
  { attr: '荆棘反伤', slot: '防具', flavor: '荆棘', gen: (n, r) => `受击反弹${rint(r, 8 + (n - 8) * 3, 14 + (n - 8) * 4)}%伤害` },
  { attr: '真实防御', slot: '防具', flavor: '不破', gen: (n, r) => `获得${rint(r, (n - 8) * 6, (n - 8) * 12)}点真实防御（无视穿透）` },
  { attr: '坚韧抗控', slot: '防具', flavor: '坚韧', gen: (n, r) => `所受控制效果时长减少${Math.min(50, rint(r, 8 + (n - 8) * 3, 12 + (n - 8) * 4))}%` },
  { attr: '急速', slot: '通用', flavor: '疾速', gen: (n, r) => `攻击 / 施法速度+${Math.min(45, rint(r, 5 + (n - 8) * 2, 8 + (n - 8) * 2))}%` },
  { attr: '会心一击', slot: '通用', flavor: '会心', gen: (n, r) => `${rint(r, 4 + (n - 8), 6 + (n - 8) * 2)}%几率会心，该次伤害翻倍` },
  { attr: '真实属性判定', slot: '通用', flavor: '真我', gen: (n, r) => `关键判定时全属性+${rint(r, (n - 8) * 2, (n - 8) * 4)}（真实判定，无视压制）` },
];

/* 功能类（utility·便利/资源/成长）：移动·负重·耐久·寻宝·招财·经验·抗性·冷却等机械便利，
   低~高阶皆可出，数值随品级档 n(1-15) 缩放、带上限。参考各游戏 QoL/magic-find/move-speed 类词条。 */
const UTILITY_GEMS: GemDef[] = [
  { attr: '移动速度', slot: '防具', flavor: '疾风', cat: '功能', gen: (n, r) => `移动速度+${Math.min(40, rint(r, 3 + n, 5 + n * 2))}%` },
  { attr: '负重上限', slot: '通用', flavor: '扛山', cat: '功能', gen: (n, r) => `负重上限+${roundNice(rint(r, n * 12, n * 24))}（可携带更多）` },
  { attr: '耐久节省', slot: '通用', flavor: '恒久', cat: '功能', gen: (n, r) => `装备耐久消耗-${Math.min(60, rint(r, 8 + n * 2, 12 + n * 3))}%，偶尔自行修复少量耐久` },
  { attr: '魔法寻宝', slot: '饰品', flavor: '探宝', cat: '功能', gen: (n, r) => `稀有物品掉落率+${Math.min(50, rint(r, 5 + n * 2, 8 + n * 3))}%` },
  { attr: '招财', slot: '饰品', flavor: '招财', cat: '功能', gen: (n, r) => `击杀/开箱掉落乐园币+${Math.min(90, rint(r, 6 + n * 3, 10 + n * 4))}%` },
  { attr: '历练', slot: '饰品', flavor: '顿悟', cat: '功能', gen: (n, r) => `获得经验/历练值+${Math.min(35, rint(r, 4 + n, 6 + n * 2))}%` },
  { attr: '全抗性', slot: '防具', flavor: '调和', cat: '功能', gen: (n, r) => `火/冰/雷/毒抗性各+${Math.min(45, rint(r, 5 + n * 2, 7 + n * 2))}%` },
  { attr: '冷却缩减', slot: '通用', flavor: '轮转', cat: '功能', gen: (n, r) => `技能冷却缩减${Math.min(35, rint(r, 4 + n, 6 + n * 2))}%` },
  { attr: '脱战回复', slot: '防具', flavor: '休复', cat: '功能', gen: (n, r) => `脱离战斗后生命/法力回复速度+${Math.min(120, rint(r, 15 + n * 5, 25 + n * 8))}%` },
  { attr: '自动拾取', slot: '通用', flavor: '集纳', cat: '功能', gen: (n) => `自动拾取范围+${Math.min(8, 1 + Math.floor(n / 2))}米，掉落物更快入包` },
];

/* 生活类（采集/生产/社交/生存·"生活技能"向）：采矿·采集·垂钓·匠艺·探脉·庖厨·交涉·社交·御兽·环境。 */
const LIFE_GEMS: GemDef[] = [
  { attr: '采掘', slot: '通用', flavor: '裂岩', cat: '生活', gen: (n, r) => `采矿/采掘速度+${Math.min(60, rint(r, 6 + n * 2, 10 + n * 3))}%，矿石产量+${Math.min(40, rint(r, 4 + n, 6 + n * 2))}%` },
  { attr: '采集', slot: '通用', flavor: '丰收', cat: '生活', gen: (n, r) => `采药/伐木/采集产出+${Math.min(50, rint(r, 5 + n * 2, 8 + n * 2))}%，偶得额外稀有材料` },
  { attr: '垂钓', slot: '通用', flavor: '渔获', cat: '生活', gen: (n, r) => `垂钓效率+${Math.min(50, rint(r, 5 + n * 2, 8 + n * 2))}%，稀有鱼种上钩几率提升` },
  { attr: '匠艺', slot: '通用', flavor: '巧匠', cat: '生活', gen: (n, r) => `制作/锻造成功率与成品品质提升（精良率+${Math.min(40, rint(r, 4 + n, 6 + n * 2))}%）` },
  { attr: '探脉', slot: '饰品', flavor: '寻脉', cat: '生活', gen: (n, r) => `自动感知周围${Math.min(60, rint(r, 10 + n * 3, 15 + n * 4))}米内的矿脉/资源/采集点` },
  { attr: '庖厨', slot: '通用', flavor: '飨食', cat: '生活', gen: (n, r) => `烹饪/炼药所得增益的时长与强度+${Math.min(50, rint(r, 6 + n * 2, 10 + n * 2))}%` },
  { attr: '交涉', slot: '饰品', flavor: '巧舌', cat: '生活', gen: (n, r) => `商店买价-${Math.min(30, rint(r, 3 + n, 5 + n))}%、卖价+${Math.min(30, rint(r, 3 + n, 5 + n))}%` },
  { attr: '魅力社交', slot: '饰品', flavor: '倾城', cat: '生活', gen: (n, r) => `与 NPC 互动的好感增长+${Math.min(60, rint(r, 8 + n * 2, 12 + n * 3))}%，初见印象更佳` },
  { attr: '御兽', slot: '通用', flavor: '驭灵', cat: '生活', gen: (n, r) => `召唤物/宠物/随从属性+${Math.min(35, rint(r, 4 + n, 6 + n * 2))}%，更易驯服野生生物` },
  { attr: '环境适应', slot: '防具', flavor: '适存', cat: '生活', gen: (n, r) => `严寒/酷热/缺氧等环境减益减弱${Math.min(70, rint(r, 10 + n * 3, 16 + n * 4))}%，夜间视野清晰` },
];

const LOW_NOUNS = ['石', '原石', '晶石', '宝石'];
const HIGH_NOUNS = ['魔晶', '魂晶', '秘晶', '源石', '圣晶', '神石'];

export interface GeneratedGem {
  item: Omit<InventoryItem, 'id' | 'addedAt'>;
  price: number;
}

/** 宝石定价：随品级指数上涨（同品阶比普通装备更贵）；带第二条效果加价；±15% 浮动 */
export function gemPrice(num: number, secondary: boolean, rng: Rng = Math.random): number {
  return roundNice(150 * Math.pow(1.9, num) * (secondary ? 1.5 : 1) * (0.85 + rng() * 0.3));
}

/** 按需求挑一条属性定义：优先指定属性(锁定)，否则优先同部位，再否则全池随机 */
function pickDef(grade: string, rng: Rng, want?: { attr?: string; slot?: GemSlotKind }): GemDef {
  const base = gradeToNum(grade) >= GEM_HIGH_FROM ? HIGH_GEMS : LOW_GEMS;
  const pool = [...base, ...UTILITY_GEMS, ...LIFE_GEMS];   // 战斗 + 功能 + 生活 三类混合 → 商店更多元
  if (want?.attr) { const d = pool.find((g) => g.attr === want.attr); if (d) return d; }
  if (want?.slot) { const cands = pool.filter((g) => g.slot === want.slot || g.slot === '通用'); if (cands.length) return pick(rng, cands); }
  return pick(rng, pool);
}

/** 用一条属性定义烘焙出一颗宝石物品（数值在此定下，镶嵌只套用）*/
function buildGem(grade: string, def: GemDef, rng: Rng, forceSet?: GemSetDef): GeneratedGem {
  const n = gradeToNum(grade);
  const high = n >= GEM_HIGH_FROM;
  const cat = def.cat ?? '战斗';
  let stat = def.gen(n, rng);
  let secondary = false;
  // 高阶（史诗级+）**战斗类**有概率附带第二条同部位高阶战斗效果，更丰富（功能/生活类保持单一清晰效果）
  if (high && n >= 10 && cat === '战斗' && rng() < 0.38) {
    const cand = HIGH_GEMS.filter((g) => g.attr !== def.attr && (g.slot === def.slot || g.slot === '通用' || def.slot === '通用'));
    if (cand.length) { stat += `；${pick(rng, cand).gen(n, rng)}`; secondary = true; }
  }
  const noun = pick(rng, high ? HIGH_NOUNS : LOW_NOUNS);
  const slotLabel = def.slot === '通用' ? '任意装备' : `仅${def.slot}`;
  const tierLabel = cat === '战斗' ? (high ? '高阶战斗属性' : '基础面板加成') : `${cat}类`;
  const sets = useGemSets.getState().sets;                 // 按玩家当前套装定义归属（非写死）
  // forceSet：强制归入指定套装——治「AI/自定义套装 members 与内置重叠时，setForGem 的"首个匹配"总把宝石判给内置套装 → AI 套装永远刷不出」。
  const setKey = forceSet ? forceSet.key : setForGem(def.attr, sets);
  const setLabel = forceSet ? forceSet.name : gemSetName(setKey, sets);
  return {
    item: {
      name: `${grade}·${def.flavor}${noun}`,
      category: '宝石',
      gradeDesc: grade,
      gemSlot: def.slot,
      gemAttr: def.attr,
      gemSet: setKey || undefined,
      effect: stat,
      quantity: 1,
      equipped: false,
      tags: ['宝石', high ? '高阶' : '基础', `${cat}类`, ...(setLabel ? [`套装·${setLabel}`] : [])],
      subType: high ? '高阶宝石' : '基础宝石',
      intro: `${cat}类宝石 · ${slotLabel}镶嵌 · ${def.attr}${setLabel ? ` · 套装【${setLabel}】` : ''}`,
      acquisition: '宝石商店',
      score: `${grade}（${tierLabel}）`,
    },
    price: gemPrice(n, secondary, rng),
  };
}

/** 生成一颗指定品级的宝石（数值在此烘焙，之后镶嵌只套用）；want 可指定属性/部位（无匹配则走随机）*/
export function generateGem(grade: string, rng: Rng = Math.random, want?: { attr?: string; slot?: GemSlotKind }): GeneratedGem {
  return buildGem(grade, pickDef(grade, rng, want), rng);
}

/* 洗牌（Fisher-Yates·就地）：让商店里"套装保底宝石"不总排在最前 */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/* 为"自造词 member"（AI 没从属性池取词）兜底一个 GemDef：**本身无面板数值**（绝不凭空造数值），只作套装计数用——套装真正的加成来自各档 tiers。 */
function customMemberDef(member: string): GemDef {
  const f = member.replace(/[+\d%·、，,\s]/g, '').slice(0, 4) || '奇珍';
  return { attr: member, slot: '通用', cat: '功能', flavor: f, gen: () => '契合本套装（自身无独立面板数值，靠集齐激活套装档加成生效）' };
}

/** 产出一颗**必定归属指定套装**的宝石：优先用能对上属性池的 member（带正经效果），对不上则用自造词兜底。 */
export function generateSetGem(grade: string, set: GemSetDef, rng: Rng = Math.random): GeneratedGem | null {
  const members = (set.members ?? []).map((m) => String(m).trim()).filter(Boolean);
  if (!members.length) return null;
  const base = gradeToNum(grade) >= GEM_HIGH_FROM ? HIGH_GEMS : LOW_GEMS;
  const pool = [...base, ...UTILITY_GEMS, ...LIFE_GEMS];
  const matched = members.map((m) => pool.find((d) => d.attr === m)).filter((d): d is GemDef => !!d);
  const def = matched.length ? pick(rng, matched) : customMemberDef(pick(rng, members));
  return buildGem(grade, def, rng, set);   // forceSet=set → 一定归入本套装
}

/** 刷新一批商店宝石（同品级）——**每个已定义套装（含 AI/自定义）保底各出 1 颗归属它的宝石**，其余随机，最后打乱。
    治"AI 生成的套装怎么也刷不出来"：随机池抽不到 + setForGem 首个匹配会把与内置重叠的 member 判给内置套装。
    AI/自定义套装优先占保底槽（内置套装本就易随机刷到）；至少保留 2 个纯随机槽。 */
export function generateGemShop(grade: string, count = 8, rng: Rng = Math.random): GeneratedGem[] {
  const sets = useGemSets.getState().sets ?? [];
  const out: GeneratedGem[] = [];
  const order = [...shuffle(sets.filter((s) => !s.builtin), rng), ...shuffle(sets.filter((s) => s.builtin), rng)];
  const reserve = Math.max(0, Math.min(count - 2, order.length));
  for (let i = 0; i < reserve; i++) { const g = generateSetGem(grade, order[i], rng); if (g) out.push(g); }
  while (out.length < count) out.push(generateGem(grade, rng));
  return shuffle(out, rng);
}

/* ───── 宝石合成「赌狗深渊」：3 颗同品级 → 1 颗高一阶 ───── */

/** 下一品级（合成产物品级）；已是最高则原级 */
export function nextGrade(grade: string): string {
  const i = ITEM_GRADES.indexOf(grade as any);
  return i >= 0 && i < ITEM_GRADES.length - 1 ? ITEM_GRADES[i + 1] : grade;
}
/** 宝石融合稳定剂价（按输入品级，略高于一颗同级宝石）*/
export function stabilizerCost(tier: string): number {
  return roundNice(150 * Math.pow(1.9, gradeToNum(tier)) * 1.2);
}

export interface SynthResult {
  gem: GeneratedGem;   // 产出宝石（高一阶）
  outputTier: string;
  locked: boolean;     // 属性是否锁定（三同属 或 用了稳定剂）
  mutated: boolean;    // 随机突变（未锁定 → 属性随机，可能产出毫不相干的废属性）
}
/** 合成 3 颗同品级宝石 → 1 颗高一阶。三颗同属性 或 投入稳定剂 → 锁定该属性方向；否则随机突变。 */
export function synthesizeGem(
  inputs: { gradeDesc: string; gemAttr?: string; gemSlot?: GemSlotKind }[],
  useStabilizer: boolean,
  rng: Rng = Math.random,
): SynthResult {
  const tier = inputs[0]?.gradeDesc ?? '白色';
  const outputTier = nextGrade(tier);
  const sameAttr = inputs.length === 3 && inputs.every((g) => g.gemAttr && g.gemAttr === inputs[0].gemAttr);
  const locked = sameAttr || useStabilizer;
  const want = locked ? { attr: inputs[0]?.gemAttr, slot: inputs[0]?.gemSlot } : undefined;
  const gem = buildGem(outputTier, pickDef(outputTier, rng, want), rng);
  gem.item.acquisition = '宝石合成';
  return { gem, outputTier, locked, mutated: !locked };
}

/** 从背包宝石物品烘焙出镶嵌快照（数值照搬，不重算）*/
export function gemFromItem(item: InventoryItem): SocketedGem {
  return {
    gemId: item.id,
    name: item.name,
    tier: item.gradeDesc,
    slot: item.gemSlot ?? '通用',
    attr: item.gemAttr ?? item.name,
    statText: item.effect ?? '',
    high: isHighGem(item.gradeDesc),
    set: item.gemSet || setForGem(item.gemAttr, useGemSets.getState().sets) || undefined,   // 旧宝石无 gemSet 则按当前套装定义回填
  };
}

/** 把已镶嵌宝石快照还原成可放回背包的宝石物品（无损剥离用）*/
export function itemFromGem(g: SocketedGem): Omit<InventoryItem, 'id' | 'addedAt'> {
  const sets = useGemSets.getState().sets;
  const setKey = g.set || setForGem(g.attr, sets);
  const setLabel = gemSetName(setKey, sets);
  return {
    name: g.name, category: '宝石', gradeDesc: g.tier,
    gemSlot: g.slot, gemAttr: g.attr, gemSet: setKey || undefined, effect: g.statText,
    quantity: 1, equipped: false, tags: ['宝石', g.high ? '高阶' : '基础', ...(setLabel ? [`套装·${setLabel}`] : [])],
    subType: g.high ? '高阶宝石' : '基础宝石',
    intro: `${g.high ? '高阶' : '基础'}宝石 · ${g.slot === '通用' ? '任意装备' : '仅' + g.slot}镶嵌 · ${g.attr}${setLabel ? ` · 套装【${setLabel}】` : ''}`,
    acquisition: '无损剥离',
    score: `${g.tier}（${g.high ? '高阶战斗属性' : '基础面板加成'}）`,
  };
}

/** 部位限制校验：宝石能否镶进该大类装备 */
export function gemFitsSlot(equipCategory: string, gemSlot?: GemSlotKind): boolean {
  if (!gemSlot || gemSlot === '通用') return true;
  return equipCategory === gemSlot;
}

/* ───── 宝石加成 → 装备 effect（镶嵌即改 effect，effect 再经 attrBonus/生物强度/AI 注入传给人物）───── */

const GEM_EFFECT_RE = /\s*【镶嵌加成：[^】]*】/gu;
/** 去掉 effect 里由镶嵌系统维护的【镶嵌加成：…】块，拿回基础 effect */
export function stripGemEffect(effect?: string): string {
  return String(effect ?? '').replace(GEM_EFFECT_RE, '').replace(/\s{2,}/g, ' ').trim();
}
/** 按当前镶嵌宝石重算 effect：剥掉旧的【镶嵌加成】块 → 追加由 gems 汇总的新块（幂等）。
 *  低阶面板加成（"力量+8"）经此进入 effect → effectiveAttrs 解析进六维；高阶描述随 effect 供战斗/AI 读取。 */
export function applyGemsToEffect(effect: string | undefined, gems: SocketedGem[]): string {
  const base = stripGemEffect(effect);
  const list = (gems ?? []).map((g) => g.statText).filter(Boolean);
  if (!list.length) return base;
  const note = `【镶嵌加成：${list.join('；')}】`;
  return base ? `${base} ${note}` : note;
}

/* ───── 打孔（打孔石扩孔，随孔位升价/降率，受 MAX_SOCKETS 上限约束）───── */

/** 当前孔位 → 再加 1 孔需要的乐园币（打孔石，逐孔指数上涨）*/
export function drillCost(currentSockets: number): number {
  return roundNice(8000 * Math.pow(2.2, currentSockets));
}
/** 打孔成功率（孔位越多越难，最低 25%）*/
export function drillRate(currentSockets: number): number {
  return Math.max(0.25, 0.9 - currentSockets * 0.12);
}

/* ───── 自定义宝石（玩家手动打造 / AI 按提示词生成）───── */

export interface CustomGemFields {
  name?: string;
  grade: string;
  slot: GemSlotKind;
  attr: string;        // 归属关键词（决定归入哪个套装 · setForGem）
  effect: string;      // 加成文本（六维/暴击等 token → 生效；其余风味）
  setKey?: string;     // 显式指定归属套装（留空按 attr 匹配 members）
}

/** 用玩家/AI 给的字段确定性打造一颗宝石物品（保证带 gemAttr + gemSet + effect，套装必能识别、加成必生效）。 */
export function makeCustomGem(fields: CustomGemFields): Omit<InventoryItem, 'id' | 'addedAt'> {
  const grade = ITEM_GRADES.includes(fields.grade as any) ? fields.grade : '紫色';
  const slot: GemSlotKind = GEM_SLOTS.includes(fields.slot) ? fields.slot : '通用';
  const attr = String(fields.attr ?? '').trim() || '自定义';
  const effect = String(fields.effect ?? '').trim();
  const high = isHighGem(grade);
  const sets = useGemSets.getState().sets;
  const setKey = (fields.setKey && sets.some((s) => s.key === fields.setKey)) ? fields.setKey : setForGem(attr, sets);
  const setLabel = gemSetName(setKey, sets);
  const noun = high ? '魂晶' : '宝石';
  const name = String(fields.name ?? '').trim() || `${grade}·${attr}${noun}`;
  const slotLabel = slot === '通用' ? '任意装备' : `仅${slot}`;
  return {
    name, category: '宝石', gradeDesc: grade,
    gemSlot: slot, gemAttr: attr, gemSet: setKey || undefined,
    effect, quantity: 1, equipped: false,
    tags: ['宝石', high ? '高阶' : '基础', '自定义', ...(setLabel ? [`套装·${setLabel}`] : [])],
    subType: high ? '高阶宝石' : '基础宝石',
    intro: `自定义宝石 · ${slotLabel}镶嵌 · ${attr}${setLabel ? ` · 套装【${setLabel}】` : ''}`,
    acquisition: '自定义',
    score: `${grade}（自定义）`,
  };
}

/** AI 按提示词生成宝石的系统提示词。 */
export const GEM_GEN_PROMPT = [
  '你是「轮回乐园」宝石工匠。请按玩家要求设计**宝石**，只输出 JSON 数组（1~N 颗，无解说、无 markdown 代码块）。每颗字段：',
  '- name：宝石名（可留空，自动命名）',
  '- slot：镶嵌部位，「武器/防具/饰品/通用」之一',
  '- attr：归属关键词（决定归入哪个套装；从属性池选或自拟一个短词）',
  '- effect：加成文本。**务必用可识别 token 才真正生效**：六维 力量+N/敏捷+N/体质+N/智力+N/魅力+N/幸运+N；战斗 暴击率+N% / 暴击伤害+N% / 穿透N% / 减伤N% / 造成伤害+N% / 冷却缩减N回合 / 额外N段；其余当风味。',
  '- grade：品级名（可留空用默认）：白色/绿色/蓝色/紫色/暗紫色/淡金/金色/暗金/传说级/史诗级/圣灵级/不朽级/起源/永恒/创世',
  '【属性池（attr 取材）】：力量/敏捷/体质/智力/魅力/幸运/基础攻击/基础防御/生命/法力/武器锋利度/无视防御/护甲穿透/真实伤害/灵魂伤害/生命吸取/暴击率/暴击伤害/烈焰附魔/霜寒附魔/惊雷附魔/伤害减免/格挡/荆棘反伤/真实防御/坚韧抗控/急速/会心一击/移动速度/招财/魔法寻宝/历练/全抗性/冷却缩减/采掘/采集/垂钓/匠艺/交涉/御兽。',
  '【数值参考·勿膨胀】：基础档六维≤15、暴击率≤10%；高阶档 破甲/穿透≤30%、暴伤≤40%、造成伤害≤25%。',
  '示例：[{"name":"赤蛟之瞳","slot":"武器","attr":"暴击率","effect":"暴击率+12%，暴击伤害+20%","grade":"史诗级"}]',
].join('\n');

/** 解析 AI 输出为若干宝石物品（gradeFallback = 玩家选的品级；确保带 gemAttr/gemSet/effect）。 */
export function parseGeneratedGems(text: string, gradeFallback = '紫色'): Omit<InventoryItem, 'id' | 'addedAt'>[] {
  const j = looseJson(text);
  if (!j) return [];
  const arr = Array.isArray(j) ? j : [j];
  const out: Omit<InventoryItem, 'id' | 'addedAt'>[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const attr = String(r.attr ?? r.gemAttr ?? '').trim();
    const effect = String(r.effect ?? r.stat ?? '').trim();
    if (!attr && !effect) continue;
    const slotRaw = String(r.slot ?? r.gemSlot ?? '通用').trim();
    const slot = (GEM_SLOTS as string[]).includes(slotRaw) ? (slotRaw as GemSlotKind) : '通用';
    const gradeCand = String(r.grade ?? r.gradeDesc ?? '').trim();
    const grade = ITEM_GRADES.includes(gradeCand as any) ? gradeCand : gradeFallback;
    out.push(makeCustomGem({ name: String(r.name ?? ''), grade, slot, attr: attr || '自定义', effect, setKey: String(r.setKey ?? '') || undefined }));
    if (out.length >= 8) break;
  }
  return out;
}
