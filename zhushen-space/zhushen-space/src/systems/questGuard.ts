import { isMainQuest, mergeRings, type MiscTask, type QuestRing } from '../store/miscStore';

/* 任务闸门（questGuard）：AI 侧任务写操作的护栏（治"任务乱变动 / 无限布置"）。
 *
 * 定位：主线环内容已有 mergeRings 路线图锁、玩家可手动 🔒（applyLockedPatch），但此前仍有三个洞：
 *   ① 非锁定任务的顶层结构字段（名称/描述/奖惩/时限/线别/终局）走 {...x,...patch} 直接覆盖——支线多为无环扁平任务，完全裸奔；
 *   ② 新建任务零闸门——AI 每轮杂项演化都能冒新支线，无数量上限、无每轮配额；
 *   ③ de() 物理删除任务——违反「数据库=图书馆只存不删」铁则。
 * 本模块把纪律下沉成代码（Prompt 不是防线），设计对齐 npcGrowthGuard：
 *   - AI 结构锁（filterAiTaskPatch）：已建档任务 AI 只许推进（status/progress/rating/rings/currentRing），
 *     结构字段冻结；环内容仍由 mergeRings 冻结（只放行环状态/总结/评级+占位环填实）。
 *   - 布置闸（gateNewAiTask）：每轮新建配额 + 在场支线上限；主线/职业任务/进阶通告豁免。
 *   - de() 转「作废」归档（在 miscParser 落地），留底可查、玩家可 ✏️ 复原。
 * 全部纯函数；被拒/被夹的每一笔由调用方（miscParser）记入仲裁日志（npcGrowthGuard 通道 → 回合洞察）。
 * 玩家路径不受限：面板 ✏️ editTask、面板删除、manualGenTask（taskGuard:false）都绕过本闸门。
 */

/* 任务状态是否为"已结算"（完成/失败/放弃/作废/结束）——用于把任务移出进行中列表。
   先排除明确的进行态（进行中/未完成/待…），再匹配结算关键词。（自 miscParser 移入，供闸门与解析共用） */
export function isTerminalTaskStatus(s?: string): boolean {
  const t = String(s ?? '');
  if (/进行中|未完成|待执行|待完成|进行|执行中|跟进中/.test(t)) return false;
  return /已?完成|已达成|达成|成功|已?失败|失败|已?放弃|放弃|已结束|结束|作废|取消/.test(t);
}

/* 进阶任务（乐园通告·ADVANCED_TASK_PROTOCOL 落库的单目标支线）：名称/描述带「进阶通告/进阶任务」标记 */
export function isAdvancedNotice(t: Pick<MiscTask, 'name' | 'desc'>): boolean {
  return /进阶通告|进阶任务/.test(`${t?.name ?? ''} ${t?.desc ?? ''}`);
}
/* 布置闸豁免：职业任务（专属按钮生成·prof 标记）与进阶通告——都是稀有的专用通道，不占支线额度也不受配额 */
export function isExemptTask(t: MiscTask): boolean {
  return !!t.prof || isAdvancedNotice(t);
}

/* ── AI 结构锁 ── */
/* AI 对已建档任务只许动的字段：推进类（环内容另有 mergeRings 冻结，rings 放行是安全的） */
export const AI_TASK_PATCH_ALLOW = new Set<string>(['status', 'progress', 'rating', 'rings', 'currentRing']);

const STRUCT_LABEL: Record<string, string> = {
  name: '名称', desc: '描述', reward: '奖励', penalty: '惩罚',
  startTime: '起始时限', endTime: '截止时限', kind: '线别(主/支)', finale: '终局',
  prof: '职业标记', locked: '锁定标记',
};
const clip = (s: string, max = 24) => (s.length > max ? s.slice(0, max) + '…' : s);

/** 过滤 AI 对已建档任务的更新载荷：只放行推进类字段，结构字段冻结。
 *  返回 { patch: 放行后的载荷, dropped: 被驳回的"真实改动尝试"清单（供仲裁日志） }。
 *  set() 会重发整行（空串默认值 + 原样字段），故只有「非空且与现值不同」的结构字段才计入 dropped，避免刷屏。 */
