import type { PlayerAttrs } from '../store/playerStore';
import { effectiveAttrs } from './attrBonus';

/* 衍生属性（主角与 NPC 共用）：由六维 + 等级 + 已装备物品换算
   - 物理ATK：max(力,敏)主导 + 武器          - 物理DEF：体质 + 防具
   - 法术ATK：智力 + 装备                     - 法术DEF：智力(感知/精神) + 魅力 + 装备法抗
   公式系数可调；换装/升级/加点会让上层组件重新调用本函数 */
export interface EquipLite { category: string; grade: number }
export interface DerivedStats { patk: number; pdef: number; matk: number; mdef: number }

export function computeDerived(attrs: PlayerAttrs | undefined, level: number, equipped: EquipLite[]): DerivedStats {
  const a = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const lv = Math.max(1, level || 1);
  const eq = equipped.reduce((acc, it) => {
    const g = Math.max(1, it.grade);
    if (it.category === '武器') { acc.patk += g * 8; acc.matk += g * 4; }
    else if (it.category === '防具') { acc.pdef += g * 6; acc.mdef += g * 4; }
    else { acc.patk += g * 2; acc.pdef += g * 2; acc.matk += g * 2; acc.mdef += g * 2; } // 饰品/特殊/其他
    return acc;
  }, { patk: 0, pdef: 0, matk: 0, mdef: 0 });
  return {
    patk: Math.round(Math.max(a.str, a.agi) * 3 + a.str * 1 + lv * 2 + eq.patk),
    pdef: Math.round(a.con * 3 + lv * 2 + eq.pdef),
    matk: Math.round(a.int * 3 + lv * 2 + eq.matk),
    mdef: Math.round(a.int * 1.6 + a.cha * 1.4 + lv * 2 + eq.mdef),
  };
}

/* ── 生命 HP / 蓝量 EP 上限换算（主角与 NPC 共用，纯前端计算，AI 不写）──
   - 生命 HP 上限 = 体质(con) × 20
   - 蓝量 EP 上限 = 智力(int) × 15
   六维按「普通属性」存储；真实属性（每 80 普通 = 1 真实，见 trueAttr）只是显示折算，
   故公式直接作用于存储的普通值即可自动适配后期：1 点真实体力(=80 普通) → 1600 HP。 */
export const HP_PER_CON = 20;
export const EP_PER_INT = 15;
export function computeMaxHp(attrs?: PlayerAttrs): number {
  const con = Math.max(0, attrs?.con ?? 5);
  return Math.round(con * HP_PER_CON);
}
export function computeMaxEp(attrs?: PlayerAttrs): number {
  const intel = Math.max(0, attrs?.int ?? 5);
  return Math.round(intel * EP_PER_INT);
}

/* 从装备的效果/词缀文本里解析"增加 HP/EP 上限"的加成——只有**明确写到"上限/最大值"**的装备效果才计入最大值，
   "回复X生命""每秒恢复X"等只是当前值变化，不计入上限。供 最大HP/EP = 六维换算 + 装备上限加成。 */
