import type { VecMemConfig } from '../store/settingsStore';

/* 向量召回·长期记忆向量库（与关键词叙事记忆并行的另一套引擎，自带 embedding 端点）
   - 记忆条目(长期事实/小结/大结/世界大事)按"内容哈希"为键，随时 embed 存入 IndexedDB + 内存缓存（增量）
   - 召回时只 embed 当前情境一次 → 在当前记忆池内 cosine topK，无任何 LLM 调用
   - 向量在 embed 时单位归一化，故 cosine = 点积 */

const DB = 'drpg-factvec';
const STORE = 'vecs';

interface VecRow { k: string; model: string; vec: number[] }

let _cache: Map<string, { vec: Float32Array; model: string }> | null = null;
let _loading: Promise<void> | null = null;

/* 内容哈希（FNV-1a 32位 + 长度）→ 稳定键：同文本幂等，不同文本极少碰撞 */
export function hashKey(text: string): string {
  let h = 0x811c9dc5;
  const s = text || '';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '_' + s.length.toString(36);
}

/* ── IndexedDB ── */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' }); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
function idbGetAll(db: IDBDatabase): Promise<VecRow[]> {
  return new Promise((res) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); r.onsuccess = () => res((r.result as VecRow[]) ?? []); r.onerror = () => res([]); });
}
function idbBulkPut(db: IDBDatabase, rows: VecRow[]): Promise<void> {
  return new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); const st = tx.objectStore(STORE); for (const r of rows) st.put(r); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
function idbDeleteKeys(db: IDBDatabase, keys: string[]): Promise<void> {
  return new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); const st = tx.objectStore(STORE); for (const k of keys) st.delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

/* 加载全部向量进内存缓存（一次；后续增量更新缓存）*/
export async function loadAll(): Promise<void> {
  if (_cache) return;
  if (_loading) return _loading;
  _loading = (async () => {
    const m = new Map<string, { vec: Float32Array; model: string }>();
    try {
      const db = await open();
      for (const r of await idbGetAll(db)) m.set(r.k, { vec: Float32Array.from(r.vec), model: r.model });
    } catch (e) { console.warn('[FactVec] 加载失败', e); }
    _cache = m; _loading = null;
  })();
  return _loading;
}