export function filterAiTaskPatch(
  existing: MiscTask,
  incoming: Partial<MiscTask>,
): { patch: Partial<MiscTask>; dropped: string[] } {
  const patch: Partial<MiscTask> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    if (k === 'id' || k === 'addedAt') continue;   // 合成字段（taskFromCols 重发整行时自带）：静默忽略，尤其别让 addedAt 被刷新——它是"一世界一主线"的边界依据
    if (k === 'rings') {
      // 既有环任务：放行（环内容由 mergeRings 冻结，只收状态/总结/评级/占位环填实）；无环扁平任务：新增环结构=重规划，冻结
      if (Array.isArray(existing.rings) && existing.rings.length) patch.rings = v as MiscTask['rings'];
      else dropped.push('rings（给无环任务补加环结构）');
      continue;
    }
    if (AI_TASK_PATCH_ALLOW.has(k)) { (patch as Record<string, unknown>)[k] = v; continue; }
    // 结构字段：冻结。只把"真的想改"的记入仲裁（缺省 kind 视为支线，避免重发 kind:"支线" 误报）
    const nv = String(v).trim();
    const ov = k === 'kind' ? String(existing.kind ?? '支线') : String((existing as unknown as Record<string, unknown>)[k] ?? '').trim();
    if (nv && nv !== ov) dropped.push(`${STRUCT_LABEL[k] ?? k}「${clip(ov) || '（空）'}→${clip(nv)}」`);
  }
  return { patch, dropped };
}

/* ── 布置闸（新建任务） ── */
export interface NewTaskGateCfg {
  sideMax: number;       // 在场支线上限（0=不限）
  newPerRound: number;   // 每轮新建配额（0=不限）
  roundCreated: number;  // 本轮已放行的新建条数
}

/** 裁决一条 AI 全新任务能否落库：返回 null=放行，否则=驳回原因（供仲裁日志）。
 *  豁免：职业任务/进阶通告。主线不占支线额度（另有"一世界一主线"降级守着）；
 *  一次性已完成任务（建完立即归档、不占进行中列表）不受支线上限、但仍占每轮配额。 */
export function gateNewAiTask(t: MiscTask, activeTasks: MiscTask[], cfg: NewTaskGateCfg): string | null {
  if (isExemptTask(t)) return null;
  if (cfg.newPerRound > 0 && cfg.roundCreated >= cfg.newPerRound) {
    return `每轮新建配额(${cfg.newPerRound}条)已用尽`;
  }
  if (cfg.sideMax > 0 && !isMainQuest(t) && !isTerminalTaskStatus(t.status)) {
    const n = activeTasks.filter((x) => !isMainQuest(x) && !isExemptTask(x)).length;
    if (n >= cfg.sideMax) return `在场支线已达上限(${cfg.sideMax}条)——先推进/结算旧支线`;
  }
  return null;
}

/* ── 环推进闸门（questAdvanceGate·治"AI 只完成部分要求就乱推进度/跳阶段/整条报完成"） ──
 * 三道确定性检查（提示词管不住谄媚，这里把"推进要有据"下沉成代码）：
 *   ① 证据锚定（gateRingAdvance）：ringAdvance 必须附 summary + evidence（正文原句逐字引用），
 *      evidence 经归一化后须真实出现在本回合正文里——AI 编不出证据就推不动。
 *   ② 跨环限幅 + 环状态单向（gateRingsPatch）：一轮最多把 jumpMax 个环翻成 done/skipped（含把 active
 *      指到后面环的隐式跨越），超了整组驳回；done/skipped 永不回退、active 不许拉回更早的环。
 *   ③ 成功结算闸（gateTaskSettle）：多环任务标"已完成/达成"时，强制环必须全部 done/skipped
 *      （唯一豁免：只差最后一个强制环——"打完高潮没来得及 ringAdvance"的合法收尾，07-15 修的老场景）。
 * 玩家路径（面板 ✏️/手动结算/manualGenTask）照旧全豁免。 */