function vitalMaxBonus(texts: (string | undefined)[], kind: 'hp' | 'ep'): number {
  const names = kind === 'hp' ? '生命|HP|血量|气血|体力|血量值' : '蓝量|EP|法力|魔力|能量|精力|内力|蓝';
  const res = [
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*(?:增加|提升|提高|额外|附加|为)?\\s*[:：]?\\s*[+＋]?\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
    new RegExp(`最大\\s*(?:${names})(?:值)?\\s*[:：]?\\s*[+＋]?\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
    new RegExp(`(?:增加|提升|提高|额外|附加)\\s*(\\d+)(?![\\d])(?!\\s*[%％])\\s*点?\\s*(?:${names})(?:值)?\\s*(?:上限|最大值)`, 'gi'),
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*(?:增加|提升|提高)\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
  ];
  let sum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const t = String(raw);
    const seen = new Set<number>();
    for (const re of res) { let m: RegExpExecArray | null; while ((m = re.exec(t)) !== null) { if (!seen.has(m.index)) { seen.add(m.index); sum += Number(m[1]); } } }
  }
  return sum;
}
/* 已装备物品对 最大HP / 最大EP 的上限加成合计（装备效果/词缀里写明"X上限"的部分）*/
export function gearMaxHpBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix], 'hp'), 0);
}
export function gearMaxEpBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix], 'ep'), 0);
}
/* 技能/天赋（被动）effect/desc 文本里写明的「X上限+N」加成合计——
   如被动「初级病毒适应：生命值上限额外+100」会让最大 HP 在六维换算之外再 +100。*/
type AbilityLite = { effect?: string; desc?: string };
export function abilityMaxHpBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return vitalMaxBonus([...skills.flatMap((s) => [s.effect, s.desc]), ...traits.flatMap((t) => [t.effect, t.desc])], 'hp');
}
export function abilityMaxEpBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return vitalMaxBonus([...skills.flatMap((s) => [s.effect, s.desc]), ...traits.flatMap((t) => [t.effect, t.desc])], 'ep');
}

/* 解析「百分比上限加成」（如「10%生命加成」「生命上限+10%」「生命值提升15%」「最大法力提高10%」）——
   返回百分数之和（10 = +10%）。百分比作用于「六维换算 + 平值上限加成」之上：最终上限 = 平值上限 ×(1+∑%/100)。
   只匹配 [生命/HP 名词] 紧邻 [上限/最大值/加成/增益/提升] 语义的百分比，避免把「造成10%生命值伤害」「8%独立减伤」「恢复10%生命」等误计。
   以百分比子串在原文中的位置去重，防止「提升10%生命上限」被前/后两种写法重复累加。 */
function vitalMaxPctBonus(texts: (string | undefined)[], kind: 'hp' | 'ep'): number {
  const names = kind === 'hp' ? '生命|HP|血量|气血|体力|血量值' : '蓝量|EP|法力|魔力|能量|精力|内力|蓝';
  // 分支A：百分比在名词【之前】(10%生命加成 / 10%最大生命上限)；分支B：百分比在名词【之后】(生命上限+10% / 生命提升10%)
  const re = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*[%％]\\s*(?:的)?\\s*(?:最大\\s*)?(?:${names})(?:值)?\\s*(?:上限|最大值|加成|增益|提升)` +
    `|(?:最大\\s*)?(?:${names})(?:值)?\\s*(?:上限|最大值|加成|增益)?\\s*(?:增加|提升|提高|额外|附加|为|\\+|＋)\\s*了?\\s*(\\d+(?:\\.\\d+)?)\\s*[%％]`,
    'gi',
  );
  let sum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const t = String(raw);
    const seen = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const val = m[1] ?? m[2];
      if (val == null) continue;
      const pctIdx = m.index + Math.max(m[0].lastIndexOf('%'), m[0].lastIndexOf('％'));
      if (seen.has(pctIdx)) continue;
      seen.add(pctIdx);
      sum += Number(val);
    }
  }
  return sum;
}
export function gearMaxHpPctBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus([it.effect, it.affix], 'hp'), 0);
}
export function gearMaxEpPctBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus([it.effect, it.affix], 'ep'), 0);
}
export function abilityMaxHpPctBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return vitalMaxPctBonus([...skills.flatMap((s) => [s.effect, s.desc]), ...traits.flatMap((t) => [t.effect, t.desc])], 'hp');
}
export function abilityMaxEpPctBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return vitalMaxPctBonus([...skills.flatMap((s) => [s.effect, s.desc]), ...traits.flatMap((t) => [t.effect, t.desc])], 'ep');
}

