/* ════════════════════════════════════════════
   战斗原语 · 标签系统（Tag VM 的数据层与纯规则）
   —— 技能 = 「标签 + 参数」的集合；前端只认本表枚举，算不出的标签直接忽略 → 技能永远跑不出战斗系统。
   本文件**不依赖任何 store**（纯函数 + 常量），可单测、可被 combatEngine / 提示词 / 面板共用。
   设计文档：指导/战斗系统-重置-设计.md（§3 标签注册表 / §4 伤害公式）

   Step 1（本次）：类型 + 注册表 + 纯公式 + AI 输出校验 + 旧档关键词兜底。
   实际「执行标签改 Combatant 状态」在 Step 2 的 combatEngine.settleAction 里调用本文件的纯件拼装。
════════════════════════════════════════════ */

// ── 标签枚举 ──
export type CombatTag =
  // P0 核心 10
  | 'deal' | 'block' | 'heal' | 'restore'
  | 'strength' | 'dexterity' | 'vulnerable' | 'weak' | 'poison' | 'stun'
  // P1 扩展
  | 'lifesteal' | 'thorns' | 'regen' | 'burn' | 'sunder' | 'silence'
  | 'execute' | 'pierce' | 'cleanse' | 'dispel' | 'taunt' | 'charge';

export type TargetMode = 'self' | 'ally' | 'enemy' | 'allEnemy' | 'allAlly' | 'all';
export const TARGET_MODES: TargetMode[] = ['self', 'ally', 'enemy', 'allEnemy', 'allAlly', 'all'];

/** 一条战斗效果（AI 生成时只能填这个；前端只读这个） */
export interface CombatEffect {
  tag: CombatTag;
  mult?: number;       // 倍率：×出手方攻击力档(deal/lifesteal/execute) 或 ×防御力档(block)
  flat?: number;       // 固定值（与 mult 叠加；纯固定值技能只填 flat）
  stacks?: number;     // 层数：buff/debuff 强度、毒层、聚能层
  turns?: number;      // 持续回合（回合型 buff/debuff/控制；99=本场常驻）
  times?: number;      // 连击次数（deal 专用，默认 1）
  chance?: number;     // 触发概率 0~1（默认 1 = 必中/必触发）
  target?: TargetMode; // 覆盖技能默认目标（少见，如「攻击同时给自己加盾」）
}

/** 一个技能/道具的战斗规格 */
export interface CombatSpec {
  cost?: number;       // EP 消耗（缺省 0）
  target?: TargetMode; // 默认作用目标
  effects: CombatEffect[];
}

// ── 公式常量（手感集中在此，§4） ──
export const VULN_MULT = 1.5;   // 易伤：目标受伤 ×1.5
export const WEAK_MULT = 0.75;  // 虚弱：出手方造伤 ×0.75
export const STR_FRAC = 0.10;   // 力量每层 ≈ +10% 攻击力档（折成固定加值）
export const DEX_FRAC = 0.10;   // 敏捷每层 ≈ +10% 防御力档（折成格挡加值）
export const EXECUTE_THRESHOLD = 0.20; // 斩杀阈值：目标 HP 占比 ≤ 此值可被秒（默认）

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return undefined;
}

/** 力量层数 → 折算的固定攻击加值（与攻击力档挂钩，故各阶位都有意义） */
export function strengthBonus(stacks: number | undefined, atkTier: number): number {
  return Math.round((stacks || 0) * Math.max(0, atkTier) * STR_FRAC);
}
/** 敏捷层数 → 折算的格挡加值 */
export function dexterityBonus(stacks: number | undefined, defTier: number): number {
  return Math.round((stacks || 0) * Math.max(0, defTier) * DEX_FRAC);
}

/**
 * §4 伤害修正链（纯函数，扣盾前）：base → 虚弱×0.75 → +力量 → 易伤×1.5。
 * 暴击与扣护盾在 settleAction 里处理（需目标状态）。
 */
export function applyDamageModifiers(opts: {
  base: number;
  strengthBonus?: number;   // 已折算的力量加值（见 strengthBonus）
  attackerWeak?: boolean;
  targetVulnerable?: boolean;
}): number {
  let dmg = Math.max(0, opts.base);
  if (opts.attackerWeak) dmg *= WEAK_MULT;
  dmg += (opts.strengthBonus || 0);
  if (opts.targetVulnerable) dmg *= VULN_MULT;
  return Math.max(0, Math.round(dmg));
}

