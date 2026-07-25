/* 本回合角色立场简报 · 输入侧（castBrief）─────────────────────────────────────
   给「正文前的规划调用」（数据库推进 / 细纲）喂一份**只含人格的瘦档案**，让它们能按性格、
   四轴态度、原则底线、口癖去排演本回合各角色的反应——而不是靠最近几楼正文猜人设。

   为什么不复用 structuredRecall 的 serializeNpcCard：
   · 那张卡是给**正文**用的，带 HP/六维/衍生/生物强度/装备/技能/物品/私密信息——排演立场一个都用不上，纯烧 token；
   · 它受 structMaxNpcs 限制（默认 2 人），群戏时第 3 个人往后连名字都没有，正好是"配角人格全靠 AI 现编"的根因。
   本模块反过来：**人多、字段少**（默认 6 人 × 只给人格字段），总开销低于 2 张全量卡。

   铁则：本模块**只产出输入材料，绝不产出指令**。数值/物品/态度增量一律不碰——那些归各演化阶段，
   预演阶段若也写就会双写打架（参见派遣/轨道A 的"三方分流防双写"）。 */

import type { NpcRecord } from '../store/npcStore';
import { dispositionLine } from './dispositionGuard';
import { isPetLike, isCompanionTag } from './petEvolution';
import { namesMentionedIn, pickOffsceneRescue } from './structuredRecall';

/** 单条字段的截断（防某个 NPC 的背景/自述几千字把整块顶爆） */
function cut(s: string | undefined, max: number): string {
  const t = (s ?? '').trim().replace(/\s*\n\s*/g, ' ');
  return t.length <= max ? t : t.slice(0, max) + '…';
}

/** 逐行保留到预算内，超出的只计数——与主角演化阶段的 clampLines 同口径 */
function clampToBudget(text: string, budget: number): string {
  if (budget <= 0 || text.length <= budget) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const ln of lines) {
    if (used + ln.length + 1 > budget) break;
    kept.push(ln);
    used += ln.length + 1;
  }
  return kept.join('\n') + `\n（另有内容因长度上限省略）`;
}

/** 可参演＝未死、未归档、有真名（id 当名字的骨架档不算） */
export function isCastEligible(r: NpcRecord): boolean {
  return !r.isDead && !r.archived && !!r.name && r.name !== r.id;
}

/* ── 挑本回合的候选演员 ──────────────────────────────────────────────
   排序权重（与 rankNpcsLocal 同源思路，但把"玩家点名"抬到最高）：
     玩家这一步点了名 +1e6（哪怕离场也要在，玩家指着谁说话谁就得应）
     在场          +1e5
     随从/入队/长期保留 +5e4（同行者不该在群戏里当木头）
     好感×100 + lastSeenTurn（近期出场过的优先）
   再补少量「被点名的离场者」（复用 pickOffsceneRescue，cap 2）——离场≠失忆，但别把离场配角全拉回来重演。 */
export function pickCastCandidates(npcs: NpcRecord[], userInput: string | undefined, max: number): NpcRecord[] {
  if (max <= 0) return [];
  const pool = npcs.filter(isCastEligible);
  const named = new Set(namesMentionedIn(pool, userInput));
  const score = (r: NpcRecord) =>
    (named.has(r) ? 1e6 : 0) +
    (r.onScene ? 1e5 : 0) +
    (r.partyMember || r.isBond ? 5e4 : 0) +
    (r.favor ?? 0) * 100 +
    (r.lastSeenTurn ?? 0);
  const ranked = pool.slice().sort((a, b) => score(b) - score(a));
  const chosen = ranked.slice(0, max);
  // 名额没用满才去救回被点名的离场者（在场的已由上面的 +1e5 覆盖）
  if (chosen.length < max) {
    const rescue = pickOffsceneRescue(pool, userInput, chosen, Math.min(2, max - chosen.length));
    for (const r of rescue) if (!chosen.includes(r)) chosen.push(r);
  }
  return chosen;
}

