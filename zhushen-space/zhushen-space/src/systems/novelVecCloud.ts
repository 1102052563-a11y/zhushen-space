/* 向量库·云端客户端（对应 multiplayer-worker/src/vectorCloud.js）。
   - 私有同步：与聊天室共用 Discord/本地身份 chatToken，跨设备取回本人的库（R2 blob + D1 元数据）。
   - 公开社区：软 owner=myPlayerId()，人人可浏览/下载（仿创意工坊）。
   载荷复用 novelVecShare 的 gzip 容器（exportUserIndexBytes / payloadFromBytes / installIndexPayload）。 */
import { mpBase, myPlayerId } from './mpConfig';
import { chatToken, chatReady } from './chatIdentity';
import { exportUserIndexBytes, payloadFromBytes, installIndexPayload } from './novelVecShare';
import { useNovelVec, type UserIndexMeta } from '../store/novelVecStore';

const base = () => mpBase().replace(/\/+$/, '');
async function errMsg(res: Response): Promise<string> {
  try { const d = await res.json(); return d.error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}
function metaParam(meta: UserIndexMeta, extra: Record<string, any> = {}): string {
  const m = { name: meta.name, kind: meta.kind, model: meta.model, dim: meta.dim, count: meta.count, sizeBytes: meta.sizeBytes, ...extra };
  return encodeURIComponent(JSON.stringify(m));
}

/* ── 私有同步（需登录）── */
export interface CloudIndexInfo { remoteId: string; name: string; kind: string; model: string; dim: number; count: number; sizeBytes: number; updatedAt: number }

function requireLogin(): string {
  if (!chatReady()) throw new Error('私有云同步需先登录（聊天室/云存档的 Discord 或本地身份）');
  const t = chatToken();
  if (!t) throw new Error('身份令牌缺失，请重新登录');
  return t;
}

export async function cloudUpload(meta: UserIndexMeta): Promise<void> {
  const token = requireLogin();
  const bytes = await exportUserIndexBytes(meta);
  const res = await fetch(`${base()}/api/vector/mine?id=${encodeURIComponent(meta.id)}&meta=${metaParam(meta)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
    body: new Blob([bytes as unknown as BlobPart]),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  useNovelVec.getState().updateUserIndex(meta.id, { remoteId: meta.id });
}

export async function cloudList(): Promise<CloudIndexInfo[]> {
  const token = requireLogin();
  const res = await fetch(`${base()}/api/vector/mine`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).items ?? []) as CloudIndexInfo[];
}

export async function cloudDownload(remoteId: string): Promise<UserIndexMeta> {
  const token = requireLogin();
  const res = await fetch(`${base()}/api/vector/mine/blob?id=${encodeURIComponent(remoteId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  const payload = await payloadFromBytes(await res.arrayBuffer());
  return installIndexPayload(payload, 'cloud', { remoteId });
}

export async function cloudDelete(remoteId: string): Promise<void> {
  const token = requireLogin();
  const res = await fetch(`${base()}/api/vector/mine?id=${encodeURIComponent(remoteId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await errMsg(res));
}

/* ── 公开社区（免登录，软 owner）── */
export interface PubIndexMeta { id: string; name: string; author?: string; owner?: string; kind: string; model: string; dim: number; count: number; sizeBytes: number; summary?: string; tags?: string[]; downloads?: number; createdAt?: number }
export interface PubListParams { q?: string; sort?: 'recent' | 'downloads'; owner?: string; limit?: number }

export async function pubList(params: PubListParams = {}): Promise<PubIndexMeta[]> {
  const u = new URL(`${base()}/api/vector/pub`);
  if (params.q) u.searchParams.set('q', params.q);
  if (params.sort) u.searchParams.set('sort', params.sort);
  if (params.owner) u.searchParams.set('owner', params.owner);
  if (params.limit) u.searchParams.set('limit', String(params.limit));
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).items ?? []) as PubIndexMeta[];
}

export async function pubListMine(): Promise<PubIndexMeta[]> {
  return pubList({ owner: myPlayerId() });
}

export async function pubPublish(meta: UserIndexMeta, extra: { author?: string; summary?: string; tags?: string[] } = {}): Promise<string> {
  const bytes = await exportUserIndexBytes(meta);
  const mp = metaParam(meta, { owner: myPlayerId(), author: extra.author?.trim() || undefined, summary: extra.summary?.trim() || undefined, tags: (extra.tags ?? []).filter(Boolean) });
  const res = await fetch(`${base()}/api/vector/pub?meta=${mp}`, {
    method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: new Blob([bytes as unknown as BlobPart]),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  const id = (await res.json()).id as string;
  useNovelVec.getState().updateUserIndex(meta.id, { publishedId: id });
  return id;
}

export async function pubDownload(id: string): Promise<UserIndexMeta> {
  const res = await fetch(`${base()}/api/vector/pub/${encodeURIComponent(id)}/blob`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  const payload = await payloadFromBytes(await res.arrayBuffer());
  return installIndexPayload(payload, 'community', { publishedId: id });
}

export async function pubDelete(id: string): Promise<void> {
  const res = await fetch(`${base()}/api/vector/pub/${encodeURIComponent(id)}?owner=${encodeURIComponent(myPlayerId())}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errMsg(res));
}
