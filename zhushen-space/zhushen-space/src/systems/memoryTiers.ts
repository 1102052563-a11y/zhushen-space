/*
  NPC 三层记忆 + 衰退 + 关系变化触发重解读（v5.6 世界引擎 `<npc>` 记忆段的轮回乐园实装）
  ───────────────────────────────────────────────────────────────────────────────
  卡里的三层：

      近期记忆(5~8) ── 最近发生的事，细节丰富
      沉淀记忆(5~8) ── 过了一段时间，压缩后的版本
      核心记忆(3~5) ── 永远不会忘的事

  加上两个机制：
    · **衰退**：近期满 → 最旧的压缩细节移入沉淀；沉淀满 → 最不重要的丢弃、重要的浓缩进核心
    · **篡改**：与某人关系变好 → 重新解读过去的负面记忆；变差 → 扭曲过去的正面记忆

  前端现状：`CharMemory { shortTerm, longTerm }` 已是两层，缺「核心」这一层，也没有衰退与重解读。

  ★ 轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §4）：
    **只给 `paradise` 作用域的 NPC**（契约者/随从/宠物）。土著在一个任务世界里活不了几十回合，
    攒不出三层记忆，给了也是浪费 token。

  ★ 分工：**衰退的"谁该动"由前端算**（零 API），"怎么压缩成一句话"交给记忆压缩阶段的 AI。
    这与派遣、传闻压缩、事件配额一脉相承——机械活前端接管。
*/
import type { MemoryEntry } from '../store/characterStore';

export type MemTier = 'recent' | 'settled' | 'core';

/** 各层容量（卡里 5~8 / 5~8 / 3~5，这里取上限） */
export const TIER_CAP: Record<MemTier, number> = { recent: 8, settled: 8, core: 5 };

export const TIER_LABEL: Record<MemTier, string> = { recent: '近期记忆', settled: '沉淀记忆', core: '核心记忆' };

export interface TieredMemory {
  recent: MemoryEntry[];
  settled: MemoryEntry[];
  core: MemoryEntry[];
}

/** 只有这些标签的 NPC 才维护三层记忆（土著不配额） */
export function usesTieredMemory(npcTag?: string): boolean {
  return npcTag === '契约者' || npcTag === '随从' || npcTag === '宠物' || npcTag === '召唤物';
}

/** 从既有两层结构读成三层（老档无 core → 空数组） */
export function toTiered(mem?: { shortTerm?: MemoryEntry[]; longTerm?: MemoryEntry[]; core?: MemoryEntry[] }): TieredMemory {
  return {
    recent: mem?.shortTerm ?? [],
    settled: mem?.longTerm ?? [],
    core: mem?.core ?? [],
  };
}

/** 写回既有结构（保持 shortTerm/longTerm 兼容，core 是新增可选层） */
export function fromTiered(t: TieredMemory): { shortTerm: MemoryEntry[]; longTerm: MemoryEntry[]; core: MemoryEntry[] } {
  return { shortTerm: t.recent, longTerm: t.settled, core: t.core };
}

/* ── 衰退 ─────────────────────────────────────────────────── */

export interface DecayPlan {
  /** 近期 → 沉淀（需 AI 压缩细节） */
  toSettle: MemoryEntry[];
  /** 沉淀 → 核心（重要到该永远记住） */
  toCore: MemoryEntry[];
  /** 沉淀里被丢弃的（最不重要且超额） */
  toDrop: MemoryEntry[];
  /** 是否有任何变动 */
  dirty: boolean;
}

/* 重要性打分（确定性·零 API）：核心情节词 > 长度 > 新近。
   刻意简单——它只决定"谁先被压缩/丢弃"，真正的内容取舍仍归 AI。 */
const WEIGHTY = /死|生死|背叛|决裂|盟誓|结契|重伤|失去|救命|真相|身世|告白|婚|仇|突破|晋阶|觉醒|遗言|托付/;

export function weightOf(e: MemoryEntry): number {
  const c = e.content ?? '';
  return (WEIGHTY.test(c) ? 100 : 0) + Math.min(30, c.length / 4) + (e.addedAt ? 1 : 0);
}

/**
 * 算出本轮该怎么衰退。**纯函数，不改输入**。
 * - 近期超 cap → 最旧的那些进 `toSettle`
 * - 沉淀（含即将并入的）超 cap → 按重要性排序：最重的若干进 `toCore`（core 还有空位时），其余最轻的进 `toDrop`
 */
