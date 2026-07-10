// GuildDO —— 每家族一实例（idFromName(guildId)）·家族真身：名册/军衔/贡献/等级/增益/金库/编年史 + WS 广播给成员。
// 创建/入会由 GuildListDO 经内部 fetch(/init, /join) 调；成员操作走 WS。变更后回推卡给 GuildListDO(env.GUILDLIST)。
// 异步家族：贡献累计→exp→等级→按等级解锁 perks。见 指导/家族系统-设计.md。P1：开放即时入会·无审批(审批=P2)。

const MAX_MEMBERS = 30;
const MAX_CHEST = 100;
const MAX_CHRONICLE = 100;
const MIN_INTERVAL = 800;
const CHAIN_WINDOW = 12 * 3600 * 1000;      // 断链窗口（12h 内无新击杀 → 连击归零）
const CHAIN_MILESTONES = [10, 50, 200, 1000, 5000];
const HOF_THRESHOLD = 5000;                 // 家族丰碑门槛：离场成员贡献≥此值才铭刻
const MAX_HOF = 50;
const MAX_BUILDINGS = 20;         // 家族据点建筑「数量」上限
const MAX_BUILDING_LV = 10;       // 单建筑等级上限

// 等级 exp 阈值（index = level；level1=0）
const LEVEL_EXP = [0, 0, 5000, 15000, 35000, 70000, 130000, 230000, 400000, 650000, 1000000];
// 家族增益（按等级解锁）——⚠幅度小/确定性/可关，忠"别凭空加数值"铁律；数值效果由前端逐期接，DO 只判解锁。
const PERK_TABLE = [
  { level: 2, key: "stipend",    label: "每日家族津贴（乐园币）",   value: 200 },
  { level: 3, key: "settlement", label: "世界结算评级小幅加成",     value: 0.05 },
  { level: 4, key: "vaultCap",   label: "金库容量↑ · 入世费减免",   value: 0.1 },
  { level: 5, key: "dropRate",   label: "掉率 / 合成品质小幅加成",  value: 0.05 },
  { level: 7, key: "morale",     label: "家族称号 · 正文士气",       value: 1 },
];
function levelForExp(exp) { let lv = 1; for (let i = LEVEL_EXP.length - 1; i >= 1; i--) { if (exp >= LEVEL_EXP[i]) { lv = i; break; } } return lv; }
function perksForLevel(level) { return PERK_TABLE.filter((p) => p.level <= level); }
// ISO 周标识（如 2026-W28）——周任务 lazy 重置的锚（按活动触发·免定时 worker）。
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - yStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function json(o, init = {}) { return new Response(JSON.stringify(o), { ...init, headers: { "Content-Type": "application/json" } }); }
function clean(s, n, fb = "") { return String(s || "").slice(0, n).replace(/[ -]/g, "").trim() || fb; }

