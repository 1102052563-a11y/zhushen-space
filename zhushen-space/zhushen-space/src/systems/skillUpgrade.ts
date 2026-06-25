import { resolveApiChain, useSettings } from '../store/settingsStore';
import { useEnhance } from '../store/enhanceStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { SKILL_LEVELUP_PROMPT } from '../promptRules';
import type { Skill, Trait } from '../store/characterStore';

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
    { role: 'system', content: SKILL_LEVELUP_PROMPT },
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
