import type { NpcRecord, NpcOwnedItem } from '../store/npcStore';
import type { FactionRecord } from '../store/factionStore';
import type { Skill, Talent, Title, SubProfession } from '../store/characterStore';
import { gradeToNum, type InventoryItem, type CurrencyWallet } from '../store/itemStore';
import type { PlayerProfile, PlayerAttrs } from '../store/playerStore';
import { effectiveResource, lvFromRealm, fullMaxHp, fullMaxEp, computeDerived } from './derivedStats';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { bioInnate, bioPower, bioStrengthLabel } from './bioStrength';

/* 取佩戴中的称号，渲染成一行（仅 equipped 注入正文）*/
function equippedTitleLine(titles: Title[] | undefined): string | undefined {
  const t = (titles ?? []).find((x) => x.equipped);
  if (!t) return undefined;
  const extra = [t.rarity && `${t.rarity}`, t.effect && `效果:${t.effect}`, t.bonusEffect && `额外效果:${t.bonusEffect}`].filter(Boolean).join('，');
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

/* 名称归一化（去空白/分隔符/标点，小写）——API 名称匹配与「字面喊到」护栏共用 */
function normName(s: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()「」『』""''的之]/g, '').toLowerCase();
}

/* API 选取的名称 → 实际对象（按归一化名匹配，保 API 给的顺序，封顶 max）；供主角技能/装备的 API 判定用 */
function matchByName<T extends { name: string }>(arr: T[], names: string[] | undefined, max: number): T[] {
  if (!names?.length || max <= 0) return [];
  const out: T[] = [];
  for (const nm of names) {
    const w = normName(nm); if (!w) continue;
    const found = arr.find((x) => { const xn = normName(x.name); return xn === w || xn.includes(w) || w.includes(xn); });
    if (found && !out.includes(found)) out.push(found);
    if (out.length >= max) break;
  }
  return out;
}

/* ── 护栏：当前情境（用户输入 + 最近正文）里**字面喊到**的条目名 → 强制注入 ──
   不受 API 漏选 / pickTop 上限约束：玩家或正文喊了技能/装备名，就一定把它的完整档案注入。
   匹配「整名」或「分隔段(≥3字，如 神威·空洞褫夺 的『空洞褫夺』)」是否为情境子串——
   复合名玩家常只喊核心段，故按段匹配；≥3字门槛避免「神威 / 之力」这类通用短前缀误命中。*/
