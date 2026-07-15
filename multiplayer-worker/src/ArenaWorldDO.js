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
const MAX_NARR = 12000;        // 实时对战·单回合战斗描写上限（防超大 WS 消息）
const MAX_DUEL_LOG = 40;       // 实时对战·回合日志留存条数
const MAX_ACTION = 2000;       // 实时对战·单条行动文本上限

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

// 实时对战·开局血量：优先用卡里算好的 maxHp（与单机同口径）；缺失则按体质粗估，保证双方都有合理血条。
function duelMaxHp(snap) {
  const h = Math.round(Number(snap && snap.maxHp) || 0);
  if (h > 0) return Math.min(9000000, h);
  const con = Number(snap && snap.attrs && snap.attrs.con) || 0;
  return Math.max(100, con * 20 || 500);
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
    this.duels = {};        // 实时对战会话（内存态·短生命周期，按 duelId 存；DO 重启即中断，可接受）
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
  // 占位取代：把挑战者从当前位抽出，插到对手位；对手及其下方（到挑战者原位）整体顺延一名。
  #occupy(mine, opp) {
    const sorted = this.#sorted();
    const fromIdx = sorted.findIndex((c) => c.id === mine.id);
    if (fromIdx >= 0) sorted.splice(fromIdx, 1);
    const oppIdx = sorted.findIndex((c) => c.id === opp.id);
    sorted.splice(Math.max(0, oppIdx), 0, mine);
    sorted.forEach((c, i) => { c.rank = i + 1; });
  }
  // 挑战失败：下降一名（与紧邻的下一名交换名次；已是末位则不动）。
  #demote(card) {
    const sorted = this.#sorted();
    const idx = sorted.findIndex((c) => c.id === card.id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const below = sorted[idx + 1];
    const t = card.rank; card.rank = below.rank; below.rank = t;
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

    this.#sendTo(server, { type: "hello", you: { playerId, name, hue }, cards: this.#sorted(), online: this.#online(), onlineOwners: this.#onlineOwners() });
    // 新玩家上线 → 广播在线名单（各端据此标记「可实时对战」的在线对手）
    this.#broadcast({ type: "online_owners", owners: this.#onlineOwners(), online: this.#online() });

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
          this.#occupy(mine, opp);   // 占位取代
        } else {
          mine.losses = (mine.losses || 0) + 1; opp.wins = (opp.wins || 0) + 1;
          this.#demote(mine);   // 挑战失败自动下降一名
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
      case "report_result": {
        // 手动应战：客户端上报真实战斗（复用战斗系统亲手打）的胜负 → 占位逻辑同 challenge。
        // 胜负改由客户端战斗结果决定（休闲社交榜·接受轻度信任；仍校验只能挑战更高名次 + 限流防刷）。
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const mine = this.cards.find((c) => c.id === String(msg.myCardId || "") && c.ownerId === att.playerId);
        const opp = this.cards.find((c) => c.id === String(msg.opponentCardId || ""));
        if (!mine || !opp) { this.#sendTo(ws, { type: "error", reason: "对手或参赛角色不存在（请刷新）" }); break; }
        if (mine.id === opp.id) { this.#sendTo(ws, { type: "error", reason: "不能和自己对战" }); break; }
        if (opp.ownerId === att.playerId) { this.#sendTo(ws, { type: "error", reason: "不能挑战自己的角色" }); break; }
        if (!(opp.rank < mine.rank)) { this.#sendTo(ws, { type: "error", reason: "只能挑战排名比你高的对手" }); break; }
        const win = !!msg.win;
        const rankBefore = mine.rank;
        if (win) { mine.wins = (mine.wins || 0) + 1; opp.losses = (opp.losses || 0) + 1; this.#occupy(mine, opp); }
        else { mine.losses = (mine.losses || 0) + 1; opp.wins = (opp.wins || 0) + 1; this.#demote(mine); }   // 手动挑战失败也下降一名
        this.matches.unshift({
          matchId: crypto.randomUUID(), at: Date.now(), mode: "manual",
          challenger: { id: mine.id, name: mine.snapshot.name, ownerName: mine.ownerName, ownerDu: mine.ownerDu },
          opponent: { id: opp.id, name: opp.snapshot.name, ownerName: opp.ownerName, ownerDu: opp.ownerDu },
          winner: win ? "challenger" : "opponent", rankBefore, rankAfter: mine.rank,
        });
        if (this.matches.length > MAX_MATCHES) this.matches = this.matches.slice(0, MAX_MATCHES);
        await this.ctx.storage.put("cards", this.cards);
        await this.ctx.storage.put("matches", this.matches);
        this.#broadcast({ type: "ladder", cards: this.#sorted() });
        break;
      }
      // ── 实时对战（双方在线·逐回合各自出招→发起方跑一次 AI 公正裁判→广播结果·可选计入排名）──
      case "duel_invite": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const mine = this.cards.find((c) => c.id === String(msg.myCardId || "") && c.ownerId === att.playerId);
        const opp = this.cards.find((c) => c.id === String(msg.opponentCardId || ""));
        if (!mine || !opp) { this.#sendTo(ws, { type: "error", reason: "对手或参赛角色不存在（请刷新）" }); break; }
        if (mine.id === opp.id || opp.ownerId === att.playerId) { this.#sendTo(ws, { type: "error", reason: "不能和自己对战" }); break; }
        if (!this.#playerOnline(opp.ownerId)) { this.#sendTo(ws, { type: "error", reason: "对方不在线，无法实时对战" }); break; }
        const ranked = !!msg.ranked;
        if (ranked && !(opp.rank < mine.rank)) { this.#sendTo(ws, { type: "error", reason: "排位对战只能挑战排名比你高的对手" }); break; }
        if (this.#duelOf(att.playerId)) { this.#sendTo(ws, { type: "error", reason: "你已在一场对战中" }); break; }
        if (this.#duelOf(opp.ownerId)) { this.#sendTo(ws, { type: "error", reason: "对方正在对战中，稍后再试" }); break; }
        const id = crypto.randomUUID();
        this.duels[id] = {
          id, ranked,
          hostId: att.playerId, guestId: opp.ownerId,   // 发起方=评委(卡A)，被邀方=卡B
          aCardId: mine.id, bCardId: opp.id,
          aName: mine.snapshot.name, bName: opp.snapshot.name,
          aSnapshot: mine.snapshot, bSnapshot: opp.snapshot,
          aOwnerName: mine.ownerName, bOwnerName: opp.ownerName,
          status: "inviting", round: 1,
          hpA: 0, hpB: 0, maxHpA: 0, maxHpB: 0,
          actions: {}, resolving: false, log: [], createdAt: Date.now(),
        };
        this.#sendToPlayer(opp.ownerId, { type: "duel_invited", duelId: id, ranked, challengerCard: mine, targetCardId: opp.id });
        this.#sendTo(ws, { type: "duel_pending", duelId: id, opponent: opp });
        break;
      }
      case "duel_respond": {
        const d = this.duels[String(msg.duelId || "")];
        if (!d || d.status !== "inviting" || d.guestId !== att.playerId) break;   // 只有被邀请者能应答
        if (!msg.accept) { this.#sendToPlayer(d.hostId, { type: "duel_declined", duelId: d.id }); delete this.duels[d.id]; break; }
        if (!this.#playerOnline(d.hostId)) { this.#sendTo(ws, { type: "error", reason: "发起方已离线" }); delete this.duels[d.id]; break; }
        d.maxHpA = duelMaxHp(d.aSnapshot); d.maxHpB = duelMaxHp(d.bSnapshot);
        d.hpA = d.maxHpA; d.hpB = d.maxHpB;
        d.status = "active"; d.round = 1; d.actions = {}; d.resolving = false;
        this.#sendToPlayer(d.hostId, { type: "duel_started", ...this.#duelView(d, d.hostId) });
        this.#sendToPlayer(d.guestId, { type: "duel_started", ...this.#duelView(d, d.guestId) });
        break;
      }
      case "duel_action": {
        const d = this.duels[String(msg.duelId || "")];
        if (!d || d.status !== "active") break;
        const side = att.playerId === d.hostId ? "A" : att.playerId === d.guestId ? "B" : null;
        if (!side) break;
        if (typeof msg.round === "number" && msg.round !== d.round) break;   // 过期回合忽略
        if (d.resolving) break;                                             // 正在裁定，忽略新出招
        const text = String(msg.text || "").slice(0, MAX_ACTION).trim();
        if (!text) break;
        d.actions[side] = text;
        this.#broadcastDuel(d, { type: "duel_action_ack", duelId: d.id, round: d.round, who: side });
        if (d.actions.A && d.actions.B) {   // 双方都已出招 → 交给发起方(评委)跑一次 AI 裁定
          d.resolving = true;
          this.#sendToPlayer(d.hostId, { type: "duel_round_ready", duelId: d.id, round: d.round, actionA: d.actions.A, actionB: d.actions.B });
        }
        break;
      }
      case "duel_round_result": {
        const d = this.duels[String(msg.duelId || "")];
        if (!d || d.status !== "active" || att.playerId !== d.hostId) break;   // 只有评委(发起方)能裁定
        if (typeof msg.round === "number" && msg.round !== d.round) break;
        if (!d.resolving) break;
        const dmgA = Math.max(0, Math.min(d.maxHpA, Math.round(Number(msg.dmgA) || 0)));
        const dmgB = Math.max(0, Math.min(d.maxHpB, Math.round(Number(msg.dmgB) || 0)));
        d.hpA = Math.max(0, d.hpA - dmgA);
        d.hpB = Math.max(0, d.hpB - dmgB);
        const ended = !!msg.ended || d.hpA <= 0 || d.hpB <= 0;
        let winner = null;
        if (ended) {
          if (msg.winner === "A" || msg.winner === "B") winner = msg.winner;
          else if (d.hpA <= 0 && d.hpB <= 0) winner = d.hpA >= d.hpB ? "A" : "B";
          else winner = d.hpA <= 0 ? "B" : "A";
        }
        const narrative = String(msg.narrative || "").slice(0, MAX_NARR);
        const resolvedRound = d.round;
        d.log.push({ round: resolvedRound, narrative });
        if (d.log.length > MAX_DUEL_LOG) d.log = d.log.slice(-MAX_DUEL_LOG);
        d.actions = {}; d.resolving = false;
        if (ended) d.status = "ended"; else d.round = resolvedRound + 1;
        this.#broadcastDuel(d, {
          type: "duel_round", duelId: d.id, round: resolvedRound, narrative,
          hpA: d.hpA, hpB: d.hpB, maxHpA: d.maxHpA, maxHpB: d.maxHpB,
          ended, winner, nextRound: ended ? resolvedRound : d.round,
        });
        if (ended) {
          if (d.ranked) await this.#settleDuelRanking(d, winner);
          delete this.duels[d.id];
        }
        break;
      }
      case "duel_forfeit": {
        const d = this.duels[String(msg.duelId || "")];
        if (!d || d.status === "ended") break;
        const side = att.playerId === d.hostId ? "A" : att.playerId === d.guestId ? "B" : null;
        if (!side) break;
        const active = d.status === "active";
        const winner = active ? (side === "A" ? "B" : "A") : null;   // 认输者判负；邀请阶段取消则无胜负
        if (active && d.ranked) await this.#settleDuelRanking(d, winner);
        d.status = "ended";
        this.#broadcastDuel(d, { type: "duel_ended", duelId: d.id, winner, reason: active ? "forfeit" : "cancel" });
        delete this.duels[d.id];
        break;
      }
      // 心跳是裸字符串 "ping"（构造函数 setWebSocketAutoResponse 自动回 "pong"）。
    }
  }

  async webSocketClose(ws) {
    try {
      await this.#ensureLoaded();
      const pid = (ws.deserializeAttachment() || {}).playerId;
      if (pid) {
        // 掉线 → 中断该玩家参与的进行中/邀请中对战（不计排名，避免掉线被误判为失败）
        for (const d of Object.values(this.duels)) {
          if (d.status !== "ended" && (d.hostId === pid || d.guestId === pid)) {
            d.status = "ended";
            const other = d.hostId === pid ? d.guestId : d.hostId;
            this.#sendToPlayer(other, { type: "duel_ended", duelId: d.id, winner: null, reason: "disconnect" });
            delete this.duels[d.id];
          }
        }
      }
    } catch {}
    // 在线名单变化 → 广播（排除正在关闭的这个连接）
    this.#broadcast({ type: "online_owners", owners: this.#onlineOwners(ws), online: this.#online(ws) });
  }
  async webSocketError(ws) { try { ws.close(); } catch {} }

  // ---- 工具 ----
  #tooFast(pid) {
    const now = Date.now();
    const last = this._rate.get(pid) || 0;
    if (now - last < MIN_INTERVAL) return true;
    this._rate.set(pid, now);
    return false;
  }
  #online(exclude) {
    return this.#onlineOwners(exclude).length;
  }
  // 当前在线的玩家 id 列表（供各端标记「可实时对战」的在线对手）；exclude=正在关闭的连接
  #onlineOwners(exclude) {
    const s = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (exclude && ws === exclude) continue;
      const a = ws.deserializeAttachment();
      if (a && a.playerId) s.add(a.playerId);
    }
    return [...s];
  }
  #playerOnline(pid) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playerId === pid) return true;
    }
    return false;
  }
  #sendToPlayer(pid, obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.playerId === pid) { try { ws.send(s); } catch {} }
    }
  }
  // 该玩家正参与的未结束对战（每人同一时刻只允许一场）
  #duelOf(pid) {
    return Object.values(this.duels).find((d) => d.status !== "ended" && (d.hostId === pid || d.guestId === pid)) || null;
  }
  #broadcastDuel(d, obj) {
    this.#sendToPlayer(d.hostId, obj);
    this.#sendToPlayer(d.guestId, obj);
  }
  // 对战视图（发给某一方；you=自己是哪一位、isJudge=是否评委）
  #duelView(d, forPid) {
    return {
      duelId: d.id, ranked: d.ranked, round: d.round, status: d.status,
      you: forPid === d.hostId ? "A" : "B",
      isJudge: forPid === d.hostId,
      a: { side: "A", cardId: d.aCardId, name: d.aName, ownerName: d.aOwnerName, snapshot: d.aSnapshot, maxHp: d.maxHpA, hp: d.hpA },
      b: { side: "B", cardId: d.bCardId, name: d.bName, ownerName: d.bOwnerName, snapshot: d.bSnapshot, maxHp: d.maxHpB, hp: d.hpB },
    };
  }
  // 排位对战结算：胜者占位取代/败者下降一名（复用 #occupy/#demote·A=发起方=挑战者）
  async #settleDuelRanking(d, winner) {
    const A = this.cards.find((c) => c.id === d.aCardId);
    const B = this.cards.find((c) => c.id === d.bCardId);
    if (!A || !B) return;
    const rankBefore = A.rank;
    if (winner === "A") { A.wins = (A.wins || 0) + 1; B.losses = (B.losses || 0) + 1; if (B.rank < A.rank) this.#occupy(A, B); }
    else { A.losses = (A.losses || 0) + 1; B.wins = (B.wins || 0) + 1; this.#demote(A); }
    this.matches.unshift({
      matchId: crypto.randomUUID(), at: Date.now(), mode: "duel",
      challenger: { id: A.id, name: A.snapshot.name, ownerName: A.ownerName, ownerDu: A.ownerDu },
      opponent: { id: B.id, name: B.snapshot.name, ownerName: B.ownerName, ownerDu: B.ownerDu },
      winner: winner === "A" ? "challenger" : "opponent", rankBefore, rankAfter: A.rank,
    });
    if (this.matches.length > MAX_MATCHES) this.matches = this.matches.slice(0, MAX_MATCHES);
    await this.ctx.storage.put("cards", this.cards);
    await this.ctx.storage.put("matches", this.matches);
    this.#broadcast({ type: "ladder", cards: this.#sorted() });
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
