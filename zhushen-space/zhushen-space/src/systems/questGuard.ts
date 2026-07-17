import { isMainQuest, type MiscTask } from '../store/miscStore';

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
    const ov = k === 'kind' ? String(existing.kind ?? '支线') : String((existing as Record<string, unknown>)[k] ?? '').trim();
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
