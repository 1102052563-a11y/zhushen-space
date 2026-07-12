/* 浏览器内建库：把玩家提供的文本/世界书 JSON → 切块 → 调 embedding → int8 量化 → 写 IndexedDB → 登记到 store。
   逻辑与 tools/build-novel-vectors.mjs 一致，但跑在浏览器里、用玩家自己的 embedding key，产出「玩家自建索引」。
   维度不写死：从第一批 embedding 返回长度推断（可用非 bge-m3 的其它模型）。 */
import { fetchWithProxy } from './apiChat';
import { openDb, kvPut, chunksBulk, type ChunkRow } from './novelVecDb';
import { useNovelVec, type UserIndexMeta, type UserIndexKind } from '../store/novelVecStore';

export interface RawChunk { t: string; v: string; c: string }

/* ── 切块：纯文本（识别 第X卷/第X章，章内滑窗 ~chunkSize 字，带 overlap，尽量句末断）── */
const NUM = '\\d一二三四五六七八九十百千零两';
const VOL_RE = new RegExp(`^第[${NUM}]{1,8}卷`);
const CHAP_RE = new RegExp(`^第[${NUM}]{1,8}章`);

export function chunkPlainText(text: string, chunkSize = 700, overlap = 100): RawChunk[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/　/g, '  ').split('\n');
  const out: RawChunk[] = [];
  let vol = '', chap = '', buf = '';
  const flush = () => {
    const t = buf.replace(/\n{2,}/g, '\n').trim(); buf = '';
    if (t.length < 20) return;
    let i = 0;
    while (i < t.length) {
      let end = Math.min(i + chunkSize, t.length);
      if (end < t.length) { // 向后最多 80 字找句末断点
        let j = end; while (j < t.length && j < end + 80 && !'。！？\n”』'.includes(t[j])) j++;
        if (j < t.length && j < end + 80) end = j + 1;
      }
      const piece = t.slice(i, end).trim();
      if (piece.length >= 20) out.push({ t: piece, v: vol, c: chap });
      if (end >= t.length) break;
      i = Math.max(i + 1, end - overlap);
    }
  };
  for (const ln of lines) {
    const s = ln.trim();
    if (VOL_RE.test(s)) { flush(); vol = s.slice(0, 40); continue; }
    if (CHAP_RE.test(s)) { flush(); chap = s.slice(0, 40); continue; }
    buf += ln + '\n';
    if (buf.length > chunkSize * 4) flush();
  }
  flush();
  return out;
}

/* ── 切块：世界书 JSON（每条 content 一块，过长再滑窗；comment 作标题、key 作来源标签）── */
export function chunkWorldBookJson(jsonText: string, chunkSize = 700, overlap = 100): RawChunk[] {
  const j = JSON.parse(jsonText);
  const entries: any[] = j?.entries ? (Array.isArray(j.entries) ? j.entries : Object.values(j.entries)) : (Array.isArray(j) ? j : []);
  const out: RawChunk[] = [];
  for (const e of entries) {
    if (e?.disable === true || e?.enabled === false) continue;
    const content = String(e?.content ?? '').replace(/\r\n/g, '\n').trim();
    if (content.length < 10) continue;
    const title = String(e?.comment ?? e?.name ?? '').replace(/^\[[^\]]*\]\s*/, '').trim() || '设定';
    const keys = Array.isArray(e?.key) ? e.key.filter(Boolean).join('/') : '';
    if (content.length <= chunkSize * 1.6) { out.push({ t: content, v: keys, c: title }); continue; }
    let i = 0;
    while (i < content.length) {
      let end = Math.min(i + chunkSize, content.length);
      if (end < content.length) { let jx = end; while (jx < content.length && jx < end + 80 && !'。！？\n；'.includes(content[jx])) jx++; if (jx < content.length && jx < end + 80) end = jx + 1; }
      out.push({ t: content.slice(i, end).trim(), v: keys, c: title });
      if (end >= content.length) break;
      i = Math.max(i + 1, end - overlap);
    }
  }
  return out;
}

export function chunkText(kind: UserIndexKind, text: string, chunkSize = 700, overlap = 100): RawChunk[] {
  return kind === 'worldbook' ? chunkWorldBookJson(text, chunkSize, overlap) : chunkPlainText(text, chunkSize, overlap);
}

