import { useNovelVec, type UserIndexMeta } from '../store/novelVecStore';
import { fetchWithProxy } from './apiChat';   // 查询 embed 直连失败(CORS/SSL)自动回退服务端代理
import { openDb, kvGet, kvPut, chunkGet, chunksBulk } from './novelVecDb';
import { canonMaxVolume, cnVolToInt } from './canonRoute';   // 🛤 原著路线·剧透闸（≤本站卷才放行原著片段）

/* 向量资料库运行时（多索引 + 多模型）：
   - 内置源：懒加载 public/<source>/{manifest,vectors.bin,chunks.json.gz}，缓存进 IndexedDB。
   - 玩家自建源：从 IndexedDB(drpg-novelvec) 直接读回（建库时已写入），按 store.userIndexes 登记表懒加载。
   每回合把查询按【模型分组】各 embed 一次 → 在同模型(同维)索引里 cosine 检索 → 合并 topK → 注入正文世界书。
   向量为单位归一化后 int8 量化(×127)；查询向量也归一化，cosine = (q·int8)/127。 */

const SOURCES = ['novel-vectors', 'worldbook-vectors', 'wiki-vectors'];   // 内置候选索引目录，存在哪个加载哪个
const SRC_LABEL: Record<string, string> = { 'novel-vectors': '原著', 'worldbook-vectors': '世界书', 'wiki-vectors': '轮回WIKI' };
/* 供 UI 列出内置源做单独开关（目录名 + 显示名）；实际是否加载仍看 public/ 是否部署 */
export const BUILTIN_SOURCES: { name: string; label: string }[] = SOURCES.map((n) => ({ name: n, label: SRC_LABEL[n] ?? n }));

interface LoadedIndex {
  name: string;          // IDB/网络里的键前缀：内置=目录名，玩家=meta.id
  label: string;         // 显示名
  vectors: Int8Array;
  count: number;
  dim: number;
  model: string;         // 建库模型（检索按模型分组）
  apiBase: string;       // 建库接口（''=用 settings.apiBase）
  origin: 'builtin' | 'user';
  builtAt: string;
}
export interface NovelHit { text: string; vol: string; chap: string; score: number; source: string }

let _builtin: LoadedIndex[] = [];
let _builtinReady = false;
let _builtinLoading: Promise<void> | null = null;
let _builtinError = '';
const _userCache = new Map<string, LoadedIndex>();   // 玩家索引按 id 缓存（跨回合复用，不重复读 IDB）
let _indexes: LoadedIndex[] = [];                    // 当前生效（内置 + 已启用玩家源）
let _ready = false;

export function novelVecStatus() {
  return {
    ready: _ready,
    count: _indexes.reduce((n, x) => n + x.count, 0),
    dim: _indexes[0]?.dim ?? 0,
    error: _builtinError,
    loading: !!_builtinLoading,
    sources: _indexes.map((x) => ({ name: x.label, count: x.count, origin: x.origin, model: x.model })),
  };
}

async function gunzipJson(buf: ArrayBuffer): Promise<any> {
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return JSON.parse(new TextDecoder().decode(buf));
  if (typeof (globalThis as any).DecompressionStream === 'function') {
    const ds = new (globalThis as any).DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  }
  throw new Error('当前浏览器不支持 DecompressionStream（请用较新版 Chrome/Edge）');
}