// ── 标签注册表（面板 chip / 校验 / 生成提示词 三处共用单一来源） ──
export type TagKind = 'damage' | 'defend' | 'heal' | 'resource' | 'buff' | 'debuff' | 'control' | 'special';
export type TagParam = 'mult' | 'flat' | 'stacks' | 'turns' | 'times';

export interface TagDef {
  tag: CombatTag;
  label: string;          // 中文名
  emoji: string;
  kind: TagKind;
  tone: 'buff' | 'debuff' | 'neutral';
  uses: TagParam[];       // 用到哪些参数（提示词 / 面板据此提示）
  desc: string;           // 给 AI 看的一句说明（也作面板 tooltip）
  tier: 0 | 1;            // 0=P0 核心 / 1=P1 扩展
}

export const TAG_REGISTRY: Record<CombatTag, TagDef> = {
  deal:       { tag: 'deal',       label: '伤害',   emoji: '⚔️', kind: 'damage',   tone: 'neutral', uses: ['mult', 'flat', 'times'], desc: '造成伤害=mult×攻击力档(+flat)，times 为连击次数', tier: 0 },
  block:      { tag: 'block',      label: '格挡',   emoji: '🛡️', kind: 'defend',   tone: 'buff',    uses: ['mult', 'flat'],          desc: '获得护盾=mult×防御力档(+flat)，回合末清零', tier: 0 },
  heal:       { tag: 'heal',       label: '治疗',   emoji: '💚', kind: 'heal',     tone: 'buff',    uses: ['mult', 'flat'],          desc: '回复 HP=mult×攻击力档(+flat)，不超上限', tier: 0 },
  restore:    { tag: 'restore',    label: '回能',   emoji: '🔷', kind: 'resource', tone: 'buff',    uses: ['flat'],                  desc: '回复 EP=flat', tier: 0 },
  strength:   { tag: 'strength',   label: '力量',   emoji: '💪', kind: 'buff',     tone: 'buff',    uses: ['stacks', 'turns'],       desc: '每层使出手伤害 +10% 攻击力档', tier: 0 },
  dexterity:  { tag: 'dexterity',  label: '敏捷',   emoji: '🌀', kind: 'buff',     tone: 'buff',    uses: ['stacks', 'turns'],       desc: '每层使格挡量 +10% 防御力档', tier: 0 },
  vulnerable: { tag: 'vulnerable', label: '易伤',   emoji: '💥', kind: 'debuff',   tone: 'debuff',  uses: ['stacks', 'turns'],       desc: '目标受到的伤害 ×1.5（按回合）', tier: 0 },
  weak:       { tag: 'weak',       label: '虚弱',   emoji: '🥀', kind: 'debuff',   tone: 'debuff',  uses: ['stacks', 'turns'],       desc: '目标造成的伤害 ×0.75（按回合）', tier: 0 },
  poison:     { tag: 'poison',     label: '中毒',   emoji: '🧪', kind: 'debuff',   tone: 'debuff',  uses: ['stacks'],                desc: '每回合损失=层数 HP，然后层数−1', tier: 0 },
  stun:       { tag: 'stun',       label: '眩晕',   emoji: '💫', kind: 'control',  tone: 'debuff',  uses: ['turns'],                 desc: '跳过目标接下来的 turns 个行动回合', tier: 0 },

  lifesteal:  { tag: 'lifesteal',  label: '吸血',   emoji: '🩸', kind: 'damage',   tone: 'neutral', uses: ['mult', 'flat'],          desc: '造成伤害并回复其 50% 为 HP', tier: 1 },
  thorns:     { tag: 'thorns',     label: '荆棘',   emoji: '🌵', kind: 'buff',     tone: 'buff',    uses: ['stacks', 'turns'],       desc: '受到攻击时反弹=层数 的伤害给攻击者', tier: 1 },
  regen:      { tag: 'regen',      label: '再生',   emoji: '♻️', kind: 'heal',     tone: 'buff',    uses: ['stacks', 'turns'],       desc: '每回合回复=层数×攻击力档 5% 的 HP', tier: 1 },
  burn:       { tag: 'burn',       label: '燃烧',   emoji: '🔥', kind: 'debuff',   tone: 'debuff',  uses: ['flat', 'turns'],         desc: '每回合损失 flat HP，持续 turns 回合（定额）', tier: 1 },
  sunder:     { tag: 'sunder',     label: '碎甲',   emoji: '🪓', kind: 'debuff',   tone: 'debuff',  uses: ['stacks', 'turns'],       desc: '目标防御力档 −10%/层（按回合）', tier: 1 },
  silence:    { tag: 'silence',    label: '沉默',   emoji: '🤐', kind: 'control',  tone: 'debuff',  uses: ['turns'],                 desc: '目标 turns 回合内不能使用技能（只能普攻/防御）', tier: 1 },
  execute:    { tag: 'execute',    label: '斩杀',   emoji: '☠️', kind: 'special',  tone: 'neutral', uses: ['mult'],                  desc: '目标 HP 占比 ≤20% 时直接击杀，否则按 mult 造伤', tier: 1 },
  pierce:     { tag: 'pierce',     label: '穿透',   emoji: '🗡️', kind: 'damage',   tone: 'neutral', uses: ['mult', 'flat'],          desc: '无视目标护盾直接造伤', tier: 1 },
  cleanse:    { tag: 'cleanse',    label: '净化',   emoji: '✨', kind: 'special',  tone: 'buff',    uses: [],                        desc: '移除自身全部减益', tier: 1 },
  dispel:     { tag: 'dispel',     label: '驱散',   emoji: '🌪️', kind: 'special',  tone: 'debuff',  uses: [],                        desc: '移除目标全部增益', tier: 1 },
  taunt:      { tag: 'taunt',      label: '嘲讽',   emoji: '📢', kind: 'control',  tone: 'debuff',  uses: ['turns'],                 desc: '强制目标 turns 回合内优先攻击施法者', tier: 1 },
  charge:     { tag: 'charge',     label: '聚能',   emoji: '⚡', kind: 'buff',     tone: 'buff',    uses: ['stacks'],                desc: '下次伤害 ×(1+0.5×层数)（复用蓄力结构）', tier: 1 },
};

