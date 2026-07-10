// ShopDO —— 全局玩家产业商城（单例 idFromName("global")）：玩家把自己开的店（商店/娼馆/铁匠铺）上传成公开店铺快照，
// 其他玩家「逛商城」浏览并进店消费（买货→本地物化 addItem/createCompanion·扣自己的币；进店 +1 光顾计数形成热度）。
// 与 AssistDO 同款：WebSocket Hibernation（空闲休眠 + ping/pong 自动响应不唤醒 → 成本≈$0）；一人多店（按 owner+srcId upsert）。
// 店铺快照后端不解析（透明存转），数值/展示/物化全交前端。买货是光顾者本地完成（无跨端货币/物品转移·同 assist）。

const MAX_SHOPS = 300;          // 全局店铺上限（超出淘汰 bumpedAt 最旧）
const MAX_PER_OWNER = 10;       // 单玩家上传店铺上限
const MAX_NAME = 40;
const MAX_IMG = 80000;          // 单张缩略立绘上限（~60KB 的 dataURL；超出/非图则剥掉）
const MAX_SNAPSHOT = 400000;    // 整店快照序列化上限（~400KB；剥立绘后仍超则拒绝上传）
const MIN_INTERVAL = 1200;      // 防刷：同一玩家两次写操作最小间隔(ms)
const KINDS = new Set(["store", "brothel", "smithy"]);

