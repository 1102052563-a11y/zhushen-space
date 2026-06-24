/* ════════════════════════════════════════════
   骰子检定引擎（ROLL 点）——纯前端确定性计算，AI 不写数值
   设计见仓库根 `摇骰子判定-集成指导.md`。要点：
   - 相对修正模型（属性 vs 自身均值），适配开放六维（前期5、后期上千）
   - 技能/天赋/装备走【递减收益 + 低封顶】（最强几项有用、堆数量无效），避免后期加成盖过难度
   - 双模式：DND d20（默认，1d20+MOD≥DC）/ CoC 百分骰（1d100≤P）
   - 对战 = 绝对强度差(强度档/阶位) + 相对修正差
   - 暴击后果倍率：大成功×2 / 碾压×1.5 / 成功×1 / 失败×0 / 大失败=反噬
   本文件只做数学；"哪个技能/天赋/状态相关"由调用方（DicePanel）从各 store 解析后传入。
════════════════════════════════════════════ */

export type DiceMode = 'd20' | 'd100';
export type Difficulty = '简单' | '普通' | '困难' | '极难' | '几乎不可能';
export type SkillTier = '入门' | '精通' | '大师' | '宗师' | '极道';
export type TalentRarity = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS' | '负面';
export type FavorTier = '敌对' | '冷淡' | '中立' | '友好' | '亲密' | '挚爱';
export type Advantage = 'adv' | 'norm' | 'dis';
export type OutcomeLevel = '大成功' | '碾压成功' | '极难成功' | '困难成功' | '成功' | '失败' | '大失败';

export interface DiceAttrs { str: number; agi: number; con: number; int: number; cha: number; luck: number }
export type AttrKey = keyof DiceAttrs;

export const ATTR_LABELS: Record<AttrKey, string> = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运',
};
export const ATTR_KEYS: AttrKey[] = ['str', 'agi', 'con', 'int', 'cha', 'luck'];

export const DIFFICULTIES: Difficulty[] = ['简单', '普通', '困难', '极难', '几乎不可能'];

/** 难度 → 百分骰基础率 / d20 DC（store 可覆盖） */
export const DIFFICULTY_BASE: Record<Difficulty, { rate: number; dc: number }> = {
  简单: { rate: 85, dc: 10 },
  普通: { rate: 65, dc: 13 },
  困难: { rate: 45, dc: 16 },
  极难: { rate: 25, dc: 20 },
  几乎不可能: { rate: 10, dc: 25 },
};

/** 敌方强度档 → 强度分（未建档敌人在骰子页选；建档 NPC 由 bioStrength/阶位 取） */
export const STRENGTH_TIERS: { key: string; label: string; score: number }[] = [
  { key: 'T0', label: 'T0 杂鱼', score: 0 },
  { key: 'T1', label: 'T1 一阶', score: 10 },
  { key: 'T2', label: 'T2 二阶', score: 20 },
  { key: 'T3', label: 'T3 勇士', score: 30 },
  { key: 'T4', label: 'T4 四阶', score: 40 },
  { key: 'T5', label: 'T5 五阶', score: 50 },
  { key: 'T6', label: 'T6 六阶', score: 60 },
  { key: 'T7', label: 'T7 七阶', score: 70 },
  { key: 'T8', label: 'T8 八阶', score: 80 },
  { key: 'T9', label: 'T9 源初', score: 90 },
];

