import { resolveApiChain, useSettings } from '../store/settingsStore';
import { useEnhance } from '../store/enhanceStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { SKILL_LEVELUP_PROMPT, SKILL_FUSION_RULE } from '../promptRules';
import { getPrompt } from '../store/promptOverrideStore';   // 预设中心：主提示词 override
import { SUBPROF_MASTERY_LADDER, SUBPROF_MASTERY_PER_SKILLPOINT } from '../store/subProfTreeStore';
import type { Skill, Trait } from '../store/characterStore';

/* ── 乐园币消耗表（用户定稿：基价 ×10）。可在此调价。 ──
   一、升等级：按品级定每级价；到达 10 整数倍那一级(跨分水岭·新增效果)用更高价。
   二、升品级质变：按目标品级 index 定价(技能/天赋共用·都 7 档)。
   三、副职业熟练度：按当前档位定每 +20 熟练度价。 */
const LEVELUP_COIN: Record<string, [normal: number, watershed: number]> = {
  普通: [1000, 5000], 精良: [3000, 15000], 稀有: [8000, 40000], 史诗: [20000, 100000],
  传说: [50000, 250000], 奥义: [150000, 750000], 极境: [400000, 2000000],
};
const RARITY_UP_COIN = [0, 30000, 100000, 300000, 1000000, 3000000, 10000000];   // index 0=最低档·1~6=升到该档的价
const MASTERY_COIN_PER_CHUNK = [4000, 12000, 30000, 80000, 0];                    // 副职业当前档 idx 0新手~4宗师(满)·每 +20 熟练度

/** 升等级·乐园币总价（oldLv→oldLv+points，每级按品级定价；到达 10 整数倍那级用分水岭价）。 */
export function levelUpCoinCost(rarity: string | undefined, oldLv: number, points: number): number {
  const [base, ws] = LEVELUP_COIN[String(rarity ?? '').trim()] ?? LEVELUP_COIN['普通'];
  let t = 0;
  for (let lv = oldLv + 1; lv <= oldLv + points; lv++) t += (lv % 10 === 0) ? ws : base;
  return t;
}
/** 升品级质变·乐园币总价（curIdx=当前档 index，steps=升几档；技能/天赋通用）。 */
export function rarityUpCoinCost(curIdx: number, steps: number): number {
  let t = 0;
  for (let i = curIdx + 1; i <= curIdx + steps && i < RARITY_UP_COIN.length; i++) t += RARITY_UP_COIN[i];
  return t;
}
function masteryTierIdx(spent: number): number {
  let idx = 0;
  for (let i = SUBPROF_MASTERY_LADDER.length - 1; i >= 0; i--) { if (spent >= SUBPROF_MASTERY_LADDER[i].min) { idx = i; break; } }
  return idx;
}
/** 副职业熟练度·乐园币总价（curSpent=当前熟练度，chunks=投入几段·每段 +SUBPROF_MASTERY_PER_SKILLPOINT·按落入的档定价）。 */
export function masteryCoinCost(curSpent: number, chunks: number): number {
  let t = 0, spent = curSpent;
  for (let c = 0; c < chunks; c++) { t += MASTERY_COIN_PER_CHUNK[masteryTierIdx(spent)] ?? 80000; spent += SUBPROF_MASTERY_PER_SKILLPOINT; }
  return t;
}

/* ════════════════════════════════════════════
   技能升级（乐园设施·技能点 / 黄金技能点）systems/skillUpgrade.ts
   - 技能点：1 点 = +1 级（品级不变）；每跨 10 级分水岭(到 Lv.10/20/…) 新增一个效果，平时只涨数值。
   - 黄金技能点：1 点 = 升 1 个品级（质变·必给强力新效果·读全信息丰富演化·可联网）。
   - 复用「装备强化所」的 API（resolveApiChain('enhance')）；提示词 SKILL_LEVELUP_PROMPT（含技能/天赋世界书 + 升级 COT）。
   - 前端确定性兜住"点数↔等级/品级"映射，AI 只负责生成升级后的效果文案。
   - setSkillUpNote/takeSkillUpNote：结算后给正文挂一条一次性"已用掉点数"系统提示（callApi 注入一次即清）。
════════════════════════════════════════════ */