export const ALL_TAGS: CombatTag[] = Object.keys(TAG_REGISTRY) as CombatTag[];
export function isCombatTag(x: unknown): x is CombatTag {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(TAG_REGISTRY, x);
}

/** 校验 AI 输出的 effects[]：丢非法 tag、夹紧参数、补 chance 默认 1。 */
export function normalizeEffects(raw: unknown): CombatEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: CombatEffect[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || !isCombatTag((r as any).tag)) continue;
    const e = r as Record<string, unknown>;
    const eff: CombatEffect = { tag: e.tag as CombatTag };
    const mult = toNum(e.mult); if (mult !== undefined) eff.mult = clamp(mult, 0, 20);
    const flat = toNum(e.flat); if (flat !== undefined) eff.flat = clamp(Math.round(flat), 0, 1_000_000);
    const stacks = toNum(e.stacks); if (stacks !== undefined) eff.stacks = clamp(Math.round(stacks), 0, 99);
    const turns = toNum(e.turns); if (turns !== undefined) eff.turns = clamp(Math.round(turns), 0, 99);
    const times = toNum(e.times); if (times !== undefined) eff.times = clamp(Math.round(times), 1, 20);
    const chance = toNum(e.chance); eff.chance = chance !== undefined ? clamp(chance, 0, 1) : 1;
    if (typeof e.target === 'string' && (TARGET_MODES as string[]).includes(e.target)) eff.target = e.target as TargetMode;
    out.push(eff);
    if (out.length >= 8) break;   // 单技能最多 8 个效果，防失控
  }
  return out;
}

function validTarget(x: unknown): TargetMode | undefined {
  return typeof x === 'string' && (TARGET_MODES as string[]).includes(x) ? (x as TargetMode) : undefined;
}

/** 旧技能（无 numeric.combat）兜底：从文本字段关键词反推标签，保证旧档不崩。 */
export interface SkillLike {
  name?: string; desc?: string; effect?: string; damage?: string; skillType?: string;
  tags?: string[]; cost?: string; attrBonus?: string;
  combat?: unknown;   // AI 可直接输出顶层 combat（addSkill 透传保留）；与 numeric.combat 等价
  numeric?: { combat?: unknown;[k: string]: unknown };
}

/** 从 damage 字段抽倍率/固定值，如「法术攻击180%」→mult1.8、「+30固定」→flat30。 */
function parseMagnitude(s?: string): { mult?: number; flat?: number } {
  if (!s) return {};
  const out: { mult?: number; flat?: number } = {};
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) out.mult = clamp(Number(pct[1]) / 100, 0, 20);
  const flat = s.match(/\+?\s*(\d+)\s*(?:点)?\s*固定|固定\s*(\d+)/);
  if (flat) out.flat = clamp(Number(flat[1] ?? flat[2]), 0, 1_000_000);
  return out;
}

