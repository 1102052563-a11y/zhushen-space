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

/* 「需发动 / 触发 / 限时状态」触发词：某段文本含这些词 → 视为**条件效果**（非常驻被动），其中的六维加成不计入常驻装备加成。
   治用户报的"吸血鬼煎药·使用后 60 分钟状态才给的 体质+15/敏捷+10/魅力-12 被常驻加进了状态栏"。 */
const CONDITIONAL_TRIGGER_RE = /使用后|使用时|服用|发动|激活|开启|施放|释放|引导|蓄力|触发|命中(时|后)|击中(时|后)|受击|受到[^，。；\n]{0,10}(伤害|攻击|致命|重创)|进入[^，。；\n]{0,10}状态|状态[:：]|「[^」]{1,14}」状态|期间|持续\s*\d+\s*(秒|分钟|小时|回合|天)|冷却|CD|每日[^，。；\n]{0,8}(注满|重置|刷新|重构)/i;

/* 剔除装备文本里「需发动 / 限时 / 触发」的条件段落，只留常驻被动段落——供装备**常驻**六维加成解析。
   按 换行 / 【条目】 边界切段（保持每条词缀/条目完整）：某段含触发词 → 该段整段的六维加成都不计入常驻
   （条件加成的"+15"常与"使用后…状态"处在同一条词缀里、只是分号隔开，故必须按条目整段判、不能按分句判）。 */
export function stripConditionalAttrSegments(text?: string): string {
  if (!text) return '';
  const segs = String(text).split(/\n+|(?=【)/).map((s) => s.trim()).filter(Boolean);
  return segs.filter((s) => !CONDITIONAL_TRIGGER_RE.test(s)).join('\n');
}

/* 取一组对象里"属性加成文本"（技能/天赋用 attrBonus，缺失才退回 effect；装备无 attrBonus 字段，用 effect+affix）并累加。
   gateConditional=true（仅装备）：① 整件被标记 condBonus（玩家手动"六维加成需发动"）→ 跳过；② 逐段剔除"需发动/触发/限时"的条件加成。 */