export class GuildDO {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.g = null; this._loaded = null; this._rate = new Map();
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }
  #ensureLoaded() {
    if (!this._loaded) this._loaded = (async () => { this.g = (await this.ctx.storage.get("guild")) || null; })();
    return this._loaded;
  }
  async #save() { await this.ctx.storage.put("guild", this.g); }

  // 周任务 lazy 重置：新的一周 → 生成新周目标(按等级缩放) + 全员 contribWeek 归零。返回是否发生了重置。
  #ensureWeek() {
    const wk = isoWeek();
    if (!this.g.weekTasks || this.g.weekTasks.weekId !== wk) {
      const lv = this.g.level;
      this.g.weekTasks = {
        weekId: wk,
        goals: [{ key: "contrib", label: "本周家族累计贡献值", target: 3000 * lv, cur: 0, reward: `完成后全员可领 ${500 * lv} 乐园币` }],
        claimed: [], rewardCoin: 500 * lv,
      };
      for (const m of this.g.members) m.contribWeek = 0;
      return true;
    }
    return false;
  }
  // 贡献推进周目标（累计贡献型）+ 广播进度。
  #advanceTasks(amount) {
    const wt = this.g.weekTasks; if (!wt || !wt.goals[0]) return;
    wt.goals[0].cur = Math.min(wt.goals[0].target, wt.goals[0].cur + amount);
    this.#broadcast({ type: "task_progress", weekTasks: wt });
  }
  // Torn 式家族连击：击杀在时间窗内累计冲里程碑（断链重置）。里程碑给家族 exp + 编年史 + 广播。
  #bumpChain() {
    const now = Date.now();
    if (!this.g.chain) this.g.chain = { count: 0, lastAt: 0, best: 0 };
    const c = this.g.chain;
    if (now - (c.lastAt || 0) > CHAIN_WINDOW) c.count = 0;
    c.count += 1; c.lastAt = now; c.best = Math.max(c.best || 0, c.count);
    if (CHAIN_MILESTONES.includes(c.count)) {
      const bonus = c.count * 20;
      this.g.exp += bonus;
      const before = this.g.level; this.g.level = levelForExp(this.g.exp); this.g.perks = perksForLevel(this.g.level);
      this.#addChronicle(`家族连击达成 ${c.count} 连！(+${bonus} 家族贡献)`, "chain");
      if (this.g.level > before) { this.#broadcast({ type: "level_up", level: this.g.level, perks: this.g.perks }); this.#pushCard(); }
    }
    this.#broadcast({ type: "chain_bumped", chain: c });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") return this.#handleWs(request, url);
    await this.#ensureLoaded();

    if (url.pathname.endsWith("/init") && request.method === "POST") {
      if (this.g) return json({ ok: false, reason: "家族已存在" });
      const b = await request.json().catch(() => ({}));
      const now = Date.now();
      const id = b.identity || {};
      this.g = {
        id: b.guildId, name: clean(b.name, 24, "无名家族"), tag: clean(b.tag, 6, "GUILD"),
        emblem: clean(b.emblem, 8), manifesto: clean(b.manifesto, 200), recruiting: true,
        ownerId: b.ownerId, createdAt: now, level: 1, exp: 0, perks: [],
        members: [{ pid: b.ownerId, name: b.ownerName || "会长", rank: "leader", contribTotal: 0, contribWeek: 0, joinedAt: now, lastActive: now, du: id.du || 0, avv: id.avv || 0, ds: id.ds || "", nc: id.nc || "" }],
        applicants: [], chest: [], chronicle: [{ at: now, text: `家族「${clean(b.name, 24, "无名家族")}」成立`, kind: "found" }],
        hallOfFame: [{ name: b.ownerName || "会长", contribTotal: 0, rank: "leader", at: now, reason: "found" }],
        base: { buildings: [] },   // 自定义建筑列表（成员手写/AI 生成·集资升级）
      };
      await this.#save();
      return json({ ok: true, summary: this.#summaryFor(b.ownerId), card: this.#card() });
    }

    if (url.pathname.endsWith("/join") && request.method === "POST") {
      if (!this.g) return json({ ok: false, reason: "家族不存在" });
      const b = await request.json().catch(() => ({}));
      if (this.g.members.some((m) => m.pid === b.pid)) return json({ ok: true, summary: this.#summaryFor(b.pid), card: this.#card() });
      if (this.g.members.length >= MAX_MEMBERS) return json({ ok: false, reason: "家族已满员" });
      if (this.g.recruiting === false) return json({ ok: false, reason: "该家族暂不招募" });
      const now = Date.now(); const id = b.identity || {};
      const member = { pid: b.pid, name: clean(b.name, 24, "新成员"), rank: "member", contribTotal: 0, contribWeek: 0, joinedAt: now, lastActive: now, du: id.du || 0, avv: id.avv || 0, ds: id.ds || "", nc: id.nc || "" };
      this.g.members.push(member);
      this.#addChronicle(`${member.name} 加入家族`, "join");
      await this.#save();
      this.#broadcast({ type: "member_joined", member });
      return json({ ok: true, summary: this.#summaryFor(b.pid), card: this.#card() });
    }

    if (url.pathname.endsWith("/contribute") && request.method === "POST") {
      // gameplay 自动贡献（REST·免持久 WS）：击杀/通关 → 该成员 contrib + 家族 exp/level/perks。
      if (!this.g) return json({ ok: false, reason: "家族不存在" });
      const b = await request.json().catch(() => ({}));
      const m = this.g.members.find((x) => x.pid === b.pid); if (!m) return json({ ok: false, reason: "非成员" });
      const amt = Math.max(0, Math.min(100000, Math.round(Number(b.amount) || 0)));
      if (!amt) return json({ ok: true, level: this.g.level, perks: this.g.perks, summary: this.#summaryFor(b.pid) });
      this.#ensureWeek();
      m.contribTotal += amt; m.contribWeek += amt; m.lastActive = Date.now();
      const before = this.g.level; this.g.exp += amt; this.g.level = levelForExp(this.g.exp); this.g.perks = perksForLevel(this.g.level);
      this.#advanceTasks(amt);
      if (b.kind === "kill") this.#bumpChain();
      this.#pushCardThrottled();
      await this.#save();
      this.#broadcast({ type: "contrib_bumped", pid: m.pid, contribTotal: m.contribTotal, contribWeek: m.contribWeek, exp: this.g.exp });
      if (this.g.level > before) { this.#addChronicle(`家族升到 Lv.${this.g.level}`, "levelup"); this.#broadcast({ type: "level_up", level: this.g.level, perks: this.g.perks }); this.#pushCard(); }
      return json({ ok: true, level: this.g.level, perks: this.g.perks, summary: this.#summaryFor(b.pid) });
    }
    if (url.pathname.endsWith("/info")) return json({ ok: true, exists: !!this.g, members: this.g ? this.g.members.length : 0 });
    return new Response("not found", { status: 404 });
  }

  async #handleWs(request, url) {
    await this.#ensureLoaded();
    const playerId = url.searchParams.get("pid") || "";
    if (!this.g || !this.g.members.some((m) => m.pid === playerId)) return new Response("not a member", { status: 403 });
    const name = clean(url.searchParams.get("name"), 24, "道友");
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    for (const old of this.ctx.getWebSockets()) { const a = old.deserializeAttachment(); if (a && a.playerId === playerId) { try { old.close(4001, "replaced"); } catch {} } }
    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId, name });
    const m = this.g.members.find((x) => x.pid === playerId); if (m) m.lastActive = Date.now();
    this.#ensureWeek(); await this.#save();
    this.#sendTo(server, { type: "hello", you: { playerId, name }, guild: this.g, online: this.#online() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.#ensureLoaded(); if (!this.g) return;
    let msg; try { msg = JSON.parse(message); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const me = this.g.members.find((m) => m.pid === att.playerId); if (!me) return;
    const isLeader = me.rank === "leader";
    const isOfficer = me.rank === "leader" || me.rank === "viceLeader";

    switch (msg.type) {
      case "contribute": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const amt = Math.max(0, Math.min(100000, Math.round(Number(msg.amount) || 0))); if (!amt) break;
        this.#ensureWeek();
        me.contribTotal += amt; me.contribWeek += amt; me.lastActive = Date.now();
        const before = this.g.level;
        this.g.exp += amt; this.g.level = levelForExp(this.g.exp); this.g.perks = perksForLevel(this.g.level);
        this.#advanceTasks(amt);
        this.#pushCardThrottled();
        await this.#save();
        this.#broadcast({ type: "contrib_bumped", pid: me.pid, contribTotal: me.contribTotal, contribWeek: me.contribWeek, exp: this.g.exp });
        if (this.g.level > before) { this.#addChronicle(`家族升到 Lv.${this.g.level}`, "levelup"); this.#broadcast({ type: "level_up", level: this.g.level, perks: this.g.perks }); this.#pushCard(); }
        break;
      }
      case "claim_task": {
        const wt = this.g.weekTasks; if (!wt) break;
        const done = wt.goals.every((gl) => gl.cur >= gl.target);
        if (!done) { this.#sendTo(ws, { type: "error", reason: "本周家族目标还没完成" }); break; }
        if (wt.claimed.includes(att.playerId)) { this.#sendTo(ws, { type: "error", reason: "本周奖励已领取" }); break; }
        wt.claimed.push(att.playerId); await this.#save();
        this.#broadcast({ type: "task_progress", weekTasks: wt });
        this.#sendTo(ws, { type: "task_reward", amount: wt.rewardCoin || 0, currency: "乐园币" });
        break;
      }
      case "deposit": {
        if (this.g.chest.length >= MAX_CHEST) { this.#sendTo(ws, { type: "error", reason: "金库已满" }); break; }
        const item = msg.item; if (!item || typeof item !== "object") break;
        this.g.chest.unshift({ ...item, _by: me.name, _at: Date.now() });
        await this.#save(); this.#broadcast({ type: "chest_changed", chest: this.g.chest });
        break;
      }
      case "withdraw": {
        const i = Number(msg.index); if (!(i >= 0 && i < this.g.chest.length)) break;
        this.g.chest.splice(i, 1); await this.#save(); this.#broadcast({ type: "chest_changed", chest: this.g.chest });
        break;
      }
      case "edit": {
        if (!isOfficer) break; const p = msg.patch || {};
        if (p.name != null) this.g.name = clean(p.name, 24) || this.g.name;
        if (p.tag != null) this.g.tag = clean(p.tag, 6) || this.g.tag;
        if (p.emblem != null) this.g.emblem = clean(p.emblem, 8);
        if (p.manifesto != null) this.g.manifesto = clean(p.manifesto, 200);
        if (p.recruiting != null) this.g.recruiting = !!p.recruiting;
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g }); this.#pushCard();
        break;
      }
      case "set_rank": {
        if (!isLeader) break; const pid = String(msg.pid || ""); const rank = msg.rank;
        const t = this.g.members.find((m) => m.pid === pid);
        if (!t || t.rank === "leader" || !["viceLeader", "elder", "member"].includes(rank)) break;
        t.rank = rank; await this.#save(); this.#broadcast({ type: "rank_changed", pid, rank });
        break;
      }
      case "kick": {
        if (!isOfficer) break; const pid = String(msg.pid || ""); const t = this.g.members.find((m) => m.pid === pid);
        if (!t || t.rank === "leader" || pid === att.playerId) break;
        this.#recordHof(t, "kicked");
        this.g.members = this.g.members.filter((m) => m.pid !== pid);
        this.#addChronicle(`${t.name} 离开了家族`, "leave"); await this.#save();
        this.#broadcast({ type: "member_left", pid }); this.#kickSocket(pid, "kicked"); this.#pushCard();
        break;
      }
      case "war_result": {
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        if (!this.g.wars) this.g.wars = { wins: 0, losses: 0, dayBucket: 0, dayCount: 0 };
        const today = Math.floor(Date.now() / 86400000);
        if (this.g.wars.dayBucket !== today) { this.g.wars.dayBucket = today; this.g.wars.dayCount = 0; }
        if ((this.g.wars.dayCount || 0) >= 5) { this.#sendTo(ws, { type: "error", reason: "今日家族战次数已用完（每日 5 次）" }); break; }
        this.g.wars.dayCount = (this.g.wars.dayCount || 0) + 1;
        const opp = String(msg.opponentName || "对手").slice(0, 24);
        if (msg.win) {
          this.g.wars.wins = (this.g.wars.wins || 0) + 1;
          const bonus = 300 + this.g.level * 100;
          this.g.exp += bonus; const before = this.g.level; this.g.level = levelForExp(this.g.exp); this.g.perks = perksForLevel(this.g.level);
          this.#addChronicle(`家族战 · 胜「${opp}」(+${bonus} 家族贡献)`, "war");
          if (this.g.level > before) this.#broadcast({ type: "level_up", level: this.g.level, perks: this.g.perks });
        } else {
          this.g.wars.losses = (this.g.wars.losses || 0) + 1;
          this.#addChronicle(`家族战 · 负于「${opp}」`, "war");
        }
        await this.#save();
        this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      // ── 家族据点·自定义建筑（会长/副会长/长老 增删改；任何成员出资升级）──
      case "add_building": {
        if (!(isLeader || me.rank === "viceLeader" || me.rank === "elder")) break;
        const arr = this.#baseArr();
        if (arr.length >= MAX_BUILDINGS) { this.#sendTo(ws, { type: "error", reason: `据点建筑上限 ${MAX_BUILDINGS}` }); break; }
        const b = msg.building || {};
        arr.push({ id: crypto.randomUUID(), name: String(b.name || "新建筑").slice(0, 24), desc: String(b.desc || "").slice(0, 300), effect: String(b.effect || "").slice(0, 200), level: 1, aiGen: !!b.aiGen });
        this.#addChronicle(`${me.name} 在据点规划了「${arr[arr.length - 1].name}」`, "base");
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      case "add_buildings": {   // AI 生成批量入据点
        if (!(isLeader || me.rank === "viceLeader" || me.rank === "elder")) break;
        const arr = this.#baseArr();
        for (const b of (Array.isArray(msg.buildings) ? msg.buildings : [])) {
          if (arr.length >= MAX_BUILDINGS) break;
          if (!b || !b.name) continue;
          arr.push({ id: crypto.randomUUID(), name: String(b.name).slice(0, 24), desc: String(b.desc || "").slice(0, 300), effect: String(b.effect || "").slice(0, 200), level: 1, aiGen: true });
        }
        this.#addChronicle(`${me.name} 用 AI 拟了据点蓝图`, "base");
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      case "edit_building": {
        if (!(isLeader || me.rank === "viceLeader" || me.rank === "elder")) break;
        const bd = this.#baseArr().find((x) => x.id === msg.id); if (!bd) break;
        const p = msg.patch || {};
        if (p.name != null) bd.name = String(p.name).slice(0, 24) || bd.name;
        if (p.desc != null) bd.desc = String(p.desc).slice(0, 300);
        if (p.effect != null) bd.effect = String(p.effect).slice(0, 200);
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      case "remove_building": {
        if (!(isLeader || me.rank === "viceLeader" || me.rank === "elder")) break;
        this.g.base.buildings = this.#baseArr().filter((x) => x.id !== msg.id);
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      case "upgrade_building": {   // 任何成员出资建设一级（乐园币客户端本地扣·纯集资）
        if (this.#tooFast(att.playerId)) { this.#sendTo(ws, { type: "rate_limited" }); break; }
        const bd = this.#baseArr().find((x) => x.id === msg.id); if (!bd) break;
        if ((bd.level || 1) >= MAX_BUILDING_LV) { this.#sendTo(ws, { type: "error", reason: "该建筑已满级" }); break; }
        bd.level = (bd.level || 1) + 1;
        this.#addChronicle(`${me.name} 出资将「${bd.name}」建至 Lv.${bd.level}`, "base");
        await this.#save(); this.#broadcast({ type: "guild_synced", guild: this.g });
        break;
      }
      case "leave": {
        if (isLeader) { this.#sendTo(ws, { type: "error", reason: "会长需先传位或解散家族" }); break; }
        this.#recordHof(me, "left");
        this.g.members = this.g.members.filter((m) => m.pid !== att.playerId);
        this.#addChronicle(`${me.name} 离开了家族`, "leave"); await this.#save();
        this.#broadcast({ type: "member_left", pid: att.playerId });
        this.#sendTo(ws, { type: "kicked", reason: "left" }); this.#pushCard();
        break;
      }
      case "disband": {
        if (!isLeader) break;
        try { await this.env.GUILDLIST.get(this.env.GUILDLIST.idFromName("global")).fetch("https://do/uncard", { method: "POST", body: JSON.stringify({ id: this.g.id }) }); } catch {}
        this.#broadcast({ type: "kicked", reason: "disband" });
        this.g = null; await this.ctx.storage.delete("guild");
        break;
      }
    }
  }

  async webSocketClose() {}
  async webSocketError(ws) { try { ws.close(); } catch {} }

  #summaryFor(pid) {
    const m = this.g.members.find((x) => x.pid === pid);
    return { id: this.g.id, name: this.g.name, tag: this.g.tag, emblem: this.g.emblem, role: m ? m.rank : "member", level: this.g.level, perks: this.g.perks, joinedAt: m ? m.joinedAt : Date.now() };
  }
  #baseArr() { if (!this.g.base || !Array.isArray(this.g.base.buildings)) this.g.base = { buildings: [] }; return this.g.base.buildings; }   // 据点建筑列表（懒建）
  #card() {
    const leader = this.g.members.find((m) => m.rank === "leader") || {};
    const weeklyContrib = this.g.members.reduce((s, m) => s + (m.contribWeek || 0), 0);   // 家族战·周榜排名依据
    const power = this.g.level * 500 + Math.floor(this.g.members.reduce((s, m) => s + (m.contribTotal || 0), 0) / 5) + this.g.members.length * 100;   // 家族战力（等级+总贡献+人数）
    return { id: this.g.id, name: this.g.name, tag: this.g.tag, emblem: this.g.emblem, manifesto: this.g.manifesto, level: this.g.level, members: this.g.members.length, recruiting: this.g.recruiting, ownerName: leader.name || "会长", weeklyContrib, power, at: this.g.createdAt, bumpedAt: Date.now() };
  }
  #addChronicle(text, kind) {
    this.g.chronicle.unshift({ at: Date.now(), text, kind });
    if (this.g.chronicle.length > MAX_CHRONICLE) this.g.chronicle = this.g.chronicle.slice(0, MAX_CHRONICLE);
    this.#broadcast({ type: "chronicle_added", entry: this.g.chronicle[0] });
  }
  // 家族丰碑：贡献达标的离场成员（或创立者）铭刻进名人堂（跨存档保留·上限 MAX_HOF）。
  #recordHof(m, reason) {
    if (!this.g.hallOfFame) this.g.hallOfFame = [];
    if (reason !== "found" && (m.contribTotal || 0) < HOF_THRESHOLD) return;
    this.g.hallOfFame.unshift({ name: m.name, contribTotal: m.contribTotal || 0, rank: m.rank, at: Date.now(), reason });
    if (this.g.hallOfFame.length > MAX_HOF) this.g.hallOfFame = this.g.hallOfFame.slice(0, MAX_HOF);
  }
  async #pushCard() { try { await this.env.GUILDLIST.get(this.env.GUILDLIST.idFromName("global")).fetch("https://do/card", { method: "POST", body: JSON.stringify(this.#card()) }); } catch {} }
  // 贡献时限流回推卡（60s 一次·让家族战周榜 weeklyContrib 大致跟得上·又不刷爆 GuildListDO）。
  #pushCardThrottled() { const now = Date.now(); if (now - (this._cardAt || 0) > 60000) { this._cardAt = now; this.#pushCard(); } }
  #kickSocket(pid, reason) {
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.playerId === pid) { try { ws.send(JSON.stringify({ type: "kicked", reason })); ws.close(); } catch {} } }
  }
  #online() { const s = new Set(); for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.playerId) s.add(a.playerId); } return s.size; }
  #tooFast(pid) { const now = Date.now(); const last = this._rate.get(pid) || 0; if (now - last < MIN_INTERVAL) return true; this._rate.set(pid, now); return false; }
  #broadcast(obj) { const s = JSON.stringify(obj); for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch {} } }
  #sendTo(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
}
