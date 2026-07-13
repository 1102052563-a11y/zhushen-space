// 游玩时长记录 + 排行榜后端（D1·共用 zhushen-workshop 库 binding DB）——凡 Discord 登录者累计"活跃游玩"秒数。
// 路由（由 index.js 转发 /api/playtime/*）：
//   POST /api/playtime/beat?token=<chatToken>   心跳累加(body {seconds,name})；服务端按"距上次心跳真实经过时长"限幅，防客户端塞大数刷榜
//   GET  /api/playtime/me?token=<chatToken>      我的 { seconds, rank, players, recorded }
//   GET  /api/playtime/top?limit=                排行榜 top N（{uid,name,seconds}）+ 总人数（公开·无需登录）
// 存储 = Cloudflare D1（共用 workshop 的 DB，无需新建库/迁移；表 playtime 首次请求自动建）。

import { verifyChatToken } from "./auth.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS playtime (
  uid INTEGER PRIMARY KEY,
  name TEXT,
  seconds INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playtime_seconds ON playtime(seconds DESC);
CREATE TABLE IF NOT EXISTS presence (
  iphash TEXT PRIMARY KEY,
  seen INTEGER NOT NULL,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence(seen DESC);
`;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  // 老库 presence 表可能没 country 列（本功能后加的）→ 补列（列已存在则忽略）
  try { await db.exec("ALTER TABLE presence ADD COLUMN country TEXT"); } catch { /* 列已存在 */ }
  schemaReady = true;
}

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { "Content-Type": "application/json", ...headers } });
}

const MAX_BEAT = 300;   // 单次心跳最多累加 5 分钟（防一次塞大数）；正常客户端每 60s 上报
const MAX_NAME = 40;
const ONLINE_MS = 3 * 60 * 1000;    // 近 3 分钟内有心跳 = 当前在玩（客户端每 60s 报一次）
const PRUNE_MS  = 30 * 60 * 1000;   // 超 30 分钟的在线记录清掉（防 presence 表无限长）

// 客户端 IP 哈希（**不存原始 IP**·仅作"当前在玩者"去重键·隐私友好）。取 Cloudflare 真实来源 IP。
async function ipHash(request, env) {
  // X-Client-Ip = 同源 Pages Function 透传的「用户真实 IP」：大陆裸连走同源 /presence 心跳时，直连 workers.dev 那跳被限、
  // 改由 Pages 边缘代发到 worker——若这里仍读 CF-Connecting-IP，会是 Pages 边缘的同一个 IP，把所有转发用户去重成 1 人。故优先用透传值。
  const ip = request.headers.get("X-Client-Ip") || request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  if (!ip) return "";
  const data = new TextEncoder().encode((env.PRESENCE_SALT || "zhushen") + "|" + ip);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
// { online: 当前在玩人数(按IP去重·近 ONLINE_MS·含没登录 Discord 的), total: 累计在线时长总秒数(所有登录者 playtime 之和) }
async function presenceStats(db, now) {
  const cut = now - ONLINE_MS;
  const on = await db.prepare("SELECT COUNT(*) AS n FROM presence WHERE seen > ?").bind(cut).first();
  const tot = await db.prepare("SELECT COALESCE(SUM(seconds), 0) AS s FROM playtime").first();
  // 按国家/地区分布（Cloudflare 边缘按 IP 免费判定的 2 位国家码）：[{country:'JP', n:1}, …]
  const geo = await db.prepare("SELECT country, COUNT(*) AS n FROM presence WHERE seen > ? GROUP BY country ORDER BY n DESC").bind(cut).all();
  const byCountry = (geo?.results || []).map((r) => ({ country: r.country || "XX", n: r.n || 0 }));
  return { online: on?.n || 0, total: tot?.s || 0, byCountry };
}

export async function handlePlaytime(request, env, ch, url) {
  const db = env.DB;
  if (!db) return json({ error: "no D1" }, { status: 500 }, ch);
  await ensureSchema(db);
  const p = url.pathname;
  const cj = (obj, init) => json(obj, init, ch);

  // ── 排行榜（公开·无需登录）──
  if (p === "/api/playtime/top" && request.method === "GET") {
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const rows = await db.prepare("SELECT uid, name, seconds FROM playtime ORDER BY seconds DESC, updated_at ASC LIMIT ?").bind(limit).all();
    const cnt = await db.prepare("SELECT COUNT(*) AS n FROM playtime").first();
    const tot = await db.prepare("SELECT COALESCE(SUM(seconds), 0) AS s FROM playtime").first();
    return cj({ items: (rows?.results || []).map((r) => ({ uid: r.uid, name: r.name || "道友", seconds: r.seconds || 0 })), players: cnt?.n || 0, total: tot?.s || 0 });
  }

  // ── 当前在玩人数 / 累计在线时长（公开·无需登录·按 IP 去重计"当前在玩者"，含没登录 Discord 的人）──
  //   POST presence = 上报"我在玩"心跳（每 60s）；GET online = 只读展示（聊天室轮询）。都回 { online, total }。
  if (p === "/api/playtime/presence" && request.method === "POST") {
    const now = Date.now();
    const iph = await ipHash(request, env);
    const country = request.headers.get("X-Client-Country") || (request.cf && request.cf.country) || "";   // 优先用同源 Pages Function 透传的用户真实国家（大陆裸连走同源时）；直连时用 Cloudflare 边缘判定（JP/CN/US…；本地 wrangler dev 可能为空）
    if (iph) {
      await db.prepare("INSERT INTO presence (iphash, seen, country) VALUES (?, ?, ?) ON CONFLICT(iphash) DO UPDATE SET seen = excluded.seen, country = excluded.country").bind(iph, now, country).run();
      await db.prepare("DELETE FROM presence WHERE seen < ?").bind(now - PRUNE_MS).run();   // 顺手清过期
    }
    return cj(await presenceStats(db, now));
  }
  if (p === "/api/playtime/online" && request.method === "GET") {
    return cj(await presenceStats(db, Date.now()));
  }

  // ── 以下需 Discord 登录（chatToken）──
  const payload = await verifyChatToken(env, url.searchParams.get("token"));
  if (!payload || !payload.cuid) return new Response("需要 Discord 登录", { status: 401, headers: ch });
  const uid = payload.cuid;

  // 心跳累加
  if (p === "/api/playtime/beat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const claimed = Math.max(0, Math.floor(Number(body.seconds) || 0));
    const name = String(body.name || payload.name || "道友").slice(0, MAX_NAME);
    const now = Date.now();
    const row = await db.prepare("SELECT seconds, updated_at FROM playtime WHERE uid = ?").bind(uid).first();
    // 限幅：把每次累加钉在"距上次心跳真实经过的墙钟时长 + 15s 宽容"内（首次心跳最多 MAX_BEAT）——
    // 即便客户端 body.seconds 谎报个大数，也只按真实经过时间入账，杜绝刷榜。
    const elapsed = row ? Math.max(0, Math.floor((now - (row.updated_at || now)) / 1000)) : MAX_BEAT;
    const add = Math.min(claimed, Math.min(MAX_BEAT, elapsed + 15));
    if (row) {
      await db.prepare("UPDATE playtime SET seconds = seconds + ?, name = ?, updated_at = ? WHERE uid = ?").bind(add, name, now, uid).run();
    } else {
      await db.prepare("INSERT INTO playtime (uid, name, seconds, updated_at) VALUES (?, ?, ?, ?)").bind(uid, name, add, now).run();
    }
    return cj({ ok: true, total: (row ? (row.seconds || 0) : 0) + add });
  }

  // 我的时长 + 名次
  if (p === "/api/playtime/me" && request.method === "GET") {
    const mine = await db.prepare("SELECT seconds FROM playtime WHERE uid = ?").bind(uid).first();
    const secs = mine?.seconds || 0;
    const higher = await db.prepare("SELECT COUNT(*) AS n FROM playtime WHERE seconds > ?").bind(secs).first();
    const cnt = await db.prepare("SELECT COUNT(*) AS n FROM playtime").first();
    return cj({ seconds: secs, rank: (higher?.n || 0) + 1, players: cnt?.n || 0, recorded: !!mine });
  }

  return new Response("not found", { status: 404, headers: ch });
}
