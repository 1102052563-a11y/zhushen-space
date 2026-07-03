// ArenaWorldDO —— 全局「世界竞技场」（单例 idFromName("global")）：玩家把主角/NPC 面板上传成参赛卡，
// 形成一条占位排名榜（阶梯榜）；挑战比自己排名高的对手，胜负由**服务端权威裁判**（两卡战力 + 种子的纯函数），
// 胜则顶掉对手名次、对手及其下方顺延一名（占位取代制）。客户端只据 winner 播过场动画，改不了胜负 → 防作弊。
// 与 ChatDO / TradeDO / AssistDO 同款 WebSocket Hibernation（空闲休眠 + ping/pong 自动响应 → 成本≈$0）。
// 每个 Discord 账号最多 3 张卡（按 ownerId+srcKey upsert，同 srcKey 再传=更新且保名次/战绩）。

const MAX_PER_OWNER = 3;       // 每个账号最多上传 3 个角色
const MAX_CARDS = 500;         // 全局参赛卡上限（超出淘汰榜尾最旧）
const MAX_MATCHES = 120;       // 挑战记录留存条数
const MAX_NAME = 24;
const MAX_AVATAR = 60000;      // 立绘缩略图上限（~45KB 的 dataURL；超出/非图则剥掉）
const MAX_SNAPSHOT = 200000;   // 整张快照序列化上限（~200KB；剥立绘后仍超则拒绝上传）
const MIN_INTERVAL = 900;      // 防刷：同一玩家两次写操作最小间隔(ms)

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
function cleanKind(k) {
  return k === "npc" ? "npc" : "player";
}

