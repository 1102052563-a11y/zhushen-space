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

/* 把一组增减叠加到六维（用于把技能树等加成折进有效属性 base，供所有判定生效）*/
export function withAttrDelta(base: PlayerAttrs | undefined, delta?: AttrDelta): PlayerAttrs {
  const b = base ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  if (!delta) return b;
  const out = { ...b } as PlayerAttrs;
  for (const k of ATTR_KEYS) if (delta[k]) (out as any)[k] = ((out as any)[k] ?? 0) + delta[k]!;
  return out;
}

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
    // 注：镶嵌宝石的加成已由 gemEngine.applyGemsToEffect 写进装备 effect（effect 已在上面被读取），
    // 故此处不再单独读 gems，避免与 effect 里的【镶嵌加成】双重计数。
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
  cap?: number,   // 本阶「单属性极值」：给定则**基础 与「基础+全部加成」的合计都夹到该上限**——属性必须遵守阶位限制，装备/技能/天赋加成也不得超（只夹力敏体智魅，幸运另算）。只有升级(升阶)提高上限。
): Record<keyof PlayerAttrs, AttrBreak> {
  const b = base ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const sk = sumBonus(skills, ['effect']);
  const ta = sumBonus(talents, ['effect']);
  const eq = sumBonus(equipped, ['effect', 'affix', 'combatStat']);   // 也读 combatStat：AI 常把「智力+11」等六维加成塞进攻防字段，否则不生效
  const out = {} as Record<keyof PlayerAttrs, AttrBreak>;
  for (const k of ATTR_KEYS) {
    const base0 = b[k] ?? 0, e = eq[k] ?? 0, s = sk[k] ?? 0, t = ta[k] ?? 0;
    const capThis = cap != null && k !== 'luck';                      // 幸运不受阶位上限（量级独立·另有标尺）
    const baseV = capThis ? Math.min(base0, cap!) : base0;            // 基础超阶也夹（治旧档/AI 误配的基础>上限）
    const total = capThis ? Math.min(base0 + e + s + t, cap!) : base0 + e + s + t;   // 含全部加成的合计 ≤ 本阶上限
    out[k] = { base: baseV, equip: e, skill: s, talent: t, total };
  }
  return out;
}

/* 从「装备需求(requirement)」文本解析出各六维的**门槛值**（不是加成，故取每项的最大值、不累加）：
   识别 "力量 5点" / "智力50" / "50点力量" / "力量10可发挥威力" / "力量20、敏捷15" 等；"无"/空 → {}。
   只解析六维；等级/阶位等其它门槛不在此列（如需再扩展）。 */
export function parseAttrRequirement(text?: string): AttrDelta {
  const out: AttrDelta = {};
  if (!text) return out;
  const t = String(text);
  for (const key of ATTR_KEYS) {
    let need = 0;
    for (const a of ATTR_ALIASES[key]) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let m: RegExpExecArray | null;
      const re1 = new RegExp(`${esc}\\s*[:：]?\\s*(\\d+)(?!\\s*[%％])`, 'gi');  // 名在前：力量 50
      while ((m = re1.exec(t)) !== null) need = Math.max(need, Number(m[1]));
      const re2 = new RegExp(`(\\d+)\\s*点?\\s*${esc}`, 'gi');                    // 数在前：50点力量
      while ((m = re2.exec(t)) !== null) need = Math.max(need, Number(m[1]));
    }
    if (need > 0) out[key] = need;
  }
  return out;
}

/* 对照持有者六维，返回**未达标**的装备需求项（空数组＝满足全部需求，可穿戴）。attrs 传有效六维。 */
export function unmetRequirements(
  reqText: string | undefined,
  attrs: PlayerAttrs | undefined,
): { key: keyof PlayerAttrs; label: string; need: number; have: number }[] {
  const need = parseAttrRequirement(reqText);
  const a = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const out: { key: keyof PlayerAttrs; label: string; need: number; have: number }[] = [];
  for (const key of ATTR_KEYS) {
    const n = need[key];
    if (n && (a[key] ?? 0) < n) out.push({ key, label: ATTR_LABEL[key], need: n, have: a[key] ?? 0 });
  }
  return out;
}

/* 有效六维（含全部加成）——喂给衍生属性/HP/EP 计算与展示。cap 给定时合计夹到本阶单属性极值（遵守阶位限制）。 */
export function effectiveAttrs(
  base: PlayerAttrs | undefined,
  skills: { attrBonus?: string; effect?: string }[] = [],
  talents: { attrBonus?: string; effect?: string }[] = [],
  equipped: { effect?: string; affix?: string; attrBonus?: string }[] = [],
  cap?: number,
): PlayerAttrs {
  const bd = computeAttrBreakdown(base, skills, talents, equipped, cap);
  return { str: bd.str.total, agi: bd.agi.total, con: bd.con.total, int: bd.int.total, cha: bd.cha.total, luck: bd.luck.total };
}
