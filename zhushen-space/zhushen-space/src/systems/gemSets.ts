import { ATTR_LABEL, type AttrDelta } from './attrBonus';
import type { PassiveMod } from './combatTags';
import type { SocketedGem } from '../store/itemStore';

/* ════════════════════════════════════════════
   宝石套装（gemSets）—— 「集齐同一套装的宝石」激活阶梯式套装加成。
   - 每颗宝石按其属性(gemAttr)归入唯一套装（setForGem）；生成时烘焙进 gemSet / SocketedGem.set。
   - 统计**已装备装备**上所有已镶嵌宝石，按套装计数；≥2/≥4/≥6 逐档激活套装效果。
   - 套装效果拆两路：六维加成(attrs)经合成"装备条目"并入有效六维；战斗被动(passive)并入战斗被动修正。
   - 与单颗宝石加成互不重叠：套装加成是"集齐"的额外奖励，不是重复计单颗数值。
   参考各游戏套装(暗黑/POE/流放之路/DNF 的 2/4/6 件套)。纯前端确定性、无 AI。
════════════════════════════════════════════ */

/** 一档套装效果：need 件数门槛 + 展示文本 + 结构化六维/战斗被动。 */
export interface SetTier {
  need: number;
  bonus: string;         // 展示文本
  attrs?: AttrDelta;     // 六维加成（并入有效六维，与单颗宝石同路径）
  passive?: PassiveMod;  // 战斗被动修正（暴击/暴伤/穿透/增减伤/冷却/多段）
}
export interface GemSet {
  key: string;
  name: string;
  emoji: string;
  theme: string;         // 主题（攻/防/元素/敏/财）
  desc: string;
  tiers: SetTier[];      // 由低到高（need 递增）
}

/** 内置五大套装（覆盖全部宝石属性；每颗宝石唯一归属）。 */
export const GEM_SETS: GemSet[] = [
  {
    key: 'rift', name: '裂空杀阵', emoji: '⚔️', theme: '攻',
    desc: '锋锐、穿刺、必杀——为极致输出而生的杀伐套装。',
    tiers: [
      { need: 2, bonus: '暴击率 +8%', passive: { critChance: 0.08 } },
      { need: 4, bonus: '暴击伤害 +30%', passive: { critMult: 0.30 } },
      { need: 6, bonus: '无视 30% 防御 · 力量 +25', passive: { pierce: 0.30 }, attrs: { str: 25 } },
    ],
  },
  {
    key: 'bulwark', name: '不灭壁垒', emoji: '🛡️', theme: '防',
    desc: '磐石之躯、金刚不坏——把伤害层层卸去的守御套装。',
    tiers: [
      { need: 2, bonus: '体质 +15', attrs: { con: 15 } },
      { need: 4, bonus: '受到伤害减免 12%', passive: { dmgTakenPct: -0.12 } },
      { need: 6, bonus: '受到伤害额外减免 18% · 体质 +20', passive: { dmgTakenPct: -0.18 }, attrs: { con: 20 } },
    ],
  },
  {
    key: 'element', name: '元素共鸣', emoji: '🔥', theme: '元素',
    desc: '烈焰、寒霜、惊雷共振——法术与元素伤害的增幅套装。',
    tiers: [
      { need: 2, bonus: '智力 +15', attrs: { int: 15 } },
      { need: 4, bonus: '造成伤害 +18%', passive: { dmgDealtPct: 0.18 } },
      { need: 6, bonus: '造成伤害额外 +22% · 智力 +20', passive: { dmgDealtPct: 0.22 }, attrs: { int: 20 } },
    ],
  },
  {
    key: 'gale', name: '疾风迅捷', emoji: '💨', theme: '敏',
    desc: '身法如电、连击不断——追求速度与连段的机动套装。',
    tiers: [
      { need: 2, bonus: '敏捷 +15', attrs: { agi: 15 } },
      { need: 4, bonus: '暴击率 +6% · 攻速提升', passive: { critChance: 0.06 } },
      { need: 6, bonus: '技能冷却 -1 回合 · 额外一段攻击 · 敏捷 +20', passive: { cdr: 1, extraHits: 1 }, attrs: { agi: 20 } },
    ],
  },
  {
    key: 'fortune', name: '聚宝天工', emoji: '💰', theme: '财',
    desc: '招财、寻宝、匠心巧手——财富与生活产出的丰饶套装。',
    tiers: [
      { need: 2, bonus: '幸运 +12', attrs: { luck: 12 } },
      { need: 4, bonus: '稀有掉落率 +20% · 乐园币收益 +30% · 幸运 +8', attrs: { luck: 8 } },
      { need: 6, bonus: '寻宝与生活产出大幅提升 · 魅力 +20 · 幸运 +10', attrs: { cha: 20, luck: 10 } },
    ],
  },
];

