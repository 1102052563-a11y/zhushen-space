// 混沌世界·世界影响记录后端（D1·共用 zhushen-workshop 库 binding DB）——
// 玩家每次离世时生成的「对该世界产生了什么影响 + 剧情偏移度」记录，opt-in 上传到公开看板，按世界名实时分类。
// 免 Discord：上传者身份 = 本机 local uid（同工坊 owner 信任模型 + IP 哈希限流），不涉及作弊收益。
//
// 路由（由 index.js 转发 /api/chaos/*）：
//   POST /api/chaos/records                          上传一条影响记录（无审核·实时可见）
//   GET  /api/chaos/worlds                           按世界名分组统计（每世界 记录数/上传人数/平均偏移度/最近时间）——「XX世界，N人上传」看板
//   GET  /api/chaos/records?world=X&limit=           某世界的记录列表（只返元数据，不含正文 body）
//   GET  /api/chaos/records/:id                      取单条（含正文 body + meta）
//   GET  /api/chaos/feed?worlds=a,b,c&perWorld=      拉取多个世界的记录（含正文·每世界限 perWorld 条）——喂给 AI 生成混沌世界卡
//   DELETE /api/chaos/records/:id?owner=<uid>        删除本人上传的（owner 匹配），或管理员(X-Admin-Key)删任意
//
// 存储 = Cloudflare D1（共用 workshop 的 DB，无需新建库/迁移；表 chaos_records 首次请求自动建）。