/** 单个候选的瘦档案（**只有人格，没有任何数值**） */
export function serializeCastDossier(r: NpcRecord): string {
  const head = [
    `[${r.id}] ${r.name}`,
    r.gender,
    r.age && `${r.age}`,
    r.npcTag,
    r.realm && `阶位/身份:${r.realm}`,
    r.profession && `职业:${r.profession}`,
    r.onScene ? '在场' : '离场',
    r.partyMember && '同行队友',
  ].filter(Boolean).join('｜');
  const lines = [
    r.personality && `性格:${cut(r.personality, 260)}`,
    r.principles && `原则底线(立场红线·绝不为讨好主角软化):${cut(r.principles, 220)}`,
    r.sampleLines && `范例台词/口癖(语气基准·别与他人同一腔调):${cut(r.sampleLines, 220)}`,
    r.callPlayer && `对主角称呼:${cut(r.callPlayer, 40)}`,
    `对主角态度·四轴(严格按当前阶段演绎·不跳级):${dispositionLine(r)}`,
    r.relations && `关系网:${cut(r.relations, 180)}`,
    r.status && `当前状态:${cut(r.status, 120)}`,
    (r.statusEffects?.length ?? 0) > 0 && `限时状态:${r.statusEffects!.map((e) => e.name).join('、')}`,
    r.motiveNow && `当前动机:${cut(r.motiveNow, 140)}`,
    r.shortGoal && `短期目标:${cut(r.shortGoal, 120)}`,
    r.innerThought && `内心:${cut(r.innerThought, 200)}`,
    (r.deedLog?.length ?? 0) > 0 && `近期经历:${cut(r.deedLog!.slice(-2).map((d) => d.description).join('；'), 220)}`,
    isPetLike(r) && `⚠ 这是${r.npcTag}：反应用行为/神态/气息表达，非人形者不说人话。`,
    (isCompanionTag(r) && !isPetLike(r)) && `⚠ 这是${r.npcTag}：有独立人格，不是听令工具。`,
  ].filter(Boolean).map((l) => `  ${l}`);
  return [head, ...lines].join('\n');
}

/** 本回合**不得出场**的名单（已死 / 已归档）——治"死人归档人突然登场"的鬼影问题 */
export function buildCastBlacklist(npcs: NpcRecord[], cap = 10): string {
  const dead = npcs.filter((r) => r.isDead && r.name && r.name !== r.id).slice(-cap).map((r) => `${r.name}(已死亡)`);
  const arch = npcs.filter((r) => r.archived && !r.isDead && r.name && r.name !== r.id).slice(-cap).map((r) => `${r.name}(已归档封存)`);
  const all = [...dead, ...arch];
  return all.length ? `本回合不得出场(除非正文明确写了复活/解封)：${all.join('、')}` : '';
}

export interface CastBriefOpts {
  max?: number;      // 最多几位候选（默认 6）
  budget?: number;   // 整块字符硬上限（默认 6000）
}

/** 组装喂给规划调用的整块材料。无候选 → 返回 ''（调用方据此跳过，别注入空标签）。 */
export function buildCastBriefInput(npcs: NpcRecord[], userInput: string | undefined, opts: CastBriefOpts = {}): string {
  const max = opts.max && opts.max > 0 ? opts.max : 6;
  const cast = pickCastCandidates(npcs, userInput, max);
  if (!cast.length) return '';
  const black = buildCastBlacklist(npcs);
  const body = cast.map(serializeCastDossier).join('\n');
  const out = [
    '<本回合可能出场角色·人格档案>',
    '（这是**候选名单，不是点名册**：谁真的出场、谁开口、谁只是在场不吭声，由剧情合理性决定；也允许出现名单外的人。）',
    clampToBudget(body, opts.budget && opts.budget > 0 ? opts.budget : 6000),
    black,
    '</本回合可能出场角色·人格档案>',
  ].filter(Boolean).join('\n');
  return out;
}
