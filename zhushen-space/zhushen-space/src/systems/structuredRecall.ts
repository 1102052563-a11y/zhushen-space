import type { NpcRecord, NpcOwnedItem } from '../store/npcStore';
import type { FactionRecord } from '../store/factionStore';
import type { Skill, Talent, Title, SubProfession } from '../store/characterStore';
import type { InventoryItem } from '../store/itemStore';
import type { PlayerProfile } from '../store/playerStore';
import { computeMaxHp, computeMaxEp, effectiveResource } from './derivedStats';

/* 取佩戴中的称号，渲染成一行（仅 equipped 注入正文）*/
function equippedTitleLine(titles: Title[] | undefined): string | undefined {
  const t = (titles ?? []).find((x) => x.equipped);
  if (!t) return undefined;
  const extra = [t.rarity && `${t.rarity}`, t.effect && `效果:${t.effect}`].filter(Boolean).join('，');
  return `当前称号: 「${t.name}」${extra ? `（${extra}）` : ''}`;
}

/* ════════════════════════════════════════════
   结构化档案召回（structured recall）
   把主角 + 在场/相关 NPC 的「完整档案 + 技能 + 装备」序列化成
   <在场与相关档案> system 块，注入主正文，让叙事看得见结构化设定。
   - 主角必含；NPC 取 maxNpcs 个（LLM 预测下回合相关 / 本地在场优先兜底）
   - 上限只作用于**主角**：技能取 maxSkills、装备取 maxItems；被选中的 NPC 给全量（所有技能/天赋/装备），不截断
   - 一律排除 addedAt/numeric 原始结构等 UI/内部字段
════════════════════════════════════════════ */

export interface RecallLimits {
  maxNpcs: number;
  maxSkills: number;    // 仅主角技能上限
  maxItems: number;     // 仅主角装备上限
  maxSubProfs?: number; // 主角副职业上限
}

/* 当前世界势力召回块（限量）——注入全量信息（含所处世界/地盘/资源/成员/资产/背景） */
export function serializeFactionsSection(factions: FactionRecord[], max: number): string {
  if (!factions.length || max <= 0) return '';
  const lines = factions.slice(0, max).map((f) => {
    const head = `  [${f.id}] ${f.name}${f.type ? `(${f.type})` : ''}`;
    const fields = [
      f.worldName && `所处世界:${f.worldName}`,
      f.scale && `规模:${f.scale}`,
      f.powerLevel && `实力:${f.powerLevel}`,
      f.status && `状态:${f.status}`,
      `对主角:${f.favorToPlayer}`,
      f.goal && `目标:${f.goal}`,
      f.leader && `首领:${f.leader}`,
      f.members && `核心成员:${f.members}`,
      f.territory && `地盘:${f.territory}`,
      f.resources && `资源:${f.resources}`,
      f.assets && `资产:${f.assets}`,
      f.relations && `关系:${f.relations}`,
      f.background && `背景:${f.background}`,
    ].filter(Boolean).join('；');
    return `${head} ${fields}`;
  });
  return '# 当前世界势力（全量档案，保持设定一致）\n' + lines.join('\n');
}

