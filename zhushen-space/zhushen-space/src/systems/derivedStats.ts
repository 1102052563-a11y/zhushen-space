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
   六维按「本阶口径」存储（一~三阶=普通属性≤99；四阶起经觉醒=真实属性 150–8000，见 ATTR_CAP_BY_TIER），
   HP=体×20 / EP=智×15 直接作用于六维，自动随阶位线性缩放。 */
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

/* 从效果/词缀文本里解析"增加 HP/EP 最大值"的平值加成。供 最大HP/EP = 六维换算 + 此加成。
   两档识别：
   ① 严谨档(strict)：明写"上限/最大值"（如「生命值上限+100」「最大生命+100」「增加100点生命上限」），高置信。
   ② 宽松档(lenient)：未写"上限"但显然是「加生命/HP」的被动/天赋/词缀——
      「生命值+5000」「HP +500」「增加2000点生命」也计入最大值（用户/AI 常这样写，旧版一律漏算→天赋叠不上血）。
   排除非"上限"语义：回复/恢复/治疗(瞬时回血)、伤害/损伤(伤害公式)、消耗/扣除(代价)、百分比(走 pct 函数)。
   去重按「字符区间是否重叠」：strict 先跑占住区间，lenient 落在剩余区间，避免「最大生命+5000」被两档各算一次。 */