/* ── embedding 批量（含重试/退避，走 fetchWithProxy 以便 CORS 时回退服务端代理）── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embedBatch(texts: string[], apiBase: string, apiKey: string, model: string, signal?: AbortSignal): Promise<number[][]> {
  const url = `${apiBase.replace(/\/+$/, '')}/embeddings`;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      const res = await fetchWithProxy(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
        signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < 7) { await sleep(800 * 2 ** attempt); continue; }
        throw new Error(`embedding ${res.status}: ${body.slice(0, 200)}`);
      }
      const j = await res.json();
      const data: any[] = j?.data;
      if (!Array.isArray(data)) throw new Error('embedding 返回缺 data');
      return data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding as number[]);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      if (attempt < 7) { await sleep(800 * 2 ** attempt); continue; }
      throw e;
    }
  }
}

/* 单位归一化 → ×127 → int8，写进 out 的 off 处 */
function quantizeInto(vec: number[], out: Int8Array, off: number, dim: number): void {
  let n = 0; for (let k = 0; k < dim; k++) n += vec[k] * vec[k]; n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) { const q = Math.round((vec[k] / n) * 127); out[off + k] = q > 127 ? 127 : q < -127 ? -127 : q; }
}

export interface BuildParams {
  name: string;
  kind: UserIndexKind;
  text: string;                 // 原始文本 或 世界书 JSON 字符串
  chunkSize?: number;
  overlap?: number;
  apiBase: string;
  apiKey: string;
  model: string;
  batch?: number;
  concurrency?: number;
  note?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const newId = () => `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/* 建库主函数：切块 → 逐批 embed（首批用于探测维度）→ 量化 → 写 IDB → 登记 store，返回元数据 */
export async function buildUserIndex(p: BuildParams): Promise<UserIndexMeta> {
  const chunkSize = p.chunkSize ?? 700;
  const overlap = p.overlap ?? 100;
  const BATCH = Math.max(1, Math.min(64, p.batch ?? 32));
  const CONC = Math.max(1, Math.min(6, p.concurrency ?? 3));
  const apiBase = p.apiBase.replace(/\/+$/, '');
  if (!apiBase || !p.apiKey) throw new Error('未配置 embedding 接口（Base / Key）');

  const chunks = chunkText(p.kind, p.text, chunkSize, overlap);
  const total = chunks.length;
  if (total === 0) throw new Error(p.kind === 'worldbook' ? '世界书里没解析出可用条目（检查 JSON 格式）' : '文本太短或为空，切不出块');

  // 首批探测维度
  if (p.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const firstEnd = Math.min(BATCH, total);
  const firstEmb = await embedBatch(chunks.slice(0, firstEnd).map((c) => c.t), apiBase, p.apiKey, p.model, p.signal);
  const dim = firstEmb[0]?.length ?? 0;
  if (!dim) throw new Error('embedding 返回空向量');

  const vectors = new Int8Array(total * dim);
  for (let k = 0; k < firstEmb.length; k++) quantizeInto(firstEmb[k], vectors, k * dim, dim);
  let done = firstEnd;
  p.onProgress?.(done, total);

  // 其余批次并发
  const starts: number[] = [];
  for (let i = firstEnd; i < total; i += BATCH) starts.push(i);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      if (p.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const s = starts[next++]; const e = Math.min(s + BATCH, total);
      const embs = await embedBatch(chunks.slice(s, e).map((c) => c.t), apiBase, p.apiKey, p.model, p.signal);
      if (embs.some((v) => v.length !== dim)) throw new Error('embedding 维度前后不一致（模型异常）');
      for (let k = 0; k < embs.length; k++) quantizeInto(embs[k], vectors, (s + k) * dim, dim);
      done += embs.length;
      p.onProgress?.(Math.min(done, total), total);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  // 写 IndexedDB（与内置源同一 schema）
  const id = newId();
  const builtAt = new Date().toISOString();
  const db = await openDb();
  const rows: ChunkRow[] = chunks.map((c, i) => ({ k: `${id}#${i}`, t: c.t, v: c.v, c: c.c }));
  await chunksBulk(db, rows);
  // 存 ArrayBuffer 副本（Int8Array.buffer 可能带 offset，用 slice 保干净）
  await kvPut(db, `vectors:${id}`, vectors.buffer.slice(0));
  const manifest = { source: p.name, model: p.model, dim, count: total, chunkSize, overlap, normalized: true, quant: 'int8', parts: 0, builtAt };
  await kvPut(db, `manifest:${id}`, manifest);

  const meta: UserIndexMeta = {
    id, name: p.name.trim() || '未命名向量库', kind: p.kind, model: p.model, apiBase,
    dim, count: total, chunkSize, overlap, sizeBytes: total * dim, builtAt,
    enabled: true, origin: 'local', note: p.note?.trim() || undefined,
  };
  useNovelVec.getState().addUserIndex(meta);
  return meta;
}
