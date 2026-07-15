// 混沌世界·客户端 helper：后端 fetch 封装（/api/chaos/*）+ 剧情偏移度量化（纯函数·可单测）。
// 后端见 multiplayer-worker/src/chaosRecords.js。上传者身份复用工坊那套 local uid（免 Discord）。

import { mpBase, myPlayerId } from './mpConfig';
import { uploaderName } from './workshop';
import { useChaosWorld } from '../store/chaosWorldStore';

/* ── 类型 ── */
export interface ChaosOffsetNode {
  原著节点: string;
  主角改动: string;
  严重度: number;   // 0~3
}

// AI 生成 / 本地待上传的混沌记录草稿
export interface ChaosRecordDraft {
  world: string;          // 归一后的世界名（分组键）
  worldRaw?: string;      // 原始世界名
  title: string;
  body: string;           // 影响概述 500-1000 字
  offset: number;         // 前端据 nodes 算出的偏移度 0-100
  band: string;           // 偏移分档（微澜/涟漪/改道/剧变/崩坏）
  nodes: ChaosOffsetNode[];
  hooks: string[];        // 留给后人的钩子
  tier?: string;
  worldRecordId?: string; // 关联本地世界记录
}

// 看板：某世界的聚合统计
export interface ChaosWorldStat {
  world: string;
  n: number;              // 记录条数
  uploaders: number;      // 上传人数（去重）
  avgOffset: number;      // 平均偏移度
  lastAt: number;
}

// 单条记录元数据（列表用·不含正文）
export interface ChaosRecordMeta {
  id: string;
  world: string;
  worldRaw?: string;
  uploaderName: string;
  offset: number;
  band?: string;
  tier?: string;
  title?: string;
  createdAt: number;
  meta?: { nodes?: ChaosOffsetNode[]; hooks?: string[] };
}

// 单条记录全文
export interface ChaosRecordFull extends ChaosRecordMeta {
  body: string;
}

/* ── 剧情偏移度量化（纯函数）──
   不信任 AI 直接吐的分数：AI 只逐个列出【偏移点 + 严重度(0-3·有正文证据)】，
   偏移度 = 各偏移点严重度按非线性权重求和、封顶 100。彻底颠覆(3)权重远大于轻微(1)，故"一处剧变" > "十处细节扰动"。 */
export const SEVERITY_POINTS = [0, 8, 20, 40];   // 严重度 0/1/2/3 → 分值

// 世界名归一（分组键兼展示名）：保留可读性（不小写、不剥中文），仅收敛空白 + 去掉尾部「世界/位面/副本/地图」装饰。
// 跨玩家写法差异（中/英文别名）无法完美归并——MVP 取可读优先；world_raw 存原始名备查。
export function canonWorldName(s: string): string {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const stripped = t.replace(/[·•・\-—_|｜:：]+$/, '').replace(/(世界|位面|副本|地图|の世界)$/, '').trim();
  return stripped || t;
}

export function bandOf(offset: number): string {
  if (offset >= 80) return '崩坏';
  if (offset >= 60) return '剧变';
  if (offset >= 40) return '改道';
  if (offset >= 20) return '涟漪';
  return '微澜';
}

export function computeOffset(nodes: ChaosOffsetNode[] | undefined | null): { offset: number; band: string } {
  let sum = 0;
  for (const nd of nodes ?? []) {
    const sev = Math.max(0, Math.min(3, Math.round(Number(nd?.严重度) || 0)));
    sum += SEVERITY_POINTS[sev];
  }
  const offset = Math.max(0, Math.min(100, Math.round(sum)));
  return { offset, band: bandOf(offset) };
}

/* ── 后端 API ── */
export function chaosApiBase(): string {
  const o = useChaosWorld.getState().apiBase;
  return (o || mpBase()).replace(/\/+$/, '');
}
async function errMsg(res: Response): Promise<string> {
  try { const d = await res.json(); return d.error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}

// 看板：按世界名分组统计
export async function chaosListWorlds(): Promise<ChaosWorldStat[]> {
  const res = await fetch(`${chaosApiBase()}/api/chaos/worlds`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).worlds ?? []) as ChaosWorldStat[];
}

// 某世界的记录列表（不含正文）
export async function chaosListRecords(world: string, limit = 100): Promise<ChaosRecordMeta[]> {
  const u = new URL(`${chaosApiBase()}/api/chaos/records`);
  u.searchParams.set('world', world);
  u.searchParams.set('limit', String(limit));
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).items ?? []) as ChaosRecordMeta[];
}

// 单条全文
export async function chaosGetRecord(id: string): Promise<ChaosRecordFull> {
  const res = await fetch(`${chaosApiBase()}/api/chaos/records/${encodeURIComponent(id)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return (await res.json()).item as ChaosRecordFull;
}

// 拉取多个世界的记录（含正文·喂 AI 生成混沌世界卡）
export async function chaosFeed(worlds: string[], perWorld = 8): Promise<ChaosRecordFull[]> {
  const u = new URL(`${chaosApiBase()}/api/chaos/feed`);
  u.searchParams.set('worlds', worlds.join(','));
  u.searchParams.set('perWorld', String(perWorld));
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).records ?? []) as ChaosRecordFull[];
}

// 上传（opt-in）→ 返回记录 id，并记进本地账本
export async function chaosUpload(draft: ChaosRecordDraft): Promise<string> {
  const body = {
    world: draft.world,
    worldRaw: draft.worldRaw || draft.world,
    uploader: myPlayerId(),
    uploaderName: uploaderName() || '无名契约者',
    offset: draft.offset,
    band: draft.band,
    tier: draft.tier || '',
    title: draft.title,
    body: draft.body,
    meta: { nodes: draft.nodes, hooks: draft.hooks },
  };
  const res = await fetch(`${chaosApiBase()}/api/chaos/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  const id = (await res.json()).id as string;
  useChaosWorld.getState().recordUpload({
    id, world: draft.world, offset: draft.offset, title: draft.title,
    uploadedAt: Date.now(), worldRecordId: draft.worldRecordId,
  });
  return id;
}

// 删除本人上传的
export async function chaosDelete(id: string): Promise<void> {
  const u = new URL(`${chaosApiBase()}/api/chaos/records/${encodeURIComponent(id)}`);
  u.searchParams.set('owner', myPlayerId());
  const res = await fetch(u.toString(), { method: 'DELETE' });
  if (!res.ok) throw new Error(await errMsg(res));
  useChaosWorld.getState().forgetUpload(id);
}