export function inferEffectsFromSkill(s: SkillLike): CombatEffect[] {
  const text = [s.name, s.desc, s.effect, s.damage, s.skillType, ...(s.tags ?? [])].filter(Boolean).join(' ');
  const has = (re: RegExp) => re.test(text);
  const mag = parseMagnitude(s.damage || s.effect);
  const out: CombatEffect[] = [];
  const push = (e: CombatEffect) => { if (!out.some((x) => x.tag === e.tag)) out.push(e); };

  if (has(/治疗|治療|回复|恢复|回血|愈合|奶量?/)) push({ tag: 'heal', mult: mag.mult ?? 1.0, flat: mag.flat });
  if (has(/护盾|格挡|护罩|结界|防护|铁壁|护体|防御姿态/)) push({ tag: 'block', mult: mag.mult ?? 1.0, flat: mag.flat });
  if (has(/中毒|剧毒|毒(?!瘤)/)) push({ tag: 'poison', stacks: 3 });
  if (has(/燃烧|灼烧|点燃|焚|烈焰加身/)) push({ tag: 'burn', flat: mag.flat ?? 8, turns: 3 });
  if (has(/眩晕|定身|冰冻|石化|麻痹|击晕|控制/)) push({ tag: 'stun', turns: 1 });
  if (has(/沉默|封印技能/)) push({ tag: 'silence', turns: 1 });
  if (has(/易伤|破绽|破防|防御下降/)) push({ tag: 'vulnerable', stacks: 2 });
  if (has(/虚弱|削弱|攻击下降|降低攻击/)) push({ tag: 'weak', stacks: 2 });
  if (has(/碎甲|破甲|护甲粉碎/)) push({ tag: 'sunder', stacks: 2 });
  if (has(/斩杀|处决|秒杀/)) push({ tag: 'execute', mult: mag.mult ?? 1.0 });
  if (has(/吸血|汲取|生命汲取|嗜血/)) push({ tag: 'lifesteal', mult: mag.mult ?? 1.0 });
  if (has(/嘲讽|挑衅/)) push({ tag: 'taunt', turns: 2 });
  if (has(/荆棘|反伤|反弹伤害/)) push({ tag: 'thorns', stacks: Math.round(mag.flat ?? 5) });
  if (has(/再生|持续回复|回春/)) push({ tag: 'regen', stacks: 1, turns: 3 });
  if (has(/力量|增伤|攻击提升|战意/)) push({ tag: 'strength', stacks: 2, turns: 3 });
  if (has(/净化|解控/)) push({ tag: 'cleanse' });
  if (has(/驱散/)) push({ tag: 'dispel' });

  // 主动技能默认是一次攻击（除非已识别为纯增益/治疗类）
  const onlySupport = out.length > 0 && out.every((e) => ['heal', 'block', 'restore', 'strength', 'dexterity', 'regen', 'cleanse', 'thorns', 'charge'].includes(e.tag));
  if (!onlySupport) {
    const isAttacky = has(/伤害|攻击|斩|劈|刺|轰|击|爆|射|拳|掌|剑气|法术/) || mag.mult !== undefined;
    if (isAttacky || out.length === 0) out.unshift({ tag: 'deal', mult: mag.mult ?? 1.0, flat: mag.flat, times: 1 });
  }
  return out.slice(0, 6);
}

/** EP 消耗：优先 numeric.combat.cost，否则从 cost 字符串抽数字，否则 0。 */
function parseCost(s: SkillLike, specCost?: unknown): number {
  const c = toNum(specCost);
  if (c !== undefined) return clamp(Math.round(c), 0, 9999);
  const m = (s.cost || '').match(/(\d+)/);
  return m ? clamp(Number(m[1]), 0, 9999) : 0;
}

function guessTarget(effects: CombatEffect[]): TargetMode {
  if (effects.length === 0) return 'enemy';
  const allSelf = effects.every((e) => ['heal', 'block', 'restore', 'strength', 'dexterity', 'regen', 'cleanse', 'charge'].includes(e.tag));
  return allSelf ? 'self' : 'enemy';
}

