// 向量库·云端（玩家自建 embedding 索引的私有同步 + 公开社区库）。
// 大 blob（gzip 的向量+文本，几 MB~几十 MB）走 R2 流式存取；元数据走 D1。复用云存档桶 CLOUD_BUCKET 与 D1(DB)。
// 元数据随 ?meta=<encodeURIComponent(JSON)> 传（body 是二进制 blob，不解析），避免新增 CORS 头。
//
// 私有同步（Bearer chatToken → cuid，跨设备取回本人的库）：
//   GET    /api/vector/mine                          列出本人云端索引（元数据）
//   POST   /api/vector/mine?id=<indexId>&meta=<json> 上传/覆盖一个索引（body=gzip bytes）
//   GET    /api/vector/mine/blob?id=<indexId>        取回某索引 blob（流式）
//   DELETE /api/vector/mine?id=<indexId>             删除本人某索引
// 公开社区（软 owner=pid，人人可浏览/下载）：
//   GET    /api/vector/pub?q=&sort=&limit=&owner=    列表（元数据+下载数）
//   POST   /api/vector/pub?meta=<json>               发布一个索引（body=gzip bytes；含 owner/author）
//   GET    /api/vector/pub/:id/blob                  下载 blob（流式，下载数+1）
//   DELETE /api/vector/pub/:id?owner=                下架（仅本人 owner 匹配）
import { verifyChatToken, bearer } from './auth.js';

const MAX_BLOB = 80 * 1024 * 1024;   // 单库上限 80MB（gzip 后；Workers 请求体上限约 100MB）
const PUB_UPLOAD_LIMIT_PER_HOUR = 10;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vector_private (
  user_id TEXT NOT NULL, index_id TEXT NOT NULL, name TEXT, kind TEXT, model TEXT,
  dim INTEGER, count INTEGER, size INTEGER, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, index_id)
);
CREATE TABLE IF NOT EXISTS vector_items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, author TEXT, owner TEXT, kind TEXT, model TEXT,
  dim INTEGER, count INTEGER, size INTEGER, summary TEXT, tags TEXT,
  downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, ip_hash TEXT, r2key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vec_recent ON vector_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vec_downloads ON vector_items(downloads DESC);