/* 证据归一化：去掉所有空白/标点/符号，只留中英数字并转小写——引用与正文只要内容一致，标点差异不影响命中 */
function normAnchor(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9一-鿿㐀-䶿]/g, '');
}

/** evidence 是否真实出现在正文：归一化后，evidence 里任意连续 minRun 字符命中正文即算（容忍 AI 摘录时轻微掐头去尾）。
 *  太短（归一后 <6 字）不足以核验 → 视为未命中。 */
export function evidenceAnchored(evidence: string, narrative: string, minRun = 10): boolean {
  const e = normAnchor(evidence);
  const nr = normAnchor(narrative);
  if (!e || !nr || e.length < 6) return false;
  if (e.length <= minRun) return nr.includes(e);
  for (let i = 0; i + minRun <= e.length; i++) {
    if (nr.includes(e.slice(i, i + minRun))) return true;
  }
  return false;
}

/** 裁决一次 ringAdvance 推进：返回 null=放行，否则=驳回原因（供仲裁日志）。
 *  narrative 缺省（非任务演化的旧调用路径）时跳过证据核验，只查 summary。 */
export function gateRingAdvance(
  task: MiscTask,
  payload: { summary?: string; rating?: string; evidence?: string } | null,
  narrative?: string,
): string | null {
  if (!Array.isArray(task.rings) || task.rings.length === 0) return null;   // 无环任务的 ringAdvance 本就 no-op，不拦
  if (!String(payload?.summary ?? '').trim()) return '缺 summary（本环行为总结）——推进必须带 summary/rating/evidence';
  if (narrative && narrative.trim()) {
    const ev = String(payload?.evidence ?? '').trim();
    if (!ev) return '缺 evidence（正文原句引用）——须逐字摘录本回合正文中证明本环目标全部要件已达成的原句';
    if (!evidenceAnchored(ev, narrative)) return 'evidence 与本回合正文对不上（须逐字摘录正文原句，不许改写/编造）';
  }
  return null;
}

const RING_RANK: Record<QuestRing['status'], number> = { planned: 0, active: 1, done: 2, skipped: 2 };

/** 清洗 AI 对既有环任务的 rings/currentRing 载荷：环状态单向 + 每轮跨环限幅。
 *  返回 { patch: 清洗后的载荷, dropped: 驳回清单, flips: 本次实际翻成 done/skipped 的环数（供"每轮一种环操作"记账） }。 */
