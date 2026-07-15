// 轮回乐园 · 联机后端入口 Worker
// 职责：REST 路由（建房/大厅/信息/关房/诊断）+ 把 WebSocket 升级转发给对应房间 DO。
// 真正的房间状态机在 RoomDO.js；大厅注册表在 LobbyDO.js。

import { RoomDO } from "./RoomDO.js";
import { LobbyDO } from "./LobbyDO.js";
import { ChatDO } from "./ChatDO.js";
import { TradeDO } from "./TradeDO.js";
import { AssistDO } from "./AssistDO.js";
import { ShopDO } from "./ShopDO.js";
import { GuildDO } from "./GuildDO.js";
import { GuildListDO } from "./GuildListDO.js";
import { ArenaWorldDO } from "./ArenaWorldDO.js";
import { handleGateway } from "./gateway.js";
import { handleWorkshop } from "./workshop.js";
import { handlePlaytime } from "./playtime.js";
import { handleChaos } from "./chaosRecords.js";
import { handleCloud } from "./cloud.js";
import { handleMonumentGet, handleMonumentPut } from "./monumentCloud.js";
import { handleVaultGet, handleVaultPut } from "./vaultCloud.js";
import { handleVector } from "./vectorCloud.js";
import { handleChatMe, handleChatAvatar } from "./chatId.js";
import { handleStickerUpload, handleStickerServe, handleStickerList, handleStickerDelete } from "./chatSticker.js";
import { verifyChatToken } from "./auth.js";