// 技能品级 7 档 / 天赋评级 D~SSS（与世界书一致）
export const SKILL_RARITIES = ['普通', '精良', '稀有', '史诗', '传说', '奥义', '极境'];
export const TALENT_RARITIES = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

/** 从 level 字符串解析当前等级数字（"入门·Lv.15"→15；"Lv.EX"→满级按 10；缺省 1）。 */
export function parseLevelNum(level?: string): number {
  const s = String(level ?? '');
  if (/Lv\.?\s*EX/i.test(s)) return 10;
  const m = s.match(/Lv\.?\s*(\d+)/i) || s.match(/(\d+)\s*级/);
  const n = m ? parseInt(m[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 把 level 串里的 Lv 数字换成 n（保留"入门·"这类前缀；没有 Lv 段就补 ·Lv.n）。 */
export function withLevelNum(oldLevel: string | undefined, n: number): string {
  const s = String(oldLevel ?? '');
  if (/Lv\.?\s*(?:EX|\d+)/i.test(s)) return s.replace(/Lv\.?\s*(?:EX|\d+)/i, `Lv.${n}`);
  return s ? `${s}·Lv.${n}` : `Lv.${n}`;
}

/** 是否跨过 10 级分水岭：升级区间 (oldLv, newLv] 内含 10 的整数倍。 */
export function crossesWatershed(oldLv: number, newLv: number): boolean {
  return Math.floor(newLv / 10) > Math.floor(oldLv / 10);
}

/** 当前品级在阶梯中的序号（找不到→0）。 */
export function rarityIndex(rarity: string | undefined, isTalent: boolean): number {
  const ladder = isTalent ? TALENT_RARITIES : SKILL_RARITIES;
  const r = String(rarity ?? '').trim();
  const i = ladder.findIndex((x) => x === r);
  return i >= 0 ? i : 0;
}

/** 升 steps 档品级（封顶最高档）。 */
export function bumpRarity(rarity: string | undefined, isTalent: boolean, steps: number): string {
  const ladder = isTalent ? TALENT_RARITIES : SKILL_RARITIES;
  const i = Math.min(ladder.length - 1, rarityIndex(rarity, isTalent) + Math.max(1, steps));
  return ladder[i];
}

// ── 一次性"已用掉点数"系统提示（给正文，注入一次即清；模块级·不持久化，本会话内有效）──
let _pendingNote = '';
export function setSkillUpNote(note: string): void { _pendingNote = note; }
export function takeSkillUpNote(): string { const n = _pendingNote; _pendingNote = ''; return n; }

export interface SkillUpgradeOpts {
  entry: Skill | Trait;        // 当前条目完整信息
  isTalent: boolean;
  mode: 'normal' | 'golden';   // normal=技能点升等级；golden=黄金技能点升品级·质变
  points: number;              // 本次投入点数
  newLevelNum: number;         // normal：升级后的等级数字
  crossed: boolean;            // normal：本次是否跨 10 级分水岭
  newRarity: string;           // golden：升级后的目标品级
  customInput: string;         // 主角自定义要求（可空）
}

export interface SkillUpgradeResult {
  apply: Record<string, any>;  // 直接写回 updateSkill/updateTrait 的字段（已确定性强制 name/等级/品级）
  raw: any;                    // AI 原始返回（调试）
}

/** 调「装备强化所」API 生成升级后的技能/天赋；前端强制点数↔等级/品级映射。 */
export async function generateSkillUpgrade(o: SkillUpgradeOpts): Promise<SkillUpgradeResult> {
  const ss = useSettings.getState();
  const E = useEnhance.getState();
  const legacy = E.enhanceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : E.enhanceApi;
  const chain = resolveApiChain('enhance', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    throw new Error('未配置 AI 接口（设置→变量管理→装备强化→API；或勾「复用正文生成 API」——技能升级与装备强化共用此接口）');
  }

  const entry: any = o.entry;
  const prof: any = usePlayer.getState().profile ?? {};
  const kind = o.isTalent ? '天赋' : '技能';
  const oldRarity = entry.rarity ?? (o.isTalent ? 'D' : '普通');

  const modeBlock = o.mode === 'normal'
    ? [
        `【升级方式】普通升级（技能点）·本次投入 ${o.points} 技能点 → 等级 ${withLevelNum(entry.level, parseLevelNum(entry.level))} ⇒ Lv.${o.newLevelNum}`,
        `【是否跨 10 级分水岭】${o.crossed
          ? '是 —— 这是质变节点：在【保留原有全部效果】的基础上，**新增一个全新的效果/机制**（围绕该技能既有主题），并把数值随等级上调'
          : '否 —— **绝不新增**效果/机制/层数，**只把已有效果里的数值往上调**（伤害/百分比/持续/既有层数威力随等级提升），效果条目条数不变'}`,
        `【品级】保持不变（${oldRarity}）——普通升级只升等级、绝不升品级`,
      ].join('\n')
    : [
        `【升级方式】黄金升级（黄金技能点·品级质变）·本次投入 ${o.points} 黄金技能点 → 品级 ${oldRarity} ⇒ ${o.newRarity}（升 ${o.points} 档）`,
        `【要求】这是**质变**：必须给予**强力的全新效果/机制**（大幅进化、有记忆点）；读全部原信息后在其基础上**丰富演化**，原有内核与全部已有加成一律保留再叠加；若接口支持联网请先 Google 检索该技能蓝本，让质变更专业还原`,
      ].join('\n');

  const userMsg = [
    `【角色】${prof.name || '主角'}　阶位:${prof.tier || '—'}　职业:${prof.identity || '—'}`,
    modeBlock,
    `【当前${kind}·完整信息（JSON）】\n${JSON.stringify(entry, null, 1)}`,
    `【主角的自定义要求】${o.customInput.trim() || '（未填写 —— 由你按该' + kind + '的主题/流派与技能/天赋世界书，自拟一个贴切且强力的升级方向）'}`,
    `请严格按系统要求（尤其"普通升级 vs 黄金质变"的区分、"只增不减·保留原有全部内容再往上叠"、"体现投入点数后的能力提升"），**只输出升级后的完整 ${kind} JSON object**。`,
  ].join('\n\n');

  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('SKILL_LEVELUP_PROMPT', SKILL_LEVELUP_PROMPT) },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 150000 });

  // 解析 JSON object
  let s = String(content ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  const raw: any = lenientJsonParse(s);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI 返回的不是有效 JSON 对象（可重试；思考型模型/上下文过长/被安全过滤都可能）');
  }

  // 确定性强制：name 不变；普通=品级不变+目标等级；黄金=目标品级
  const apply: Record<string, any> = { ...raw, name: entry.name };
  if (o.mode === 'normal') {
    apply.rarity = oldRarity;
    apply.level = withLevelNum(raw.level || entry.level, o.newLevelNum);
  } else {
    apply.rarity = o.newRarity;
    if (!raw.level) apply.level = o.isTalent ? `${o.newRarity}·觉醒` : `Lv.1`;
  }
  // 清理：天赋不该带技能专属机读字段
  if (o.isTalent) { delete apply.combat; delete apply.skillType; delete apply.cooldown; delete apply.cost; delete apply.target; delete apply.damage; delete apply.tags; }

  return { apply, raw };
}