/** 取技能的战斗规格：有合法 combat(顶层或 numeric.combat) 用之，否则关键词兜底。前端战斗只调这里。 */
export function parseCombatSpec(skill: SkillLike): CombatSpec {
  const raw: any = skill?.numeric?.combat ?? (skill as any)?.combat;
  if (raw && typeof raw === 'object') {
    const effects = normalizeEffects(raw.effects);
    if (effects.length) return { cost: parseCost(skill, raw.cost), target: validTarget(raw.target) ?? guessTarget(effects), effects };
  }
  const inferred = inferEffectsFromSkill(skill);
  return { cost: parseCost(skill), target: guessTarget(inferred), effects: inferred };
}

/** 生成提示词用的枚举表（SKILL_COMBAT_TAG_RULE 注入，保证与注册表永不脱节）。 */
export function tagPromptTable(tier: 0 | 1 | 'all' = 'all'): string {
  const rows = ALL_TAGS
    .filter((t) => tier === 'all' || TAG_REGISTRY[t].tier === tier)
    .map((t) => {
      const d = TAG_REGISTRY[t];
      const params = d.uses.length ? d.uses.join('/') : '无参数';
      return `- ${d.tag}（${d.label}）｜参数:${params}｜${d.desc}`;
    });
  return rows.join('\n');
}

/* ════════════════════════════════════════════
   条件触发系统（C）—— 让技能树/AI 技能的「被动修正」与「条件触发」在前端结算。
   · 被动修正(PassiveMod)：常驻、来自所有技能/天赋、聚合后全程生效（暴击/增伤减伤/穿透/冷却缩减/多段）。
   · 触发器(CombatTrigger)：on 事件(命中/受击/击杀/回合开始) + 可选 cond 条件 + chance 概率 → 触发一个标签效果。
   高度个性化的叙事效果仍不强求建模（归 AI 叙事）。
════════════════════════════════════════════ */
export type TriggerEvent = 'onHit' | 'onHurt' | 'onKill' | 'turnStart' | 'onDefend';
export const TRIGGER_EVENTS: TriggerEvent[] = ['onHit', 'onHurt', 'onKill', 'turnStart', 'onDefend'];
export type TriggerCond = 'always' | 'targetBurning' | 'targetPoisoned' | 'targetStunned' | 'targetLowHp' | 'selfLowHp' | 'selfHasShield';
export const TRIGGER_CONDS: TriggerCond[] = ['always', 'targetBurning', 'targetPoisoned', 'targetStunned', 'targetLowHp', 'selfLowHp', 'selfHasShield'];

/** 一条触发器：on 事件发生时(可选满足 cond·按 chance 概率)触发 effect（标签效果，作用对象同事件目标/自身）。 */
export interface CombatTrigger { on: TriggerEvent; cond?: TriggerCond; chance?: number; effect: CombatEffect; note?: string }

/** 被动战斗修正（常驻；来自技能/天赋，聚合后全程生效）。所有项默认 0/无。 */
export interface PassiveMod {
  critChance?: number;   // 暴击几率 0~1（默认 0 = 无暴击。基础必中之上偶尔暴击）
  critMult?: number;     // 暴击伤害·加成（叠在基础 CRIT_BASE 之上，0.25=暴伤+25%）
  dmgDealtPct?: number;  // 造成伤害 +%（0.2=+20%；负=减少）
  dmgTakenPct?: number;  // 受到伤害 +%（负=减伤，-0.1=减伤10%）
  pierce?: number;       // 无视目标防御档的比例 0~1
  cdr?: number;          // 技能冷却缩减回合数
  extraHits?: number;    // 攻击额外段数（deal 多段）
}
export const CRIT_BASE = 1.5;   // 暴击基础倍率（之上叠 PassiveMod.critMult）

/** 校验/夹紧 AI 输出的 passive。 */
export function normalizePassive(raw: unknown): PassiveMod | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>; const p: PassiveMod = {};
  const cc = toNum(r.critChance); if (cc !== undefined) p.critChance = clamp(cc, 0, 1);
  const cm = toNum(r.critMult); if (cm !== undefined) p.critMult = clamp(cm, 0, 10);
  const dd = toNum(r.dmgDealtPct); if (dd !== undefined) p.dmgDealtPct = clamp(dd, -0.9, 5);
  const dt = toNum(r.dmgTakenPct); if (dt !== undefined) p.dmgTakenPct = clamp(dt, -0.9, 5);
  const pi = toNum(r.pierce); if (pi !== undefined) p.pierce = clamp(pi, 0, 1);
  const cd = toNum(r.cdr); if (cd !== undefined) p.cdr = clamp(Math.round(cd), 0, 9);
  const eh = toNum(r.extraHits); if (eh !== undefined) p.extraHits = clamp(Math.round(eh), 0, 9);
  return Object.keys(p).length ? p : undefined;
}

