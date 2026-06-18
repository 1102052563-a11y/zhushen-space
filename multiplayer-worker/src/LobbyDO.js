// LobbyDO —— 单例（idFromName("global")）。公共房间注册表，给大厅列表用。
// 各 RoomDO 在建房/有人进出/关房时来 register / deregister。

function json(o, init = {}) {
  return new Response(JSON.stringify(o), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

export class LobbyDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this._rooms = undefined; // { [roomId]: entry }
  }

  async #load() {
    if (this._rooms === undefined) {
      this._rooms = (await this.ctx.storage.get("rooms")) || {};
    }
    return this._rooms;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const rooms = await this.#load();

    if (p.endsWith("/register")) {
      const e = await request.json();
      if (e && e.roomId) {
        rooms[e.roomId] = e;
        await this.ctx.storage.put("rooms", rooms);
      }
      return json({ ok: true });
    }

    if (p.endsWith("/deregister")) {
      const { roomId } = await request.json().catch(() => ({}));
      if (roomId && rooms[roomId]) {
        delete rooms[roomId];
        await this.ctx.storage.put("rooms", rooms);
      }
      return json({ ok: true });
    }

    if (p.endsWith("/list")) {
      const now = Date.now();
      const STALE = 1000 * 60 * 30; // 30 分钟没动静视为僵尸房
      let changed = false;
      const list = [];
      for (const [id, r] of Object.entries(rooms)) {
        if (now - (r.updatedAt || 0) > STALE) {
          delete rooms[id];
          changed = true;
          continue;
        }
        if (r.status === "open" && r.visibility === "public") list.push(r);
      }
      if (changed) await this.ctx.storage.put("rooms", rooms);
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return json({ rooms: list });
    }

    return new Response("not found", { status: 404 });
  }
}