`;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  schemaReady = true;
}

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}
function str(v, max) { if (v == null) return null; const s = String(v); return s.length > max ? s.slice(0, max) : s; }
function randHex(n = 8) { const a = crypto.getRandomValues(new Uint8Array(n)); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(text) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''); }
function parseMeta(url) { try { return JSON.parse(decodeURIComponent(url.searchParams.get('meta') || '')) || {}; } catch { return {}; } }
const auth = async (env, request) => { const p = await verifyChatToken(env, bearer(request)); return p && p.cuid ? p : null; };
const oversize = (request) => { const len = parseInt(request.headers.get('Content-Length') || '0', 10) || 0; return len > MAX_BLOB; };

export async function handleVector(request, env, ch, url) {
  const db = env.DB;
  const bucket = env.CLOUD_BUCKET;
  if (!db || !bucket) return json({ error: '向量库云端未配置：缺少 D1(DB) 或 R2(CLOUD_BUCKET) 绑定' }, { status: 503 }, ch);
  await ensureSchema(db);
  const p = url.pathname;
  const method = request.method;

  /* ── 私有同步 ── */
  if (p === '/api/vector/mine') {
    const a = await auth(env, request);
    if (!a) return json({ error: '未登录或会话过期（私有云同步需登录）' }, { status: 401 }, ch);
    const uid = String(a.cuid);

    if (method === 'GET') {
      const rs = await db.prepare(
        'SELECT index_id,name,kind,model,dim,count,size,updated_at FROM vector_private WHERE user_id = ? ORDER BY updated_at DESC'
      ).bind(uid).all();
      const items = (rs.results || []).map((r) => ({
        remoteId: r.index_id, name: r.name, kind: r.kind, model: r.model,
        dim: r.dim, count: r.count, sizeBytes: r.size, updatedAt: r.updated_at,
      }));
      return json({ items }, {}, ch);
    }
    if (method === 'POST') {
      if (oversize(request)) return json({ error: `内容过大（上限 ${Math.floor(MAX_BLOB / 1048576)}MB）` }, { status: 413 }, ch);
      const indexId = str(url.searchParams.get('id'), 64);
      if (!indexId || !request.body) return json({ error: 'id 与 body 必填' }, { status: 400 }, ch);
      const m = parseMeta(url);
      const key = `vec/${uid}/${indexId}`;
      await bucket.put(key, request.body, { httpMetadata: { contentType: 'application/gzip' } });
      const size = Number(m.sizeBytes) || 0;
      await db.prepare(
        'INSERT INTO vector_private (user_id,index_id,name,kind,model,dim,count,size,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(user_id,index_id) DO UPDATE SET name=excluded.name,kind=excluded.kind,model=excluded.model,dim=excluded.dim,count=excluded.count,size=excluded.size,updated_at=excluded.updated_at'
      ).bind(uid, indexId, str(m.name, 80), str(m.kind, 20), str(m.model, 80), Number(m.dim) || 0, Number(m.count) || 0, size, Date.now()).run();
      return json({ ok: true, remoteId: indexId }, {}, ch);
    }
    if (method === 'DELETE') {
      const indexId = str(url.searchParams.get('id'), 64);
      if (!indexId) return json({ error: 'id 必填' }, { status: 400 }, ch);
      await bucket.delete(`vec/${uid}/${indexId}`).catch(() => {});
      await db.prepare('DELETE FROM vector_private WHERE user_id = ? AND index_id = ?').bind(uid, indexId).run();
      return json({ ok: true }, {}, ch);
    }
    return json({ error: 'method not allowed' }, { status: 405 }, ch);
  }

  if (p === '/api/vector/mine/blob' && method === 'GET') {
    const a = await auth(env, request);
    if (!a) return json({ error: '未登录或会话过期' }, { status: 401 }, ch);
    const indexId = str(url.searchParams.get('id'), 64);
    if (!indexId) return json({ error: 'id 必填' }, { status: 400 }, ch);
    const obj = await bucket.get(`vec/${String(a.cuid)}/${indexId}`);
    if (!obj) return json({ error: 'not found' }, { status: 404 }, ch);
    return new Response(obj.body, { headers: { ...ch, 'Content-Type': 'application/gzip' } });
  }

  /* ── 公开社区 ── */
  if (p === '/api/vector/pub') {
    if (method === 'GET') {
      const q = url.searchParams.get('q');
      const sort = url.searchParams.get('sort') === 'downloads' ? 'downloads' : 'recent';
      const owner = url.searchParams.get('owner');
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
      const where = []; const binds = [];
      if (q) { where.push('(name LIKE ? OR summary LIKE ? OR author LIKE ? OR tags LIKE ?)'); const like = `%${q}%`; binds.push(like, like, like, like); }
      if (owner) { where.push('owner = ?'); binds.push(owner); }
      const order = sort === 'downloads' ? 'downloads DESC, created_at DESC' : 'created_at DESC';
      const sql = `SELECT id,name,author,owner,kind,model,dim,count,size,summary,tags,downloads,created_at FROM vector_items ` +
        `${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`;
      binds.push(limit);
      const rs = await db.prepare(sql).bind(...binds).all();
      const items = (rs.results || []).map((r) => {
        let tags = []; try { tags = r.tags ? JSON.parse(r.tags) : []; } catch {}
        return { id: r.id, name: r.name, author: r.author || undefined, owner: r.owner || undefined, kind: r.kind, model: r.model, dim: r.dim, count: r.count, sizeBytes: r.size, summary: r.summary || undefined, tags, downloads: r.downloads || 0, createdAt: r.created_at };
      });
      return json({ items }, {}, ch);
    }
    if (method === 'POST') {
      if (oversize(request)) return json({ error: `内容过大（上限 ${Math.floor(MAX_BLOB / 1048576)}MB）` }, { status: 413 }, ch);
      if (!request.body) return json({ error: 'body 必填' }, { status: 400 }, ch);
      const m = parseMeta(url);
      if (!m.name) return json({ error: 'meta.name 必填' }, { status: 400 }, ch);
      const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
      const ipHash = await sha256(ip + '|' + (env.WS_SALT || 'zhushen-vector'));
      const recent = await db.prepare('SELECT COUNT(*) AS c FROM vector_items WHERE ip_hash = ? AND created_at > ?').bind(ipHash, Date.now() - 3600 * 1000).first();
      if (recent && recent.c >= PUB_UPLOAD_LIMIT_PER_HOUR) return json({ error: '发布过于频繁，请稍后再试' }, { status: 429 }, ch);
      const id = `vec-${randHex(8)}`;
      const r2key = `vec-pub/${id}`;
      await bucket.put(r2key, request.body, { httpMetadata: { contentType: 'application/gzip' } });
      const tags = Array.isArray(m.tags) ? JSON.stringify(m.tags.map((t) => String(t).slice(0, 24)).slice(0, 12)) : '[]';
      await db.prepare(
        'INSERT INTO vector_items (id,name,author,owner,kind,model,dim,count,size,summary,tags,downloads,created_at,ip_hash,r2key) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)'
      ).bind(id, str(m.name, 80), str(m.author, 40), str(m.owner, 64), str(m.kind, 20), str(m.model, 80),
        Number(m.dim) || 0, Number(m.count) || 0, Number(m.sizeBytes) || 0, str(m.summary, 600), tags, Date.now(), ipHash, r2key).run();
      return json({ id }, {}, ch);
    }
    return json({ error: 'method not allowed' }, { status: 405 }, ch);
  }

  const mm = p.match(/^\/api\/vector\/pub\/([\w-]+)(\/blob)?$/);
  if (mm) {
    const id = mm[1];
    const isBlob = mm[2] === '/blob';
    if (isBlob && method === 'GET') {
      const row = await db.prepare('SELECT r2key FROM vector_items WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'not found' }, { status: 404 }, ch);
      const obj = await bucket.get(row.r2key);
      if (!obj) return json({ error: 'blob missing' }, { status: 404 }, ch);
      await db.prepare('UPDATE vector_items SET downloads = downloads + 1 WHERE id = ?').bind(id).run();
      return new Response(obj.body, { headers: { ...ch, 'Content-Type': 'application/gzip' } });
    }
    if (!isBlob && method === 'DELETE') {
      const owner = url.searchParams.get('owner');
      const adminKey = request.headers.get('X-Admin-Key') || url.searchParams.get('admin');
      const isAdmin = !!env.WS_ADMIN_KEY && !!adminKey && adminKey === env.WS_ADMIN_KEY;
      const row = await db.prepare('SELECT owner,r2key FROM vector_items WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'not found' }, { status: 404 }, ch);
      if (!isAdmin) {
        if (!owner) return json({ error: 'owner required' }, { status: 400 }, ch);
        if (!row.owner || row.owner !== owner) return json({ error: '无权下架（不是你发布的）' }, { status: 403 }, ch);
      }
      await bucket.delete(row.r2key).catch(() => {});
      await db.prepare('DELETE FROM vector_items WHERE id = ?').bind(id).run();
      return json({ ok: true, admin: isAdmin }, {}, ch);
    }
  }

  return json({ error: 'not found' }, { status: 404 }, ch);
}