/** 成功等级 → 后果倍率（大失败为反噬，倍率指反噬幅度） */
export const CRIT_MULT: Record<OutcomeLevel, number> = {
  大成功: 2, 碾压成功: 1.5, 极难成功: 1.5, 困难成功: 1.25, 成功: 1, 失败: 0, 大失败: 1,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const avgOf = (a: DiceAttrs) => ((a.str + a.agi + a.con + a.int + a.cha + a.luck) / 6) || 1;

/** 加成调参（可在 设置→变量管理→🎲ROLL点 调整，随 diceStore 持久化/导出）。
 *  *Cap = d20 尺度的封顶，百分骰自动 ×4；decay 越小递减越狠（越难被装备池碾压）。 */
export interface DiceTuning { skillCap: number; talentCap: number; equipCap: number; decay: number }
export const DEFAULT_TUNING: DiceTuning = { skillCap: 4, talentCap: 4, equipCap: 3, decay: 0.55 };

/* ── 各修正项（按模式不同尺度）── */
export function attrMod(attrVal: number, attrs: DiceAttrs, mode: DiceMode): number {
  const avg = avgOf(attrs);
  return mode === 'd20'
    ? clamp(Math.round(((attrVal - avg) / avg) * 6), -4, 5)
    : clamp(Math.round(((attrVal - avg) / avg) * 30), -15, 20);
}
export function luckMod(attrs: DiceAttrs, mode: DiceMode): number {
  const avg = avgOf(attrs);
  return mode === 'd20'
    ? clamp(Math.round(((attrs.luck - avg) / avg) * 2), -1, 2)
    : clamp(Math.round(((attrs.luck - avg) / avg) * 12), -8, 12);
}
const SKILL_D20: Record<SkillTier, number> = { 入门: 1, 精通: 2, 大师: 3, 宗师: 4, 极道: 5 };
const SKILL_D100: Record<SkillTier, number> = { 入门: 5, 精通: 10, 大师: 15, 宗师: 20, 极道: 25 };
export function skillMod(tier: SkillTier | null | undefined, mode: DiceMode): number {
  if (!tier) return 0;
  return mode === 'd20' ? SKILL_D20[tier] : SKILL_D100[tier];
}
const TALENT_D20: Record<TalentRarity, number> = { D: 1, C: 1, B: 2, A: 3, S: 4, SS: 5, SSS: 6, 负面: -2 };
const TALENT_D100: Record<TalentRarity, number> = { D: 3, C: 6, B: 9, A: 12, S: 16, SS: 21, SSS: 27, 负面: -12 };
export function talentMod(r: TalentRarity | null | undefined, mode: DiceMode): number {
  if (!r) return 0;
  return mode === 'd20' ? TALENT_D20[r] : TALENT_D100[r];
}
const FAVOR_D20: Record<FavorTier, number> = { 敌对: -4, 冷淡: -2, 中立: 0, 友好: 2, 亲密: 4, 挚爱: 6 };
const FAVOR_D100: Record<FavorTier, number> = { 敌对: -20, 冷淡: -10, 中立: 0, 友好: 10, 亲密: 20, 挚爱: 30 };
export function favorMod(f: FavorTier | null | undefined, mode: DiceMode): number {
  if (!f) return 0;
  return mode === 'd20' ? FAVOR_D20[f] : FAVOR_D100[f];
}
/** 对战绝对强度差（强度分之差） */
export function strengthDelta(myScore: number | undefined, enemyScore: number | undefined, mode: DiceMode): number {
  if (myScore == null || enemyScore == null) return 0;
  const d = myScore - enemyScore;
  return mode === 'd20' ? clamp(Math.round(d / 8), -6, 6) : clamp(Math.round(d * 0.6), -40, 40);
}

export interface SkillLite { level?: string }
export interface TalentLite { rarity?: string }
export interface EquipItemLite { category: string; grade?: number; combatStat?: string }

/** 递减收益：正贡献降序后按几何衰减求和（最强几项有用、长尾趋零，杜绝"堆数量"刷爆）；
 *  负贡献（负面天赋等）全额计入——惩罚不打折。decay 越小递减越狠（0.55≈有效项约前 3 个）。 */
function diminishingSum(vals: number[], decay = 0.55): number {
  let sum = 0, w = 1;
  for (const v of vals.filter((x) => x > 0).sort((a, b) => b - a)) { sum += v * w; w *= decay; }
  for (const v of vals) if (v < 0) sum += v;
  return sum;
}

/** 计入角色【全部】技能（递减收益：最强几项有用、长尾趋零；低封顶防碾压） */
export function skillsTotalMod(skills: SkillLite[] | undefined, mode: DiceMode, tune: DiceTuning = DEFAULT_TUNING): number {
  if (!skills?.length) return 0;
  const vals = skills.map((s) => skillMod(skillTierFromLevel(s.level), mode));
  const cap = mode === 'd20' ? tune.skillCap : tune.skillCap * 4;
  return clamp(Math.round(diminishingSum(vals, tune.decay)), -cap, cap);
}
/** 计入角色【全部】天赋（正项递减收益、负面全额；低封顶防碾压） */
export function talentsTotalMod(talents: TalentLite[] | undefined, mode: DiceMode, tune: DiceTuning = DEFAULT_TUNING): number {
  if (!talents?.length) return 0;
  const vals = talents.map((t) => talentMod(talentRarityFromRaw(t.rarity), mode));
  const cap = mode === 'd20' ? tune.talentCap : tune.talentCap * 4;
  return clamp(Math.round(diminishingSum(vals, tune.decay)), -cap, cap);
}

/** 装备品类对某属性检定的相关权重（武器→力/敏攻击，防具→体质防御，饰品→智/魅/幸） */
function equipWeight(cat: string, attr: AttrKey): number {
  const isCombat = attr === 'str' || attr === 'agi';
  if (cat === '武器') return isCombat ? 1 : attr === 'con' ? 0.3 : 0.1;
  if (cat === '防具') return attr === 'con' ? 1 : isCombat ? 0.3 : 0.1;
  return attr === 'int' || attr === 'cha' || attr === 'luck' ? 0.5 : 0.2;  // 饰品/特殊/法宝/其它
}
/** 已装备物品对检定的加成（按属性相关性 × 品质，递减收益 + 低封顶防碾压） */
export function equipMod(equipped: EquipItemLite[] | undefined, attrKey: AttrKey, mode: DiceMode, tune: DiceTuning = DEFAULT_TUNING): number {
  if (!equipped?.length) return 0;
  const per = mode === 'd20' ? 0.4 : 2;
  const vals = equipped.map((it) => Math.max(1, it.grade ?? 1) * equipWeight(it.category, attrKey) * per);
  const cap = mode === 'd20' ? tune.equipCap : tune.equipCap * 4;
  return clamp(Math.round(diminishingSum(vals, tune.decay)), -cap, cap);
}

/* ── 文本→枚举解析（供调用方从 store 数据提取）── */
export function skillTierFromLevel(level?: string): SkillTier | null {
  const s = level ?? '';
  for (const t of ['极道', '宗师', '大师', '精通', '入门'] as SkillTier[]) if (s.includes(t)) return t;
  return null;
}
export function talentRarityFromRaw(raw?: string): TalentRarity | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/负|诅咒|debuff/i.test(s)) return '负面';
  const up = s.toUpperCase();
  for (const r of ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D'] as TalentRarity[]) if (up.includes(r)) return r;
  return null;
}
export function favorTierFromValue(favor: number | undefined): FavorTier {
  const v = favor ?? 50;
  if (v < 0) return '敌对';
  if (v < 30) return '冷淡';
  if (v < 50) return '中立';
  if (v < 70) return '友好';
  if (v < 90) return '亲密';
  return '挚爱';
}
/** 从 bioStrength 文本（"T3·勇士"）取强度分；取不到按阶位/等级兜底 */
export function strengthScoreFromBio(bio?: string, realmLevel?: number): number | undefined {
  const m = /T(\d)/i.exec(bio ?? '');
  if (m) return Math.min(9, Number(m[1])) * 10;
  if (realmLevel != null) return clamp(Math.round(realmLevel / 10) * 10, 0, 90);
  return undefined;
}