/* 「基础真实上限」(不含跨资源公式) = (六维换算 + 装备/被动平值上限加成) ×(1 + 百分比加成)。 */
function baseMaxHp(attrs?: PlayerAttrs, equipped: { effect?: string; affix?: string }[] = [], skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  const eff = effectiveAttrs(attrs, skills as any, traits as any, equipped as any);   // 六维加成(如体质+1)折进六维，再 体质×20
  const flat = computeMaxHp(eff) + gearMaxHpBonus(equipped) + abilityMaxHpBonus(skills, traits);
  const pct = gearMaxHpPctBonus(equipped) + abilityMaxHpPctBonus(skills, traits);
  return Math.round(flat * (1 + pct / 100));
}
function baseMaxEp(attrs?: PlayerAttrs, equipped: { effect?: string; affix?: string }[] = [], skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  const eff = effectiveAttrs(attrs, skills as any, traits as any, equipped as any);
  const flat = computeMaxEp(eff) + gearMaxEpBonus(equipped) + abilityMaxEpBonus(skills, traits);
  const pct = gearMaxEpPctBonus(equipped) + abilityMaxEpPctBonus(skills, traits);
  return Math.round(flat * (1 + pct / 100));
}
/* 跨资源上限公式：如「生命值额外提升量=最大法力值的300%」→ HP += 300% × 最大EP（灵影体质类）。
   kind='hp' 解析「生命…最大法力…X%」用 EP 算；kind='ep' 反之。用 base 值算，避免 HP↔EP 循环。 */
function vitalCrossBonus(texts: (string | undefined)[], kind: 'hp' | 'ep', otherMax: number): number {
  const pat = kind === 'hp'
    ? '(?:生命|HP|血量|气血|体力)(?:值)?[^。；,\\n]{0,16}?最大\\s*(?:法力|魔力|蓝量|能量|内力|精力)(?:值)?[^。；,\\n]{0,8}?(\\d+(?:\\.\\d+)?)\\s*[%％]'
    : '(?:法力|魔力|蓝量|能量|内力|精力)(?:值)?[^。；,\\n]{0,16}?最大\\s*(?:生命|HP|血量|气血|体力)(?:值)?[^。；,\\n]{0,8}?(\\d+(?:\\.\\d+)?)\\s*[%％]';
  let pctSum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const re = new RegExp(pat, 'gi'); let m: RegExpExecArray | null;
    while ((m = re.exec(String(raw))) !== null) pctSum += Number(m[1]);
  }
  return Math.round((pctSum / 100) * (otherMax || 0));
}
function crossTexts(equipped: { effect?: string; affix?: string }[], skills: AbilityLite[], traits: AbilityLite[]): (string | undefined)[] {
  return [
    ...skills.flatMap((s) => [s.effect, s.desc]),
    ...traits.flatMap((t) => [t.effect, t.desc]),
    ...equipped.flatMap((e) => [e.effect, e.affix]),
  ];
}

/* 统一口径的「真实最大 HP / EP」（主角与 NPC 共用）= 基础上限 + 跨资源公式加成。
   各处显示/钳制/战斗/AI快照一律走这两个，确保一致；含百分比加成与「生命=最大法力X%」类跨资源公式。 */
export function fullMaxHp(
  attrs?: PlayerAttrs,
  equipped: { effect?: string; affix?: string }[] = [],
  skills: AbilityLite[] = [],
  traits: AbilityLite[] = [],
): number {
  return baseMaxHp(attrs, equipped, skills, traits)
    + vitalCrossBonus(crossTexts(equipped, skills, traits), 'hp', baseMaxEp(attrs, equipped, skills, traits));
}
export function fullMaxEp(
  attrs?: PlayerAttrs,
  equipped: { effect?: string; affix?: string }[] = [],
  skills: AbilityLite[] = [],
  traits: AbilityLite[] = [],
): number {
  return baseMaxEp(attrs, equipped, skills, traits)
    + vitalCrossBonus(crossTexts(equipped, skills, traits), 'ep', baseMaxHp(attrs, equipped, skills, traits));
}
/* 「当前值」显示：
   - 从未设过(undefined) → 视为满（= 当前上限），仅用于角色刚建档、还没发生任何增减时
   - 已有具体当前值 → **原样保留**，只夹到 [0, 上限] 内
   注意：**上限变大时绝不自动把当前值顶上去**（否则体质/智力一变，HP/EP 会"自己回血"）——
   当前值只应由正文驱动的 hp.<id>/mp.<id> 增减来改变。storedMax 参数已不再参与判断，保留仅为兼容调用签名。 */
export function effectiveResource(cur: number | undefined, _storedMax: number | undefined, derivedMax: number): number {
  if (cur == null) return derivedMax;
  return Math.min(Math.max(0, cur), derivedMax);
}

