import { useNovelVec } from '../store/novelVecStore';

/* 向量资料库运行时（多索引）：懒加载 public/<source>/{manifest,vectors.bin,chunks.json.gz}，缓存进 IndexedDB；
   每回合把查询 embed 一次 → 在【所有已加载索引】里 cosine 检索 → 合并 topK → 返回片段供注入正文世界书。
   向量为单位归一化后 int8 量化(×127)；查询向量也归一化，cosine = (q·int8)/127。
   两个源（小说 novel-vectors + 世界书 worldbook-vectors）必须用同一 embedding 模型(维度一致)。 */

const DB = 'drpg-novelvec';
const SOURCES = ['novel-vectors', 'worldbook-vectors'];          // 候选索引目录，存在哪个加载哪个
const SRC_LABEL: Record<string, string> = { 'novel-vectors': '原著', 'worldbook-vectors': '世界书' };

interface LoadedIndex { name: string; vectors: Int8Array; count: number; dim: number; builtAt: string }
interface ChunkRow { k: string; t: string; v: string; c: string }
export interface NovelHit { text: string; vol: string; chap: string; score: number; source: string }

let _indexes: LoadedIndex[] = [];
let _ready = false;
let _loading: Promise<boolean> | null = null;
let _loadError = '';

export function novelVecStatus() {
  return {
    ready: _ready,
    count: _indexes.reduce((n, x) => n + x.count, 0),
    dim: _indexes[0]?.dim ?? 0,
    error: _loadError,
    loading: !!_loading,
    sources: _indexes.map((x) => ({ name: SRC_LABEL[x.name] ?? x.name, count: x.count })),
  };
}

/* ── IndexedDB（v2：kv 存 manifest:<name>/vectors:<name>；chunks 键 <name>#<id>）── */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      for (const s of ['kv', 'chunks']) if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
      db.createObjectStore('kv');
      db.createObjectStore('chunks', { keyPath: 'k' });
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
function chunkGet(db: IDBDatabase, key: string): Promise<ChunkRow | undefined> {
  return new Promise((res) => { const r = db.transaction('chunks', 'readonly').objectStore('chunks').get(key); r.onsuccess = () => res(r.result as ChunkRow); r.onerror = () => res(undefined); });
}
function chunksBulk(db: IDBDatabase, rows: ChunkRow[]): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('chunks', 'readwrite'); const st = tx.objectStore('chunks'); for (const r of rows) st.put(r); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

async function gunzipJson(buf: ArrayBuffer): Promise<any> {
  const bytes = new Uint8Array(buf);
  // gzip 魔数 1f 8b？很多服务器(含 Vite dev)会按 .gz 透明解压并发 Content-Encoding，浏览器拿到已是明文 JSON → 直接 parse；仍是 gzip 字节才手动解压
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return JSON.parse(new TextDecoder().decode(buf));
  if (typeof (globalThis as any).DecompressionStream === 'function') {
    const ds = new (globalThis as any).DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  }
  throw new Error('当前浏览器不支持 DecompressionStream（请用较新版 Chrome/Edge）');
}

/* 加载单个源；该源没建/不存在 → 返回 null（跳过，不报错） */
async function loadOne(db: IDBDatabase, base: string, name: string): Promise<LoadedIndex | null> {
  const grab = async (file: string): Promise<Response | null> => {
    let r: Response;
    try { r = await fetch(`${base}${name}/${file}`, { cache: 'no-cache' }); } catch { return null; }
    return r.ok ? r : null;
  };
  const mres = await grab('manifest.json');
  if (!mres) return null;
  let manifest: any; try { manifest = await mres.json(); } catch { return null; }   // 返回HTML(SPA兜底)等 → 当作没建
  if (!manifest || typeof manifest.count !== 'number' || typeof manifest.dim !== 'number') return null;

  const cachedMeta: any = await kvGet(db, `manifest:${name}`);
  const cachedVec = await kvGet<ArrayBuffer>(db, `vectors:${name}`);
  let vectors: Int8Array;
  if (cachedVec && cachedMeta?.builtAt === manifest.builtAt && cachedVec.byteLength === manifest.count * manifest.dim) {
    vectors = new Int8Array(cachedVec);
  } else {
    // vectors.bin 可能被切成多片（Cloudflare 单文件 25 MiB 限制）：manifest.parts>0 时逐片取回拼接
    const nparts = Number((manifest as any).parts) || 0;
    let vbuf: ArrayBuffer;
    if (nparts > 0) {
      const merged = new Uint8Array(manifest.count * manifest.dim);
      let off = 0;
      for (let i = 0; i < nparts; i++) {
        const r = await grab(`vectors.bin.${i}`); if (!r) throw new Error(`${name}/vectors.bin.${i} 缺失`);
        const b = new Uint8Array(await r.arrayBuffer());
        merged.set(b, off); off += b.byteLength;
      }
      vbuf = merged.buffer;
    } else {
      const vres = await grab('vectors.bin'); if (!vres) throw new Error(`${name}/vectors.bin 缺失`);
      vbuf = await vres.arrayBuffer();
    }
    if (vbuf.byteLength !== manifest.count * manifest.dim) throw new Error(`${name} vectors 大小不符，请重建该索引`);
    vectors = new Int8Array(vbuf);
    const cres = await grab('chunks.json.gz'); if (!cres) throw new Error(`${name}/chunks.json.gz 缺失`);
    const arr: any[] = await gunzipJson(await cres.arrayBuffer());
    await chunksBulk(db, arr.map((x, i) => ({ k: `${name}#${i}`, t: String(x.t ?? ''), v: String(x.v ?? ''), c: String(x.c ?? '') })));
    await kvPut(db, `vectors:${name}`, vbuf);
    await kvPut(db, `manifest:${name}`, manifest);
  }
  return { name, vectors, count: manifest.count, dim: manifest.dim, builtAt: manifest.builtAt };
}