/** 校验 AI 输出的 triggers[]。 */
export function normalizeTriggers(raw: unknown): CombatTrigger[] {
  if (!Array.isArray(raw)) return [];
  const out: CombatTrigger[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const t = r as Record<string, unknown>;
    if (!(TRIGGER_EVENTS as string[]).includes(t.on as string)) continue;
    const eff = normalizeEffects([t.effect])[0];
    if (!eff) continue;
    const trig: CombatTrigger = { on: t.on as TriggerEvent, effect: eff };
    if ((TRIGGER_CONDS as string[]).includes(t.cond as string)) trig.cond = t.cond as TriggerCond;
    const ch = toNum(t.chance); trig.chance = ch !== undefined ? clamp(ch, 0, 1) : 1;
    out.push(trig);
    if (out.length >= 8) break;
  }
  return out;
}

/** 旧档/未标注技能·天赋：从 effect 文本解析常见被动修正（暴击/增伤减伤/穿透/冷却/多段）。 */
export function inferPassiveFromSkill(s: SkillLike): PassiveMod | undefined {
  const text = [s.name, s.effect, s.desc, s.attrBonus, ...(s.tags ?? [])].filter(Boolean).join(' ');
  if (!text) return undefined;
  const pct = (re: RegExp): number | undefined => { const m = text.match(re); return m ? clamp(Number(m[1]) / 100, 0, 5) : undefined; };
  const p: PassiveMod = {}; let v: number | undefined;
  if ((v = pct(/暴击(?:率|几率)\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined) p.critChance = clamp(v, 0, 1);
  if ((v = pct(/暴击伤害\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined) p.critMult = v;
  if ((v = pct(/(?:受到|承受)[^，。；]{0,6}伤害[^，。；]{0,3}(?:降低|减少|[-−])\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined || (v = pct(/减伤\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined) p.dmgTakenPct = -Math.abs(v!);
  if ((v = pct(/(?:造成|输出|增伤)[^，。；]{0,4}(?:伤害)?[^，。；]{0,2}[+＋]\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined) p.dmgDealtPct = v;
  if ((v = pct(/(?:穿透|破甲|无视(?:护甲|防御))\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/)) !== undefined) p.pierce = clamp(v, 0, 1);
  else if (/穿透|无视(?:护甲|防御)/.test(text)) p.pierce = 0.5;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/冷却[^，。；]{0,4}(?:缩减|降低|[-−])\s*(\d+)\s*回合?/))) p.cdr = clamp(Number(m[1]), 0, 9);
  if ((m = text.match(/(?:额外|追加|多段|连击)[^，。；]{0,4}(\d+)\s*段/))) p.extraHits = clamp(Number(m[1]), 0, 9);
  else if (/连击|多段|二连|三连/.test(text)) p.extraHits = 1;
  return Object.keys(p).length ? p : undefined;
}

/** 旧档/未标注技能·天赋：解析少数常见「条件触发」（击杀回血 / 命中几率挂状态 / 对燃烧·中毒目标增伤）。 */
export function inferTriggersFromSkill(s: SkillLike): CombatTrigger[] {
  const text = [s.name, s.effect, s.desc, ...(s.tags ?? [])].filter(Boolean).join(' ');
  if (!text) return [];
  const out: CombatTrigger[] = []; let m: RegExpMatchArray | null;
  // 击杀后回血
  if ((m = text.match(/击杀|斩杀|处决/)) && /回复|回血|生命/.test(text)) {
    const fm = text.match(/(\d{2,5})\s*(?:点)?\s*(?:生命|血|HP)/i);
    out.push({ on: 'onKill', chance: 1, effect: { tag: 'heal', flat: fm ? clamp(Number(fm[1]), 1, 1e6) : undefined, mult: fm ? undefined : 0.3 } });
  }
  // 命中时 X% 概率施加 DoT/控制
  if ((m = text.match(/命中(?:时|后)?[^，。；]{0,8}?(\d+)\s*%[^，。；]{0,6}?(中毒|燃烧|灼烧|流血|眩晕)/))) {
    const tag = /眩晕/.test(m[2]) ? 'stun' : /燃烧|灼烧/.test(m[2]) ? 'burn' : 'poison';
    out.push({ on: 'onHit', chance: clamp(Number(m[1]) / 100, 0, 1), effect: tag === 'stun' ? { tag, turns: 1 } : tag === 'burn' ? { tag, flat: 8, turns: 2 } : { tag, stacks: 3 } });
  }
  // 对[燃烧/中毒/濒死]目标额外 +X% 伤害
  if ((m = text.match(/对[^，。；]{0,6}?(点燃|燃烧|中毒|濒死|残血)[^，。；]{0,6}?(?:的)?(?:敌人|目标)[^，。；]{0,6}?[+＋](\d+)\s*%/))) {
    const cond: TriggerCond = /点燃|燃烧/.test(m[1]) ? 'targetBurning' : /中毒/.test(m[1]) ? 'targetPoisoned' : 'targetLowHp';
    out.push({ on: 'onHit', cond, chance: 1, effect: { tag: 'deal', mult: clamp(Number(m[2]) / 100, 0, 5) } });
  }
  return out.slice(0, 4);
}

function passiveOf(s: SkillLike): PassiveMod | undefined {
  const raw: any = s?.numeric?.combat ?? (s as any)?.combat;
  if (raw && typeof raw === 'object' && raw.passive) { const p = normalizePassive(raw.passive); if (p) return p; }
  return inferPassiveFromSkill(s);
}
function triggersOf(s: SkillLike): CombatTrigger[] {
  const raw: any = s?.numeric?.combat ?? (s as any)?.combat;
  if (raw && typeof raw === 'object' && Array.isArray(raw.triggers)) { const t = normalizeTriggers(raw.triggers); if (t.length) return t; }
  return inferTriggersFromSkill(s);
}

/** 聚合某角色全部技能+天赋的常驻被动修正（暴击/穿透/多段取强或上限，其余累加）。 */
export function aggregatePassives(list: SkillLike[]): PassiveMod {
  const agg: PassiveMod = {};
  for (const s of list ?? []) {
    const p = passiveOf(s); if (!p) continue;
    if (p.critChance) agg.critChance = clamp((agg.critChance ?? 0) + p.critChance, 0, 1);
    if (p.critMult) agg.critMult = (agg.critMult ?? 0) + p.critMult;
    if (p.dmgDealtPct) agg.dmgDealtPct = (agg.dmgDealtPct ?? 0) + p.dmgDealtPct;
    if (p.dmgTakenPct) agg.dmgTakenPct = (agg.dmgTakenPct ?? 0) + p.dmgTakenPct;
    if (p.pierce) agg.pierce = Math.max(agg.pierce ?? 0, p.pierce);
    if (p.cdr) agg.cdr = (agg.cdr ?? 0) + p.cdr;
    if (p.extraHits) agg.extraHits = (agg.extraHits ?? 0) + p.extraHits;
  }
  return agg;
}

/** 合并两组被动修正（暴击/暴伤/增减伤/冷却/多段取和·穿透取最大·全程夹合法区间）。 */
export function mergePassive(a?: PassiveMod, b?: PassiveMod): PassiveMod {
  const p: PassiveMod = { ...(a ?? {}) };
  if (!b) return p;
  if (b.critChance) p.critChance = clamp((p.critChance ?? 0) + b.critChance, 0, 1);
  if (b.critMult) p.critMult = clamp((p.critMult ?? 0) + b.critMult, 0, 10);
  if (b.dmgDealtPct) p.dmgDealtPct = clamp((p.dmgDealtPct ?? 0) + b.dmgDealtPct, -0.9, 5);
  if (b.dmgTakenPct) p.dmgTakenPct = clamp((p.dmgTakenPct ?? 0) + b.dmgTakenPct, -0.9, 5);
  if (b.pierce) p.pierce = clamp(Math.max(p.pierce ?? 0, b.pierce), 0, 1);
  if (b.cdr) p.cdr = clamp((p.cdr ?? 0) + b.cdr, 0, 9);
  if (b.extraHits) p.extraHits = clamp((p.extraHits ?? 0) + b.extraHits, 0, 9);
  return p;
}

/** 从**已装备装备**的词缀/效果/攻防文本解析常驻战斗被动（含镶嵌宝石写进 effect 的【镶嵌加成】）。
 *  技能/天赋走 aggregatePassives；装备与宝石的高阶战斗属性（暴击/暴伤/破甲穿透无视防御/减伤）此前从不参与
 *  标签战斗结算 → "宝石效果不生效" 的根因。此函数把它们抽成 PassiveMod，与技能被动合并后即机械生效。
 *  只认能映射进标签 VM 的四类（暴击率/暴击伤害/穿透/减伤）；元素附魔·真伤等定值加成仍为叙述类，供正文/AI 读取。 */
export function equipmentPassive(items: { effect?: string; affix?: string; combatStat?: string }[]): PassiveMod {
  const text = (items ?? [])
    .map((it) => [it.effect, it.affix, it.combatStat].filter(Boolean).join(' '))
    .join(' ');
  if (!text.trim()) return {};
  const sumPct = (re: RegExp): number => { let m: RegExpExecArray | null, s = 0; const r = new RegExp(re.source, 'gi'); while ((m = r.exec(text)) !== null) s += Number(m[1]) / 100; return s; };
  const maxPct = (re: RegExp): number => { let m: RegExpExecArray | null, s = 0; const r = new RegExp(re.source, 'gi'); while ((m = r.exec(text)) !== null) s = Math.max(s, Number(m[1]) / 100); return s; };
  const p: PassiveMod = {};
  const cc = sumPct(/暴击(?:率|几率)\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/);            if (cc) p.critChance = clamp(cc, 0, 1);
  const cm = sumPct(/暴击伤害\s*[+＋]?\s*(\d+(?:\.\d+)?)\s*%/);                    if (cm) p.critMult = clamp(cm, 0, 10);
  const pi = maxPct(/(?:无视|穿透|破甲)[^%\d]{0,4}?(\d+(?:\.\d+)?)\s*%/);          if (pi) p.pierce = clamp(pi, 0, 1);
  const dr = sumPct(/(?:伤害减免|减免伤害|受到?伤害[^%\d]{0,4}?减[免少]|减伤)\s*(\d+(?:\.\d+)?)\s*%/); if (dr) p.dmgTakenPct = -clamp(dr, 0, 0.9);
  return p;
}

/** 聚合某角色全部技能+天赋的触发器。 */
export function aggregateTriggers(list: SkillLike[]): CombatTrigger[] {
  const out: CombatTrigger[] = [];
  for (const s of list ?? []) for (const t of triggersOf(s)) out.push(t);
  return out.slice(0, 24);
}

/** 触发/被动·提示词片段（挂进 SKILL_COMBAT_TAG_RULE，让 AI 生成技能时按枚举写条件效果）。 */
export function triggerPromptText(): string {
  return [
    '【条件触发 / 被动（可选·让复杂效果在战斗里生效）】除 effects 外，技能/天赋可在 combat 里再带两项：',
    '- "passive": 常驻被动修正(数值小数)：critChance 暴击几率0~1 / critMult 暴击伤害加成(0.25=+25%) / dmgDealtPct 增伤 / dmgTakenPct 受伤(负=减伤) / pierce 穿透防御0~1 / cdr 冷却缩减(回合) / extraHits 额外攻击段数。',
    '- "triggers": [{ "on": 事件, "cond": 条件(可空), "chance": 概率0~1, "effect": {一个标签效果} }]',
    `  · on ∈ ${TRIGGER_EVENTS.join(' / ')}（命中时/受击时/击杀时/回合开始/防御时）`,
    `  · cond ∈ ${TRIGGER_CONDS.join(' / ')}（空=always；如 targetBurning=目标燃烧中、targetLowHp=目标残血、selfLowHp=自身残血）`,
    '  · effect 用上表标签(如 {"tag":"burn","flat":10,"turns":2} / {"tag":"heal","mult":0.3} / {"tag":"deal","mult":0.5})。',
    '  例：「命中时30%概率点燃」→ triggers:[{"on":"onHit","chance":0.3,"effect":{"tag":"burn","flat":12,"turns":2}}]；',
    '  「击杀回血」→ [{"on":"onKill","effect":{"tag":"heal","mult":0.4}}]；「对燃烧目标增伤20%」→ [{"on":"onHit","cond":"targetBurning","effect":{"tag":"deal","mult":0.2}}]。',
    '被动/触发是常驻档案(全程生效)，不必每次重写；高度独特、难枚举的效果照常写进 effect/desc 文案由叙事体现即可。',
  ].join('\n');
}
