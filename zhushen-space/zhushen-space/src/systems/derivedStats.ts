import type { PlayerAttrs } from '../store/playerStore';
import { effectiveAttrs, withAttrDelta, ATTR_KEYS } from './attrBonus';

/* 衍生属性（主角与 NPC 共用）：由六维 + 等级 + 已装备物品换算
   - 物理ATK：max(力,敏)主导 + 武器          - 物理DEF：体质 + 防具
   - 法术ATK：智力 + 装备                     - 法术DEF：智力(感知/精神) + 魅力 + 装备法抗
   公式系数可调；换装/升级/加点会让上层组件重新调用本函数 */
export interface EquipLite { category: string; grade: number; combatStat?: string }
export interface DerivedStats { patk: number; pdef: number; matk: number; mdef: number }

/* 解析装备「攻防字段(combatStat)」里写明的实际攻防数值，折算成对衍生攻防的贡献。
   旧版只按品级估算(grade×N)，导致卡面写的「法术攻击力 60-135」等数值根本没加进主角法术攻击——本函数把它真正读出来。
   口径：
   - 类型判定按数值前的标签窗口：含 法/术/魔/奥 → 法术(matk/mdef)，否则物理(patk/pdef)；含 防御/护甲/抗 → 防御，否则攻击。
   - 数值：范围「a-b / a~b」取均值(期望伤害)四舍五入；单值原样。允许前导「+」(强化基础值)。
   识别不到任何数字 → 返回全 0（调用方回退到品级估算，保持旧装备兼容）。 */
export interface CombatStatDelta { patk: number; matk: number; pdef: number; mdef: number }
export function parseCombatStat(text?: string): CombatStatDelta {
  const out: CombatStatDelta = { patk: 0, matk: 0, pdef: 0, mdef: 0 };
  const t = String(text ?? '');
  if (!/\d/.test(t)) return out;
  const re = /(\d+)\s*(?:[-~～至]\s*(\d+))?/g;   // 单值或「下限-上限」范围
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(t)) !== null) {
    const lo = Number(m[1]);
    const hi = m[2] != null ? Number(m[2]) : lo;
    const val = Math.round((lo + hi) / 2);   // 范围取均值（期望攻防），单值即本身
    const ctx = t.slice(lastEnd, m.index);   // 本数值前的标签窗口（上个数值之后到此数值之前）
    lastEnd = re.lastIndex;
    const isMagic = /法|术|魔|奥/.test(ctx);
    const isDef = /防御|护甲|防护|抗性|法抗|魔抗|抗|防/.test(ctx);
    if (isDef) { if (isMagic) out.mdef += val; else out.pdef += val; }
    else { if (isMagic) out.matk += val; else out.patk += val; }
  }
  return out;
}