export function planDecay(t: TieredMemory, cap: Record<MemTier, number> = TIER_CAP): DecayPlan {
  const toSettle = t.recent.length > cap.recent ? t.recent.slice(0, t.recent.length - cap.recent) : [];
  const settledAfter = [...t.settled, ...toSettle];

  const toCore: MemoryEntry[] = [];
  const toDrop: MemoryEntry[] = [];
  if (settledAfter.length > cap.settled) {
    const overflow = settledAfter.length - cap.settled;
    const ranked = [...settledAfter].sort((a, b) => weightOf(b) - weightOf(a));
    const coreRoom = Math.max(0, cap.core - t.core.length);
    // 最重的、且 core 还有空位 → 升进核心；其余最轻的被丢弃
    for (const e of ranked.slice(0, Math.min(coreRoom, overflow))) toCore.push(e);
    const remainOverflow = overflow - toCore.length;
    if (remainOverflow > 0) toDrop.push(...ranked.slice(-remainOverflow));
  }
  return { toSettle, toCore, toDrop, dirty: toSettle.length + toCore.length + toDrop.length > 0 };
}

/** 执行衰退（结构层面的搬运；文本压缩由 AI 在记忆阶段做，这里只挪位置） */
export function applyDecay(t: TieredMemory, plan: DecayPlan): TieredMemory {
  if (!plan.dirty) return t;
  const settledIds = new Set(plan.toSettle.map((e) => e.content));
  const coreIds = new Set(plan.toCore.map((e) => e.content));
  const dropIds = new Set(plan.toDrop.map((e) => e.content));
  const recent = t.recent.filter((e) => !settledIds.has(e.content));
  const settled = [...t.settled, ...plan.toSettle]
    .filter((e) => !coreIds.has(e.content) && !dropIds.has(e.content));
  const core = [...t.core, ...plan.toCore].slice(-TIER_CAP.core);
  return { recent, settled, core };
}

/* ── 关系变化 → 记忆重解读（篡改）───────────────────────── */

/** 触发重解读的四轴变化阈值：一轮之内动这么多，说明关系发生了质变 */
export const REINTERPRET_THRESHOLD = 15;

export interface DispositionDelta { trust?: number; respect?: number; lust?: number; corruption?: number }

/**
 * 关系是否变化到该重新解读旧记忆的程度。
 * 返回方向：'warm' = 变好（旧的负面记忆该被善意重解）／'cold' = 变差（旧的正面记忆该被扭曲）／null = 无需。
 */
export function reinterpretDirection(delta: DispositionDelta): 'warm' | 'cold' | null {
  const net = (delta.trust ?? 0) + (delta.respect ?? 0);
  if (net >= REINTERPRET_THRESHOLD) return 'warm';
  if (net <= -REINTERPRET_THRESHOLD) return 'cold';
  return null;
}

/* ── 序列化 ───────────────────────────────────────────────── */

/**
 * 注入正文/私聊：**只给核心 + 最近 3 条**。
 * 沉淀层只在记忆演化阶段用——全量注入是此前的浪费大头。
 */
export function buildMemoryInjection(t: TieredMemory, name: string): string {
  const core = t.core.slice(-TIER_CAP.core);
  const recent = t.recent.slice(-3);
  if (!core.length && !recent.length) return '';
  const fmt = (e: MemoryEntry) => `${e.time ? `[${e.time}]` : ''}${e.content}`;
  const parts: string[] = [];
  if (core.length) parts.push(`核心记忆（永不遗忘）：${core.map(fmt).join('；')}`);
  if (recent.length) parts.push(`近期记忆：${recent.map(fmt).join('；')}`);
  return `${name}｜${parts.join('　')}`;
}

/** 喂给记忆压缩阶段：带层级与待处理标记，让 AI 知道该压哪几条 */
export function serializeTiersForEvo(t: TieredMemory, plan: DecayPlan): string {
  const sec = (label: string, arr: MemoryEntry[], cap: number, note = '') =>
    `【${label}】(${arr.length}/${cap})${note}\n${arr.length ? arr.map((e, i) => `  ${i + 1}. ${e.time ? `[${e.time}]` : ''}${e.content}`).join('\n') : '  （空）'}`;
  const pend = plan.dirty
    ? `\n⏳ 本轮待处理：${plan.toSettle.length ? `${plan.toSettle.length} 条近期需压缩后移入沉淀；` : ''}`
      + `${plan.toCore.length ? `${plan.toCore.length} 条沉淀重要到该升入核心；` : ''}`
      + `${plan.toDrop.length ? `${plan.toDrop.length} 条沉淀可以忘掉；` : ''}`
    : '\n（本轮各层均未超额，无需衰退）';
  return [
    sec(TIER_LABEL.recent, t.recent, TIER_CAP.recent, '　细节丰富、按时间倒序'),
    sec(TIER_LABEL.settled, t.settled, TIER_CAP.settled, '　已压缩过的版本'),
    sec(TIER_LABEL.core, t.core, TIER_CAP.core, '　永远不会忘'),
    pend,
  ].join('\n');
}