/* ════════════════════════════════════════════
   技能 / 天赋 融合（乐园设施·技能熔炉）systems/skillUpgrade.ts
   - 主角把 2+ 个已有 技能/天赋 投入熔炉，熔铸成 1 个全新条目；来源可技能/天赋混合。
   - **产物类型（技能 or 天赋）由前端随机判定**（见面板 doFuse），传入 outKind；AI 只按指定类型生成内容，前端强制 schema。
   - 复用「装备强化所」API；提示词 SKILL_FUSION_RULE（含技能/天赋世界书 + 融合铁则）。
   - 结算：消耗来源(removeSkill/removeTrait) → 写入新条目(addSkill/addTrait) → setSkillUpNote 给正文一条一次性"已用掉"提示。
════════════════════════════════════════════ */

export type FuseKind = 'skill' | 'talent';
export interface FuseSource { kind: FuseKind; entry: Skill | Trait; }

export interface SkillFusionOpts {
  sources: FuseSource[];   // 参与熔铸的技能/天赋（≥2）
  outKind: FuseKind;       // 前端已随机决定的产物类型（技能/天赋）
  customInput: string;     // 主角自定义倾向（可空）
}
export interface SkillFusionResult {
  apply: Record<string, any>;  // 写回 addSkill/addTrait 的字段（不含 id/addedAt；已强制类型 schema）
  outKind: FuseKind;
  raw: any;
}