/* ── 掷骰 ── */
export function rollDie(sides: number): number { return Math.floor(Math.random() * Math.max(2, sides)) + 1; }

/** 解析并掷 "2d6+3" / "1d20" / "3d6*2" / 纯数字 */
export function rollExpr(expr: string): { total: number; rolls: number[]; detail: string } {
  const m = String(expr).replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?(?:[*×](\d+(?:\.\d+)?))?$/i);
  if (!m) {
    const n = Number(expr);
    return Number.isFinite(n) ? { total: n, rolls: [], detail: String(n) } : { total: 0, rolls: [], detail: '0' };
  }
  const count = clamp(parseInt(m[1] || '1', 10), 1, 50);
  const sides = Math.max(2, parseInt(m[2], 10));
  const add = m[3] ? parseInt(m[3], 10) : 0;
  const mult = m[4] ? parseFloat(m[4]) : 1;
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  const total = Math.round((rolls.reduce((a, b) => a + b, 0) + add) * mult);
  const addStr = add ? (add > 0 ? `+${add}` : `${add}`) : '';
  const multStr = mult !== 1 ? `×${mult}` : '';
  return { total, rolls, detail: `${count}d${sides}${addStr}${multStr} = [${rolls.join(',')}]${addStr}${multStr} = ${total}` };
}