const MAX_BODY = 12000;        // 单条正文上限（500-1000 字影响概述 + 余量）
const MAX_META = 8000;         // meta JSON 上限（偏移点/钩子等结构化）
const UPLOAD_LIMIT_PER_HOUR = 20;
const FEED_PER_WORLD_MAX = 20; // 喂 AI 时每世界最多拉几条

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chaos_records (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  world_raw TEXT,
  uploader TEXT,
  uploader_name TEXT,
  offset_pct INTEGER NOT NULL DEFAULT 0,
  band TEXT,
  tier TEXT,
  title TEXT,
  body TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_chaos_world ON chaos_records(world, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chaos_created ON chaos_records(created_at DESC);
`;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
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

function clampPct(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(100, n));
}

function rowToMeta(row) {
  let meta = null;
  try { meta = row.meta ? JSON.parse(row.meta) : null; } catch {}
  return {
    id: row.id,
    world: row.world,
    worldRaw: row.world_raw || undefined,
    uploaderName: row.uploader_name || "无名契约者",
    offset: row.offset_pct || 0,
    band: row.band || undefined,
    tier: row.tier || undefined,
    title: row.title || undefined,
    createdAt: row.created_at,
    meta: meta || undefined,
  };
}

export async function handleChaos(request, env, ch, url) {
  const db = env.DB;
  if (!db) {
    return json({ error: "混沌世界后端未配置：缺少 D1 绑定 DB（见 WORKSHOP-DEPLOY.md）" }, { status: 503 }, ch);
  }
  await ensureSchema(db);

  const p = url.pathname;
  const method = request.method;

  // ── 按世界名分组统计（公开·无需登录）：驱动「XX世界，N人上传，平均偏移度」看板 ──
  if (p === "/api/chaos/worlds" && method === "GET") {
    const rs = await db.prepare(
      "SELECT world, COUNT(*) AS n, COUNT(DISTINCT uploader) AS uploaders, AVG(offset_pct) AS avg_offset, MAX(created_at) AS last_at " +
      "FROM chaos_records GROUP BY world ORDER BY n DESC, last_at DESC"
    ).all();
    const worlds = (rs.results || []).map((r) => ({
      world: r.world,
      n: r.n || 0,
      uploaders: r.uploaders || 0,
      avgOffset: Math.round(r.avg_offset || 0),
      lastAt: r.last_at || 0,
    }));
    return json({ worlds }, {}, ch);
  }

  // ── 某世界的记录列表（只返元数据，不含正文）──
  if (p === "/api/chaos/records" && method === "GET") {
    const world = url.searchParams.get("world");
    if (!world) return json({ error: "world required" }, { status: 400 }, ch);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    const rs = await db.prepare(
      "SELECT id,world,world_raw,uploader_name,offset_pct,band,tier,title,created_at,meta " +
      "FROM chaos_records WHERE world = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(world, limit).all();
    return json({ items: (rs.results || []).map(rowToMeta) }, {}, ch);
  }

  // ── 拉取多个世界的记录（含正文·每世界限 perWorld 条）：喂 AI 生成混沌世界卡 ──
  if (p === "/api/chaos/feed" && method === "GET") {
    const raw = url.searchParams.get("worlds") || "";
    const worlds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (!worlds.length) return json({ error: "worlds required" }, { status: 400 }, ch);
    const perWorld = Math.min(FEED_PER_WORLD_MAX, Math.max(1, parseInt(url.searchParams.get("perWorld") || "8", 10) || 8));
    const out = [];
    for (const w of worlds) {
      const rs = await db.prepare(
        "SELECT id,world,world_raw,uploader_name,offset_pct,band,tier,title,body,meta,created_at " +
        "FROM chaos_records WHERE world = ? ORDER BY created_at DESC LIMIT ?"
      ).bind(w, perWorld).all();
      for (const r of (rs.results || [])) {
        out.push({ ...rowToMeta(r), body: r.body || "" });
      }
    }
    return json({ records: out }, {}, ch);
  }

  // ── 上传（无审核·实时可见）──
  if (p === "/api/chaos/records" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || !b.world || b.body == null) {
      return json({ error: "world / body 必填" }, { status: 400 }, ch);
    }
    const bodyStr = String(b.body);
    if (bodyStr.length > MAX_BODY) {
      return json({ error: `正文过长（上限 ${MAX_BODY} 字）` }, { status: 413 }, ch);
    }
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const ipHash = await sha256(ip + "|" + (env.WS_SALT || "zhushen-chaos"));
    const recent = await db.prepare(
      "SELECT COUNT(*) AS c FROM chaos_records WHERE ip_hash = ? AND created_at > ?"
    ).bind(ipHash, Date.now() - 3600 * 1000).first();
    if (recent && recent.c >= UPLOAD_LIMIT_PER_HOUR) {
      return json({ error: "上传过于频繁，请稍后再试" }, { status: 429 }, ch);
    }

    const id = `chaos-${randHex(8)}`;
    const metaStr = b.meta != null ? str(JSON.stringify(b.meta), MAX_META) : null;
    await db.prepare(
      "INSERT INTO chaos_records (id,world,world_raw,uploader,uploader_name,offset_pct,band,tier,title,body,meta,created_at,ip_hash) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id,
      str(b.world, 80),
      str(b.worldRaw, 120),
      str(b.uploader, 64),
      str(b.uploaderName, 40),
      clampPct(b.offset),
      str(b.band, 24),
      str(b.tier, 24),
      str(b.title, 120),
      bodyStr,
      metaStr,
      Date.now(),
      ipHash
    ).run();
    return json({ id }, {}, ch);
  }

  // ── 单条 / 删除 ──
  const m = p.match(/^\/api\/chaos\/records\/([\w-]+)$/);
  if (m) {
    const id = m[1];
    if (method === "GET") {
      const row = await db.prepare("SELECT * FROM chaos_records WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, { status: 404 }, ch);
      return json({ item: { ...rowToMeta(row), body: row.body || "" } }, {}, ch);
    }
    if (method === "DELETE") {
      const adminKey = request.headers.get("X-Admin-Key") || url.searchParams.get("admin");
      const isAdmin = !!env.WS_ADMIN_KEY && !!adminKey && adminKey === env.WS_ADMIN_KEY;
      const row = await db.prepare("SELECT uploader FROM chaos_records WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "not found" }, { status: 404 }, ch);
      if (!isAdmin) {
        const owner = url.searchParams.get("owner");
        if (!owner) return json({ error: "owner required" }, { status: 400 }, ch);
        if (!row.uploader || row.uploader !== owner) return json({ error: "无权删除（不是你上传的）" }, { status: 403 }, ch);
      }
      await db.prepare("DELETE FROM chaos_records WHERE id = ?").bind(id).run();
      return json({ ok: true, admin: isAdmin }, {}, ch);
    }
  }

  return json({ error: "not found" }, { status: 404 }, ch);
}