/* ── 通用：按打分取前 N（高分优先），保持稳定 ── */
function pickTop<T>(arr: T[], n: number, score: (x: T) => number): T[] {
  if (n <= 0 || arr.length === 0) return [];
  return arr
    .map((x, i) => ({ x, i, s: score(x) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .slice(0, n)
    .map((e) => e.x);
}

const TALENT_RANK: Record<string, number> = { sss: 7, ss: 6, s: 5, a: 4, b: 3, c: 2, d: 1 };
function talentScore(t: Talent): number {
  return TALENT_RANK[(t.rarity || '').toLowerCase()] ?? 0;
}
function gradeOf(numeric?: Record<string, unknown>): number {
  const g = numeric?.grade;
  return typeof g === 'number' ? g : 0;
}
/* 副职业 → 紧凑行（名称[档位 进度%] 配方:名(进度%)…）*/
function subProfLines(list: SubProfession[] | undefined): string[] {
  return (list ?? []).map((p) => {
    const recs = (p.recipes ?? []).map((r) => `${r.name}(${r.progress ?? 0}%)`).join('、');
    return `    · ${p.name}[${p.tier} ${p.progress ?? 0}%]${recs ? ` ${p.recipeLabel || '配方'}:${recs}` : ''}`;
  });
}

/* InventoryItem 未声明 numeric、NpcOwnedItem 有；统一安全读取 */
function numericOf(it: InventoryItem | NpcOwnedItem): Record<string, unknown> | undefined {
  return (it as { numeric?: Record<string, unknown> }).numeric;
}

/* ── 单条技能 → 全量可读行（排除 addedAt / numeric 原始结构等 UI/内部字段）── */
function skillLine(s: Skill): string {
  const parts = [`「${s.name}」`, s.level && `[${s.level}]`].filter(Boolean);
  const tail: string[] = [];
  if (s.cooldown) tail.push(`冷却:${s.cooldown}`);
  if (s.cost) tail.push(`消耗:${s.cost}`);
  if (s.layers) tail.push(`层数:${s.layers}`);
  if (s.layerProgress) tail.push(`层级:${s.layerProgress}`);
  const desc = [s.desc, s.effect && `效果:${s.effect}`, s.layerEffects && `各层:${s.layerEffects}`, s.note && `备注:${s.note}`]
    .filter(Boolean).join('；');
  return `    · ${parts.join(' ')}${tail.length ? ` (${tail.join(' ')})` : ''}${desc ? ` — ${desc}` : ''}`;
}

/* ── 单条天赋 → 全量可读行 ── */
function talentLine(t: Talent): string {
  const head = `「${t.name}」${t.rarity ? `·${t.rarity}级` : ''}${t.category ? `·${t.category}` : ''}`;
  const body = [t.source && `来源:${t.source}`, t.desc, t.effect && `效果:${t.effect}`, t.note && `备注:${t.note}`].filter(Boolean).join('；');
  return `    · ${head}${body ? ` — ${body}` : ''}`;
}

/* ── 单条物品/装备 → 全量可读行（排除 addedAt / numeric / locked 等）── */
function itemLine(it: InventoryItem | NpcOwnedItem): string {
  const head = `「${it.name}」${it.category ? `[${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}]` : ''}`;
  const tail: string[] = [];
  if ((it.quantity ?? 1) > 1) tail.push(`×${it.quantity}`);
  if (it.equipped) tail.push(`已装备${it.equipSlot ? ':' + it.equipSlot : ''}`);
  const body = [
    it.effect && `效果:${it.effect}`,
    it.appearance && `外观:${it.appearance}`,
    it.acquisition && `获得:${it.acquisition}`,
    Array.isArray(it.tags) && it.tags.length ? `标签:${it.tags.join('/')}` : '',
    it.notes && `备注:${it.notes}`,
  ].filter(Boolean).join('；');
  return `    · ${head}${tail.length ? ` (${tail.join(' ')})` : ''}${body ? ` — ${body}` : ''}`;
}

/* ── 装备优先级：已装备 > 品阶高 > 数量多 ── */
function itemScore(it: InventoryItem | NpcOwnedItem): number {
  return (it.equipped ? 1000 : 0) + gradeOf(numericOf(it)) * 10 + Math.min(9, it.quantity ?? 1);
}
function skillScore(s: Skill): number {
  return gradeOf(s.numeric) * 100 + (s.addedAt ?? 0) / 1e12;
}

function block(label: string, lines: string[]): string {
  return lines.length ? `  ${label}：\n${lines.join('\n')}` : `  ${label}：（无）`;
}

/* ── 主角档案卡（必含）── */
export function serializePlayerCard(
  profile: PlayerProfile,
  game: { hp: number; maxHp: number; mp?: number; maxMp?: number; san?: number; maxSan?: number },
  skills: Skill[],
  talents: Talent[],
  items: InventoryItem[],
  limits: RecallLimits,
  titles?: Title[],
  subProfs?: SubProfession[],
): string {
  const id = ['姓名:' + (profile.name || '主角'),
    profile.homeParadise && `所属乐园:${profile.homeParadise}`,
    profile.preParadiseJob && `主角背景(入园前职业):${profile.preParadiseJob}`,
    profile.level != null && `Lv.${profile.level}`,
    profile.tier && `阶位:${profile.tier}`,
    profile.title && `称号:${profile.title}`,
    profile.identity && `身份:${profile.identity}`,
    profile.profession && `职业:${profile.profession}`,
    profile.arenaRank && `竞技场:${profile.arenaRank}`,
    profile.brandLevel && `烙印:${profile.brandLevel}`,
    profile.contractorId && `契约者ID:${profile.contractorId}`,
    profile.bioStrength && `生物强度:${profile.bioStrength}`,
  ].filter(Boolean).join(' | ');
  const a = profile.attrs;
  const pMaxHp = computeMaxHp(a);
  const pMaxEp = computeMaxEp(a);
  const stat = [
    `HP:${effectiveResource(game.hp, game.maxHp, pMaxHp)}/${pMaxHp}（上限=体质×20，自动算）`,
    `EP:${effectiveResource(game.mp, game.maxMp, pMaxEp)}/${pMaxEp}（上限=智力×15，自动算）`,
    game.san != null && `SAN:${game.san}/${game.maxSan ?? '?'}`,
    a && `六维: 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
    profile.advancePoints != null && `进阶点数:${profile.advancePoints}`,
    profile.worldSource != null && `世界之源:${profile.worldSource}`,
  ].filter(Boolean).join(' | ');
  const detail = [
    profile.status && `当前状态:${profile.status}`,
    (profile.statusEffects?.length ?? 0) > 0 && `限时状态:${profile.statusEffects.map((e) => `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}`).join('、')}`,
    profile.appearance && `外观:${profile.appearance}`,
    profile.location && `位置:${profile.location}`,
    profile.background && `背景:${profile.background}`,
  ].filter(Boolean).join('\n  ');

  const topSkills = pickTop(skills, limits.maxSkills, skillScore).map(skillLine);
  const topItems = pickTop(items.filter((it) => !it.locked || it.equipped), limits.maxItems, itemScore).map(itemLine);
  const talLines = talents.slice().sort((x, y) => talentScore(y) - talentScore(x)).map(talentLine);

  const titleLine = equippedTitleLine(titles);
  const spLines = subProfLines((subProfs ?? []).slice(0, limits.maxSubProfs ?? 4));
  return ['# 主角 [B1]', '  ' + id, '  ' + stat,
    titleLine && '  ' + titleLine,
    detail && '  ' + detail,
    block('技能', topSkills), block('天赋', talLines), block('装备/物品', topItems),
    spLines.length ? block('副职业', spLines) : '',
  ].filter(Boolean).join('\n');
}

/* ── 单个 NPC 档案卡（被选中即全量信息：所有技能/天赋/装备，无上限；排除调度/UI/内部字段）── */
export function serializeNpcCard(
  npc: NpcRecord,
  skills: Skill[],
  talents: Talent[],
  titles?: Title[],
  subProfs?: SubProfession[],
): string {
  const flags = [npc.isDead && '已死亡', npc.onScene ? '在场' : '离场'].filter(Boolean).join('·');
  const id = ['姓名:' + (npc.name || '（未命名）'),
    npc.gender && `性别:${npc.gender}`,
    npc.age && `年龄:${npc.age}`,
    npc.npcTag && `标签:${npc.npcTag}`,
    npc.realm && `阶位/身份:${npc.realm}`,
    npc.title && `称号:${npc.title}`,
    npc.profession && `职业:${npc.profession}`,
    npc.arenaRank && `竞技场:${npc.arenaRank}`,
    npc.brandLevel && `烙印:${npc.brandLevel}`,
    npc.contractorId && `契约者ID:${npc.contractorId}`,
    npc.bioStrength && `生物强度:${npc.bioStrength}`,
  ].filter(Boolean).join(' | ');
  const a = npc.attrs;
  const stat = [
    a && `HP:${effectiveResource(npc.hp, npc.maxHp, computeMaxHp(a))}/${computeMaxHp(a)}（上限=体质×20，自动算）`,
    a && `EP:${effectiveResource(npc.mp, npc.maxMp, computeMaxEp(a))}/${computeMaxEp(a)}（上限=智力×15，自动算）`,
    !a && (npc.hp != null || npc.maxHp != null) && `HP:${npc.hp ?? '?'}/${npc.maxHp ?? '?'}`,
    !a && (npc.mp != null || npc.maxMp != null) && `EP:${npc.mp ?? 0}/${npc.maxMp ?? 0}`,
    a && `六维: 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
    npc.advancePoints != null && `进阶点数:${npc.advancePoints}`,
    `好感:${npc.favor}`,
  ].filter(Boolean).join(' | ');
  const detail = [
    npc.personality && `性格:${npc.personality}`,
    npc.status && `当前状态:${npc.status}`,
    (npc.statusEffects?.length ?? 0) > 0 && `限时状态:${npc.statusEffects!.map((e) => `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}`).join('、')}`,
    npc.callPlayer && `对主角称呼:${npc.callPlayer}`,
    npc.relations && `关系:${npc.relations}`,
    npc.motiveNow && `当前动机:${npc.motiveNow}`,
    npc.shortGoal && `短期目标:${npc.shortGoal}`,
    npc.longGoal && `长期目标:${npc.longGoal}`,
    npc.innerThought && `内心:${npc.innerThought}`,
    npc.appearance5 && `肖像:${npc.appearance5}`,
    npc.appearanceDetail && `容貌:${npc.appearanceDetail}`,
    npc.background && `背景:${npc.background}`,
  ].filter(Boolean).join('\n  ');

  // 被选中的 NPC 给全量信息（仅排序，不截断）
  const skillLines = skills.slice().sort((a, b) => skillScore(b) - skillScore(a)).map(skillLine);
  const itemLines = (npc.items ?? []).slice().sort((a, b) => itemScore(b) - itemScore(a)).map(itemLine);
  const talLines = talents.slice().sort((x, y) => talentScore(y) - talentScore(x)).map(talentLine);

  const titleLine = equippedTitleLine(titles);
  const spLines = subProfLines(subProfs);
  // 私密信息（性相关列 8/17/18/20-24 + 命名字段，存 npc.extra）：存在则注入正文召回，让主叙事知晓 NPC 私密状态
  const PRIV: [string, string][] = [
    ['8', '性经验'], ['17', '表性癖'], ['18', '里性癖'], ['20', '敏感部位'], ['21', '性器状态'],
    ['22', '情欲值'], ['23', '快感值'], ['24', '性观念'],
    ['淫纹', '淫纹'], ['解锁服装', '解锁服装'], ['独特技巧', '独特技巧'], ['性爱姿势', '性爱姿势'], ['开发玩法', '开发玩法'],
  ];
  const ex = (npc.extra ?? {}) as Record<string, unknown>;
  const privLines = PRIV
    .map(([k, label]) => { const v = ex[k]; return v != null && String(v).trim() ? `${label}:${String(v).trim()}` : null; })
    .filter(Boolean) as string[];
  return [`# NPC [${npc.id}]${flags ? ` (${flags})` : ''}`, '  ' + id, '  ' + stat,
    titleLine && '  ' + titleLine,
    detail && '  ' + detail,
    block('技能', skillLines), block('天赋', talLines), block('装备/物品', itemLines),
    spLines.length ? block('副职业', spLines) : '',
    privLines.length ? block('私密信息', privLines) : '',
  ].filter(Boolean).join('\n');
}

/* ── 候选 NPC 标题清单（给 LLM 预测用，紧凑省 token）── */
export function buildNpcCandidateTitles(npcs: NpcRecord[]): string {
  return npcs.map((r) =>
    `${r.id}｜${r.name || '未命名'}｜${r.realm || '阶位未知'}｜${r.onScene ? '在场' : '离场'}｜好感${r.favor}${r.relations ? '｜' + r.relations.slice(0, 24) : ''}`
  ).join('\n');
}

/* ── 本地兜底排序：在场且未死 > 好感高 > 最近在场 ── */
export function rankNpcsLocal(npcs: NpcRecord[], max: number): NpcRecord[] {
  return pickTop(
    npcs.filter((r) => !r.isDead),
    max,
    (r) => (r.onScene ? 100000 : 0) + (r.favor ?? 0) * 100 + (r.lastSeenTurn ?? 0),
  );
}

/* ── LLM 预测：下回合最可能登场/相关的 NPC（输出 id 列表）── */
export const NM_STRUCT_SELECT_PROMPT = `你是轮回乐园的「场景调度预测器」。根据【当前情境】，预测**下一回合剧情中最可能登场、或与剧情强相关的 NPC**，以便提前调出其完整档案保持设定一致。
要求：
- 从【候选 NPC】中挑选，最多 \${max_npcs} 个；按"下回合相关性"从高到低排序。
- 已在场的角色优先；用户输入/最近正文点名或暗示要找的人也要选上。
- 已死亡、且剧情无关的角色不要选。
- 拿不准就少选，宁缺毋滥。
- 只输出 id，不要解释。

【当前情境（最近正文 + 用户输入）】
\${context}

【候选 NPC（id｜姓名｜阶位｜在场/离场｜好感｜关系）】
\${candidates}

【输出格式】只输出一个 JSON 对象：
{"npcs":["C1","C3"]}`;
