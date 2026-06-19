// 轮回乐园 · 联机后端入口 Worker
// 职责：REST 路由（建房/大厅/信息/关房/诊断）+ 把 WebSocket 升级转发给对应房间 DO。
// 真正的房间状态机在 RoomDO.js；大厅注册表在 LobbyDO.js。

import { RoomDO } from "./RoomDO.js";
import { LobbyDO } from "./LobbyDO.js";
import { handleGateway } from "./gateway.js";
import { handleWorkshop } from "./workshop.js";

// wrangler 需要从入口模块导出 DO 类
export { RoomDO, LobbyDO };

// 房间码：去掉易混字符（0/O/1/I），6 位
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function roomCode(n = 6) {
  let s = "";
  const a = crypto.getRandomValues(new Uint8Array(n));
  for (const b of a) s += ALPHABET[b % ALPHABET.length];
  return s;
}

function pickOrigin(origin, allowed) {
  if (!allowed) return origin || "*"; // 未配置白名单 → 反射来源
  const list = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && list.includes(origin)) return origin;
  return list[0] || "*";
}
function corsHeaders(origin, allowed) {
  return {
    "Access-Control-Allow-Origin": pickOrigin(origin, allowed),
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), {
    ...init,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function lobbyStub(env) {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}
function roomStub(env, id) {
  return env.ROOMS.get(env.ROOMS.idFromName(id));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const ch = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ch });
    }

    const p = url.pathname;
    try {
      // AI 反代网关（AI Studio / Vertex → OpenAI 兼容；解决浏览器 CORS）
      if (p.startsWith("/api/gw/")) {
        return await handleGateway(request, env, ch);
      }

      // 创意工坊（社区共享内容：浏览/上传/下载计数；存 Cloudflare D1）
      if (p.startsWith("/api/workshop")) {
        return await handleWorkshop(request, env, ch, url);
      }

      // 健康检查
      if (p === "/api/multiplayer/diagnostics") {
        return json({ ok: true, service: "zhushen-multiplayer", ts: Date.now() }, {}, ch);
      }

      // 大厅列表
      if (p === "/api/multiplayer/rooms" && request.method === "GET") {
        const r = await lobbyStub(env).fetch("https://do/list");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // 建房
      if (p === "/api/multiplayer/rooms" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (!b.hostId) return json({ error: "hostId required" }, { status: 400 }, ch);
        const id = roomCode();
        const init = await roomStub(env, id).fetch("https://do/init", {
          method: "POST",
          body: JSON.stringify({
            roomId: id,
            name: b.name,
            hostId: b.hostId,
            hostName: b.hostName,
            maxSeats: b.maxSeats,
            visibility: b.visibility,
            mode: b.mode,
          }),
        });
        const data = await init.json();
        // 注册进大厅
        await lobbyStub(env).fetch("https://do/register", {
          method: "POST",
          body: JSON.stringify({
            roomId: id,
            name: b.name || "未命名秘境",
            hostName: b.hostName || "房主",
            players: 0,
            maxSeats: b.maxSeats || 4,
            status: "open",
            visibility: b.visibility || "public",
            mode: b.mode === "raid" ? "raid" : "adventure",
            updatedAt: Date.now(),
          }),
        });
        return json({ roomId: id, room: data.room }, {}, ch);
      }

      // /api/multiplayer/rooms/:id        (GET 信息)
      // /api/multiplayer/rooms/:id/ws     (WebSocket 升级)
      // /api/multiplayer/rooms/:id/close  (POST 关房，房主限定)
      const m = p.match(/^\/api\/multiplayer\/rooms\/([A-Za-z0-9]+)(\/ws|\/close)?$/);
      if (m) {
        const id = m[1];
        const sub = m[2];
        const stub = roomStub(env, id);

        if (sub === "/ws") {
          if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("expected websocket", { status: 426, headers: ch });
          }
          // 原样转发（保留 Upgrade 头 + 查询参数 pid/name/want）→ DO 完成 101 升级
          return stub.fetch(request);
        }

        if (sub === "/close" && request.method === "POST") {
          const r = await stub.fetch("https://do/close", {
            method: "POST",
            body: await request.text(),
          });
          return new Response(await r.text(), {
            status: r.status,
            headers: { ...ch, "Content-Type": "application/json" },
          });
        }

        // GET 房间信息（加入前展示用）
        const r = await stub.fetch("https://do/info");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      return json({ error: "not found" }, { status: 404 }, ch);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, { status: 500 }, ch);
    }
  },
};