const SET_BY_KEY: Record<string, GemSet> = Object.fromEntries(GEM_SETS.map((s) => [s.key, s]));

/** 属性 → 套装 key 映射（每个宝石属性唯一归属一个套装）。 */
const ATTR_TO_SET: Record<string, string> = {
  // 裂空杀阵（攻）
  力量: 'rift', 基础攻击: 'rift', 武器锋利度: 'rift', 无视防御: 'rift', 护甲穿透: 'rift',
  真实伤害: 'rift', 暴击率: 'rift', 暴击伤害: 'rift', 会心一击: 'rift', 真实属性判定: 'rift',
  // 不灭壁垒（防）
  体质: 'bulwark', 生命: 'bulwark', 基础防御: 'bulwark', 伤害减免: 'bulwark', 格挡: 'bulwark',
  荆棘反伤: 'bulwark', 真实防御: 'bulwark', 坚韧抗控: 'bulwark', 全抗性: 'bulwark', 环境适应: 'bulwark',
  // 元素共鸣（元素）
  智力: 'element', 法力: 'element', 烈焰附魔: 'element', 霜寒附魔: 'element', 惊雷附魔: 'element', 灵魂伤害: 'element',
  // 疾风迅捷（敏）
  敏捷: 'gale', 急速: 'gale', 移动速度: 'gale', 冷却缩减: 'gale', 生命吸取: 'gale', 脱战回复: 'gale', 自动拾取: 'gale',
  // 聚宝天工（财 / 生活）
  魅力: 'fortune', 幸运: 'fortune', 招财: 'fortune', 魔法寻宝: 'fortune', 历练: 'fortune',
  采掘: 'fortune', 采集: 'fortune', 垂钓: 'fortune', 匠艺: 'fortune', 探脉: 'fortune', 庖厨: 'fortune',
  交涉: 'fortune', 魅力社交: 'fortune', 御兽: 'fortune', 负重上限: 'fortune', 耐久节省: 'fortune',
};

/** 宝石属性 → 所属套装 key（未匹配的属性归入与其主题最近的套装：功能/生活类→聚宝天工）。 */
export function setForGem(attr?: string, _cat?: string): string {
  const a = String(attr ?? '').trim();
  return ATTR_TO_SET[a] ?? 'fortune';
}
export function gemSetName(key?: string): string { return key ? SET_BY_KEY[key]?.name ?? '' : ''; }
export function gemSetMeta(key?: string): GemSet | undefined { return key ? SET_BY_KEY[key] : undefined; }

type EquipLike = { equipped?: boolean; gems?: SocketedGem[] };

/** 统计**已装备**装备上的镶嵌宝石按套装计数（旧档宝石无 set 字段则按属性回填）。
 *  内部再兜一层 equipped 过滤：套装绝不统计未装备装备上的宝石（调用方通常已 filter，此为防御性双保险）。 */