/* ── 主裁决 ── */
/** 一方的检定要素（对战时敌方用） */
export interface ResolveSide {
  attrs: DiceAttrs;
  attrKey: AttrKey;
  skills?: SkillLite[];
  talents?: TalentLite[];
  equipped?: EquipItemLite[];
  extraMod?: number;
}

export interface ResolveInput {
  mode: DiceMode;
  attrs: DiceAttrs;
  attrKey: AttrKey;
  difficulty: Difficulty;
  skills?: SkillLite[];          // 【全部】技能，自动计入（不再只选一个）
  talents?: TalentLite[];        // 【全部】天赋
  equipped?: EquipItemLite[];    // 已装备物品（按属性相关性计入）
  favorTier?: FavorTier | null;
  extraMod?: number;             // 情境/状态修正（native 尺度）
  includeLuck?: boolean;         // 默认 true
  advantage?: Advantage;         // 默认 norm
  opposed?: boolean;
  myStrengthScore?: number;
  enemyStrengthScore?: number;
  enemy?: ResolveSide;           // 对战时敌方（算其全部技能/天赋/装备）
  diffBase?: Partial<Record<Difficulty, { rate: number; dc: number }>>;
  tuning?: DiceTuning;           // 技能/天赋/装备封顶 + 递减强度（留空用 DEFAULT_TUNING）
}

export interface ResolveResult {
  mode: DiceMode;
  dice: number[];             // 实际掷出的骰子（优劣势含 2 颗）
  chosen: number;             // 取用的那颗
  mods: { attr: number; skill: number; talent: number; equip: number; favor: number; luck: number; extra: number; strength: number; enemyRel: number; total: number };
  dc: number;                 // d20=DC；d100=目标 P
  P: number;                  // 成功率%
  total: number;              // d20=chosen+mods.total；d100=chosen
  success: boolean;
  level: OutcomeLevel;
  isCrit: boolean;
  isFumble: boolean;
  multiplier: number;
  backlash: boolean;
}

function pickAdvantage(adv: Advantage): { dice: number[]; chosen: number; pTransform: (p: number) => number } {
  if (adv === 'adv') { const a = rollDie(20), b = rollDie(20); return { dice: [a, b], chosen: Math.max(a, b), pTransform: (p) => 1 - (1 - p) * (1 - p) }; }
  if (adv === 'dis') { const a = rollDie(20), b = rollDie(20); return { dice: [a, b], chosen: Math.min(a, b), pTransform: (p) => p * p }; }
  const a = rollDie(20); return { dice: [a], chosen: a, pTransform: (p) => p };
}

