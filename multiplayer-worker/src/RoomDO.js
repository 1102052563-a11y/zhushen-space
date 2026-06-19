// RoomDO —— 每个房间一个实例。WS 协调中继 + 房间权威状态。
// 设计：房主权威。世界/战斗快照只由房主 publish，服务器只转发；玩家提交行动文本+自己的角色卡。
// 用 WebSocket Hibernation API（acceptWebSocket + webSocket* 方法 + 自动 ping/pong），空闲不计时长 → 省钱关键。

function json(o, init = {}) {
  return new Response(JSON.stringify(o), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

export class RoomDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.meta = null; // {roomId,name,hostId,hostName,maxSeats,visibility,status,createdAt}
    this.seats = []; // [{seatId,playerId,name,joinedAt,snapshot}]
    this.world = null; // 最后一次 world_snapshot 载荷（不透明，后端不解析）
    this.combat = null; // 最后一次 combat_snapshot 载荷
    this.turn = null; // {turnId,phase:'collecting'|'resolved',startedAt,inputs:{seatId:{name,text,at}}}
    this.comments = []; // 弹幕环形缓冲（最多 100）
    this.transcript = []; // 正文进度日志（供中途加入者补看，最多 80 条）
    this._loaded = null;
    // 心跳：客户端发字符串 "ping" → 运行时直接回 "pong"，不唤醒 DO（不计费）
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
  }

  // 休眠唤醒后构造函数是全新的 → 处理任何消息前先从存储读回状态
  #ensureLoaded() {
    if (!this._loaded) {
      this._loaded = (async () => {
        const s = await this.ctx.storage.get(["meta", "seats", "world", "combat", "turn", "comments", "transcript"]);
        this.meta = s.get("meta") || this.meta;
        this.seats = s.get("seats") || [];
        this.world = s.get("world") || null;
        this.combat = s.get("combat") || null;
        this.turn = s.get("turn") || null;
        this.comments = s.get("comments") || [];
        this.transcript = s.get("transcript") || [];
      })();
    }
    return this._loaded;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") return this.#handleWs(request, url);
    const p = url.pathname;
    if (p.endsWith("/init")) return this.#init(request);
    if (p.endsWith("/info")) return this.#info();
    if (p.endsWith("/close")) return this.#httpClose(request);
    return new Response("not found", { status: 404 });
  }

  async #init(request) {
    await this.#ensureLoaded();
    if (this.meta && this.meta.status !== "closed") {
      return json({ ok: true, room: this.#publicState() });
    }
    const b = await request.json();
    this.meta = {
      roomId: b.roomId,
      name: b.name || "未命名秘境",
      hostId: b.hostId,
      hostName: b.hostName || "房主",
      maxSeats: Math.max(2, Math.min(8, b.maxSeats || 4)),
      visibility: b.visibility === "private" ? "private" : "public",
      mode: b.mode === "raid" ? "raid" : "adventure",   // adventure=共同冒险 / raid=组队讨伐
      status: "open",
      createdAt: Date.now(),
    };
    this.seats = [];
    this.turn = null;
    await this.ctx.storage.put("meta", this.meta);
    await this.ctx.storage.put("seats", this.seats);
    return json({ ok: true, room: this.#publicState() });
  }

  async #info() {
    await this.#ensureLoaded();
    if (!this.meta) return json({ error: "not found" }, { status: 404 });
    return json({ room: this.#publicState() });
  }

  async #httpClose(request) {
    await this.#ensureLoaded();
    if (!this.meta) return json({ error: "no room" }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    if (b.playerId !== this.meta.hostId) return json({ error: "forbidden" }, { status: 403 });
    await this.#close();
    return json({ ok: true });
  }

  // ---- WebSocket 接入 ----
  async #handleWs(request, url) {
    await this.#ensureLoaded();
    if (!this.meta || this.meta.status === "closed") {
      return new Response("room closed", { status: 410 });
    }
    const playerId = url.searchParams.get("pid") || crypto.randomUUID();
    const name = (url.searchParams.get("name") || "道友").slice(0, 24);
    const want = url.searchParams.get("want") || "play"; // play | watch

    let role = "spectator";
    let seatId = null;
    if (playerId === this.meta.hostId) {
      role = "host";
    } else if (want === "play") {
      const seat = this.#assignSeat(playerId, name);
      if (seat) {
        role = "player";
        seatId = seat.seatId;
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 同一 playerId 重连 → 踢掉旧连接
    for (const old of this.ctx.getWebSockets()) {
      const a = old.deserializeAttachment();
      if (a && a.playerId === playerId) {
        try {
          old.close(4001, "replaced");
        } catch {}
      }
    }

    this.ctx.acceptWebSocket(server, [playerId, role]); // 可休眠
    server.serializeAttachment({ playerId, name, role, seatId });
    await this.ctx.storage.put("seats", this.seats);

    // 给新连接做完整同步（晚加入/重连都靠这一段）
    this.#sendTo(server, { type: "room_state", room: this.#publicState(), you: { playerId, role, seatId } });
    if (this.world) this.#sendTo(server, { type: "world_snapshot", payload: this.world, replay: true });   // replay=只同步世界态，正文走 narrative_log 免重复
    if (this.transcript.length) this.#sendTo(server, { type: "narrative_log", entries: this.transcript });  // 中途加入：补看房主正文进度
    if (this.combat) this.#sendTo(server, { type: "combat_snapshot", payload: this.combat });
    this.#sendTo(server, { type: "player_snapshots", seats: this.#seatCards() });
    if (this.comments.length) this.#sendTo(server, { type: "room_comment", backlog: this.comments.slice(-50) });

    // 通知其他人座位变化
    this.#broadcast({ type: "seats_updated", seats: this.#publicSeats() }, server);
    this.#touchLobby();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.#ensureLoaded();
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() || {};
    const isHost = att.role === "host";

    switch (msg.type) {
      case "start_turn": {
        if (!isHost) return this.#deny(ws);
        this.turn = { turnId: (this.turn?.turnId || 0) + 1, phase: "collecting", startedAt: Date.now(), inputs: {} };
        await this.ctx.storage.put("turn", this.turn);
        this.#broadcast({ type: "turn_started", turn: this.#turnPublic() });
        break;
      }
      case "submit_input": {
        if (att.role !== "player") return this.#deny(ws, "只有座位玩家能提交行动");
        if (!this.turn || this.turn.phase !== "collecting") {
          this.turn = this.turn || { turnId: 1, phase: "collecting", startedAt: Date.now(), inputs: {} };
          this.turn.phase = "collecting";
        }
        this.turn.inputs[att.seatId] = { name: att.name, text: String(msg.text || "").slice(0, 4000), at: Date.now() };
        if (msg.snapshot) this.#setSeatCard(att.seatId, msg.snapshot); // 玩家把自己最新角色卡顺带上报
        await this.ctx.storage.put("turn", this.turn);
        await this.ctx.storage.put("seats", this.seats);
        this.#broadcast({ type: "turn_updated", turn: this.#turnPublic() });
        this.#broadcast({ type: "player_snapshots", seats: this.#seatCards() });
        break;
      }
      case "publish_world_snapshot": {
        if (!isHost) return this.#deny(ws);
        this.world = msg.payload;
        if (this.turn) this.turn.phase = "resolved";
        // 累积正文进度日志（供中途加入者补看）
        { const pl = msg.payload || {};
          if (pl.turnUser) this.transcript.push({ role: "user", content: String(pl.turnUser).slice(0, 4000) });
          if (pl.narrative) this.transcript.push({ role: "assistant", content: String(pl.narrative).slice(0, 8000) });
          if (this.transcript.length > 80) this.transcript = this.transcript.slice(-80);
          await this.ctx.storage.put("transcript", this.transcript); }
        await this.ctx.storage.put("world", this.world);
        if (this.turn) await this.ctx.storage.put("turn", this.turn);
        this.#broadcast({ type: "world_snapshot", payload: this.world });
        this.#broadcast({ type: "turn_resolved", turn: this.#turnPublic() });
        break;
      }
      case "publish_combat_snapshot": {
        if (!isHost) return this.#deny(ws);
        this.combat = msg.payload;
        await this.ctx.storage.put("combat", this.combat);
        this.#broadcast({ type: "combat_snapshot", payload: this.combat });
        break;
      }
      case "start_combat_action": {
        if (!isHost) return this.#deny(ws);
        this.#broadcast({ type: "combat_action_required", payload: msg.payload });
        break;
      }
      case "submit_combat_action": {
        this.#broadcast({ type: "combat_action_updated", seatId: att.seatId, name: att.name, payload: msg.payload });
        break;
      }
      case "skip_combat_action": {
        this.#broadcast({ type: "combat_action_updated", seatId: att.seatId, name: att.name, skip: true });
        break;
      }
      case "send_room_comment": {
        const c = {
          id: crypto.randomUUID(),
          name: att.name,
          role: att.role,
          text: String(msg.text || "").slice(0, 500),
          at: Date.now(),
        };
        if (!c.text) break;
        this.comments.push(c);
        if (this.comments.length > 100) this.comments.shift();
        await this.ctx.storage.put("comments", this.comments);
        this.#broadcast({ type: "room_comment", comment: c });
        break;
      }
      case "approve_join":
      case "reject_join": {
        if (!isHost) return this.#deny(ws);
        // v1 自动入座，无审批；保留消息类型以便后续开启审批模式
        break;
      }
      case "leave_room": {
        try {
          ws.close(1000, "left");
        } catch {}
        break;
      }
      case "close_room": {
        if (!isHost) return this.#deny(ws);
        await this.#close();
        break;
      }
      case "relay": {
        // 通用透传（赠予/分享等都走这条，免得每个新功能都改后端）：广播给全房，带上发送者信息
        this.#broadcast({
          type: "relayed",
          event: String(msg.event || ""),
          from: { seatId: att.seatId, name: att.name, role: att.role, playerId: att.playerId },
          payload: msg.payload,
        });
        break;
      }
      case "ping": {
        this.#sendTo(ws, { type: "pong", t: Date.now() });
        break;
      }
      default:
        this.#sendTo(ws, { type: "error", error: "unknown_type", of: msg.type });
    }
  }

  async webSocketClose(ws) {
    await this.#ensureLoaded();
    const att = ws.deserializeAttachment() || {};
    if (att.seatId) {
      this.seats = this.seats.filter((s) => s.seatId !== att.seatId);
      await this.ctx.storage.put("seats", this.seats);
      this.#broadcast({ type: "seats_updated", seats: this.#publicSeats() });
    }
    this.#touchLobby();
  }

  async webSocketError(ws) {
    try {
      await this.webSocketClose(ws);
    } catch {}
  }

  // ---- 关房 ----
  async #close() {
    if (this.meta) {
      this.meta.status = "closed";
      await this.ctx.storage.put("meta", this.meta);
    }
    this.#broadcast({ type: "room_closed" });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "room closed");
      } catch {}
    }
    await this.#deregisterLobby();
  }

  // ---- 座位 ----
  #assignSeat(playerId, name) {
    let seat = this.seats.find((s) => s.playerId === playerId);
    if (seat) {
      seat.name = name;
      return seat;
    }
    if (this.seats.length >= (this.meta.maxSeats || 4)) return null; // 满 → 转旁观
    seat = {
      seatId: "S" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      playerId,
      name,
      joinedAt: Date.now(),
      snapshot: null,
    };
    this.seats.push(seat);
    return seat;
  }
  #setSeatCard(seatId, card) {
    const s = this.seats.find((x) => x.seatId === seatId);
    if (s) s.snapshot = card;
  }

  // ---- 大厅同步 ----
  #lobbyStub() {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName("global"));
  }
  #lobbyEntry() {
    return {
      roomId: this.meta.roomId,
      name: this.meta.name,
      hostName: this.meta.hostName,
      players: this.seats.length,
      maxSeats: this.meta.maxSeats,
      status: this.meta.status,
      visibility: this.meta.visibility,
      updatedAt: Date.now(),
    };
  }
  async #touchLobby() {
    if (!this.meta) return;
    try {
      await this.#lobbyStub().fetch("https://do/register", {
        method: "POST",
        body: JSON.stringify(this.#lobbyEntry()),
      });
    } catch {}
  }
  async #deregisterLobby() {
    try {
      await this.#lobbyStub().fetch("https://do/deregister", {
        method: "POST",
        body: JSON.stringify({ roomId: this.meta?.roomId }),
      });
    } catch {}
  }

  // ---- 视图/工具 ----
  #publicState() {
    return { ...this.meta, seats: this.#publicSeats(), turn: this.#turnPublic() };
  }
  #publicSeats() {
    return this.seats.map((s) => ({ seatId: s.seatId, name: s.name, playerId: s.playerId, hasCard: !!s.snapshot }));
  }
  #seatCards() {
    return this.seats.map((s) => ({ seatId: s.seatId, name: s.name, snapshot: s.snapshot || null }));
  }
  #turnPublic() {
    return this.turn ? { turnId: this.turn.turnId, phase: this.turn.phase, inputs: this.turn.inputs || {} } : null;
  }
  #broadcast(obj, except) {
    const m = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(m);
      } catch {}
    }
  }
  #sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }
  #deny(ws, why) {
    this.#sendTo(ws, { type: "error", error: "forbidden", reason: why || "仅房主可操作" });
  }
}
