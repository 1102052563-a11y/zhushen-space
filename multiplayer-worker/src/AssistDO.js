// AssistDO —— 全局助战角色卡（单例 idFromName("global")）：玩家把主角面板上传成公开 NPC 卡，
// 其他玩家「邀请助战」拉进自己的临时队伍；每被邀请一次累计 +1，形成排行榜，按职业类型分类。
// 与 ChatDO / TradeDO 同款 WebSocket Hibernation（空闲休眠 + ping/pong 自动响应不唤醒 → 成本≈$0）。
// 一人一卡（按 ownerId upsert）；卡片快照后端不解析（透明存转），数值/展示全交前端。
// 「邀请」只把排行榜计数 +1 并广播；把卡物化成本地 NPC 全在邀请者前端完成（见 systems/assistApply.ts）。

const MAX_CARDS = 200;          // 全局助战卡上限（超出淘汰 bumpedAt 最旧）
const MAX_NPC_PER_OWNER = 30;   // 单玩家 NPC 助战卡上限（主角卡固定 1 张不计入）
const MAX_NAME = 24;
const MAX_AVATAR = 60000;     // 立绘缩略图上限（~45KB 的 dataURL；超出/非图则剥掉）
const MAX_SNAPSHOT = 200000;  // 整张快照序列化上限（~200KB；剥立绘后仍超则拒绝上传）
const MIN_INTERVAL = 1200;    // 防刷：同一玩家两次写操作最小间隔(ms)

// 分类白名单（与前端 systems/assistCategory.ts ASSIST_CATEGORIES 保持一致）
const CATEGORIES = new Set(['近战', '远程', '法师', '辅助', '坦克', '召唤', '刺客', '全能']);

