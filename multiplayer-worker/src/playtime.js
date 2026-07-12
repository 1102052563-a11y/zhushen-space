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
`;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  schemaReady = true;
}

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { "Content-Type": "application/json", ...headers } });
}

const MAX_BEAT = 300;   // 单次心跳最多累加 5 分钟（防一次塞大数）；正常客户端每 60s 上报
const MAX_NAME = 40;

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
    return cj({ items: (rows?.results || []).map((r) => ({ uid: r.uid, name: r.name || "道友", seconds: r.seconds || 0 })), players: cnt?.n || 0 });
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