export function resolve(inp: ResolveInput): ResolveResult {
  const mode = inp.mode;
  const base = { ...DIFFICULTY_BASE, ...(inp.diffBase ?? {}) };
  const includeLuck = inp.includeLuck !== false;
  const adv = inp.advantage ?? 'norm';
  const tune = inp.tuning ?? DEFAULT_TUNING;

  const mAttr = attrMod(inp.attrs[inp.attrKey] ?? 5, inp.attrs, mode);
  const mSkill = skillsTotalMod(inp.skills, mode, tune);
  const mTalent = talentsTotalMod(inp.talents, mode, tune);
  const mEquip = 0;  // 装备(+宝石)六维已并入有效属性 inp.attrs（见 attrBonus.effectiveAttrs），不再按品级二次加成，防双算
  const mFavor = favorMod(inp.favorTier, mode);
  const mLuck = includeLuck ? luckMod(inp.attrs, mode) : 0;
  const mExtra = Math.round(inp.extraMod ?? 0);
  const mStrength = inp.opposed ? strengthDelta(inp.myStrengthScore, inp.enemyStrengthScore, mode) : 0;
  const e = inp.enemy;
  const enemyRel = inp.opposed && e
    ? attrMod(e.attrs[e.attrKey] ?? 5, e.attrs, mode) + skillsTotalMod(e.skills, mode, tune) + talentsTotalMod(e.talents, mode, tune) + Math.round(e.extraMod ?? 0)
    : 0;
  const relTotal = mAttr + mSkill + mTalent + mEquip + mFavor + mLuck + mExtra;
  const modTotal = relTotal + mStrength;
  const mods = { attr: mAttr, skill: mSkill, talent: mTalent, equip: mEquip, favor: mFavor, luck: mLuck, extra: mExtra, strength: mStrength, enemyRel, total: modTotal };

  if (mode === 'd20') {
    const dc = inp.opposed ? 13 + Math.round(enemyRel) : base[inp.difficulty].dc;
    const { dice, chosen, pTransform } = pickAdvantage(adv);
    const total = chosen + modTotal;
    // 成功率：单骰命中面数 → 优劣势变换
    let faces = 0;
    for (let n = 1; n <= 20; n++) { if (n === 20) { faces++; continue; } if (n === 1) continue; if (n + modTotal >= dc) faces++; }
    const P = clamp(Math.round(pTransform(faces / 20) * 100), 5, 95);
    let level: OutcomeLevel;
    if (chosen === 20) level = '大成功';
    else if (chosen === 1) level = '大失败';
    else if (total >= dc) level = (total - dc) >= 10 ? '碾压成功' : '成功';
    else level = '失败';
    const success = level !== '失败' && level !== '大失败';
    return { mode, dice, chosen, mods, dc, P, total, success, level, isCrit: level === '大成功', isFumble: level === '大失败', multiplier: CRIT_MULT[level], backlash: level === '大失败' };
  }

  // d100（CoC 百分骰）
  const P = inp.opposed
    ? clamp(50 + mStrength + (relTotal - enemyRel), 5, 95)
    : clamp(base[inp.difficulty].rate + relTotal, 5, 95);
  let chosen: number; let dice: number[];
  if (adv === 'adv') { const a = rollDie(100), b = rollDie(100); chosen = Math.min(a, b); dice = [a, b]; }
  else if (adv === 'dis') { const a = rollDie(100), b = rollDie(100); chosen = Math.max(a, b); dice = [a, b]; }
  else { chosen = rollDie(100); dice = [chosen]; }
  let level: OutcomeLevel;
  if (chosen >= 96) level = '大失败';
  else if (chosen <= 5) level = '大成功';
  else if (chosen <= P / 5) level = '极难成功';
  else if (chosen <= P / 2) level = '困难成功';
  else if (chosen <= P) level = '成功';
  else level = '失败';
  const success = level !== '失败' && level !== '大失败';
  return { mode, dice, chosen, mods, dc: P, P, total: chosen, success, level, isCrit: level === '大成功', isFumble: level === '大失败', multiplier: CRIT_MULT[level], backlash: level === '大失败' };
}

/** 把裁决结果拼成注入主提示词的 `<检定结果>` 块 */
export function buildCheckResultBlock(opts: {
  actorName: string; actionText?: string; attrLabel: string;
  difficulty?: Difficulty; opposed?: boolean; opponentName?: string;
  res: ResolveResult;
}): string {
  const { actorName, attrLabel, difficulty, opposed, opponentName, res } = opts;
  const head = opposed
    ? `${actorName}（${attrLabel}） vs ${opponentName || '对手'}`
    : `${actorName}（${attrLabel}）${difficulty ? ` 难度=${difficulty}` : ''}`;
  const calc = res.mode === 'd20'
    ? `d20:${res.chosen} + 修正${res.mods.total >= 0 ? '+' : ''}${res.mods.total} = ${res.total} ${res.success ? '≥' : '<'} DC${res.dc}`
    : `d100:${res.chosen} ${res.success ? '≤' : '>'} 成功率${res.P}%`;
  const mult = res.backlash ? '（大失败·后果反噬己方）' : res.multiplier !== 1 ? `（后果×${res.multiplier}）` : '';
  return `<检定结果> ${head} → ${res.level}${mult}（${calc}） </检定结果>\n（以上为系统骰子判定结果，请让本回合剧情严格服从该成败与等级，不要推翻。）`;
}