function json(o, init = {}) {
  return new Response(JSON.stringify(o), { ...init, headers: { "Content-Type": "application/json" } });
}
function hueFromId(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function cleanName(n) {
  return String(n || "").slice(0, MAX_NAME).replace(/[ -]/g, "").trim() || "道友";
}
function cleanColor(c) {
  const s = String(c || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : "";
}
function cleanSeed(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_~-]/g, "").slice(0, 48);
}
function cleanCategory(c) {
  const s = String(c || "").trim();
  return CATEGORIES.has(s) ? s : "全能";
}
// 卡类型：主角助战 / NPC 助战（两块独立排名）。缺省/非法 → 'player'。
function cleanKind(k) {
  return k === "npc" ? "npc" : "player";
}
// 快照消毒：剥超大/非法立绘；整体超限先剥图再判，仍超则拒绝（返回 null）。
function sanitizeSnapshot(s) {
  if (!s || typeof s !== "object") return null;
  const snap = { ...s };
  if (typeof snap.avatar === "string" && (snap.avatar.length > MAX_AVATAR || !/^data:image\//.test(snap.avatar))) snap.avatar = "";
  let str = "";
  try { str = JSON.stringify(snap); } catch { return null; }
  if (str.length > MAX_SNAPSHOT) {
    snap.avatar = "";
    try { str = JSON.stringify(snap); } catch { return null; }
    if (str.length > MAX_SNAPSHOT) return null;
  }
  return snap;
}

export class AssistDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cards = null;       // AssistCard[]（最近更新在前）
    this._loaded = null;
    this._rate = new Map();
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
  }

  #ensureLoaded() {
    if (!this._loaded) {
      this._loaded = (async () => {
        this.cards = (await this.ctx.storage.get("cards")) || [];
      })();
    }
    return this._loaded;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") return this.#handleWs(request, url);
    if (url.pathname.endsWith("/info")) {
      await this.#ensureLoaded();
      return json({ ok: true, cards: this.cards.length, online: this.#online() });
    }
    return new Response("not found", { status: 404 });
  }

  async #handleWs(request, url) {
    await this.#ensureLoaded();
    const playerId = url.searchParams.get("pid") || crypto.randomUUID();
    const name = cleanName(url.searchParams.get("name"));
    const avv = parseInt(url.searchParams.get("avv") || "0", 10) || 0;   // 复用聊天身份：头像版本/DiceBear种子/名牌色，供卡片显示
    const ds = cleanSeed(url.searchParams.get("ds"));
    const nc = cleanColor(url.searchParams.get("nc"));
    const du = parseInt(url.searchParams.get("du") || "0", 10) || 0;     // 显示号(自定义靓号·index.js 从令牌注入·0=用内部 uid)
    const hue = hueFromId(playerId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a && a.playerId === playerId) { try { old.close(4001, "replaced"); } catch {} }
    }

    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId, name, hue, avv, ds, nc, du, joinedAt: Date.now() });

    // 进来即把整个助战大厅同步给它（含排行榜计数）
    this.#sendTo(server, { type: "hello", you: { playerId, name, hue }, cards: this.cards, online: this.#online() });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.#ensureLoaded();
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    const att = ws.deserializeAttachment() || {};

    switch (msg.type) {
      case "publish_card": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const snapshot = sanitizeSnapshot(msg.snapshot);
        if (!snapshot || !snapshot.name) { this.#sendTo(ws, { type: "error", reason: "角色卡内容无效或过大" }); break; }
        const kind = cleanKind(msg.kind);                          // 'player' 主角助战 / 'npc' NPC 助战
        // 主角卡一人一张(srcKey 固定空)；NPC 卡可多张，按来源 NPC 区分(srcKey=该 NPC 的本地 id)，同 srcKey 再传=更新。
        const srcKey = kind === "npc" ? String(msg.srcKey || "").slice(0, 48) : "";
        const now = Date.now();
        const prev = this.cards.find((c) => c.ownerId === att.playerId && (c.kind || "player") === kind && (c.srcKey || "") === srcKey);   // 同 owner+kind+srcKey 一卡：保留旧 id / 首传时间 / 助战计数
        if (kind === "npc" && !prev) {                             // 新建 NPC 卡才查上限（更新不查）
          const mine = this.cards.filter((c) => c.ownerId === att.playerId && (c.kind || "player") === "npc").length;
          if (mine >= MAX_NPC_PER_OWNER) { this.#sendTo(ws, { type: "error", reason: `NPC 助战卡最多 ${MAX_NPC_PER_OWNER} 张，请先删除一些` }); break; }
        }
        const card = {
          id: prev ? prev.id : crypto.randomUUID(),
          ownerId: att.playerId,
          ownerName: att.name,
          hue: att.hue,
          avv: att.avv || 0, ds: att.ds || "", nc: att.nc || "",   // 上传者聊天身份(头像/名牌色)
          ownerDu: att.du || 0,                                     // 上传者显示号(自定义靓号·0=用内部 uid)
          kind,
          srcKey,                                                  // 来源标识(NPC=本地 id；主角=空)
          category: cleanCategory(msg.category),
          snapshot,
          assists: prev ? (prev.assists || 0) : 0,                  // 更新卡不清零累计助战次数
          at: prev ? prev.at : now,
          bumpedAt: now,
        };
        this.cards = this.cards.filter((c) => !(c.ownerId === att.playerId && (c.kind || "player") === kind && (c.srcKey || "") === srcKey));
        this.cards.unshift(card);
        if (this.cards.length > MAX_CARDS) {
          this.cards.sort((a, b) => (b.bumpedAt || 0) - (a.bumpedAt || 0));
          this.cards = this.cards.slice(0, MAX_CARDS);
        }
        await this.ctx.storage.put("cards", this.cards);
        this.#broadcast({ type: "card_added", card });
        break;
      }
      case "remove_card": {
        const cardId = String(msg.cardId || "");
        const before = this.cards.length;
        this.cards = this.cards.filter((c) => !(c.id === cardId && c.ownerId === att.playerId));   // 只能删自己的卡
        if (this.cards.length !== before) {
          await this.ctx.storage.put("cards", this.cards);
          this.#broadcast({ type: "card_removed", cardId });
        }
        break;
      }
      case "invite": {
        // 邀请助战 = 该卡累计 +1（自己邀请自己的卡不计数）。物化成本地 NPC 由邀请者前端完成。
        const card = this.cards.find((c) => c.id === msg.cardId);
        if (!card) break;
        if (card.ownerId === att.playerId) break;          // 自邀不计数（前端也禁用了自己的卡）
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        card.assists = (card.assists || 0) + 1;
        await this.ctx.storage.put("cards", this.cards);
        this.#broadcast({ type: "assist_bumped", cardId: card.id, assists: card.assists });
        break;
      }
      // 心跳是裸字符串 "ping"（构造函数 setWebSocketAutoResponse 自动回 "pong"）。
    }
  }

  async webSocketClose() {}                       // 看板型无在线名单广播
  async webSocketError(ws) { try { ws.close(); } catch {} }

  // ---- 工具 ----
  #tooFast(pid) {
    const now = Date.now();
    const last = this._rate.get(pid) || 0;
    if (now - last < MIN_INTERVAL) return true;
    this._rate.set(pid, now);
    return false;
  }
  #online() {
    const s = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playerId) s.add(a.playerId);
    }
    return s.size;
  }
  /** @param {import('../../zhushen-space/zhushen-space/src/systems/assistProtocol').AssistInbound} obj  出向消息按前端 AssistInbound 校验（跨包单一事实来源） */
  #broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch {}
    }
  }
  /** @param {WebSocket} ws @param {import('../../zhushen-space/zhushen-space/src/systems/assistProtocol').AssistInbound} obj */
  #sendTo(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}