function mentionTokens(name: string): string[] {
  const toks = new Set<string>();
  const full = normName(name);
  if (full.length >= 2) toks.add(full);
  for (const seg of (name || '').split(/[·•・|｜\/／（）()【】「」『』，,、\s]+/)) {
    const t = normName(seg);
    if (t.length >= 3) toks.add(t);
  }
  return [...toks];
}
export function namesMentionedIn<T extends { name: string }>(arr: T[], context: string | undefined): T[] {
  const ctx = normName(context || '');
  if (!ctx) return [];
  return arr.filter((x) => mentionTokens(x.name).some((t) => ctx.includes(t)));
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

/* ── 单条技能 → 全量可读行（排除 addedAt / numeric 原始结构等 UI/内部字段）──
   注：**手动编辑表单能改的字段必须全注入**，否则改了品级/类型/目标/伤害/属性加成/标签
   却没进正文 → AI 仍按历史里的旧值描述（"改了正文依旧是老的"的根因）。 */
function skillLine(s: Skill): string {
  const parts = [`「${s.name}」`, s.level && `[${s.level}]`, s.rarity && `·${s.rarity}`, s.skillType && `·${s.skillType}`].filter(Boolean);
  const tail: string[] = [];
  if (s.cooldown) tail.push(`冷却:${s.cooldown}`);
  if (s.cost) tail.push(`消耗:${s.cost}`);
  if (s.target) tail.push(`目标:${s.target}`);
  if (s.damage) tail.push(`伤害:${s.damage}`);
  if (s.layers) tail.push(`层数:${s.layers}`);
  if (s.layerProgress) tail.push(`层级:${s.layerProgress}`);
  if (s.attrBonus) tail.push(`属性加成:${s.attrBonus}`);
  const tagsTxt = Array.isArray(s.tags) ? s.tags.join('/') : (typeof s.tags === 'string' ? s.tags : '');
  const desc = [s.desc, s.effect && `效果:${s.effect}`, s.layerEffects && `各层:${s.layerEffects}`, tagsTxt && `标签:${tagsTxt}`, s.note && `备注:${s.note}`]
    .filter(Boolean).join('；');
  return `    · ${parts.join(' ')}${tail.length ? ` (${tail.join(' ')})` : ''}${desc ? ` — ${desc}` : ''}`;
}

/* ── 单条天赋 → 全量可读行（同理：编辑表单能改的等级/属性加成也要注入）── */
function talentLine(t: Talent): string {
  const head = `「${t.name}」${t.rarity ? `·${t.rarity}级` : ''}${t.category ? `·${t.category}` : ''}${t.level ? `·${t.level}` : ''}`;
  const body = [t.source && `来源:${t.source}`, t.desc, t.effect && `效果:${t.effect}`, t.attrBonus && `属性加成:${t.attrBonus}`, t.note && `备注:${t.note}`].filter(Boolean).join('；');
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

/* ── 主角装备/物品 → 精简行：只注入 名称/类型/品级/杀敌数/词缀/效果（其他信息不注入）── */
function playerItemLine(it: InventoryItem): string {
  const qty = (it.quantity ?? 1) > 1 ? ` ×${it.quantity}` : '';   // 消耗品/材料数量也注入，供 AI 感知库存
  const head = `「${it.name}」${(it.category || it.gradeDesc) ? `[${[it.category, it.gradeDesc].filter(Boolean).join('·')}]` : ''}${qty}`;
  const body = [
    it.killCount && `杀敌:${it.killCount}`,
    it.affix && `词缀:${it.affix}`,
    it.effect && `效果:${it.effect}`,
  ].filter(Boolean).join('；');
  return `    · ${head}${body ? ` — ${body}` : ''}`;
}

/* ── 装备优先级：已装备 > 品阶高 > 数量多 ── */
function itemScore(it: InventoryItem | NpcOwnedItem): number {
  const grade = gradeOf(numericOf(it)) || gradeToNum(it.gradeDesc);   // AI 未给 numeric.grade 时按品级文字兜底
  return (it.equipped ? 1000 : 0) + grade * 10 + Math.min(9, it.quantity ?? 1);
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
  wallet?: CurrencyWallet,
  pick?: { skills?: string[]; items?: string[] },   // API 选取的技能名/装备名；提供则覆盖本地 pickTop（副职业不受影响，仍机械取）
  context?: string,   // 当前情境（用户输入+最近正文）：字面喊到的技能/装备强制注入（护栏，不受 API/上限约束）
): string {
  const id = ['姓名:' + (profile.name || '主角'),
    profile.gender && `性别:${profile.gender}`,
    profile.race && `种族:${profile.race}`,
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
  ].filter(Boolean).join(' | ');
  const a = profile.attrs;
  const pEqp = items.filter((it) => it.equipped);
  // HP/EP 上限的基 = 基础 + 技能树 + 冒险团团队六维(体/智→HP/EP)，团队增益里的「生命/法力上限+N」并入天赋（与 App.playerMaxHp/EP、属性面板同口径，技能树加的体质/智力同步抬高上限）
  const hpBase = withAttrDelta(withAttrDelta(a, playerTreeAttrBonus('B1')), playerTeamAttrBonus());
  const hpTalents = [...(talents ?? []), ...playerTeamPerkAbilities()];
  const pMaxHp = fullMaxHp(hpBase, pEqp, skills, hpTalents);
  const pMaxEp = fullMaxEp(hpBase, pEqp, skills, hpTalents);
  // 有效六维 = 基础 + 装备/技能/天赋 + 技能树 + 团队加成（与属性面板/战斗/骰子完全一致；注入正文用实战值，并标注基础值）
  const effA = effectiveAttrs(withAttrDelta(withAttrDelta(a, playerTreeAttrBonus('B1')), playerTeamAttrBonus()), skills, talents, pEqp);
  // 衍生攻防（与属性面板同式：有效六维 + 等级 + 已装备品级）
  const derived = computeDerived(effA, profile.level, pEqp.map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc) })));
  const faP = (k: keyof PlayerAttrs) => { if (!a) return ''; return effA[k] === a[k] ? `${effA[k]}` : `${effA[k]}(基${a[k]})`; };
  const stat = [
    `HP:${effectiveResource(game.hp, game.maxHp, pMaxHp)}/${pMaxHp}（上限=体质×20，自动算${profile.hpLabel ? `；正文叙述称「${profile.hpLabel}」，状态行/指令仍写 HP` : ''}）`,
    `EP:${effectiveResource(game.mp, game.maxMp, pMaxEp)}/${pMaxEp}（上限=智力×15，自动算${profile.epLabel ? `；正文叙述称「${profile.epLabel}」，状态行/指令仍写 EP` : ''}）`,
    game.san != null && `SAN:${game.san}/${game.maxSan ?? '?'}`,
    a && `六维(实战值=基础+装备/技能/天赋/技能树/团队加成): 力${faP('str')} 敏${faP('agi')} 体${faP('con')} 智${faP('int')} 魅${faP('cha')} 幸${faP('luck')}`,
    a && `衍生属性(六维+装备现算): 物攻${derived.patk} 物防${derived.pdef} 法攻${derived.matk} 法防${derived.mdef}`,
    a && `生物强度(前端按六维机械判定,勿改): ${bioStrengthLabel(bioInnate(a, profile.tier, profile.level), bioPower(effA))}`,
    profile.attrPoints != null && `属性点:${profile.attrPoints}`,
    profile.realAttrPoints != null && `真实属性点:${profile.realAttrPoints}`,
    profile.worldSource != null && `世界之源:${profile.worldSource}`,
    wallet && `货币: 乐园币${wallet.乐园币 ?? 0} | 灵魂钱币${wallet.灵魂钱币 ?? 0} | 技能点${wallet.技能点 ?? 0} | 黄金技能点${wallet.黄金技能点 ?? 0}`,
  ].filter(Boolean).join(' | ');
  const detail = [
    profile.raceDetail && `种族详情:${profile.raceDetail}`,
    profile.personality && `性格:${profile.personality}`,
    profile.personalityDetail && `性格描述:${profile.personalityDetail}`,
    profile.status && `当前状态:${profile.status}`,
    (profile.statusEffects?.length ?? 0) > 0 && `限时状态:${profile.statusEffects.map((e) => `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}`).join('、')}`,
    profile.appearance && `外观:${profile.appearance}`,
    profile.location && `位置:${profile.location}`,
    profile.background && `背景:${profile.background}`,
  ].filter(Boolean).join('\n  ');

  // 技能：开了 API 选取(pick.skills)→按 API 选的名字注入；否则本地 pickTop(品阶/新近) 兜底（API 给的名都没匹配上也回退本地，避免空）
  let skillSel = matchByName(skills, pick?.skills, limits.maxSkills);
  if (!skillSel.length) skillSel = pickTop(skills, limits.maxSkills, skillScore);
  // 护栏：情境里字面喊到的技能强制并入（置顶去重，不受 maxSkills 上限约束）——治"都喊技能名了还不注入"
  for (const s of namesMentionedIn(skills, context)) if (!skillSel.includes(s)) skillSel.unshift(s);
  const topSkills = skillSel.map(skillLine);
  // 装备(武器/防具/饰品 或 已装备)：同理 API 选取优先、本地 pickTop 兜底；材料+消耗品全部显示(名称+效果)；其它类一律不注入
  const EQUIP_CATS = new Set<string>(['武器', '防具', '饰品']);
  const equipPool = items.filter((it) => it.equipped || EQUIP_CATS.has(it.category));
  let equipSel = matchByName(equipPool, pick?.items, limits.maxItems);
  if (!equipSel.length) equipSel = pickTop(equipPool, limits.maxItems, itemScore);
  // 护栏：情境里字面喊到的物品强制并入（材料/消耗品下方已全量注入，排除以免重复；不受 maxItems 上限约束）
  for (const it of namesMentionedIn(items, context)) if (it.category !== '材料' && it.category !== '消耗品' && !equipSel.includes(it)) equipSel.unshift(it);
  const equipItems = equipSel.map(playerItemLine);
  const matConItems = items.filter((it) => it.category === '材料' || it.category === '消耗品').map(playerItemLine);
  const talLines = talents.slice().sort((x, y) => talentScore(y) - talentScore(x)).map(talentLine);

  const titleLine = equippedTitleLine(titles);
  const spLines = subProfLines((subProfs ?? []).slice(0, limits.maxSubProfs ?? 4));
  return ['# 主角 [B1]', '  ' + id, '  ' + stat,
    titleLine && '  ' + titleLine,
    detail && '  ' + detail,
    block('技能', topSkills), block('天赋', talLines), block('装备', equipItems), block('材料/消耗品', matConItems),
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
  ].filter(Boolean).join(' | ');
  const a = npc.attrs;
  // 有效六维 = 基础 + 装备/技能/天赋加成（与 NPC 详情面板一致；注入正文用实战值，并标注基础值）
  const effA = a ? effectiveAttrs(a, skills, talents, (npc.items ?? []).filter((it) => it.equipped) as any) : undefined;
  const faN = (k: keyof PlayerAttrs) => { if (!a || !effA) return ''; return effA[k] === a[k] ? `${effA[k]}` : `${effA[k]}(基${a[k]})`; };
  const nEqp = (npc.items ?? []).filter((it) => it.equipped) as any;
  const nMaxHp = a ? fullMaxHp(a, nEqp, skills, talents) : 0;
  const nMaxEp = a ? fullMaxEp(a, nEqp, skills, talents) : 0;
  const nDerived = a && effA ? computeDerived(effA, lvFromRealm(npc.realm), nEqp.map((it: any) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc) }))) : undefined;
  const stat = [
    a && `HP:${effectiveResource(npc.hp, npc.maxHp, nMaxHp)}/${nMaxHp}（上限=体质×20，自动算）`,
    a && `EP:${effectiveResource(npc.mp, npc.maxMp, nMaxEp)}/${nMaxEp}（上限=智力×15，自动算）`,
    !a && (npc.hp != null || npc.maxHp != null) && `HP:${npc.hp ?? '?'}/${npc.maxHp ?? '?'}`,
    !a && (npc.mp != null || npc.maxMp != null) && `EP:${npc.mp ?? 0}/${npc.maxMp ?? 0}`,
    a && `六维(实战值=基础+装备/技能/天赋加成): 力${faN('str')} 敏${faN('agi')} 体${faN('con')} 智${faN('int')} 魅${faN('cha')} 幸${faN('luck')}`,
    nDerived && `衍生属性(六维+装备现算): 物攻${nDerived.patk} 物防${nDerived.pdef} 法攻${nDerived.matk} 法防${nDerived.mdef}`,
    a && `生物强度(前端按六维机械判定,勿改): ${bioStrengthLabel(bioInnate(a, npc.realm, lvFromRealm(npc.realm)), bioPower(effA))}`,
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
    npc.selfNarration && `第一人称自述:${npc.selfNarration}`,
    npc.appearance5 && `肖像:${npc.appearance5}`,
    npc.appearanceDetail && `容貌:${npc.appearanceDetail}`,
    npc.background && `背景:${npc.background}`,
    (npc.deedLog?.length ?? 0) > 0 && `近期经历:${npc.deedLog!.slice(-3).map((d) => d.description).join('；')}`,
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

/* 主角技能候选（名称｜品阶｜简效），供 API 选取「该注入哪些技能」用 */
export function buildPlayerSkillCandidates(skills: Skill[]): string {
  return (skills ?? []).map((s) => `${s.name}${s.level ? `｜${s.level}` : ''}${s.effect ? `｜${String(s.effect).slice(0, 24)}` : ''}`).filter(Boolean).join('\n') || '（无）';
}
/* 主角装备候选（仅已装备/武器防具饰品的名称｜品级），供 API 选取「该注入哪些装备」用 */
export function buildPlayerItemCandidates(items: InventoryItem[]): string {
  const EQUIP_CATS = new Set<string>(['武器', '防具', '饰品']);
  return (items ?? []).filter((it) => it.equipped || EQUIP_CATS.has(it.category))
    .map((it) => `${it.name}${it.gradeDesc ? `｜${it.gradeDesc}` : ''}${it.equipped ? '｜已装备' : ''}`).filter(Boolean).join('\n') || '（无）';
}

/* ── 本地兜底排序：在场且未死 > 好感高 > 最近在场 ── */
export function rankNpcsLocal(npcs: NpcRecord[], max: number): NpcRecord[] {
  return pickTop(
    npcs.filter((r) => !r.isDead),
    max,
    (r) => (r.onScene ? 100000 : 0) + (r.favor ?? 0) * 100 + (r.lastSeenTurn ?? 0),
  );
}

/* ── LLM 选取：按当前情境挑出最该注入正文的结构化条目（相关 NPC + 主角相关技能/装备）── */
export const NM_STRUCT_SELECT_PROMPT = `你是轮回乐园的「场景调度预测器」。根据【当前情境（用户这一轮的输入 + 最近正文）】，挑出**下一回合最该注入正文的结构化条目**——既包括相关 NPC，也包括主角此刻**最该用到 / 最相关的技能与装备**，以便保持设定 / 数值一致。
要求：
- 【NPC】从【候选 NPC】挑，最多 \${max_npcs} 个：已在场优先、用户输入或正文点名 / 暗示要找的人优先；已死且与剧情无关的不选。
- 【主角技能】从【候选技能】挑最多 \${max_skills} 个：与本轮动作 / 战斗 / 施法 / 情境最相关的（要打就挑战斗技、要交涉就挑社交 / 辅助技、要潜行就挑隐匿技…）；拿不准就挑最强或最常用的。
- 【主角装备】从【候选装备】挑最多 \${max_items} 个：当前已装备的、与本轮情境最相关的优先。
- 名称 / id 一律**照抄候选里的原值**，别改字。拿不准就少选、宁缺毋滥；只输出 JSON、不要解释。

【当前情境（最近正文 + 用户输入）】
\${context}

【候选 NPC（id｜姓名｜阶位｜在场/离场｜好感｜关系）】
\${candidates}

【候选 主角技能（名称）】
\${skill_candidates}

【候选 主角装备（名称）】
\${item_candidates}

【输出格式】只输出一个 JSON 对象（NPC 用 id，技能 / 装备用名称，照抄原值）：
{"npcs":["C1","C3"],"skills":["技能名A","技能名B"],"items":["装备名A"]}`;
