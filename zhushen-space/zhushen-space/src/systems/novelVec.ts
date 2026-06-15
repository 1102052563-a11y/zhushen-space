import { useNovelVec } from '../store/novelVecStore';

/* 向量资料库运行时：懒加载 public/novel-vectors/{manifest,vectors.bin,chunks.json.gz}，
   缓存进 IndexedDB；每回合把查询 embed → cosine 检索 topK → 返回原著片段供注入正文世界书。
   向量为单位归一化后 int8 量化（×127）；查询向量也归一化，cosine = (q·int8)/127。 */

const DB = 'drpg-novelvec';
let _vectors: Int8Array | null = null;
let _dim = 1024, _count = 0;
let _ready = false;
let _loading: Promise<boolean> | null = null;
let _loadError = '';

export interface NovelHit { text: string; vol: string; chap: string; score: number }
interface ChunkRow { id: number; t: string; v: string; c: string }

export function novelVecStatus() { return { ready: _ready, count: _count, dim: _dim, error: _loadError, loading: !!_loading }; }

/* ── IndexedDB ── */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
function kvGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((res) => { const r = db.transaction('kv', 'readonly').objectStore('kv').get(key); r.onsuccess = () => res(r.result as T); r.onerror = () => res(undefined); });
}
function kvPut(db: IDBDatabase, key: string, val: any): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
function chunkGet(db: IDBDatabase, id: number): Promise<ChunkRow | undefined> {
  return new Promise((res) => { const r = db.transaction('chunks', 'readonly').objectStore('chunks').get(id); r.onsuccess = () => res(r.result as ChunkRow); r.onerror = () => res(undefined); });
}
function chunksBulk(db: IDBDatabase, rows: ChunkRow[]): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('chunks', 'readwrite'); const st = tx.objectStore('chunks'); for (const r of rows) st.put(r); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

async function gunzipJson(buf: ArrayBuffer): Promise<any> {
  if (typeof (globalThis as any).DecompressionStream === 'function') {
    const ds = new (globalThis as any).DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  }
  throw new Error('当前浏览器不支持 DecompressionStream（请用较新版 Chrome/Edge）');
}

/* ── 懒加载索引（首次：从 public 拉取 + 缓存 IndexedDB；之后从 IndexedDB 取）── */
export function loadNovelIndex(): Promise<boolean> {
  if (_ready) return Promise.resolve(true);
  if (_loading) return _loading;
  _loading = (async () => {
    const base = (import.meta as any).env?.BASE_URL || '/';
    const NOT_BUILT = '索引还没建：未找到 public/novel-vectors/。请先在终端 `npm run build-vectors` 建库（生成 vectors.bin/chunks.json.gz/manifest.json）并把它们一起部署。';
    // 容错取文件：网络拒绝/404/返回HTML(SPA兜底) 都翻译成"没建库"
    const grab = async (file: string): Promise<Response> => {
      let res: Response;
      try { res = await fetch(`${base}novel-vectors/${file}`, { cache: 'no-cache' }); }
      catch { throw new Error(NOT_BUILT); }
      if (!res.ok) throw new Error(NOT_BUILT);
      return res;
    };
    try {
      let manifest: any = null;
      try { manifest = await (await grab('manifest.json')).json(); }
      catch { throw new Error(NOT_BUILT); }   // 返回的是 index.html 等非 JSON → 解析失败
      if (!manifest || typeof manifest.count !== 'number' || typeof manifest.dim !== 'number') throw new Error(NOT_BUILT);
      _dim = manifest.dim; _count = manifest.count;

      const db = await open();
      const cachedMeta: any = await kvGet(db, 'manifest');
      const cachedVec = await kvGet<ArrayBuffer>(db, 'vectors');
      if (cachedVec && cachedMeta?.builtAt === manifest.builtAt && cachedVec.byteLength === _count * _dim) {
        _vectors = new Int8Array(cachedVec);   // 命中本地缓存
      } else {
        const vbuf = await (await grab('vectors.bin')).arrayBuffer();
        if (vbuf.byteLength !== _count * _dim) throw new Error(`vectors.bin 大小不符（${vbuf.byteLength} ≠ ${_count * _dim}），索引可能损坏，请重新建库`);
        _vectors = new Int8Array(vbuf);
        const cbuf = await (await grab('chunks.json.gz')).arrayBuffer();
        const arr: any[] = await gunzipJson(cbuf);
        const rows: ChunkRow[] = arr.map((x, i) => ({ id: i, t: String(x.t ?? ''), v: String(x.v ?? ''), c: String(x.c ?? '') }));
        await chunksBulk(db, rows);
        await kvPut(db, 'vectors', vbuf);
        await kvPut(db, 'manifest', manifest);
      }
      _ready = true; _loadError = '';
      return true;
    } catch (e: any) { _loadError = e?.message ?? '加载失败'; console.warn('[NovelVec] 索引加载失败', e); return false; }
    finally { _loading = null; }
  })();
  return _loading;
}

/* ── 查询 embed（归一化）── */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  const s = useNovelVec.getState().settings;
  if (!s.apiKey || !s.apiBase) throw new Error('未配置 embedding 接口（设置→向量资料库）');
  const res = await fetch(`${s.apiBase.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, input: text, encoding_format: 'float' }),
  });
  if (!res.ok) throw new Error(`embedding 接口 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const v: number[] = j?.data?.[0]?.embedding;
  if (!Array.isArray(v)) return null;
  if (v.length !== _dim) throw new Error(`维度不符：库是 ${_dim} 维，接口返回 ${v.length} 维（查询模型须与建库模型一致）`);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/* ── cosine topK（全量扫描，几万条以内毫秒级）── */
export function searchVec(q: Float32Array, topK: number, threshold: number): { id: number; score: number }[] {
  if (!_vectors) return [];
  const inv = 1 / 127;
  const hits: { id: number; score: number }[] = [];
  for (let i = 0; i < _count; i++) {
    let dot = 0; const off = i * _dim;
    for (let k = 0; k < _dim; k++) dot += q[k] * _vectors[off + k];
    const cos = dot * inv;
    if (cos >= threshold) hits.push({ id: i, score: cos });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK));
}

/* ── 一站式：查询文本 → 命中原著片段（受 maxChars 限量）── */
export async function retrieveNovel(queryText: string): Promise<NovelHit[]> {
  const s = useNovelVec.getState().settings;
  if (!s.enabled) return [];
  if (!(await loadNovelIndex())) return [];
  let q: Float32Array | null;
  try { q = await embedQuery((queryText || '').slice(0, 1500)); } catch (e) { console.warn('[NovelVec] 查询 embed 失败', e); return []; }
  if (!q) return [];
  const ids = searchVec(q, s.topK ?? 5, s.threshold ?? 0.35);
  if (ids.length === 0) return [];
  const db = await open();
  const out: NovelHit[] = [];
  let chars = 0; const cap = s.maxChars ?? 2500;
  for (const h of ids) {
    const row = await chunkGet(db, h.id);
    if (!row) continue;
    if (chars && chars + row.t.length > cap) break;
    chars += row.t.length;
    out.push({ text: row.t, vol: row.v, chap: row.c, score: h.score });
  }
  return out;
}