export function collectSetCounts(equippedItems: EquipLike[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of equippedItems ?? []) {
    if (it.equipped === false) continue;
    for (const g of it.gems ?? []) {
      const key = g.set || setForGem(g.attr);
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

export interface ActiveSet {
  key: string; name: string; emoji: string; theme: string; desc: string; count: number;
  tiers: (SetTier & { active: boolean })[];   // 全档 + 是否已激活（供面板显示"下一档还差几件"）
}
/** 已装备装备上激活的套装（count≥2 才收录；含全档激活状态供展示）。 */
export function activeGemSets(equippedItems: EquipLike[]): ActiveSet[] {
  const counts = collectSetCounts(equippedItems);
  const out: ActiveSet[] = [];
  for (const set of GEM_SETS) {
    const count = counts[set.key] ?? 0;
    if (count < 2) continue;   // 至少 2 件才成套
    out.push({
      key: set.key, name: set.name, emoji: set.emoji, theme: set.theme, desc: set.desc, count,
      tiers: set.tiers.map((t) => ({ ...t, active: count >= t.need })),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 汇总所有激活套装档的**六维加成**（供并入有效六维）。 */
export function gemSetAttrDelta(equippedItems: EquipLike[]): AttrDelta {
  const d: AttrDelta = {};
  for (const s of activeGemSets(equippedItems)) {
    for (const t of s.tiers) {
      if (!t.active || !t.attrs) continue;
      for (const k of Object.keys(t.attrs) as (keyof AttrDelta)[]) d[k] = (d[k] ?? 0) + (t.attrs[k] ?? 0);
    }
  }
  return d;
}

/** 汇总所有激活套装档的**战斗被动修正**（暴击/暴伤取和、穿透取最大、增减伤取和、冷却/多段取和）。 */
export function gemSetPassive(equippedItems: EquipLike[]): PassiveMod {
  const p: PassiveMod = {};
  for (const s of activeGemSets(equippedItems)) {
    for (const t of s.tiers) {
      if (!t.active || !t.passive) continue;
      const q = t.passive;
      if (q.critChance) p.critChance = Math.min(1, (p.critChance ?? 0) + q.critChance);
      if (q.critMult) p.critMult = (p.critMult ?? 0) + q.critMult;
      if (q.dmgDealtPct) p.dmgDealtPct = (p.dmgDealtPct ?? 0) + q.dmgDealtPct;
      if (q.dmgTakenPct) p.dmgTakenPct = (p.dmgTakenPct ?? 0) + q.dmgTakenPct;
      if (q.pierce) p.pierce = Math.max(p.pierce ?? 0, q.pierce);
      if (q.cdr) p.cdr = (p.cdr ?? 0) + q.cdr;
      if (q.extraHits) p.extraHits = (p.extraHits ?? 0) + q.extraHits;
    }
  }
  return p;
}

/** 把套装六维加成格式化成"力量+25 体质+15"文本，包成一个合成"装备条目"，
 *  与真实装备一起传入 effectiveAttrs/computeAttrBreakdown——套装六维即计入"装备"来源列（同样受阶位上限约束）。
 *  无激活套装六维时返回 null。 */
export function gemSetEquipEntry(equippedItems: EquipLike[]): { effect: string } | null {
  const d = gemSetAttrDelta(equippedItems);
  const parts = (Object.keys(d) as (keyof AttrDelta)[])
    .filter((k) => d[k])
    .map((k) => `${ATTR_LABEL[k]}+${d[k]}`);
  return parts.length ? { effect: `【套装加成：${parts.join('；')}】` } : null;
}

/** 一句话套装摘要（供场外通报 / AI 一致性）。 */
export function gemSetSummaryLine(equippedItems: EquipLike[]): string {
  const sets = activeGemSets(equippedItems);
  if (!sets.length) return '';
  const segs = sets.map((s) => {
    const on = s.tiers.filter((t) => t.active).map((t) => `${t.need}件`).join('/');
    return `${s.name}(${s.count}件·激活${on})`;
  });
  return `宝石套装：${segs.join('，')}`;
}