/* 批量 embed（一次 API 调用嵌入多条），单位归一化 */
export async function embedBatch(texts: string[], cfg: VecMemConfig): Promise<Float32Array[]> {
  if (!cfg.apiBase || !cfg.apiKey) throw new Error('未配置 embedding 接口（设置→向量记忆）');
  if (texts.length === 0) return [];
  const res = await fetch(cfg.apiBase.replace(/\/+$/, '') + '/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: texts, encoding_format: 'float' }),
  });
  if (!res.ok) throw new Error(`embedding 接口 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const data: any[] = (j?.data ?? []).slice();
  data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));   // 按 index 对齐输入顺序
  return data.map((d) => {
    const v: number[] = d.embedding ?? [];
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
  });
}

/* embed 单条（查询用，单位归一化）*/
export async function embedOne(text: string, cfg: VecMemConfig): Promise<Float32Array | null> {
  const r = await embedBatch([(text || '').slice(0, 2000)], cfg);
  return r[0] ?? null;
}

export interface MemItem { key: string; text: string }

/* 补缺：对缓存里缺失(或 embed 模型已变)的条目分批 embed 入库。
   opts.max 限制本次最多 embed 多少条（0/缺省=全部；召回内联用小值，回填按钮用全部）。
   返回 {embedded(本次), remaining(仍缺), total}。*/
export async function ensureVectors(
  items: MemItem[], cfg: VecMemConfig,
  opts: { max?: number; batch?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ embedded: number; remaining: number; total: number }> {
  await loadAll();
  const cache = _cache!;
  const missing = items.filter((it) => { const c = cache.get(it.key); return !c || c.model !== cfg.model; });
  const max = opts.max && opts.max > 0 ? Math.min(opts.max, missing.length) : missing.length;
  const todo = missing.slice(0, max);
  const batch = Math.max(1, opts.batch ?? 64);
  let done = 0;
  if (todo.length) {
    const db = await open();
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      const vecs = await embedBatch(chunk.map((c) => c.text.slice(0, 2000)), cfg);
      const rows: VecRow[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const v = vecs[j]; if (!v || v.length === 0) continue;
        cache.set(chunk[j].key, { vec: v, model: cfg.model });
        rows.push({ k: chunk[j].key, model: cfg.model, vec: Array.from(v) });
      }
      await idbBulkPut(db, rows);
      done += chunk.length;
      opts.onProgress?.(done, todo.length);
    }
  }
  return { embedded: done, remaining: missing.length - done, total: items.length };
}

/* cosine topK（向量已归一化→点积）；只在传入的 keys（当前记忆池）内检索，避免召回已淘汰条目 */
export function search(queryVec: Float32Array, keys: string[], topK: number, threshold: number): { key: string; score: number }[] {
  if (!_cache) return [];
  const hits: { key: string; score: number }[] = [];
  for (const k of keys) {
    const c = _cache.get(k); if (!c) continue;
    const v = c.vec; const n = Math.min(v.length, queryVec.length);
    let dot = 0; for (let i = 0; i < n; i++) dot += queryVec[i] * v[i];
    if (dot >= threshold) hits.push({ key: k, score: dot });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK));
}

/* 清理缓存与库里不在 keepKeys 内的孤儿向量（记忆条目被 FIFO 淘汰后）；返回删除数 */
export async function pruneExcept(keepKeys: Set<string>): Promise<number> {
  await loadAll();
  const cache = _cache!;
  const dead: string[] = [];
  for (const k of cache.keys()) if (!keepKeys.has(k)) dead.push(k);
  if (dead.length) { for (const k of dead) cache.delete(k); try { await idbDeleteKeys(await open(), dead); } catch { /* ignore */ } }
  return dead.length;
}

/* 当前已索引向量数（缓存未加载则 -1）*/
export function vecStatus(): { indexed: number } {
  return { indexed: _cache ? _cache.size : -1 };
}

/* 清空全部向量（新开存档/清档时调用，与 clearAllImg 并列）。内存缓存置空。*/
export async function clearAllVectors(): Promise<void> {
  _cache = new Map();
  try {
    const db = await open();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* ignore */ }
}

/* 记忆池条目：把长期事实/大小总结/世界大事统一成"可向量化 + 可注入"的条目。
   text=用于 embed 的全文；body=注入正文的文本；key=内容哈希（幂等）。供召回与设置页回填共用。*/
export interface PoolEntry { key: string; text: string; body: string; kind: 'fact' | 'large' | 'small' | 'event' }
export function buildMemPool(src: {
  narrativeFacts?: { title: string; text: string; keywords: string[] }[];
  largeSummaries?: string[]; smallSummaries?: string[];
  worldEvents?: { time: string; location: string; desc: string }[];
}, maxItems = 1000): PoolEntry[] {
  const out: PoolEntry[] = [];
  for (const f of src.narrativeFacts ?? []) {
    const text = `${f.title} ${f.text} ${(f.keywords ?? []).join(' ')}`.trim();
    out.push({ key: hashKey('fact|' + text), text, body: f.text, kind: 'fact' });
  }
  for (const t of src.largeSummaries ?? []) out.push({ key: hashKey('large|' + t), text: t, body: t, kind: 'large' });
  for (const t of src.smallSummaries ?? []) out.push({ key: hashKey('small|' + t), text: t, body: t, kind: 'small' });
  for (const e of src.worldEvents ?? []) { const t = `${e.time}@${e.location} ${e.desc}`.trim(); out.push({ key: hashKey('event|' + t), text: t, body: t, kind: 'event' }); }
  // 超上限时保留尾部（较近期）；默认上限远大于常见池大小，一般不触发
  return out.length > maxItems ? out.slice(out.length - maxItems) : out;
}