/* ── 加载单个内置源（网络 → 首次缓存进 IDB）；没建/不存在 → null（跳过）── */
async function loadBuiltinOne(db: IDBDatabase, base: string, name: string): Promise<LoadedIndex | null> {
  const grab = async (file: string): Promise<Response | null> => {
    let r: Response;
    try { r = await fetch(`${base}${name}/${file}`, { cache: 'no-cache' }); } catch { return null; }
    return r.ok ? r : null;
  };
  const mres = await grab('manifest.json');
  if (!mres) return null;
  let manifest: any; try { manifest = await mres.json(); } catch { return null; }
  if (!manifest || typeof manifest.count !== 'number' || typeof manifest.dim !== 'number') return null;

  const cachedMeta: any = await kvGet(db, `manifest:${name}`);
  const cachedVec = await kvGet<ArrayBuffer>(db, `vectors:${name}`);
  let vectors: Int8Array;
  if (cachedVec && cachedMeta?.builtAt === manifest.builtAt && cachedVec.byteLength === manifest.count * manifest.dim) {
    vectors = new Int8Array(cachedVec);
  } else {
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
  return { name, label: SRC_LABEL[name] ?? name, vectors, count: manifest.count, dim: manifest.dim, model: String(manifest.model ?? ''), apiBase: '', origin: 'builtin', builtAt: manifest.builtAt };
}

/* ── 加载单个玩家自建源（纯 IDB，建库时已写入）── */
async function loadUserOne(db: IDBDatabase, meta: UserIndexMeta): Promise<LoadedIndex | null> {
  const vec = await kvGet<ArrayBuffer>(db, `vectors:${meta.id}`);
  if (!vec || vec.byteLength !== meta.count * meta.dim) return null;   // 血本没了/损坏 → 跳过
  return { name: meta.id, label: meta.name, vectors: new Int8Array(vec), count: meta.count, dim: meta.dim, model: meta.model, apiBase: meta.apiBase, origin: 'user', builtAt: meta.builtAt };
}

async function loadBuiltin(): Promise<void> {
  if (_builtinReady) return;
  if (_builtinLoading) return _builtinLoading;
  _builtinLoading = (async () => {
    const base = (import.meta as any).env?.BASE_URL || '/';
    try {
      const db = await openDb();
      const loaded: LoadedIndex[] = [];
      const errs: string[] = [];
      for (const name of SOURCES) {
        try { const idx = await loadBuiltinOne(db, base, name); if (idx) loaded.push(idx); }
        catch (e: any) { errs.push(`${SRC_LABEL[name] ?? name}: ${e?.message ?? '失败'}`); }
      }
      _builtin = loaded;
      _builtinError = errs.length ? `（部分内置源未加载：${errs.join('；')}）` : '';
      _builtinReady = true;
    } catch (e: any) { _builtinError = e?.message ?? '加载失败'; console.warn('[NovelVec] 内置索引加载失败', e); }
    finally { _builtinLoading = null; }
  })();
  return _builtinLoading;
}

/* 按登记表(仅启用)重建生效玩家源列表；缓存命中不重读 IDB */
async function loadUsers(): Promise<LoadedIndex[]> {
  const metas = useNovelVec.getState().userIndexes.filter((m) => m.enabled);
  const db = await openDb();
  const out: LoadedIndex[] = [];
  for (const m of metas) {
    let idx = _userCache.get(m.id);
    if (!idx || idx.builtAt !== m.builtAt || idx.count !== m.count) {
      const loaded = await loadUserOne(db, m);
      if (loaded) { _userCache.set(m.id, loaded); idx = loaded; } else { _userCache.delete(m.id); idx = undefined; }
    }
    if (idx) { idx.label = m.name; idx.model = m.model; idx.apiBase = m.apiBase; out.push(idx); }
  }
  return out;
}

/* 加载/刷新全部索引（内置一次 + 玩家源每次按登记表对账）。有任一源就绪即返回 true。 */
export async function loadNovelIndex(): Promise<boolean> {
  await loadBuiltin();
  const users = await loadUsers();
  // 玩家在向量库面板单独关掉的内置源（如轮回乐园原著）→ 加载了也不参与检索注入
  const disabled = useNovelVec.getState().settings.builtinDisabled ?? [];
  const activeBuiltin = disabled.length ? _builtin.filter((x) => !disabled.includes(x.name)) : _builtin;
  _indexes = [...activeBuiltin, ...users];
  _ready = _indexes.length > 0;
  // 内置真缺失(未部署)才提示；被用户单独关掉不算错(静默)
  if (!_ready && !_builtinError && _builtin.length === 0) _builtinError = '还没有任何向量库：内置未部署 public/novel-vectors/，也没有自建索引（下方「建库」可自建）';
  else if (_ready) _builtinError = _builtin.length ? _builtinError : '';   // 有自建源时清掉"内置缺失"噪音
  return _ready;
}

/* 建库/删除/导入后调用：让指定 id（或全部）下次检索重新对账 */
export function invalidateUserIndex(id?: string): void {
  if (id) _userCache.delete(id); else _userCache.clear();
}
export async function refreshNovelIndex(): Promise<ReturnType<typeof novelVecStatus>> {
  await loadNovelIndex();
  return novelVecStatus();
}

/* 用指定模型/接口把查询 embed 并归一化（settings.apiKey；apiBase 缺省用 settings.apiBase） */
async function embedQueryWith(text: string, model: string, apiBase: string): Promise<Float32Array | null> {
  const s = useNovelVec.getState().settings;
  const base = (apiBase || s.apiBase || '').replace(/\/+$/, '');
  const mdl = (model || s.model || '').trim() || 'Pro/BAAI/bge-m3';
  if (!s.apiKey || !base) throw new Error('未配置 embedding 接口（设置→向量资料库）');
  const res = await fetchWithProxy(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: mdl, input: text, encoding_format: 'float' }),
  });
  if (!res.ok) throw new Error(`embedding 接口 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const v: number[] = j?.data?.[0]?.embedding;
  if (!Array.isArray(v)) return null;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/* 在给定的一组同维索引里 cosine 检索 */
function searchIn(q: Float32Array, group: LoadedIndex[], topK: number, threshold: number): { name: string; label: string; id: number; score: number }[] {
  const inv = 1 / 127;
  const hits: { name: string; label: string; id: number; score: number }[] = [];
  for (const idx of group) {
    if (idx.dim !== q.length) continue;   // 维度不符（模型对不上）→ 跳过
    const { vectors, dim, count, name, label } = idx;
    for (let i = 0; i < count; i++) {
      let dot = 0; const off = i * dim;
      for (let k = 0; k < dim; k++) dot += q[k] * vectors[off + k];
      const cos = dot * inv;
      if (cos >= threshold) hits.push({ name, label, id: i, score: cos });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK) * 3);   // 每组多留些，跨组合并后再截断
}

/* 一站式：查询文本 → 命中片段（跨全部启用索引、按模型分组各 embed 一次、受 topK/maxChars 限量）*/
export async function retrieveNovel(queryText: string): Promise<NovelHit[]> {
  const s = useNovelVec.getState().settings;
  if (!s.enabled) return [];
  if (!(await loadNovelIndex())) return [];
  if (_indexes.length === 0) return [];

  // 按 模型@接口 分组（同组同维，一次 embed 覆盖全组）
  const groups = new Map<string, LoadedIndex[]>();
  for (const idx of _indexes) {
    const key = `${idx.model || s.model}\n${idx.apiBase || s.apiBase}`;
    const arr = groups.get(key); if (arr) arr.push(idx); else groups.set(key, [idx]);
  }
  const q = (queryText || '').slice(0, 1500);
  const merged: { name: string; label: string; id: number; score: number }[] = [];
  for (const [key, idxs] of groups) {
    const [model, apiBase] = key.split('\n');
    let qv: Float32Array | null;
    try { qv = await embedQueryWith(q, model, apiBase); }
    catch (e) { console.warn(`[NovelVec] 组 ${model} 查询 embed 失败`, e); continue; }
    if (!qv) continue;
    merged.push(...searchIn(qv, idxs, s.topK ?? 5, s.threshold ?? 0.35));
  }
  if (merged.length === 0) return [];
  merged.sort((a, b) => b.score - a.score);
  const topK = Math.max(1, s.topK ?? 5);

  // 🛤 原著路线·剧透闸：身处某站世界时，原著小说源片段只放行 ≤ 本站卷（未来卷=剧透，直接拦）。
  //   无卷标片段（前言等）与其他源（世界书/wiki/自建）不受限；候选池本就 3×topK，滤后仍够填满。
  const volCap = canonMaxVolume();

  const db = await openDb();
  const out: NovelHit[] = [];
  let chars = 0; const cap = s.maxChars ?? 2500;
  for (const h of merged) {
    if (out.length >= topK) break;
    const row = await chunkGet(db, `${h.name}#${h.id}`);
    if (!row) continue;
    if (volCap != null && h.name === 'novel-vectors' && row.v) {
      const vn = cnVolToInt(row.v);
      if (vn != null && vn > volCap) continue;
    }
    if (chars && chars + row.t.length > cap) break;
    chars += row.t.length;
    out.push({ text: row.t, vol: row.v, chap: row.c, score: h.score, source: h.label });
  }
  return out;
}