export function gateRingsPatch(
  existing: MiscTask,
  patch: Partial<MiscTask>,
  jumpMax: number,
): { patch: Partial<MiscTask>; dropped: string[]; flips: number } {
  const out: Partial<MiscTask> = { ...patch };
  const dropped: string[] = [];
  const ex = Array.isArray(existing.rings) ? existing.rings : [];
  const activeIdx = ex.find((r) => r.status === 'active')?.idx;

  if (Array.isArray(out.rings) && out.rings.length && ex.length) {
    // ① 环状态单向：done/skipped 不回 active/planned；active 不许被指回更早的环（回退当前进度）
    const cleaned = out.rings.map((r) => ({ ...r }));
    for (const inc of cleaned) {
      if (inc.status === undefined) continue;
      const prev = ex.find((e) => e.idx === inc.idx);
      if (!prev) continue;   // 新 idx：路线图锁定，mergeRings 会忽略
      if ((RING_RANK[inc.status] ?? 0) < (RING_RANK[prev.status] ?? 0)) {
        dropped.push(`环${inc.idx} 状态回退(${prev.status}→${inc.status})`);
        delete (inc as Partial<QuestRing>).status;
        continue;
      }
      if (inc.status === 'active' && activeIdx != null && inc.idx < activeIdx) {
        dropped.push(`环${inc.idx} 试图把 active 拉回更早的环(当前在环${activeIdx})`);
        delete (inc as Partial<QuestRing>).status;
      }
    }
    out.rings = cleaned;
    // ② 悬空检查：把 active 指到后面环、却把中间 planned 环晾着不标 done/skipped——这种"没逐环交代"的跳跃
    //    会留下 active 后方的悬空 planned 环（之后 advanceRing 还会把 active 拉回去，数据彻底乱掉）→ 整组驳回
    const merged = mergeRings(ex, cleaned);
    const mAct = merged.find((r) => r.status === 'active');
    const exAct = ex.find((r) => r.status === 'active');
    const wasStranded = new Set(ex.filter((r) => exAct && r.status === 'planned' && r.idx < exAct.idx).map((r) => r.idx));
    const stranded = mAct ? merged.filter((r) => r.status === 'planned' && r.idx < mAct.idx && !wasStranded.has(r.idx)) : [];
    if (stranded.length) {
      dropped.push(`把 active 指到环${mAct!.idx}、但中间环${stranded.map((r) => r.idx).join('、')}未标 done/skipped——跨环必须逐环显式标状态`);
      delete out.rings;
      delete out.currentRing;
      return { patch: out, dropped, flips: 0 };
    }
    // ③ 跨环限幅：数"新翻成 done/skipped"的环
    const before = new Map(ex.map((r) => [r.idx, r.status]));
    const flips = merged.filter((r) =>
      (r.status === 'done' || r.status === 'skipped')
      && before.get(r.idx) !== 'done' && before.get(r.idx) !== 'skipped').length;
    if (jumpMax > 0 && flips > jumpMax) {
      dropped.push(`一次把 ${flips} 个环翻成已达成/跳过（>每轮上限${jumpMax}）——按正文证据分轮推进`);
      delete out.rings;
      delete out.currentRing;
      return { patch: out, dropped, flips: 0 };
    }
    // currentRing 与合并后的 active 对齐（纯缓存字段，静默归一，不值一条仲裁）
    if (out.currentRing != null && mAct && out.currentRing !== mAct.idx) out.currentRing = mAct.idx;
    return { patch: out, dropped, flips };
  }

  // 只动 currentRing 不动 rings：指针须与当前 active 环一致（防"只改指针假装推进/回退"）
  if (out.currentRing != null && activeIdx != null && out.currentRing !== activeIdx) {
    dropped.push(`currentRing(${out.currentRing})与当前 active 环(${activeIdx})不符——推进请用 ringAdvance 或环状态`);
    delete out.currentRing;
  }
  return { patch: out, dropped, flips: 0 };
}

/* 成功向结算状态（完成/达成/成功，且不含失败/放弃/作废字样）——失败向结算不经此闸（强制环致命失败合法） */
export function isSuccessSettleStatus(s?: string): boolean {
  const t = String(s ?? '');
  return isTerminalTaskStatus(t) && /完成|达成|成功/.test(t) && !/失败|放弃|作废|取消/.test(t);
}

/** 裁决一次"整条任务成功结算"：返回 null=放行，否则=驳回原因。
 *  多环任务：强制环须全部 done/skipped；唯一豁免=只剩最后一个强制环未推进（终局已打、没来得及 ringAdvance 的合法收尾）。
 *  无环扁平任务/失败向结算：不拦（扁平任务的完成度由推进复核裁判管）。 */
export function gateTaskSettle(task: MiscTask, incomingStatus: string): string | null {
  if (!isSuccessSettleStatus(incomingStatus)) return null;
  const rings = Array.isArray(task.rings) ? task.rings : [];
  if (!rings.length) return null;
  const forced = rings.filter((r) => !r.optional);
  if (!forced.length) return null;
  const unDone = forced.filter((r) => r.status !== 'done' && r.status !== 'skipped').sort((a, b) => a.idx - b.idx);
  if (unDone.length === 0) return null;
  const lastForcedIdx = Math.max(...forced.map((r) => r.idx));
  if (unDone.length === 1 && unDone[0].idx === lastForcedIdx) return null;
  return `还有 ${unDone.length} 个强制环未达成（最早停在环${unDone[0].idx}「${clip(unDone[0].goal || '', 18)}」）——先按正文证据逐环 ringAdvance`;
}