/** 调「装备强化所」API 把 2+ 技能/天赋熔铸成 1 个新技能或天赋（产物类型由前端随机指定，AI 只生成内容）。 */
export async function generateSkillFusion(o: SkillFusionOpts): Promise<SkillFusionResult> {
  const ss = useSettings.getState();
  const E = useEnhance.getState();
  const legacy = E.enhanceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : E.enhanceApi;
  const chain = resolveApiChain('enhance', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    throw new Error('未配置 AI 接口（设置→变量管理→装备强化→API；或勾「复用正文生成 API」——技能融合与装备强化共用此接口）');
  }

  const prof: any = usePlayer.getState().profile ?? {};
  const outLabel = o.outKind === 'skill' ? '技能' : '天赋';
  const list = o.sources.map((s, i) => {
    const e: any = s.entry;
    return `${i + 1}. 【${s.kind === 'skill' ? '技能' : '天赋'}】${e.name}\n${JSON.stringify(e, null, 1)}`;
  }).join('\n\n');

  const userMsg = [
    `【角色】${prof.name || '主角'}　阶位:${prof.tier || '—'}　职业:${prof.identity || '—'}　等级:Lv.${prof.level ?? '—'}`,
    `【参与熔铸的技能/天赋（共 ${o.sources.length} 个·含完整信息）】\n${list}`,
    `【本次熔铸产物类型】＝ **${outLabel}**（系统已随机判定，务必只产出「${outLabel}」类型的 JSON；技能与天赋可互相熔铸转化）`,
    `【主角的自定义倾向】${o.customInput.trim() || '（未填写 —— 由你按各来源的共性主题与流派，自拟一个贴切且强力的熔铸方向）'}`,
    `【联网检索·必做】请先调用联网搜索（Google Search / 内置检索工具）检索各来源技能/天赋及同类经典游戏·小说·神话·动漫中相近技能天赋的机制与效果设计，博采众长以丰富本次熔铸产物的机制与效果库，再消化为贴合轮回乐园的原创效果（不照搬他作专有名词/数值，也不得借此突破品级与 attrBonus 上限；接口不支持联网时凭已有知识写到最丰富）。`,
    `请把以上 ${o.sources.length} 个来源熔铸成**一个**全新的「${outLabel}」，严格按系统要求（先联网检索充实效果库、融会贯通再质变、忠于设定不浮夸、只输出 JSON 本体）。`,
  ].join('\n\n');

  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('SKILL_FUSION_RULE', SKILL_FUSION_RULE) },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 150000 });

  // 解析 JSON object
  let s = String(content ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  const raw: any = lenientJsonParse(s);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.name) {
    throw new Error('AI 返回的不是有效 JSON 对象（可重试；思考型模型/上下文过长/被安全过滤都可能）');
  }

  // 前端强制产物类型 schema：清理不属于该类型的机读字段、补默认档
  const apply: Record<string, any> = { ...raw, name: String(raw.name).trim() };
  delete apply.id; delete apply.addedAt;
  if (o.outKind === 'talent') {
    delete apply.combat; delete apply.skillType; delete apply.cooldown; delete apply.cost; delete apply.target; delete apply.damage; delete apply.tags; delete apply.numeric;
    if (!apply.rarity) apply.rarity = 'B';
    if (!apply.source) apply.source = `技能熔炉·${o.sources.map((x) => (x.entry as any).name).join('+')}`;
  } else {
    if (!apply.rarity) apply.rarity = '稀有';
    if (!apply.level) apply.level = 'Lv.1';
  }

  return { apply, outKind: o.outKind, raw };
}
