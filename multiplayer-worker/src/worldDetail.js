// 世界资料库·修订后端（D1，共用 zhushen-workshop 库）——玩家提交世界档案修订 → 站长审核 → 全局生效。
// 前端消费：src/systems/worldDetailShare.ts（提交/审核）+ src/systems/worldDetail.ts（loadOverrides 覆盖内置分片）。
// 路由（由 index.js 转发 /api/worlddetail/*）：
//   POST /api/worlddetail/submit                      提交一份修订（进待审队列；同 owner 同世界的旧待审被替换）
//   GET  /api/worlddetail/submissions?owner=          我的提交（元数据+字数，不含全文）
//   GET  /api/worlddetail/submissions?status=pending  【站长】待审列表（含全文；X-Admin-Key）
//   POST /api/worlddetail/review {id, action}         【站长】approve=写进 overrides 全局生效 / reject=仅标记（X-Admin-Key）
//   GET  /api/worlddetail/overrides                   已通过的全局修订（所有玩家会话内拉一次，覆盖内置分片）
// 防护：单份修订全文 ≤300K 字符；同 IP(哈希) 1 小时 ≤10 份；字段截断。
// 管理员 = X-Admin-Key === env.WS_ADMIN_KEY（与创意工坊同一把钥匙，前端在 创意工坊→设置 里配）。

const MAX_TEXT = 300 * 1024;        // plot+cut 合计字符上限（正常档案 ~1.5万字，留足余量防灌爆 D1）
const SUBMIT_LIMIT_PER_HOUR = 10;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlddetail_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plot TEXT NOT NULL,
  cut TEXT,
  note TEXT,
  author TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_wd_status ON worlddetail_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_owner ON worlddetail_submissions(owner, created_at DESC);