// wrangler 需要从入口模块导出 DO 类
export { RoomDO, LobbyDO, ChatDO, TradeDO, AssistDO, ArenaWorldDO, ShopDO, GuildDO, GuildListDO };

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key, X-Cloud-Meta",
    // 允许「公开 https 页面 → 本地 localhost worker」(Chrome Private Network Access)，否则本地 Vertex 会 Failed to fetch
    "Access-Control-Allow-Private-Network": "true",
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
function chatStub(env) {
  return env.CHAT.get(env.CHAT.idFromName("global"));
}
function tradeStub(env) {
  return env.TRADE.get(env.TRADE.idFromName("global"));
}
function assistStub(env) {
  return env.ASSIST.get(env.ASSIST.idFromName("global"));
}
function shopStub(env) {
  return env.SHOP.get(env.SHOP.idFromName("global"));
}
function guildListStub(env) {
  return env.GUILDLIST.get(env.GUILDLIST.idFromName("global"));
}
function arenaWorldStub(env) {
  return env.ARENAWORLD.get(env.ARENAWORLD.idFromName("global"));
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

      // 游玩时长记录 + 排行榜（凡 Discord 登录者累计活跃游玩时长；存 D1·共用 workshop 库）
      if (p.startsWith("/api/playtime")) {
        return await handlePlaytime(request, env, ch, url);
      }

      // 混沌世界·世界影响记录（离世时生成的「对世界的影响 + 剧情偏移度」opt-in 上传；按世界分组看板 + 喂 AI 生成世界卡；存 D1·共用 workshop 库）
      if (p.startsWith("/api/chaos")) {
        return await handleChaos(request, env, ch, url);
      }

      // 云存档（Discord 登录 + R2 存档 blob + D1 索引；手动上传/下载，含图）
      if (p.startsWith("/api/cloud")) {
        return await handleCloud(request, env, ch, url);
      }

      // 纪念丰碑·云同步（个人私有 R2 blob mon/<uid>.json；与聊天室共用 Discord 身份 chatToken）
      if (p === "/api/monument") {
        if (request.method === "GET") return await handleMonumentGet(request, env, ch);
        if (request.method === "POST") return await handleMonumentPut(request, env, ch);
        return json({ error: "method not allowed" }, { status: 405 }, ch);
      }

      // 账户仓库·云同步（个人私有 R2 blob vault/<uid>.json；与聊天室共用 Discord 身份 chatToken）
      if (p === "/api/vault") {
        if (request.method === "GET") return await handleVaultGet(request, env, ch);
        if (request.method === "POST") return await handleVaultPut(request, env, ch);
        return json({ error: "method not allowed" }, { status: 405 }, ch);
      }

      // 向量库·云端（玩家自建 embedding 索引：私有跨设备同步 + 公开社区库；R2 大 blob + D1 元数据）
      if (p.startsWith("/api/vector")) {
        return await handleVector(request, env, ch, url);
      }

      // 健康检查
      if (p === "/api/multiplayer/diagnostics") {
        return json({ ok: true, service: "zhushen-multiplayer", ts: Date.now() }, {}, ch);
      }

      // 聊天室身份：Discord 登录(复用云存档会话) → 分配顺序 UID + 签发 chatToken + 个人资料
      if (p === "/api/chat/me") {
        return await handleChatMe(request, env, ch, url);
      }
      // 聊天室头像：按 UID 取自定义头像 dataURL（公开读）
      if (p === "/api/chat/avatar") {
        return await handleChatAvatar(request, env, ch, url);
      }
      // 聊天室云端表情包：上传(POST·chatToken) / 列出我的(GET·chatToken) / 取图(GET·公开) / 删除(DELETE·chatToken)
      if (p === "/api/chat/sticker" && request.method === "POST") {
        return await handleStickerUpload(request, env, ch, url);
      }
      if (p === "/api/chat/stickers") {
        return await handleStickerList(request, env, ch, url);
      }
      if (p.startsWith("/api/chat/sticker/")) {
        const hash = decodeURIComponent(p.slice("/api/chat/sticker/".length));
        if (request.method === "DELETE") return await handleStickerDelete(request, env, ch, hash);
        return await handleStickerServe(request, env, hash);   // GET 公开取图
      }

      // 全局实时聊天室（独立 ChatDO 单例；与游戏房解耦，不进大厅）
      // 鉴权：必须带有效 chatToken（含顺序 UID）；验签后改写 pid=chat:<uid> 再转发，ChatDO 不碰令牌。
      if (p === "/api/chat/ws") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket", { status: 426, headers: ch });
        }
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) {
          return new Response("需要 Discord 登录", { status: 401, headers: ch });
        }
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);                                  // 身份=顺序 UID，权威来自验签
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));                        // 显示号(自定义靓号)权威来自令牌，防客户端伪造
        u.searchParams.delete("token");
        return chatStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/chat/info") {
        const r = await chatStub(env).fetch("https://do/info" + url.search);
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // 全局交易行（独立 TradeDO 单例；挂牌 + 还价 公开看板）。
      // 与聊天室共用 Discord 身份：验 chatToken → pid=chat:<uid>，并保留 name/avv/ds/nc 供挂牌显示头像/名牌。
      if (p === "/api/trade/ws") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket", { status: 426, headers: ch });
        }
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) {
          return new Response("需要 Discord 登录", { status: 401, headers: ch });
        }
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));                        // 显示号(自定义靓号)权威来自令牌，挂牌/还价显示用
        u.searchParams.delete("token");
        return tradeStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/trade/info") {
        const r = await tradeStub(env).fetch("https://do/info");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // 全局助战大厅（独立 AssistDO 单例；上传主角卡 + 邀请助战 + 排行榜）。
      // 与聊天室共用 Discord 身份：验 chatToken → pid=chat:<uid>，并保留 name/avv/ds/nc 供卡片显示头像/名牌。
      if (p === "/api/assist/ws") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket", { status: 426, headers: ch });
        }
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) {
          return new Response("需要 Discord 登录", { status: 401, headers: ch });
        }
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));                        // 显示号(自定义靓号)权威来自令牌，卡片显示用
        u.searchParams.delete("token");
        return assistStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/assist/info") {
        const r = await assistStub(env).fetch("https://do/info");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // 全局玩家产业商城（独立 ShopDO 单例；上传店铺 + 逛店买货 + 光顾计数）。
      // 与聊天室共用 Discord 身份：验 chatToken → pid=chat:<uid>，并保留 name/avv/ds/nc 供店卡显示头像/名牌。
      if (p === "/api/shop/ws") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket", { status: 426, headers: ch });
        }
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) {
          return new Response("需要 Discord 登录", { status: 401, headers: ch });
        }
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));
        u.searchParams.delete("token");
        return shopStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/shop/info") {
        const r = await shopStub(env).fetch("https://do/info");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // 家族系统：GuildListDO 单例（注册表·浏览/搜索/创建/申请）+ GuildDO 每家族（成员操作·按 guildId 路由）。
      // 与聊天室共用 Discord 身份：验 chatToken → pid=chat:<uid>。
      if (p === "/api/guild-list/ws") {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426, headers: ch });
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) return new Response("需要 Discord 登录", { status: 401, headers: ch });
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));
        u.searchParams.delete("token");
        return guildListStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/guild/ws") {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426, headers: ch });
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) return new Response("需要 Discord 登录", { status: 401, headers: ch });
        const guildId = url.searchParams.get("guildId") || "";
        if (!guildId) return new Response("missing guildId", { status: 400, headers: ch });
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.delete("token");
        return env.GUILD.get(env.GUILD.idFromName(guildId)).fetch(new Request(u.toString(), request));
      }
      // gameplay 自动贡献（REST·免持久 WS）：验 token → GuildDO(guildId)/contribute。
      if (p === "/api/guild/contribute" && request.method === "POST") {
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) return new Response("需要 Discord 登录", { status: 401, headers: ch });
        const guildId = url.searchParams.get("guildId") || "";
        if (!guildId) return new Response("missing guildId", { status: 400, headers: ch });
        const body = await request.json().catch(() => ({}));
        const r = await env.GUILD.get(env.GUILD.idFromName(guildId)).fetch("https://do/contribute", { method: "POST", body: JSON.stringify({ pid: "chat:" + payload.cuid, amount: body.amount, kind: body.kind }) });
        return new Response(await r.text(), { status: r.status, headers: { ...ch, "Content-Type": "application/json" } });
      }

      // 全局世界竞技场（独立 ArenaWorldDO 单例；上传参赛卡 + 占位排名榜 + 服务端裁判挑战）。
      // 与聊天室共用 Discord 身份：验 chatToken → pid=chat:<uid>，并保留 name/avv/ds/nc 供卡片显示头像/名牌。
      if (p === "/api/arena-world/ws") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("expected websocket", { status: 426, headers: ch });
        }
        const payload = await verifyChatToken(env, url.searchParams.get("token"));
        if (!payload || !payload.cuid) {
          return new Response("需要 Discord 登录", { status: 401, headers: ch });
        }
        const u = new URL(request.url);
        u.searchParams.set("pid", "chat:" + payload.cuid);
        u.searchParams.set("name", (u.searchParams.get("name") || payload.name || "道友"));
        u.searchParams.set("du", String(payload.du || payload.cuid));
        u.searchParams.delete("token");
        return arenaWorldStub(env).fetch(new Request(u.toString(), request));
      }
      if (p === "/api/arena-world/info") {
        const r = await arenaWorldStub(env).fetch("https://do/info");
        return new Response(await r.text(), {
          status: r.status,
          headers: { ...ch, "Content-Type": "application/json" },
        });
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
