/* 向量库文件分享（零服务端）：把一个自建索引打包成 .zsvec（gzip 的 JSON 容器）导出/导入。
   容器 = { fmt, meta, vectorsB64(int8 字节), chunks[] }。导入端解包 → 写 IndexedDB → 登记为新的本地索引。
   也复用为「私有云/社区」的上传载荷（buildIndexPayload / installIndexPayload）。 */
import { openDb, kvPut, chunksBulk, kvGet, chunksByPrefix, type ChunkRow } from './novelVecDb';
import { useNovelVec, type UserIndexMeta, type UserIndexKind, type UserIndexOrigin } from '../store/novelVecStore';
import { invalidateUserIndex } from './novelVec';

const FMT = 'zhushen-novelvec@1';

export interface IndexPayload {
  fmt: string;
  meta: { name: string; kind: UserIndexKind; model: string; apiBase: string; dim: number; count: number; chunkSize: number; overlap: number; builtAt: string; note?: string };
  vectorsB64: string;
  chunks: RawChunkLite[];
}
interface RawChunkLite { t: string; v: string; c: string }

/* ── base64 <-> 字节（分块避免大数组爆栈）── */
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as any);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── gzip / gunzip（浏览器 Compression*Stream；不支持则明文兜底）── */
async function gzip(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  if (typeof (globalThis as any).CompressionStream !== 'function') return bytes;
  const cs = new (globalThis as any).CompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(buf);
  if (typeof (globalThis as any).DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压（请用较新版 Chrome/Edge）');
  const ds = new (globalThis as any).DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

/* ── 从 IDB 读出一个索引，打包成载荷（内存对象）── */
export async function buildIndexPayload(meta: UserIndexMeta): Promise<IndexPayload> {
  const db = await openDb();
  const vec = await kvGet<ArrayBuffer>(db, `vectors:${meta.id}`);
  if (!vec) throw new Error('索引向量丢失，无法导出');
  const rows = await chunksByPrefix(db, meta.id);
  return {
    fmt: FMT,
    meta: { name: meta.name, kind: meta.kind, model: meta.model, apiBase: meta.apiBase, dim: meta.dim, count: meta.count, chunkSize: meta.chunkSize, overlap: meta.overlap, builtAt: meta.builtAt, note: meta.note },
    vectorsB64: bytesToB64(new Uint8Array(vec)),
    chunks: rows.map((r) => ({ t: r.t, v: r.v, c: r.c })),
  };
}

/* ── 把载荷落地为一个【新的本地索引】（分配新 id，写 IDB + 登记 store）── */
export async function installIndexPayload(payload: IndexPayload, origin: UserIndexOrigin = 'local', remote?: { remoteId?: string; publishedId?: string }): Promise<UserIndexMeta> {
  if (!payload || payload.fmt !== FMT || !payload.meta) throw new Error('文件格式不对（不是 zhushen 向量库）');
  const m = payload.meta;
  const bytes = b64ToBytes(payload.vectorsB64);
  if (bytes.byteLength !== m.count * m.dim) throw new Error('向量大小与元数据不符，文件可能损坏');
  const id = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const db = await openDb();
  const rows: ChunkRow[] = payload.chunks.map((c, i) => ({ k: `${id}#${i}`, t: c.t, v: c.v, c: c.c }));
  await chunksBulk(db, rows);
  await kvPut(db, `vectors:${id}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  await kvPut(db, `manifest:${id}`, { source: m.name, model: m.model, dim: m.dim, count: m.count, chunkSize: m.chunkSize, overlap: m.overlap, normalized: true, quant: 'int8', parts: 0, builtAt: m.builtAt });
  const meta: UserIndexMeta = {
    id, name: m.name || '导入的向量库', kind: m.kind, model: m.model, apiBase: m.apiBase,
    dim: m.dim, count: m.count, chunkSize: m.chunkSize, overlap: m.overlap, sizeBytes: m.count * m.dim,
    builtAt: m.builtAt, enabled: true, origin, note: m.note,
    remoteId: remote?.remoteId, publishedId: remote?.publishedId,
  };
  useNovelVec.getState().addUserIndex(meta);
  invalidateUserIndex(id);
  return meta;
}

/* ── 导出为 .zsvec 文件（触发下载）── */
export async function exportUserIndexToFile(meta: UserIndexMeta): Promise<void> {
  const payload = await buildIndexPayload(meta);
  const gz = await gzip(JSON.stringify(payload));
  const blob = new Blob([gz as unknown as BlobPart], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(meta.name || 'novelvec').replace(/[\\/:*?"<>|]+/g, '_')}.zsvec`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── 从文件导入（解 gzip → 解析 → 落地）── */
export async function importUserIndexFromFile(file: File): Promise<UserIndexMeta> {
  const buf = await file.arrayBuffer();
  const text = await gunzip(buf);
  const payload = JSON.parse(text) as IndexPayload;
  return installIndexPayload(payload, 'local');
}

/* 导出为压缩字节（供上传云端/社区复用，不触发下载）*/
export async function exportUserIndexBytes(meta: UserIndexMeta): Promise<Uint8Array> {
  const payload = await buildIndexPayload(meta);
  return gzip(JSON.stringify(payload));
}
/* 从压缩字节解析回载荷（供云端/社区下载复用）*/
export async function payloadFromBytes(buf: ArrayBuffer): Promise<IndexPayload> {
  return JSON.parse(await gunzip(buf)) as IndexPayload;
}