/* 从 realm 字符串（如 "一阶·Lv.8|身份"）提取 Lv 数字；取不到默认 1 */
export function lvFromRealm(realm?: string): number {
  const m = /Lv\.?\s*(\d+)/i.exec(realm ?? '');
  return m ? Number(m[1]) : 1;
}

/* 等级 → 阶位名（轮回乐园阶位表，与角色阶位体系一致）
   一阶 Lv.1-10 … 九阶 Lv.81-90 / 绝强 91-100 / 至强 101-120 / 巅峰至强 121-140 / 无上之境 140+ */
export function realmFromLevel(level: number): string {
  const lv = Math.max(1, Math.round(level || 1));
  if (lv <= 10) return '一阶';
  if (lv <= 20) return '二阶';
  if (lv <= 30) return '三阶';
  if (lv <= 40) return '四阶';
  if (lv <= 50) return '五阶';
  if (lv <= 60) return '六阶';
  if (lv <= 70) return '七阶';
  if (lv <= 80) return '八阶';
  if (lv <= 90) return '九阶';
  if (lv <= 100) return '绝强';
  if (lv <= 120) return '至强';
  if (lv <= 140) return '巅峰至强';
  return '无上之境';
}

/* 真实属性换算：每 80 点普通属性 = 1 点真实属性（floor(值/80)）。
   仅当属性 > 80 时才开始产生真实属性（80→1，160→2…，<80→0）。 */
export function trueAttr(value: number): number {
  return Math.floor(Math.max(0, value || 0) / 80);
}
export function trueAttrs<T extends Record<string, number>>(attrs: T): T {
  const out = {} as Record<string, number>;
  for (const k of Object.keys(attrs)) out[k] = trueAttr(attrs[k]);
  return out as T;
}

/* 合法阶位枚举（轮回乐园），由低到高。阶位字段只允许这些值。 */
export const TIERS = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶', '绝强', '至强', '巅峰至强', '无上之境'] as const;

/* 把 AI 写的任意阶位字符串规范化成合法阶位名（如 "三阶中期"→"三阶"、"结丹"→""）。
   取不到合法阶位时返回 ''（调用方可回退到按等级推导 realmFromLevel）。多字阶位优先匹配。 */
export function normalizeTier(raw?: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  for (const t of ['巅峰至强', '无上之境', '至强', '绝强', '九阶', '八阶', '七阶', '六阶', '五阶', '四阶', '三阶', '二阶', '一阶']) {
    if (s.includes(t)) return t;
  }
  return '';
}

/* 阶位 → 特效 class（越高阶越华丽，主角/NPC 通用；对应 index.css 的 .tier-fx*）。
   一阶起就有流光特效（最低档珠光微流·无光环），逐阶升级：翠光→青蓝→碧蓝呼吸→金辉光环→紫电→烈焰→神性彩虹旋环。 */
export function tierFxClass(tier?: string): string {
  const i = TIERS.indexOf(normalizeTier(tier) as typeof TIERS[number]);
  if (i < 0) return 'text-god';            // 认不出阶位 → 普通青光
  if (i <= 1) return 'tier-fx tier-fx-0';  // 一/二阶 珠光微流（入门也有特效）
  if (i <= 4) return 'tier-fx tier-fx-1';  // 三/四/五阶 翠光
  if (i <= 6) return 'tier-fx tier-fx-2';  // 六/七阶 青蓝
  if (i <= 8) return 'tier-fx tier-fx-3';  // 八/九阶 碧蓝流光呼吸
  if (i === 9) return 'tier-fx tier-fx-4';  // 绝强 金辉光环
  if (i === 10) return 'tier-fx tier-fx-5'; // 至强 紫电强光环
  if (i === 11) return 'tier-fx tier-fx-6'; // 巅峰至强 烈焰
  return 'tier-fx tier-fx-7';               // 无上之境 神性彩虹旋环
}

