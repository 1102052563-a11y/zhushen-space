// 创意工坊后端（D1）——社区共享内容：无审核直传 + 浏览 + 下载计数。
// 路由（由 index.js 转发 /api/workshop/*）：
//   GET  /api/workshop/items?type=&category=&q=&sort=&limit=   列表(只返元数据+下载数,不含 payload)
//   POST /api/workshop/items                                   上传一条(无审核,实时可见)
//   GET  /api/workshop/items/:id                               取单条(含 payload)
//   POST /api/workshop/items/:id/download                      下载数 +1，返回最新下载数
//
// 存储 = Cloudflare D1（免费额度内基本 $0）。绑定名 DB（见 wrangler.toml）。
// 防护：单条 payload ≤ 256KB；同 IP(哈希) 1 小时上限 20 条；字段长度截断。
// XSS：前端用 React 渲染纯文本(默认转义)，不把 payload 当 HTML 注入，故展示侧安全。

const MAX_PAYLOAD = 256 * 1024;
const UPLOAD_LIMIT_PER_HOUR = 20;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workshop_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category TEXT,
  name TEXT NOT NULL,
  author TEXT,
  version TEXT,
  summary TEXT,
  tags TEXT,
  payload TEXT NOT NULL,
  content_hash TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ip_hash TEXT,
  owner TEXT
);
CREATE INDEX IF NOT EXISTS idx_ws_type ON workshop_items(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_downloads ON workshop_items(downloads DESC);
`;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  try { await db.exec('ALTER TABLE workshop_items ADD COLUMN owner TEXT'); } catch (e) { /* 列已存在，忽略 */ }
  schemaReady = true;
}

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), {
    ...init,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function str(v, max) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function randHex(n = 8) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function rowToMeta(row) {
  let tags = [];
  try { tags = row.tags ? JSON.parse(row.tags) : []; } catch {}
  return {
    id: row.id,
    type: row.type,
    category: row.category || undefined,
    name: row.name,
    author: row.author || undefined,
    version: row.version || undefined,
    summary: row.summary || undefined,
    tags,
    contentHash: row.content_hash || undefined,
    downloads: row.downloads || 0,
    createdAt: row.created_at,
  };
}

export async function handleWorkshop(request, env, ch, url) {
  const db = env.DB;
  if (!db) {
    return json({ error: "工坊后端未配置：缺少 D1 绑定 DB（见 WORKSHOP-DEPLOY.md）" }, { status: 503 }, ch);
  }
  await ensureSchema(db);

  const p = url.pathname;
  const method = request.method;

  // 管理员密钥校验（前端「设置」里验证用）
  if (p === "/api/workshop/admin/verify" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const ok = !!env.WS_ADMIN_KEY && !!b.key && b.key === env.WS_ADMIN_KEY;
    return json({ ok }, {}, ch);
  }

  // 改名：把该 owner 所有条目的署名(author)批量改成新昵称
  if (p === "/api/workshop/rename" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || !b.owner) return json({ error: "owner required" }, { status: 400 }, ch);
    const r = await db.prepare("UPDATE workshop_items SET author = ? WHERE owner = ?")
      .bind(str(b.author, 40), b.owner).run();
    return json({ updated: (r.meta && r.meta.changes) || 0 }, {}, ch);
  }

  // 列表
  if (p === "/api/workshop/items" && method === "GET") {
    const type = url.searchParams.get("type");
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");
    const sort = url.searchParams.get("sort") === "downloads" ? "downloads" : "recent";
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "60", 10) || 60));

    const where = [];
    const binds = [];
    if (type) { where.push("type = ?"); binds.push(type); }
    if (category) { where.push("category = ?"); binds.push(category); }
    if (q) {
      where.push("(name LIKE ? OR summary LIKE ? OR author LIKE ? OR tags LIKE ?)");
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }
    const owner = url.searchParams.get("owner");   // 「已上传」按 owner 过滤
    if (owner) { where.push("owner = ?"); binds.push(owner); }
    const order = sort === "downloads" ? "downloads DESC, created_at DESC" : "created_at DESC";
    const sql =
      `SELECT id,type,category,name,author,version,summary,tags,content_hash,downloads,created_at ` +
      `FROM workshop_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ?`;
    binds.push(limit);
    const rs = await db.prepare(sql).bind(...binds).all();
    return json({ items: (rs.results || []).map(rowToMeta) }, {}, ch);
  }

  // 上传（无审核）
  if (p === "/api/workshop/items" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || !b.type || !b.name || b.payload == null) {
      return json({ error: "type / name / payload 必填" }, { status: 400 }, ch);
    }
    const payloadStr = JSON.stringify(b.payload);
    if (payloadStr.length > MAX_PAYLOAD) {
      return json({ error: `内容过大（上限 ${Math.floor(MAX_PAYLOAD / 1024)}KB）` }, { status: 413 }, ch);
    }
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const ipHash = await sha256(ip + "|" + (env.WS_SALT || "zhushen-workshop"));
    const recent = await db.prepare(
      "SELECT COUNT(*) AS c FROM workshop_items WHERE ip_hash = ? AND created_at > ?"
    ).bind(ipHash, Date.now() - 3600 * 1000).first();
    if (recent && recent.c >= UPLOAD_LIMIT_PER_HOUR) {
      return json({ error: "上传过于频繁，请稍后再试" }, { status: 429 }, ch);
    }

    const id = `${str(b.type, 24)}-${randHex(8)}`;
    const tags = Array.isArray(b.tags) ? JSON.stringify(b.tags.map((t) => String(t).slice(0, 24)).slice(0, 12)) : "[]";
    await db.prepare(
      "INSERT INTO workshop_items (id,type,category,name,author,version,summary,tags,payload,content_hash,downloads,created_at,ip_hash,owner) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)"
    ).bind(
      id,
      str(b.type, 40),
      str(b.category, 40),
      str(b.name, 80),
      str(b.author, 40),
      str(b.version, 20),
      str(b.summary, 600),
      tags,
      payloadStr,
      str(b.contentHash, 16),
      Date.now(),
      ipHash,
      str(b.owner, 64)
    ).run();
    return json({ id }, {}, ch);
  }

  // 单条 / 下载计数
  const m = p.match(/^\/api\/workshop\/items\/([\w-]+)(\/download)?$/);
  if (m) {
    const id = m[1];
    const isDownload = m[2] === "/download";

    if (isDownload && method === "POST") {
      await db.prepare("UPDATE workshop_items SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
      const row = await db.prepare("SELECT downloads FROM workshop_items WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, { status: 404 }, ch);
      return json({ downloads: row.downloads || 0 }, {}, ch);
    }

    if (!isDownload && method === "GET") {
      const row = await db.prepare("SELECT * FROM workshop_items WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, { status: 404 }, ch);
      let payload = null;
      try { payload = JSON.parse(row.payload); } catch { return json({ error: "payload corrupt" }, { status: 500 }, ch); }
      return json({ item: { ...rowToMeta(row), payload } }, {}, ch);
    }

    // 删除：管理员(密钥匹配)可删任意；否则仅本人(owner 匹配)
    if (!isDownload && method === "DELETE") {
      const adminKey = request.headers.get("X-Admin-Key") || url.searchParams.get("admin");
      const isAdmin = !!env.WS_ADMIN_KEY && !!adminKey && adminKey === env.WS_ADMIN_KEY;
      const row = await db.prepare("SELECT owner FROM workshop_items WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, { status: 404 }, ch);
      if (!isAdmin) {
        const owner = url.searchParams.get("owner");
        if (!owner) return json({ error: "owner required" }, { status: 400 }, ch);
        if (!row.owner || row.owner !== owner) return json({ error: "无权删除（不是你上传的）" }, { status: 403 }, ch);
      }
      await db.prepare("DELETE FROM workshop_items WHERE id = ?").bind(id).run();
      return json({ ok: true, admin: isAdmin }, {}, ch);
    }
  }

  return json({ error: "not found" }, { status: 404 }, ch);
}