function vitalMaxBonus(texts: (string | undefined)[], kind: 'hp' | 'ep'): number {
  const names = kind === 'hp' ? '生命|HP|血量|气血|体力|血量值' : '蓝量|EP|法力|魔力|能量|精力|内力|蓝';
  const strict = [
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*(?:增加|提升|提高|额外|附加|为)?\\s*[:：]?\\s*[+＋]?\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
    new RegExp(`最大\\s*(?:${names})(?:值)?\\s*[:：]?\\s*[+＋]?\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
    new RegExp(`(?:增加|提升|提高|额外|附加)\\s*(\\d+)(?![\\d])(?!\\s*[%％])\\s*点?\\s*(?:${names})(?:值)?\\s*(?:上限|最大值)`, 'gi'),
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*(?:增加|提升|提高)\\s*(\\d+)(?![\\d])(?!\\s*[%％])`, 'gi'),
  ];
  const lenient = [
    // 「生命值+5000」「HP +500」「气血：+3000」（显式加号）——排除「+5000点伤害」等伤害公式
    new RegExp(`(?:${names})(?:值)?\\s*[:：]?\\s*[+＋]\\s*(\\d+)(?![\\d])(?!\\s*[%％])(?!\\s*点?\\s*(?:伤害|损伤|减伤|穿透))`, 'gi'),
    // 「增加2000点生命」「永久提升5000生命」（增益动词在前·不含回复/恢复/治疗等瞬回词）——排除尾随 上限(归严谨档)/伤害/回复
    new RegExp(`(?:增加|提升|提高|增益|增幅|额外|附加|永久增加|永久提升|强化|赋予|获得)\\s*(\\d+)(?![\\d])(?!\\s*[%％])\\s*点?\\s*(?:${names})(?:值)?(?!\\s*(?:上限|最大值|回复|恢复|再生|伤害))`, 'gi'),
    // 「+2000生命」「+500点 HP」（加号·数字在前·名词在后）——尾随 上限/伤害/回复 等非加成语义排除
    new RegExp(`[+＋]\\s*(\\d+)(?![\\d])(?!\\s*[%％])\\s*点?\\s*(?:${names})(?:值)?(?!\\s*(?:上限|最大值|回复|恢复|再生|伤害|损伤))`, 'gi'),
  ];
  let sum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const t = String(raw);
    const ranges: [number, number][] = [];   // 已计入的字符区间，防 strict/lenient 重叠重复计数
    const run = (re: RegExp) => {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(t)) !== null) {
        const s = m.index, e = m.index + m[0].length;
        if (ranges.some(([rs, re2]) => s < re2 && e > rs)) continue;   // 与已计区间重叠 → 跳过
        ranges.push([s, e]);
        sum += Number(m[1]);
      }
    };
    for (const re of strict) run(re);    // 先占「上限」类高置信区间
    for (const re of lenient) run(re);   // 再补未写上限的「+N生命」类
  }
  return sum;
}
/* 已装备物品对 最大HP / 最大EP 的上限加成合计（装备效果/词缀里写明"X上限"的部分）*/
export function gearMaxHpBonus(equipped: { effect?: string; affix?: string; combatStat?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix, it.combatStat], 'hp'), 0);
}
export function gearMaxEpBonus(equipped: { effect?: string; affix?: string; combatStat?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix, it.combatStat], 'ep'), 0);
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
export function gearMaxHpPctBonus(equipped: { effect?: string; affix?: string; combatStat?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus([it.effect, it.affix, it.combatStat], 'hp'), 0);
}
export function gearMaxEpPctBonus(equipped: { effect?: string; affix?: string; combatStat?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus([it.effect, it.affix, it.combatStat], 'ep'), 0);
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
  // 需出现「增益动词」(提升/=/为…)以区分加成与伤害公式(如「生命与法力之和X%伤害」不算)。
  // 全角逗号「，」纳入断句字符，配合「每条文本只取首个百分比」避免阶梯式「初始30%，突破45%，最终100%」被累加。
  const verb = '(?:提升|提高|增加|增幅|加成|额外|提供|转化|=|＝|为|等于|达到?)';
  const pat = kind === 'hp'
    ? '(?:生命|HP|血量|气血|体力)[^。；，,\\n]{0,6}?' + verb + '[^。；，,\\n]{0,14}?(?:最大\\s*)?(?:法力|魔力|蓝量|能量|内力|精力)(?:值)?[^。；，,\\n]{0,16}?(\\d+(?:\\.\\d+)?)\\s*[%％]'
    : '(?:法力|魔力|蓝量|能量|内力|精力)[^。；，,\\n]{0,6}?' + verb + '[^。；，,\\n]{0,14}?(?:最大\\s*)?(?:生命|HP|血量|气血|体力)(?:值)?[^。；，,\\n]{0,16}?(\\d+(?:\\.\\d+)?)\\s*[%％]';
  let pctSum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const m = new RegExp(pat, 'i').exec(String(raw)); // 每条文本仅取首个百分比(阶梯值取初始)
    if (m) pctSum += Number(m[1]);
  }
  return Math.round((pctSum / 100) * (otherMax || 0));
}
function crossTexts(equipped: { effect?: string; affix?: string; combatStat?: string }[], skills: AbilityLite[], traits: AbilityLite[]): (string | undefined)[] {
  return [
    ...skills.flatMap((s) => [s.effect, s.desc]),
    ...traits.flatMap((t) => [t.effect, t.desc]),
    ...equipped.flatMap((e) => [e.effect, e.affix, e.combatStat]),
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
   一阶 Lv.1-10 … 九阶 Lv.81-90 / 绝强 91-100 / 巅峰绝强 101-110 / 至强 111-130 / 巅峰至强 131-150 / 无上之境 151+ */
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
  if (lv <= 110) return '巅峰绝强';
  if (lv <= 130) return '至强';
  if (lv <= 150) return '巅峰至强';
  return '无上之境';
}

/* 真实属性·÷80 折算（旧口径·保留为内部因子）：floor(值/80)。
   注：2026-06-24 重置后，四阶起「六维数值本身即真实属性」(见 ATTR_CAP_BY_TIER)，÷80 不再是主显示口径；
   本函数仅供 ① 战斗高阶碾压因子(combatEngine trueScore) ② 旧真实属性分配面板/觉醒里程碑 内部使用。 */
export function trueAttr(value: number): number {
  return Math.floor(Math.max(0, value || 0) / 80);
}
export function trueAttrs<T extends Record<string, number>>(attrs: T): T {
  const out = {} as Record<string, number>;
  for (const k of Object.keys(attrs)) out[k] = trueAttr(attrs[k]);
  return out as T;
}

/* 合法阶位枚举（轮回乐园），由低到高。阶位字段只允许这些值。 */
export const TIERS = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶', '绝强', '巅峰绝强', '至强', '巅峰至强', '无上之境'] as const;

/* 把 AI 写的任意阶位字符串规范化成合法阶位名（如 "三阶中期"→"三阶"、"结丹"→""）。
   取不到合法阶位时返回 ''（调用方可回退到按等级推导 realmFromLevel）。多字阶位优先匹配。 */
export function normalizeTier(raw?: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  for (const t of ['巅峰至强', '巅峰绝强', '无上之境', '至强', '绝强', '九阶', '八阶', '七阶', '六阶', '五阶', '四阶', '三阶', '二阶', '一阶']) {
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
  if (i <= 10) return 'tier-fx tier-fx-4'; // 绝强 / 巅峰绝强 金辉光环
  if (i === 11) return 'tier-fx tier-fx-5'; // 至强 紫电强光环
  if (i === 12) return 'tier-fx tier-fx-6'; // 巅峰至强 烈焰
  return 'tier-fx tier-fx-7';               // 无上之境 神性彩虹旋环
}

/* ── 各阶位「单个基础属性」单属性极值（仅约束基础六维；装备/技能/天赋加成可超过此上限）──
   重置版·百级真实属性口径（2026-06-24）：一~三阶为「普通属性」(50/80/99，99=普通绝对极限)；
   四阶起经「属性觉醒」转「真实属性」，六维数值本身即真实属性，连续爬升不再 ÷80：
   四阶150 / 五阶175 / 六阶200 / 七阶250 / 八阶300 / 九阶500 / 绝强1000 / 巅峰绝强2500 / 至强4000 / 巅峰至强8000。
   无上之境=EX(无数值上限)，代码给巨大有限哨兵避免生成/钳制时产生 Infinity。
   HP=体质×20、EP=智力×15 直接作用于六维，故各阶 HP/EP 随单属性极值线性缩放（如巅峰至强 体8000→HP16万）。 */
export const ATTR_CAP_BY_TIER: Record<string, number> = {
  一阶: 50, 二阶: 80, 三阶: 99,
  四阶: 150, 五阶: 175, 六阶: 200, 七阶: 250, 八阶: 300,
  九阶: 500, 绝强: 1000, 巅峰绝强: 2500, 至强: 4000, 巅峰至强: 8000,
  无上之境: 999999999,  // 无上=EX：给巨大有限哨兵(≈10亿)，避免 Infinity 进生成/钳制逻辑
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

/* 真实属性·每项上限（旧 ÷80 分配面板专用·保留）：含「base 派生 floor(值/80) + 直加 realAttrs」的合计上限。
   仅五阶起生效（一~四阶返回 Infinity 不设限）。= 该阶单属性极值的 ÷80 折算 × 档位倍率（五阶起 ×2/×4/…每阶 +2）。
   注：主口径「四阶起六维即真实属性」走 ATTR_CAP_BY_TIER；此函数只服务旧真实属性点分配 UI，不影响主显示。 */
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