// ── 确定性裁判：战力 + 种子 RNG（胜负是两卡快照 + 种子的纯函数，服务端可复算）──
function fnv1a(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 生物战力：有效六维加权 + HP/EP 上限（六维已含阶位/等级/装备/技能加成，故无需再吃阶位表；夹取防溢出）。
function powerOf(snap) {
  const a = (snap && snap.attrs) || {};
  const n = (x) => Math.max(0, Math.min(100000, Number(x) || 0));
  return n(a.str) * 1 + n(a.agi) * 0.85 + n(a.con) * 1 + n(a.int) * 0.85 + n(a.cha) * 0.2 + n(a.luck) * 0.3
    + Math.max(0, Number((snap && snap.maxHp) || 0)) * 0.02
    + Math.max(0, Number((snap && snap.maxEp) || 0)) * 0.01;
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

export class ArenaWorldDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cards = null;      // ArenaCard[]（内存态，排名以 rank 字段为准）
    this.matches = null;    // 挑战记录（最近在前）
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
        this.matches = (await this.ctx.storage.get("matches")) || [];
      })();
    }
    return this._loaded;
  }

  // 按 rank 升序（rank 1 = 榜首）返回快照数组
  #sorted() {
    return [...this.cards].sort((a, b) => (a.rank || 9e9) - (b.rank || 9e9));
  }
  // 重排：连续化 rank（1..N），持久化
  #renumber() {
    this.#sorted().forEach((c, i) => { c.rank = i + 1; });
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

    this.#sendTo(server, { type: "hello", you: { playerId, name, hue }, cards: this.#sorted(), online: this.#online() });

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
        const kind = cleanKind(msg.kind);
        const srcKey = String(msg.srcKey || (kind === "npc" ? "" : "B1")).slice(0, 48) || "B1";
        const now = Date.now();
        const prev = this.cards.find((c) => c.ownerId === att.playerId && (c.srcKey || "") === srcKey);
        if (!prev) {
          const mine = this.cards.filter((c) => c.ownerId === att.playerId).length;
          if (mine >= MAX_PER_OWNER) { this.#sendTo(ws, { type: "error", reason: `每个账号最多上传 ${MAX_PER_OWNER} 个角色，请先删除一个` }); break; }
        }
        const card = {
          id: prev ? prev.id : crypto.randomUUID(),
          ownerId: att.playerId,
          ownerName: att.name,
          hue: att.hue,
          avv: att.avv || 0, ds: att.ds || "", nc: att.nc || "",
          ownerDu: att.du || 0,
          kind,
          srcKey,
          snapshot,
          rank: prev ? prev.rank : (this.cards.length + 1),   // 新卡入榜末位；更新保名次
          wins: prev ? (prev.wins || 0) : 0,
          losses: prev ? (prev.losses || 0) : 0,
          at: prev ? prev.at : now,
          bumpedAt: now,
        };
        this.cards = this.cards.filter((c) => !(c.ownerId === att.playerId && (c.srcKey || "") === srcKey));
        this.cards.push(card);
        if (this.cards.length > MAX_CARDS) {
          this.cards.sort((a, b) => (a.rank || 9e9) - (b.rank || 9e9));
          this.cards = this.cards.slice(0, MAX_CARDS);
        }
        this.#renumber();
        await this.ctx.storage.put("cards", this.cards);
        this.#broadcast({ type: "ladder", cards: this.#sorted() });
        break;
      }
      case "remove_card": {
        const cardId = String(msg.cardId || "");
        const before = this.cards.length;
        this.cards = this.cards.filter((c) => !(c.id === cardId && c.ownerId === att.playerId));   // 只能删自己的
        if (this.cards.length !== before) {
          this.#renumber();   // 删卡 → 下方顺延上升
          await this.ctx.storage.put("cards", this.cards);
          this.#broadcast({ type: "ladder", cards: this.#sorted() });
        }
        break;
      }
      case "challenge": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const mine = this.cards.find((c) => c.id === String(msg.myCardId || "") && c.ownerId === att.playerId);
        const opp = this.cards.find((c) => c.id === String(msg.opponentCardId || ""));
        if (!mine || !opp) { this.#sendTo(ws, { type: "error", reason: "对手或参赛角色不存在（请刷新）" }); break; }
        if (mine.id === opp.id) { this.#sendTo(ws, { type: "error", reason: "不能和自己对战" }); break; }
        if (opp.ownerId === att.playerId) { this.#sendTo(ws, { type: "error", reason: "不能挑战自己的角色" }); break; }
        if (!(opp.rank < mine.rank)) { this.#sendTo(ws, { type: "error", reason: "只能挑战排名比你高的对手" }); break; }

        // 服务端权威裁判：战力 + 种子 → 胜负（纯函数，可复算）
        const matchId = crypto.randomUUID();
        const seed = fnv1a(matchId);
        const rnd = mulberry32(seed);
        const pa = powerOf(mine.snapshot), pb = powerOf(opp.snapshot);
        let wa = pa / (pa + pb || 1);
        wa = Math.max(0.2, Math.min(0.8, wa));   // 胜率夹取，弱者也有逆袭空间
        const challengerWins = rnd() < wa;

        const rankBefore = mine.rank;
        const targetRank = opp.rank;
        if (challengerWins) {
          mine.wins = (mine.wins || 0) + 1; opp.losses = (opp.losses || 0) + 1;
          // 占位取代：把挑战者从当前位抽出，插到对手位；对手及其下方（到挑战者原位）整体顺延一名
          const sorted = this.#sorted();
          const fromIdx = sorted.findIndex((c) => c.id === mine.id);
          sorted.splice(fromIdx, 1);
          const oppIdx = sorted.findIndex((c) => c.id === opp.id);
          sorted.splice(oppIdx, 0, mine);
          sorted.forEach((c, i) => { c.rank = i + 1; });
        } else {
          mine.losses = (mine.losses || 0) + 1; opp.wins = (opp.wins || 0) + 1;
        }

        const rec = {
          matchId, at: Date.now(),
          challenger: { id: mine.id, name: mine.snapshot.name, ownerName: mine.ownerName, ownerDu: mine.ownerDu },
          opponent: { id: opp.id, name: opp.snapshot.name, ownerName: opp.ownerName, ownerDu: opp.ownerDu },
          winner: challengerWins ? "challenger" : "opponent",
          rankBefore, rankAfter: mine.rank,
        };
        this.matches.unshift(rec);
        if (this.matches.length > MAX_MATCHES) this.matches = this.matches.slice(0, MAX_MATCHES);
        await this.ctx.storage.put("cards", this.cards);
        await this.ctx.storage.put("matches", this.matches);

        // 结果只发给挑战者（据 winner+seed 播过场动画）；榜单变动广播全体
        this.#sendTo(ws, {
          type: "challenge_result",
          matchId, seed,
          winner: rec.winner,
          challenger: mine, opponent: opp,
          rankBefore, rankAfter: mine.rank,
        });
        this.#broadcast({ type: "ladder", cards: this.#sorted() });
        break;
      }
      // 心跳是裸字符串 "ping"（构造函数 setWebSocketAutoResponse 自动回 "pong"）。
    }
  }

  async webSocketClose() {}
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