CREATE TABLE IF NOT EXISTS worlddetail_overrides (
  name TEXT PRIMARY KEY,
  plot TEXT NOT NULL,
  cut TEXT,
  author TEXT,
  submission_id TEXT,
  updated_at INTEGER NOT NULL
);
`;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, " ").trim());
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

function isAdmin(request, env, url) {
  const adminKey = request.headers.get("X-Admin-Key") || url.searchParams.get("admin");
  return !!env.WS_ADMIN_KEY && !!adminKey && adminKey === env.WS_ADMIN_KEY;
}

function rowToSubmission(row, withText) {
  return {
    id: row.id,
    name: row.name,
    ...(withText ? { plot: row.plot, cut: row.cut || undefined } : {}),
    plotLen: row.plot_len != null ? row.plot_len : (row.plot ? row.plot.length : 0),
    cutLen: row.cut_len != null ? row.cut_len : (row.cut ? row.cut.length : 0),
    note: row.note || undefined,
    author: row.author || undefined,
    owner: row.owner || undefined,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || undefined,
  };
}

export async function handleWorldDetail(request, env, ch, url) {
  const db = env.DB;
  if (!db) {
    return json({ error: "世界资料库后端未配置：缺少 D1 绑定 DB（同创意工坊，见 WORKSHOP-DEPLOY.md）" }, { status: 503 }, ch);
  }
  await ensureSchema(db);

  const p = url.pathname;
  const method = request.method;

  // 全局修订（公开·所有玩家拉取）：{ version, worlds: { 世界名: { p: 剧情, c: 切入点 } } }
  if (p === "/api/worlddetail/overrides" && method === "GET") {
    const rs = await db.prepare("SELECT name, plot, cut, updated_at FROM worlddetail_overrides").all();
    const worlds = {};
    let version = 0;
    for (const r of rs.results || []) {
      worlds[r.name] = r.cut ? { p: r.plot, c: r.cut } : { p: r.plot };
      if (r.updated_at > version) version = r.updated_at;
    }
    return json({ version, worlds }, {}, ch);
  }

  // 提交修订
  if (p === "/api/worlddetail/submit" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || !b.name || !b.plot) return json({ error: "name / plot 必填" }, { status: 400 }, ch);
    const plot = String(b.plot);
    const cut = b.cut == null ? null : String(b.cut);
    if (plot.length + (cut ? cut.length : 0) > MAX_TEXT) {
      return json({ error: `修订全文过大（上限 ${Math.floor(MAX_TEXT / 1024)}K 字符）` }, { status: 413 }, ch);
    }
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const ipHash = await sha256(ip + "|" + (env.WS_SALT || "zhushen-workshop"));
    const recent = await db.prepare(
      "SELECT COUNT(*) AS c FROM worlddetail_submissions WHERE ip_hash = ? AND created_at > ?"
    ).bind(ipHash, Date.now() - 3600 * 1000).first();
    if (recent && recent.c >= SUBMIT_LIMIT_PER_HOUR) {
      return json({ error: "提交过于频繁，请稍后再试" }, { status: 429 }, ch);
    }

    const name = str(b.name, 120);
    const owner = str(b.owner, 64);
    // 同 owner 同世界的旧「待审」替换成新版（改了又改只留最新一份，别刷爆审核队列）
    if (owner) {
      await db.prepare("DELETE FROM worlddetail_submissions WHERE owner = ? AND name = ? AND status = 'pending'")
        .bind(owner, name).run();
    }
    const id = `wd-${randHex(8)}`;
    await db.prepare(
      "INSERT INTO worlddetail_submissions (id,name,plot,cut,note,author,owner,status,created_at,ip_hash) " +
      "VALUES (?,?,?,?,?,?,?,'pending',?,?)"
    ).bind(id, name, plot, cut, str(b.note, 600), str(b.author, 40), owner, Date.now(), ipHash).run();
    return json({ id }, {}, ch);
  }

  // 提交列表：owner=我的（无全文）；status=pending 站长待审（含全文，需管理员）
  if (p === "/api/worlddetail/submissions" && method === "GET") {
    const owner = url.searchParams.get("owner");
    const status = url.searchParams.get("status");
    if (owner) {
      const rs = await db.prepare(
        "SELECT id,name,length(plot) AS plot_len,length(cut) AS cut_len,note,author,owner,status,created_at,reviewed_at " +
        "FROM worlddetail_submissions WHERE owner = ? ORDER BY created_at DESC LIMIT 50"
      ).bind(owner).all();
      return json({ submissions: (rs.results || []).map((r) => rowToSubmission(r, false)) }, {}, ch);
    }
    if (!isAdmin(request, env, url)) return json({ error: "需要管理员密钥（创意工坊→设置）" }, { status: 403 }, ch);
    const st = status === "approved" || status === "rejected" ? status : "pending";
    const rs = await db.prepare(
      "SELECT * FROM worlddetail_submissions WHERE status = ? ORDER BY created_at ASC LIMIT 100"
    ).bind(st).all();
    return json({ submissions: (rs.results || []).map((r) => rowToSubmission(r, true)) }, {}, ch);
  }

  // 审核（站长）：approve → 写 overrides 全局生效；reject → 仅标记
  if (p === "/api/worlddetail/review" && method === "POST") {
    if (!isAdmin(request, env, url)) return json({ error: "需要管理员密钥（创意工坊→设置）" }, { status: 403 }, ch);
    const b = await request.json().catch(() => null);
    if (!b || !b.id || (b.action !== "approve" && b.action !== "reject")) {
      return json({ error: "id / action(approve|reject) 必填" }, { status: 400 }, ch);
    }
    const row = await db.prepare("SELECT * FROM worlddetail_submissions WHERE id = ?").bind(b.id).first();
    if (!row) return json({ error: "not found" }, { status: 404 }, ch);
    if (row.status !== "pending") return json({ error: `该提交已处理过（${row.status}）` }, { status: 409 }, ch);
    const now = Date.now();
    if (b.action === "approve") {
      await db.prepare(
        "INSERT INTO worlddetail_overrides (name,plot,cut,author,submission_id,updated_at) VALUES (?,?,?,?,?,?) " +
        "ON CONFLICT(name) DO UPDATE SET plot=excluded.plot, cut=excluded.cut, author=excluded.author, submission_id=excluded.submission_id, updated_at=excluded.updated_at"
      ).bind(row.name, row.plot, row.cut, row.author, row.id, now).run();
    }
    await db.prepare("UPDATE worlddetail_submissions SET status = ?, reviewed_at = ? WHERE id = ?")
      .bind(b.action === "approve" ? "approved" : "rejected", now, b.id).run();
    return json({ ok: true }, {}, ch);
  }

  return json({ error: "not found" }, { status: 404 }, ch);
}