export function computeDerived(attrs: PlayerAttrs | undefined, level: number, equipped: EquipLite[]): DerivedStats {
  const a = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const lv = Math.max(1, level || 1);
  const eq = equipped.reduce((acc, it) => {
    const cs = parseCombatStat(it.combatStat);
    if (cs.patk || cs.matk || cs.pdef || cs.mdef) {
      // 卡面写明了攻防数值 → 以实际数值为准（所见即所得），不再按品级估算本件
      acc.patk += cs.patk; acc.matk += cs.matk; acc.pdef += cs.pdef; acc.mdef += cs.mdef;
      return acc;
    }
    const g = Math.max(1, it.grade);   // 无可识别攻防数值 → 回退按品级估算（兼容旧档/无攻防数值的装备）
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
   **多属性混合换算**：HP / EP 各自 = 六维的一张「自定义系数表」加权和，任何属性都能按自定义系数同时供给 HP 与 EP：
   - 生命 HP 上限 = Σ 六维[k] × hpRatio[k]      （默认只有 体质×20，其余 0）
   - 蓝量 EP 上限 = Σ 六维[k] × epRatio[k]      （默认只有 智力×15，其余 0）
   例：hpRatio={con:10,int:5} → HP = 体×10 + 智×5；epRatio={con:8} → EP = 体×8（给了表就以表为准，不再叠默认）。
   六维按「本阶口径」存储（一~三阶=普通属性≤99；四阶起经觉醒=真实属性 150–8000，见 ATTR_CAP_BY_TIER），
   系数直接作用于六维，自动随阶位线性缩放。
   **系数表可自定义**：主角存 PlayerProfile、NPC 存 NpcRecord 的 hpRatio/epRatio（缺省/空表回退默认 体×20 / 智×15），
   各 computeMaxHp/EP·fullMaxHp/EP 调用方用 ratioOf(profile|npc) 传入；realMult(四阶起×5)仍在系数之上叠乘。 */
export const HP_PER_CON = 20;
export const EP_PER_INT = 15;
export type AttrCoef = Partial<Record<keyof PlayerAttrs, number>>;   // {属性键: 每点系数}
export const DEFAULT_HP_RATIO: AttrCoef = Object.freeze({ con: HP_PER_CON });   // 默认 HP = 体×20
export const DEFAULT_EP_RATIO: AttrCoef = Object.freeze({ int: EP_PER_INT });   // 默认 EP = 智×15
export const ATTR_SHORT: Record<keyof PlayerAttrs, string> = { str: '力', agi: '敏', con: '体', int: '智', cha: '魅', luck: '幸' };   // 单字短名（公式/紧凑UI）
/* 「六维→HP/EP」自定义系数表（多属性混合换皮）。hp/ep 各是 {属性键:每点系数}；缺省/空表→回退默认。 */
export interface VitalRatio { hp?: AttrCoef; ep?: AttrCoef }
/* 兼容入参形状：新 map 字段 + 旧扁平字段（本会话早期的 2×2 数据，自动并入 map）。 */
type RatioSource = {
  hpRatio?: AttrCoef; epRatio?: AttrCoef;
  hpPerCon?: number; epPerInt?: number; hpPerInt?: number; epPerCon?: number;   // 旧扁平字段（兼容回填）
};
/* 清洗一张系数表：只留有限且 >0 的项；全空→undefined。 */
function cleanCoef(m?: AttrCoef | null): AttrCoef | undefined {
  if (!m) return undefined;
  const out: AttrCoef = {};
  for (const k of ATTR_KEYS) { const v = m[k]; if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v; }
  return Object.keys(out).length ? out : undefined;
}
/* 从对象(主角 profile / NPC 记录)抽出系数表；兼容旧扁平字段(hpPerCon/epPerInt/hpPerInt/epPerCon→并入 map)。两表皆空→undefined(全默认)。 */
export function ratioOf(o?: RatioSource | null): VitalRatio | undefined {
  if (!o) return undefined;
  const hp: AttrCoef = { ...(o.hpRatio ?? {}) };
  const ep: AttrCoef = { ...(o.epRatio ?? {}) };
  if (o.hpPerCon != null && hp.con == null) hp.con = o.hpPerCon;   // 旧 2×2 扁平字段兜底回填（仅当 map 未显式给该键）
  if (o.hpPerInt != null && hp.int == null) hp.int = o.hpPerInt;
  if (o.epPerInt != null && ep.int == null) ep.int = o.epPerInt;
  if (o.epPerCon != null && ep.con == null) ep.con = o.epPerCon;
  const hpC = cleanCoef(hp), epC = cleanCoef(ep);
  if (!hpC && !epC) return undefined;
  return { hp: hpC, ep: epC };
}
/* 有效 HP 系数表：自定义非空→用之；否则默认 体×20。 */
export function hpCoefOf(ratio?: VitalRatio): AttrCoef {
  return cleanCoef(ratio?.hp) ?? DEFAULT_HP_RATIO;
}
/* 有效 EP 系数表：自定义非空→用之；否则默认 智×15。 */
export function epCoefOf(ratio?: VitalRatio): AttrCoef {
  return cleanCoef(ratio?.ep) ?? DEFAULT_EP_RATIO;
}
/* 把系数表渲染成中文公式串，如「体×10+智×5」；空→「—」。 */
export function vitalFormula(coef: AttrCoef): string {
  const parts: string[] = [];
  for (const k of ATTR_KEYS) { const v = coef[k]; if (typeof v === 'number' && v > 0) parts.push(`${ATTR_SHORT[k]}×${v}`); }
  return parts.length ? parts.join('+') : '—';
}
/* 六维按系数表加权求和（缺省六维补 5，与旧 computeMaxHp(undefined)=100 口径一致）。 */
function weightedAttrSum(attrs: PlayerAttrs | undefined, coef: AttrCoef): number {
  const a: any = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  let sum = 0;
  for (const k of ATTR_KEYS) sum += Math.max(0, a[k] ?? 0) * (coef[k] ?? 0);
  return sum;
}
export function computeMaxHp(attrs?: PlayerAttrs, realMult = 1, ratio?: VitalRatio): number {
  return Math.round(weightedAttrSum(attrs, hpCoefOf(ratio)) * realMult);   // Σ 六维×HP系数；四阶 realMult=5
}
export function computeMaxEp(attrs?: PlayerAttrs, realMult = 1, ratio?: VitalRatio): number {
  return Math.round(weightedAttrSum(attrs, epCoefOf(ratio)) * realMult);   // Σ 六维×EP系数
}
/* 通用「六维×系数表」资源池上限（供自定义能量条复用 HP/EP 同一套加权和；coef 空→0）。
   如 灵力上限 = computeAttrPool(attrs, {int:30,con:5}, realMult) = (智×30 + 体×5)×倍率。 */
export function computeAttrPool(attrs: PlayerAttrs | undefined, coef: AttrCoef | undefined, realMult = 1): number {
  return Math.round(weightedAttrSum(attrs, cleanCoef(coef) ?? {}) * realMult);
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
/* 选取一条 技能/天赋/装备 里「应计入 HP/EP 上限」的文本（平值与百分比共用同一取数口径）。
   规范写法是把数值上限加成写进 **attrBonus** 字段（与六维同字段，如「生命上限+5000」「法力上限+15%」）：
   - attrBonus 里**已写明本类资源(生命/法力…)的上限/加成** → **只认 attrBonus**，不再扫 effect/desc/affix，
     避免「effect 顺带复述了同一加成、attrBonus 又结构化写了一遍」造成双计（AI 常两边都写）。
   - attrBonus 没写本类上限（或只写了别的，如纯六维「体质+10」）→ 退回扫描描述字段(effect/desc/affix/combatStat)，
     并把 attrBonus 也一并带上兜底（旧档常把"生命上限+N"直接写在 effect 自由文本里）。 */
type GearLite = { effect?: string; affix?: string; combatStat?: string; attrBonus?: string };
type AbilityLite = { effect?: string; desc?: string; attrBonus?: string };
function pickVitalTexts(descFields: (string | undefined)[], attrBonus: string | undefined, kind: 'hp' | 'ep'): (string | undefined)[] {
  const names = kind === 'hp' ? /生命|HP|血量|气血|体力/i : /蓝量|EP|法力|魔力|能量|精力|内力|蓝/i;
  const ab = (attrBonus ?? '').trim();
  if (ab && names.test(ab) && /\d/.test(ab)) return [ab];   // attrBonus 已结构化写明本类上限加成 → 只认它，防与描述字段重复计
  return [...descFields, ab || undefined];
}

/* 已装备物品对 最大HP / 最大EP 的「平值上限加成」合计（attrBonus/effect/affix 里写明"生命上限+N"等的部分）*/
export function gearMaxHpBonus(equipped: GearLite[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus(pickVitalTexts([it.effect, it.affix, it.combatStat], it.attrBonus, 'hp'), 'hp'), 0);
}
export function gearMaxEpBonus(equipped: GearLite[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus(pickVitalTexts([it.effect, it.affix, it.combatStat], it.attrBonus, 'ep'), 'ep'), 0);
}
/* 技能/天赋（被动）的「平值上限加成」合计——规范写进 attrBonus(如「生命上限+5000」)，同时兼容写在 effect/desc 的旧档。
   如被动「初级病毒适应：生命上限+100」会让最大 HP 在六维换算之外再 +100。*/
export function abilityMaxHpBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return [...skills, ...traits].reduce((s, a) => s + vitalMaxBonus(pickVitalTexts([a.effect, a.desc], a.attrBonus, 'hp'), 'hp'), 0);
}
export function abilityMaxEpBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return [...skills, ...traits].reduce((s, a) => s + vitalMaxBonus(pickVitalTexts([a.effect, a.desc], a.attrBonus, 'ep'), 'ep'), 0);
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
export function gearMaxHpPctBonus(equipped: GearLite[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus(pickVitalTexts([it.effect, it.affix, it.combatStat], it.attrBonus, 'hp'), 'hp'), 0);
}
export function gearMaxEpPctBonus(equipped: GearLite[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxPctBonus(pickVitalTexts([it.effect, it.affix, it.combatStat], it.attrBonus, 'ep'), 'ep'), 0);
}
export function abilityMaxHpPctBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return [...skills, ...traits].reduce((s, a) => s + vitalMaxPctBonus(pickVitalTexts([a.effect, a.desc], a.attrBonus, 'hp'), 'hp'), 0);
}
export function abilityMaxEpPctBonus(skills: AbilityLite[] = [], traits: AbilityLite[] = []): number {
  return [...skills, ...traits].reduce((s, a) => s + vitalMaxPctBonus(pickVitalTexts([a.effect, a.desc], a.attrBonus, 'ep'), 'ep'), 0);
}

/* 「基础真实上限」(不含跨资源公式) = (六维换算 + 装备/被动平值上限加成) ×(1 + 百分比加成)。 */
function baseMaxHp(attrs?: PlayerAttrs, equipped: { effect?: string; affix?: string }[] = [], skills: AbilityLite[] = [], traits: AbilityLite[] = [], realMult = 1, ratio?: VitalRatio): number {
  const eff = effectiveAttrs(attrs, skills as any, traits as any, equipped as any);   // 六维加成(如体质+1)折进六维，再 体质×转化比×真实倍率
  const flat = computeMaxHp(eff, realMult, ratio) + gearMaxHpBonus(equipped) + abilityMaxHpBonus(skills, traits);  // 六维部分×realMult；装备/被动平值加成不×
  const pct = gearMaxHpPctBonus(equipped) + abilityMaxHpPctBonus(skills, traits);
  return Math.round(flat * (1 + pct / 100));
}
function baseMaxEp(attrs?: PlayerAttrs, equipped: { effect?: string; affix?: string }[] = [], skills: AbilityLite[] = [], traits: AbilityLite[] = [], realMult = 1, ratio?: VitalRatio): number {
  const eff = effectiveAttrs(attrs, skills as any, traits as any, equipped as any);
  const flat = computeMaxEp(eff, realMult, ratio) + gearMaxEpBonus(equipped) + abilityMaxEpBonus(skills, traits);
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
function crossTexts(equipped: GearLite[], skills: AbilityLite[], traits: AbilityLite[]): (string | undefined)[] {
  return [
    ...skills.flatMap((s) => [s.effect, s.desc, s.attrBonus]),
    ...traits.flatMap((t) => [t.effect, t.desc, t.attrBonus]),
    ...equipped.flatMap((e) => [e.effect, e.affix, e.combatStat, e.attrBonus]),
  ];
}

/* 统一口径的「真实最大 HP / EP」（主角与 NPC 共用）= 基础上限 + 跨资源公式加成。
   各处显示/钳制/战斗/AI快照一律走这两个，确保一致；含百分比加成与「生命=最大法力X%」类跨资源公式。 */
export function fullMaxHp(
  attrs?: PlayerAttrs,
  equipped: { effect?: string; affix?: string }[] = [],
  skills: AbilityLite[] = [],
  traits: AbilityLite[] = [],
  realMult = 1,
  ratio?: VitalRatio,
): number {
  return baseMaxHp(attrs, equipped, skills, traits, realMult, ratio)
    + vitalCrossBonus(crossTexts(equipped, skills, traits), 'hp', baseMaxEp(attrs, equipped, skills, traits, realMult, ratio));
}
export function fullMaxEp(
  attrs?: PlayerAttrs,
  equipped: { effect?: string; affix?: string }[] = [],
  skills: AbilityLite[] = [],
  traits: AbilityLite[] = [],
  realMult = 1,
  ratio?: VitalRatio,
): number {
  return baseMaxEp(attrs, equipped, skills, traits, realMult, ratio)
    + vitalCrossBonus(crossTexts(equipped, skills, traits), 'ep', baseMaxHp(attrs, equipped, skills, traits, realMult, ratio));
}
/* HP/EP 上限「构成明细」（供血条点击弹层展示：基础六维换算 + 各效果逐条加成）。
   分量与 fullMaxHp/EP 严格同口径：total 恒 === fullMaxHp/EP。
   ① attrBase = 六维换算(含技能树/团队/装备/技能天赋的六维加成折算·×realMult)；
   ② flatItems = 逐件装备/逐个技能天赋写明的「生命/法力上限 +N」平值；
   ③ pctItems = 「最大HP +6%」类百分比（作用于 attrBase+平值 之上）；pctAdd = 百分比实际增加的点数；
   ④ crossItems = 「生命 = 最大法力 X%」类跨资源加成。 */
export interface VitalBreakItem { name: string; source: '装备' | '技能' | '天赋'; amount: number; }
export interface VitalPctItem { name: string; source: '装备' | '技能' | '天赋'; pct: number; }
export interface VitalBreakdown {
  kind: 'hp' | 'ep';
  attrBase: number; realMult: number;
  flatItems: VitalBreakItem[]; flatTotal: number;
  pctItems: VitalPctItem[]; pctTotal: number; pctAdd: number;
  crossItems: VitalBreakItem[]; crossTotal: number;
  total: number;   // === fullMaxHp/EP
}
type NamedGear = GearLite & { name?: string };
type NamedAbility = AbilityLite & { name?: string };
export function computeVitalBreakdown(
  kind: 'hp' | 'ep',
  attrs?: PlayerAttrs,
  equipped: NamedGear[] = [],
  skills: NamedAbility[] = [],
  traits: NamedAbility[] = [],
  realMult = 1,
  ratio?: VitalRatio,
): VitalBreakdown {
  const eff = effectiveAttrs(attrs, skills as any, traits as any, equipped as any);
  const attrBase = kind === 'hp' ? computeMaxHp(eff, realMult, ratio) : computeMaxEp(eff, realMult, ratio);
  const gearTexts = (it: NamedGear) => pickVitalTexts([it.effect, it.affix, it.combatStat], it.attrBonus, kind);
  const abilTexts = (a: NamedAbility) => pickVitalTexts([a.effect, a.desc], a.attrBonus, kind);
  // ② 平值上限（逐件/逐技能）
  const flatItems: VitalBreakItem[] = [];
  for (const it of equipped) { const a = vitalMaxBonus(gearTexts(it), kind); if (a) flatItems.push({ name: it.name || '装备', source: '装备', amount: a }); }
  for (const s of skills)   { const a = vitalMaxBonus(abilTexts(s), kind); if (a) flatItems.push({ name: s.name || '技能', source: '技能', amount: a }); }
  for (const t of traits)   { const a = vitalMaxBonus(abilTexts(t), kind); if (a) flatItems.push({ name: t.name || '天赋', source: '天赋', amount: a }); }
  const flatTotal = flatItems.reduce((s, x) => s + x.amount, 0);
  // ③ 百分比（逐件/逐技能）
  const pctItems: VitalPctItem[] = [];
  for (const it of equipped) { const p = vitalMaxPctBonus(gearTexts(it), kind); if (p) pctItems.push({ name: it.name || '装备', source: '装备', pct: p }); }
  for (const s of skills)   { const p = vitalMaxPctBonus(abilTexts(s), kind); if (p) pctItems.push({ name: s.name || '技能', source: '技能', pct: p }); }
  for (const t of traits)   { const p = vitalMaxPctBonus(abilTexts(t), kind); if (p) pctItems.push({ name: t.name || '天赋', source: '天赋', pct: p }); }
  const pctTotal = pctItems.reduce((s, x) => s + x.pct, 0);
  const afterPct = Math.round((attrBase + flatTotal) * (1 + pctTotal / 100));   // === baseMaxHp/EP
  const pctAdd = afterPct - (attrBase + flatTotal);
  // ④ 跨资源（逐条·用另一资源的 base，与 fullMaxHp/EP 同口径）
  const otherBase = kind === 'hp' ? baseMaxEp(attrs, equipped, skills, traits, realMult, ratio) : baseMaxHp(attrs, equipped, skills, traits, realMult, ratio);
  const crossItems: VitalBreakItem[] = [];
  for (const it of equipped) { const c = vitalCrossBonus([it.effect, it.affix, it.combatStat, it.attrBonus], kind, otherBase); if (c) crossItems.push({ name: it.name || '装备', source: '装备', amount: c }); }
  for (const s of skills)   { const c = vitalCrossBonus([s.effect, s.desc, s.attrBonus], kind, otherBase); if (c) crossItems.push({ name: s.name || '技能', source: '技能', amount: c }); }
  for (const t of traits)   { const c = vitalCrossBonus([t.effect, t.desc, t.attrBonus], kind, otherBase); if (c) crossItems.push({ name: t.name || '天赋', source: '天赋', amount: c }); }
  const crossTotal = crossItems.reduce((s, x) => s + x.amount, 0);
  return { kind, attrBase, realMult, flatItems, flatTotal, pctItems, pctTotal, pctAdd, crossItems, crossTotal, total: afterPct + crossTotal };
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

/* 从 realm 字符串（如 "一阶·Lv.8|身份"）提取 Lv 数字；取不到默认 1。
   ⚠ 阶位·等级一致性守卫：同一串里阶位与等级矛盾时（AI 幻觉写出 "二阶·Lv.86"）以**阶位**为准，
   把等级夹进该阶合法区间（二阶 → Lv.20）。理由：NPC 的阶位与等级来自同一个字符串、同时写入，
   不存在 attrCapForTier/nominalTierNum 里 max(阶位串, 按等级推) 想防的「阶位字段滞后于等级」——
   矛盾只可能是 AI 写错。不夹的话 Lv.86 会经该 max() 把「二阶」顶成九阶，连锁三处爆炸：
   ① bioInnate 拿九阶区间[301,500]量她 ~65 的峰值 → 占用率负 → 掉到九阶窗口**地板 T8·真神**
   ② tierVitalMult(8) → NPC maxHp ×32  ③ 六维上限由 80 放开到 500，且 T8 还会注回提示词
   让 NPC 演化真按真神养她 → 每回合自我强化。（主角走 profile.tier/level 两个独立字段、确实可能滞后，
   不经本函数，max() 对主角仍然成立。）
   阶位段取 '|' 前的头部——身份后缀里的阶位词（如 "一阶·Lv.5|三阶佣兵团学徒"）不作数。
   认不出阶位（纯 "Lv.25" / "结丹中期·Lv.25" 等脏数据）→ 不夹，仍交给 realmFromLevel 推导。 */
export function lvFromRealm(realm?: string): number {
  const m = /Lv\.?\s*(\d+)/i.exec(realm ?? '');
  if (!m) return 1;
  return clampLevelToTier(Number(m[1]), (realm ?? '').split('|')[0]);
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

/* 阶位 → 合法等级区间 [下限,上限]（无上之境 无上限）。realmFromLevel 的**反向表**——两张表必须一致，
   derivedStats.test.ts 有双向一致性测试兜底（改一处漏改另一处会直接测挂）。 */
export const TIER_LEVEL_RANGE: Record<string, [number, number]> = {
  一阶: [1, 10], 二阶: [11, 20], 三阶: [21, 30], 四阶: [31, 40], 五阶: [41, 50],
  六阶: [51, 60], 七阶: [61, 70], 八阶: [71, 80], 九阶: [81, 90],
  绝强: [91, 100], 巅峰绝强: [101, 110], 至强: [111, 130], 巅峰至强: [131, 150],
  无上之境: [151, Infinity],
};

/* 把等级夹进某阶位的合法等级区间；阶位认不出（''/脏数据）→ 原样返回、不夹。 */
export function clampLevelToTier(level: number, tier?: string): number {
  const lv = Math.max(1, Math.round(level || 1));
  const r = TIER_LEVEL_RANGE[normalizeTier(tier)];
  return r ? Math.max(r[0], Math.min(r[1], lv)) : lv;
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

/* 真实属性·每项上限（新口径 2026-06-24）：四阶起「六维即真实属性」，故真实属性(基础六维 + 真实属性点直加 realAttrs)
   的合计上限 = 本阶「单属性极值」(attrCapForTier)。一~三阶为普通属性阶段、不发放真实属性点 → 返回 Infinity 不设限。 */
export function realAttrCapForTier(tier?: string, level?: number): number {
  const idx = TIERS.indexOf((normalizeTier(tier) || (level != null ? realmFromLevel(level) : '')) as typeof TIERS[number]);
  if (idx >= 0 && idx < 3) return Infinity;   // 一~三阶（idx0-2）：普通属性阶段，真实属性不设限
  return attrCapForTier(tier, level);         // 四阶起：真实属性(基础+直加) ≤ 本阶单属性极值
}

/* 真实属性·战斗/HP 倍率（2026-06-24·5:1强制）：四阶起「六维即真实属性」、1真实=5普通之效，
   故 HP/EP 池(体×20/智×15)与战斗攻防/伤害(computeDerived/strengthBonus)按此倍率放大；一~三阶普通属性=1。
   传入 computeMaxHp/EP、fullMaxHp/EP 的 realMult 参数，或在战斗块里缩放参战六维。 */
/* NPC「HP/EP/衍生 基础六维」= 基础 attrs + 真实属性点直加(realAttrs)。与战斗 buildNpc(npcBase) 严格同口径
   （realAttrs 直加并入六维→自动进 攻防/HP/EP）。NPC 无技能树/团队加成（主角专属）；装备/技能/天赋的六维加成
   由 fullMaxHp/EP 内部 effectiveAttrs 折算、不在此。
   ⚠ 多处 NPC 的 fullMaxHp/computeMaxHp 曾只传 npc.attrs 漏 realAttrs → 给 NPC 加真实属性点不涨血/蓝
   （与主角 realAttrs 漏算同源，见 playerBaseAttrs）。所有 NPC vitals 计算都走这里，防漂移。 */
export function npcBaseAttrs(npc?: { attrs?: PlayerAttrs; realAttrs?: Partial<PlayerAttrs> }): PlayerAttrs {
  return withAttrDelta(npc?.attrs, npc?.realAttrs);
}

export const REAL_ATTR_MULT = 5;
export function realAttrMult(tier?: string, level?: number): number {
  const idx = TIERS.indexOf((normalizeTier(tier) || (level != null ? realmFromLevel(level) : '')) as typeof TIERS[number]);
  return idx >= 3 ? REAL_ATTR_MULT : 1;   // 四阶(idx3)起 ×5；认不出阶位/一~三阶 = 1
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