function json(o, init = {}) {
  return new Response(JSON.stringify(o), { ...init, headers: { "Content-Type": "application/json" } });
}
function hueFromId(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function cleanName(n) {
  return String(n || "").slice(0, MAX_NAME).replace(/[ -]/g, "").trim() || "小店";
}
function cleanColor(c) {
  const s = String(c || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : "";
}
function cleanSeed(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_~-]/g, "").slice(0, 48);
}
function cleanKind(k) {
  return KINDS.has(k) ? k : "store";
}
function capImg(v) {
  return (typeof v === "string" && v.length <= MAX_IMG && /^data:image\//.test(v)) ? v : "";
}
// 店铺快照消毒：剥超大/非法立绘（店招/商品图/娼妇立绘/铁匠立绘）；整体超限先剥全部立绘再判，仍超则拒绝（返回 null）。
function sanitizeShopSnapshot(s) {
  if (!s || typeof s !== "object") return null;
  const snap = { ...s };
  snap.sign = capImg(snap.sign);
  if (Array.isArray(snap.goods)) snap.goods = snap.goods.slice(0, 60).map((g) => ({ ...(g || {}), image: capImg(g && g.image) }));
  if (Array.isArray(snap.girls)) snap.girls = snap.girls.slice(0, 30).map((g) => ({ ...(g || {}), portrait: capImg(g && g.portrait) }));
  if (snap.smith && snap.smith.boss) snap.smith = { ...snap.smith, boss: { ...snap.smith.boss, portrait: capImg(snap.smith.boss.portrait) } };
  let str = "";
  try { str = JSON.stringify(snap); } catch { return null; }
  if (str.length > MAX_SNAPSHOT) {
    snap.sign = "";
    if (Array.isArray(snap.goods)) snap.goods = snap.goods.map((g) => ({ ...(g || {}), image: "" }));
    if (Array.isArray(snap.girls)) snap.girls = snap.girls.map((g) => ({ ...(g || {}), portrait: "" }));
    if (snap.smith && snap.smith.boss) snap.smith.boss.portrait = "";
    try { str = JSON.stringify(snap); } catch { return null; }
    if (str.length > MAX_SNAPSHOT) return null;
  }
  return snap;
}

export class ShopDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.shops = null;       // PublishedShop[]（最近更新在前）
    this._loaded = null;
    this._rate = new Map();
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
  }

  #ensureLoaded() {
    if (!this._loaded) {
      this._loaded = (async () => {
        this.shops = (await this.ctx.storage.get("shops")) || [];
        this.revenue = (await this.ctx.storage.get("revenue")) || {};   // { ownerPid → { 货币 → 待领营收 } } 跨端收益账本
      })();
    }
    return this._loaded;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") return this.#handleWs(request, url);
    if (url.pathname.endsWith("/info")) {
      await this.#ensureLoaded();
      return json({ ok: true, shops: this.shops.length, online: this.#online() });
    }
    return new Response("not found", { status: 404 });
  }

  async #handleWs(request, url) {
    await this.#ensureLoaded();
    const playerId = url.searchParams.get("pid") || crypto.randomUUID();
    const name = cleanName(url.searchParams.get("name"));
    const avv = parseInt(url.searchParams.get("avv") || "0", 10) || 0;
    const ds = cleanSeed(url.searchParams.get("ds"));
    const nc = cleanColor(url.searchParams.get("nc"));
    const du = parseInt(url.searchParams.get("du") || "0", 10) || 0;
    const hue = hueFromId(playerId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a && a.playerId === playerId) { try { old.close(4001, "replaced"); } catch {} }
    }

    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId, name, hue, avv, ds, nc, du, joinedAt: Date.now() });

    this.#sendTo(server, { type: "hello", you: { playerId, name, hue }, shops: this.shops, online: this.#online(), revenue: this.revenue[playerId] || {} });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.#ensureLoaded();
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    const att = ws.deserializeAttachment() || {};

    switch (msg.type) {
      case "publish_shop": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const snapshot = sanitizeShopSnapshot(msg.snapshot);
        if (!snapshot || !snapshot.name) { this.#sendTo(ws, { type: "error", reason: "店铺内容无效或过大" }); break; }
        const kind = cleanKind(msg.shopType);
        const srcId = String(msg.srcId || "").slice(0, 48);
        const now = Date.now();
        const prev = this.shops.find((c) => c.ownerId === att.playerId && (c.srcId || "") === srcId);   // 同 owner+srcId 一店：保留旧 id / 首传时间 / 光顾计数
        if (!prev) {
          const mine = this.shops.filter((c) => c.ownerId === att.playerId).length;
          if (mine >= MAX_PER_OWNER) { this.#sendTo(ws, { type: "error", reason: `最多上传 ${MAX_PER_OWNER} 家店，请先下架一些` }); break; }
        }
        const shop = {
          id: prev ? prev.id : crypto.randomUUID(),
          ownerId: att.playerId,
          ownerName: att.name,
          hue: att.hue,
          avv: att.avv || 0, ds: att.ds || "", nc: att.nc || "",
          ownerDu: att.du || 0,
          srcId,
          type: kind,
          name: cleanName(msg.name) || snapshot.name || "小店",
          snapshot,
          visits: prev ? (prev.visits || 0) : 0,   // 更新不清零累计光顾
          at: prev ? prev.at : now,
          bumpedAt: now,
        };
        this.shops = this.shops.filter((c) => !(c.ownerId === att.playerId && (c.srcId || "") === srcId));
        this.shops.unshift(shop);
        if (this.shops.length > MAX_SHOPS) {
          this.shops.sort((a, b) => (b.bumpedAt || 0) - (a.bumpedAt || 0));
          this.shops = this.shops.slice(0, MAX_SHOPS);
        }
        await this.ctx.storage.put("shops", this.shops);
        this.#broadcast({ type: "shop_added", shop });
        break;
      }
      case "remove_shop": {
        const shopId = String(msg.shopId || "");
        const before = this.shops.length;
        this.shops = this.shops.filter((c) => !(c.id === shopId && c.ownerId === att.playerId));   // 只能下架自己的店
        if (this.shops.length !== before) {
          await this.ctx.storage.put("shops", this.shops);
          this.#broadcast({ type: "shop_removed", shopId });
        }
        break;
      }
      case "visit": {
        // 进店 = 该店累计光顾 +1（自己逛自己的店不计数）。物化/买货在光顾者前端完成。
        const shop = this.shops.find((c) => c.id === msg.shopId);
        if (!shop) break;
        if (shop.ownerId === att.playerId) break;
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        shop.visits = (shop.visits || 0) + 1;
        await this.ctx.storage.put("shops", this.shops);
        this.#broadcast({ type: "shop_visited", shopId: shop.id, visits: shop.visits });
        break;
      }
      case "earn": {
        // 跨端收益：光顾者在他人店消费(买货/强化/门票)后上报，钱记进店主的云端待领账（自己逛自己店不记，本地已计）。
        const shop = this.shops.find((c) => c.id === String(msg.shopId || ""));
        if (!shop) break;
        if (shop.ownerId === att.playerId) break;
        const cur = msg.currency === "灵魂钱币" ? "灵魂钱币" : msg.currency === "乐园币" ? "乐园币" : null;
        if (!cur) break;
        let amt = Math.floor(Number(msg.amount) || 0);
        if (!(amt > 0)) break;
        if (amt > 100000000) amt = 100000000;                 // 单次上报封顶（防离谱注入）
        const bag = this.revenue[shop.ownerId] || (this.revenue[shop.ownerId] = {});
        bag[cur] = Math.min((bag[cur] || 0) + amt, 1e12);      // 累计封顶防溢出
        await this.ctx.storage.put("revenue", this.revenue);
        for (const w of this.ctx.getWebSockets()) {            // 店主在线则实时推待领
          const a = w.deserializeAttachment();
          if (a && a.playerId === shop.ownerId) this.#sendTo(w, { type: "revenue", pending: this.revenue[shop.ownerId] || {} });
        }
        break;
      }
      case "collect_revenue": {
        // 店主领取云端待领营收 → 清账 + 回执金额（客户端据此 adjustCurrency 入钱包/储存空间）。
        const amounts = this.revenue[att.playerId] || {};
        const has = Object.keys(amounts).some((k) => (amounts[k] || 0) > 0);
        if (has) { delete this.revenue[att.playerId]; await this.ctx.storage.put("revenue", this.revenue); }
        this.#sendTo(ws, { type: "revenue_collected", amounts: has ? amounts : {} });
        this.#sendTo(ws, { type: "revenue", pending: {} });
        break;
      }
    }
  }

  async webSocketClose() {}
  async webSocketError(ws) { try { ws.close(); } catch {} }

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
  #broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch {}
    }
  }
  #sendTo(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}
