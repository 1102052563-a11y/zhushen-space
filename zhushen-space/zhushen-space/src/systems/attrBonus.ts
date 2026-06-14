import type { PlayerAttrs } from '../store/playerStore';

/* 把技能/天赋/装备文本里的「属性加成」解析成对六维的实际数值增减，
   汇总成 有效属性(effective) + 来源拆解(breakdown)，供属性面板真实加载 + 点击查看构成。 */

export const ATTR_KEYS: (keyof PlayerAttrs)[] = ['str', 'agi', 'con', 'int', 'cha', 'luck'];
export const ATTR_LABEL: Record<keyof PlayerAttrs, string> = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运',
};
/* 各属性的识别别名（用整词，避免「力」匹配进「力量」造成重复计数）*/
const ATTR_ALIASES: Record<keyof PlayerAttrs, string[]> = {
  str: ['力量', '膂力', 'strength', 'str'],
  agi: ['敏捷', '身法', 'agility', 'agi'],
  con: ['体质', '体魄', '耐力', 'constitution', 'con'],
  int: ['智力', '智慧', '感知', '精神', '灵力', 'intelligence', 'int'],
  cha: ['魅力', 'charisma', 'cha'],
  luck: ['幸运', '气运', 'luck'],
};

export type AttrDelta = Partial<Record<keyof PlayerAttrs, number>>;

/* 从一段文本解析六维增减：识别 "力量+5" / "+5力量" / "敏捷 +2" / "智力:8"；忽略百分比(如 暴击+10%) */
export function parseAttrBonus(text?: string): AttrDelta {
  const out: AttrDelta = {};
  if (!text) return out;
  const t = String(text);
  for (const key of ATTR_KEYS) {
    let sum = 0;
    for (const a of ATTR_ALIASES[key]) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let m: RegExpExecArray | null;
      const re1 = new RegExp(`${esc}\\s*[:：]?\\s*([+\\-]?\\d+)(?!\\s*[%％])`, 'gi');  // 名 在前
      while ((m = re1.exec(t)) !== null) sum += Number(m[1]);
      const re2 = new RegExp(`([+\\-]?\\d+)\\s*点?\\s*${esc}`, 'gi');                   // 数 在前
      while ((m = re2.exec(t)) !== null) sum += Number(m[1]);
    }
    if (sum) out[key] = sum;
  }
  return out;
}

export interface AttrBreak { base: number; equip: number; skill: number; talent: number; total: number; }

/* 取一组对象里"属性加成文本"（技能/天赋用 attrBonus，缺失才退回 effect；装备无 attrBonus 字段，用 effect+affix）并累加 */
function sumBonus(items: any[], fields: string[]): AttrDelta {
  const d: AttrDelta = {};
  for (const it of items ?? []) {
    // 优先 attrBonus；为空再退回其它字段，避免同一加成在 attrBonus 与 effect 里被重复计两次
    const primary = (it?.attrBonus ?? '').toString().trim();
    const texts = primary ? [primary] : fields.map((f) => it?.[f]).filter(Boolean);
    for (const t of texts) {
      const p = parseAttrBonus(t);
      for (const k of ATTR_KEYS) if (p[k]) d[k] = (d[k] ?? 0) + p[k]!;
    }
  }
  return d;
}

/* 计算某角色每个属性的来源构成：原始(base) + 装备(equip) + 技能(skill) + 天赋(talent) → 合计(total) */
export function computeAttrBreakdown(
  base: PlayerAttrs | undefined,
  skills: { attrBonus?: string; effect?: string }[] = [],
  talents: { attrBonus?: string; effect?: string }[] = [],
  equipped: { effect?: string; affix?: string; attrBonus?: string }[] = [],
): Record<keyof PlayerAttrs, AttrBreak> {
  const b = base ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const sk = sumBonus(skills, ['effect']);
  const ta = sumBonus(talents, ['effect']);
  const eq = sumBonus(equipped, ['effect', 'affix']);
  const out = {} as Record<keyof PlayerAttrs, AttrBreak>;
  for (const k of ATTR_KEYS) {
    const base0 = b[k] ?? 0, e = eq[k] ?? 0, s = sk[k] ?? 0, t = ta[k] ?? 0;
    out[k] = { base: base0, equip: e, skill: s, talent: t, total: base0 + e + s + t };
  }
  return out;
}

/* 有效六维（含全部加成）——喂给衍生属性/HP/EP 计算与展示 */
export function effectiveAttrs(
  base: PlayerAttrs | undefined,
  skills: { attrBonus?: string; effect?: string }[] = [],
  talents: { attrBonus?: string; effect?: string }[] = [],
  equipped: { effect?: string; affix?: string; attrBonus?: string }[] = [],
): PlayerAttrs {
  const bd = computeAttrBreakdown(base, skills, talents, equipped);
  return { str: bd.str.total, agi: bd.agi.total, con: bd.con.total, int: bd.int.total, cha: bd.cha.total, luck: bd.luck.total };
}