export function loadNovelIndex(): Promise<boolean> {
  if (_ready) return Promise.resolve(true);
  if (_loading) return _loading;
  _loading = (async () => {
    const base = (import.meta as any).env?.BASE_URL || '/';
    try {
      const db = await open();
      const loaded: LoadedIndex[] = [];
      const errs: string[] = [];
      for (const name of SOURCES) {
        try { const idx = await loadOne(db, base, name); if (idx) loaded.push(idx); }
        catch (e: any) { errs.push(`${SRC_LABEL[name] ?? name}: ${e?.message ?? '失败'}`); }
      }
      if (loaded.length === 0) {
        _loadError = errs.length ? errs.join('；') : '索引还没建：未找到 public/novel-vectors/（先在终端 npm run build-vectors 建库并部署）';
        return false;
      }
      const dim0 = loaded[0].dim;
      if (loaded.some((x) => x.dim !== dim0)) { _loadError = `两个索引维度不一致（${loaded.map((x) => x.dim).join(' vs ')}）——必须用同一 embedding 模型建库`; return false; }
      _indexes = loaded; _ready = true;
      _loadError = errs.length ? `（部分源未加载：${errs.join('；')}）` : '';
      return true;
    } catch (e: any) { _loadError = e?.message ?? '加载失败'; console.warn('[NovelVec] 索引加载失败', e); return false; }
    finally { _loading = null; }
  })();
  return _loading;
}

/* 查询 embed（归一化）；维度按已加载索引校验 */
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
  const dim = _indexes[0]?.dim ?? v.length;
  if (v.length !== dim) throw new Error(`维度不符：库是 ${dim} 维，接口返回 ${v.length} 维（查询模型须与建库模型一致）`);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/* 在所有已加载索引里 cosine 检索，合并取全局 topK */
export function searchAll(q: Float32Array, topK: number, threshold: number): { name: string; id: number; score: number }[] {
  const inv = 1 / 127;
  const hits: { name: string; id: number; score: number }[] = [];
  for (const idx of _indexes) {
    const { vectors, dim, count, name } = idx;
    for (let i = 0; i < count; i++) {
      let dot = 0; const off = i * dim;
      for (let k = 0; k < dim; k++) dot += q[k] * vectors[off + k];
      const cos = dot * inv;
      if (cos >= threshold) hits.push({ name, id: i, score: cos });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK));
}

/* 一站式：查询文本 → 命中片段（跨两个源、受 maxChars 限量）*/
export async function retrieveNovel(queryText: string): Promise<NovelHit[]> {
  const s = useNovelVec.getState().settings;
  if (!s.enabled) return [];
  if (!(await loadNovelIndex())) return [];
  let q: Float32Array | null;
  try { q = await embedQuery((queryText || '').slice(0, 1500)); } catch (e) { console.warn('[NovelVec] 查询 embed 失败', e); return []; }
  if (!q) return [];
  const ids = searchAll(q, s.topK ?? 5, s.threshold ?? 0.35);
  if (ids.length === 0) return [];
  const db = await open();
  const out: NovelHit[] = [];
  let chars = 0; const cap = s.maxChars ?? 2500;
  for (const h of ids) {
    const row = await chunkGet(db, `${h.name}#${h.id}`);
    if (!row) continue;
    if (chars && chars + row.t.length > cap) break;
    chars += row.t.length;
    out.push({ text: row.t, vol: row.v, chap: row.c, score: h.score, source: SRC_LABEL[h.name] ?? h.name });
  }
  return out;
}