function sumBonus(items: any[], fields: string[], gateConditional = false): AttrDelta {
  const d: AttrDelta = {};
  for (const it of items ?? []) {
    // 玩家显式标记「此装备六维加成需发动·不常驻」→ 整件跳过，一点都不计入常驻六维
    if (gateConditional && it?.condBonus) continue;
    // 优先 attrBonus；为空再退回其它字段，避免同一加成在 attrBonus 与 effect 里被重复计两次
    const primary = (it?.attrBonus ?? '').toString().trim();
    let texts = primary ? [primary] : fields.map((f) => it?.[f]).filter(Boolean);
    // 装备：先把"需发动/触发/限时状态"的条件段落剔掉，只按常驻被动算——防条件加成被当永久加成塞进状态栏
    if (gateConditional) texts = texts.map((t) => stripConditionalAttrSegments(String(t))).filter(Boolean);
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
  equipped: { effect?: string; affix?: string; attrBonus?: string; combatStat?: string; condBonus?: boolean }[] = [],
  cap?: number,   // 本阶「单属性极值」：给定则**基础 与「基础+全部加成」的合计都夹到该上限**——属性必须遵守阶位限制，装备/技能/天赋加成也不得超（只夹力敏体智魅，幸运另算）。只有升级(升阶)提高上限。
): Record<keyof PlayerAttrs, AttrBreak> {
  const b = base ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const sk = sumBonus(skills, ['effect']);
  const ta = sumBonus(talents, ['effect']);
  const eq = sumBonus(equipped, ['effect', 'affix', 'combatStat'], true);   // 也读 combatStat：AI 常把「智力+11」等六维加成塞进攻防字段，否则不生效；gate=true：剔除"需发动/触发/限时状态"的条件加成 + 尊重 condBonus 手动标记
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

/* 被本阶【单属性极值】上限「夹掉」的加成量 = 显示合计(基础+装备+技能+天赋) − 实际有效合计(total)。
   >0 ⇒ 装备/技能/天赋加成有一部分因顶到上限而不生效（四阶起六维即真实属性，故真实属性顶格后
   装备/天赋加不上去——忠于原著；唯升阶提高上限）。供属性面板诚实标注"显示了却没加上"的差额。 */
export function clampedBonus(bk: AttrBreak): number {
  return Math.max(0, (bk.base + bk.equip + bk.skill + bk.talent) - bk.total);
}

/* 从「装备需求(requirement)」文本解析出各六维的**门槛值**（不是加成，故取每项最大值、不累加），
   并按尺度分两桶：
   - real（真实尺度）：需求名前带「真实」标记，如「真实力量300」「真实·魅力150」——所有玩家都按真实属性逐值比较。
   - normal（普通尺度）：不带「真实」的普通写法，如「力量50」「魅力300」——只卡一~三阶普通属性玩家；
     四阶起（真实属性阶段）主角视为已超越普通维度，自动满足（见 unmetRequirements 的 isRealTier）。
   识别 "力量 5点" / "智力50" / "50点力量" / "力量10可发挥威力" / "力量20、敏捷15" 等；"无"/空 → 两桶皆空。 */
export function parseAttrRequirement(text?: string): { normal: AttrDelta; real: AttrDelta } {
  const normal: AttrDelta = {}, real: AttrDelta = {};
  if (!text) return { normal, real };
  const t = String(text);
  for (const key of ATTR_KEYS) {
    for (const a of ATTR_ALIASES[key]) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let m: RegExpExecArray | null;
      const re1 = new RegExp(`(真实)?\\s*[·・]?\\s*${esc}\\s*[:：]?\\s*(\\d+)(?!\\s*[%％])`, 'gi');  // 名在前：(真实)力量 50
      while ((m = re1.exec(t)) !== null) { const b = m[1] ? real : normal; b[key] = Math.max(b[key] ?? 0, Number(m[2])); }
      const re2 = new RegExp(`(\\d+)\\s*点?\\s*(真实)?\\s*${esc}`, 'gi');                            // 数在前：50点(真实)力量
      while ((m = re2.exec(t)) !== null) { const b = m[2] ? real : normal; b[key] = Math.max(b[key] ?? 0, Number(m[1])); }
    }
  }
  return { normal, real };
}

/* 对照持有者六维，返回**未达标**的装备需求项（空数组＝满足全部需求，可穿戴）。attrs 传有效六维(含真实属性点直加)。
   isRealTier=四阶起真实属性阶段：真实尺度需求(real)对所有人逐值比较；普通尺度需求(normal)只卡普通阶段玩家，
   真实属性玩家(isRealTier=true)自动满足普通需求（真实属性已超越普通维度）。 */
export function unmetRequirements(
  reqText: string | undefined,
  attrs: PlayerAttrs | undefined,
  isRealTier = false,
): { key: keyof PlayerAttrs; label: string; need: number; have: number; real: boolean }[] {
  const { normal, real } = parseAttrRequirement(reqText);
  const a = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const out: { key: keyof PlayerAttrs; label: string; need: number; have: number; real: boolean }[] = [];
  for (const key of ATTR_KEYS) {
    const rn = real[key];   // 真实尺度：人人逐值比
    if (rn && (a[key] ?? 0) < rn) out.push({ key, label: ATTR_LABEL[key], need: rn, have: a[key] ?? 0, real: true });
    const nn = normal[key]; // 普通尺度：真实属性玩家自动满足；普通玩家逐值比
    if (nn && !isRealTier && (a[key] ?? 0) < nn) out.push({ key, label: ATTR_LABEL[key], need: nn, have: a[key] ?? 0, real: false });
  }
  return out;
}

/* 有效六维（含全部加成）——喂给衍生属性/HP/EP 计算与展示。cap 给定时合计夹到本阶单属性极值（遵守阶位限制）。 */
export function effectiveAttrs(
  base: PlayerAttrs | undefined,
  skills: { attrBonus?: string; effect?: string }[] = [],
  talents: { attrBonus?: string; effect?: string }[] = [],
  equipped: { effect?: string; affix?: string; attrBonus?: string; combatStat?: string; condBonus?: boolean }[] = [],
  cap?: number,
): PlayerAttrs {
  const bd = computeAttrBreakdown(base, skills, talents, equipped, cap);
  return { str: bd.str.total, agi: bd.agi.total, con: bd.con.total, int: bd.int.total, cha: bd.cha.total, luck: bd.luck.total };
}