/* ── 各阶位「单个基础属性」上限（普通属性口径；仅约束基础六维；装备/技能/天赋加成可超过此上限）──
   一~四阶用普通属性：一阶5–50 / 二阶51–80 / 三阶81–120 / 四阶121–149。
   **五阶起改「真实属性点」口径（=普通属性÷80）、每阶 ×3 倍数级**——真实点上限 五阶4 / 六阶12 / 七阶36 /
   八阶108 / 九阶324；下表存的是其普通等值(真实×80)：五阶320 / 六阶960 / 七阶2880 / 八阶8640 / 九阶25920。
   **九阶以上（绝强/至强/巅峰至强/无上之境）跨度更大、每阶 ×10**：真实点 3240 / 32400 / 324000 / 3240000（普通×80）。
   HP=体质×20、EP=智力×15 仍按普通值算，故高阶数值随之倍数级膨胀。 */
export const ATTR_CAP_BY_TIER: Record<string, number> = {
  一阶: 50, 二阶: 80, 三阶: 120, 四阶: 149,
  五阶: 320, 六阶: 960, 七阶: 2880, 八阶: 8640, 九阶: 25920,
  绝强: 259200, 至强: 2592000, 巅峰至强: 25920000, 无上之境: 259200000,  // 九阶以上每阶 ×10(无上之境给有限巨值,避免生成 Infinity)
};
/* 取某阶位「单个基础属性」上限。阶位名与等级**取较高的一个上限**（避免阶位字段滞后于等级时把人误夹低）；
   两者都取不到返回 Infinity(不夹)。仅用于基础六维；有效属性(含装备/技能/天赋加成)不受此限。 */
export function attrCapForTier(tier?: string, level?: number): number {
  const tName = normalizeTier(tier);
  const tCap = tName ? (ATTR_CAP_BY_TIER[tName] ?? Infinity) : -Infinity;
  const lCap = level != null ? (ATTR_CAP_BY_TIER[realmFromLevel(level)] ?? Infinity) : -Infinity;
  const cap = Math.max(tCap, lCap);
  return cap === -Infinity ? Infinity : cap;
}

/* 真实属性·每项上限（含「base 派生 floor(值/80) + 直加 realAttrs」的合计）。
   仅五阶起生效（一~四阶真实属性≤1、无意义，返回 Infinity 不设限）。
   = 该阶基础属性上限的真实折算(attrCap/80) × 档位倍率；倍率自五阶起 ×2 / ×4 / ×6 / ×8 / ×10 …（每阶 +2）。
   例：五阶 4×2=8 / 六阶 12×4=48 / 七阶 36×6=216 / 八阶 108×8=864 / 九阶 324×10=3240。 */
export function realAttrCapForTier(tier?: string, level?: number): number {
  const tName = normalizeTier(tier) || (level != null ? realmFromLevel(level) : '');
  const idx = TIERS.indexOf(tName as typeof TIERS[number]);   // 0=一阶 … 4=五阶 …
  if (idx < 4) return Infinity;                                // 一~四阶不设真实属性上限
  const baseCap = ATTR_CAP_BY_TIER[tName] ?? Infinity;
  if (!isFinite(baseCap)) return Infinity;
  const mult = (idx - 3) * 2;                                  // 五阶(idx4)→2、六阶→4、七阶→6 …（每阶 +2）
  return Math.round(baseCap / 80 * mult);
}

/* 把基础六维整体夹进本阶上限（六维封顶护栏）。六维=力/敏/体/智/魅/幸的【基础值】；
   装备/技能/天赋加成另算、不受此限。取不到阶位上限(Infinity)时原样返回不夹。
   用于"照抄正文人物卡六维"等绕过短指令的入口，与短指令路径(statusCommands)同护栏。 */
export function clampBaseAttrs<T extends Record<string, number | undefined>>(attrs: T, tier?: string, level?: number): T {
  const cap = attrCapForTier(tier, level);
  if (!isFinite(cap)) return attrs;
  const out: Record<string, number | undefined> = { ...attrs };
  for (const k of ['str', 'agi', 'con', 'int', 'cha', 'luck'] as const) {
    if (typeof out[k] === 'number') out[k] = Math.min(cap, Math.max(0, out[k] as number));
  }
  return out as T;
}
