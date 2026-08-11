/* 小地图 · 确定性引擎（纯逻辑，无 React、无 store 依赖）——
   分层节点图：世界层=大区域(region)，场景层=区域内场所(site)；边=已知通路（道路/隐秘）。
   前端拍板：地点全路径解析建图 / 坐标一次落位永不重排 / 迷雾状态机 / 移动耗时报价；
   AI 只在护栏内补充传闻节点与风味（见 mapParser/mapPrompt）。
   数据形态对齐「地点全路径」铁则（WORLD_EVENT_LOCATION_RULE）：所处世界 大区域 场所 具体位置。
   迷雾状态只进不退：rumored(传闻) → discovered(已探) → visited(已访)，visited 仅由主角实际位置驱动。 */

export type MapNodeStatus = 'rumored' | 'discovered' | 'visited';
export type MapNodeKind = 'region' | 'site';

export interface MapNode {
  id: string;
  name: string;
  kind: MapNodeKind;
  parentId: string;          // site 的所属区域 id；region 恒为 ''
  status: MapNodeStatus;
  tags: string[];            // 功能标签（安全屋/商店/任务…）≤4 个
  danger: number;            // 0~5 氛围参考，不参与任何数值结算
  note: string;              // AI 一句话风味（≤60 字）
  aliases: string[];         // 名称漂移收容：正文/指令里出现过的别名（≤6 个）
  x: number;                 // 画布坐标：region=世界层，site=所在区域场景层。一次落位，永不重排（防抖动）。
  y: number;
  dirHint?: string;          // 初次落位的方位提示（N/NE/…或 北/东北…），只影响落位扇区
  pinned?: boolean;          // 玩家图钉（免自动归档）
  playerNote?: string;       // 玩家私人标注（不喂 AI）
  hasImage?: boolean;        // 有地点图（大图在 imageDb，key 见 systems/mapImages.mapImageKey；绝不进本 store 防爆 localStorage）
  imagePrompt?: string;      // 最近一次生图用的提示词（编辑重生成用；≤600 字）
  archived?: boolean;        // 传闻久未提及自动归档：画布隐藏，列表可见可捞回
  firstSeenTurn: number;
  lastSeenTurn: number;
  lastVisitTurn?: number;
}

export interface MapEdge { a: string; b: string; kind: 'road' | 'secret'; note?: string; }

export interface WorldMapData {
  nodes: Record<string, MapNode>;
  edges: MapEdge[];
  trail: string[];           // 最近足迹（node id·新在后）
  seq: number;               // id 发号器（持久化，保证 id 稳定）
  currentPath: string[];     // 最近一次解析出的路径段 [区域, 场所, 细部…]，供面包屑/信息条
}

export const MAP_CANVAS_W = 1000;
export const MAP_CANVAS_H = 640;
export const MAP_TRAIL_CAP = 24;
const NAME_MAX = 24;
const NOTE_MAX = 60;
const ALIAS_CAP = 6;
const TAG_CAP = 4;

const STATUS_RANK: Record<MapNodeStatus, number> = { rumored: 0, discovered: 1, visited: 2 };

export function statusLabel(s: MapNodeStatus): string {
  return s === 'visited' ? '已访' : s === 'discovered' ? '已探' : '传闻';
}

export function mapWorldKey(worldName: string): string {
  return (worldName || '').trim() || '轮回乐园';
}

export function emptyWorldMap(): WorldMapData {
  return { nodes: {}, edges: [], trail: [], seq: 0, currentPath: [] };
}

/* ── 基础工具 ── */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampDanger(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? clamp(n, 0, 5) : 0;
}

function clampName(s: string): string { return s.trim().slice(0, NAME_MAX); }
function clampNote(s: unknown): string { return String(s ?? '').trim().slice(0, NOTE_MAX); }

export function parseTags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map((x) => String(x)) : String(v ?? '').split(/[,，、/|]+/);
  return arr.map((t) => t.trim().slice(0, 8)).filter(Boolean).slice(0, TAG_CAP);
}

/* 名称归一化（照 calendarStore.nameEq 口径）：去空白/标点/大小写后比较 */
function normName(s: string): string {
  return (s || '').replace(/[\s·•・\-—_,，.。、|｜()（）【】[\]:：「」『』"'“”]/g, '').trim().toLowerCase();
}

export function nameEq(a: string, b: string): boolean {
  const x = normName(a), y = normName(b);
  return !!x && !!y && x === y;
}

/* 确定性字符串 hash（布局落位用，禁 Math.random 防抖动） */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  return h >>> 0;
}

/* 方位提示 → 扇区角（弧度）；认英文缩写与中文，认不出返回 null */
export function sectorAngle(dir?: string): number | null {
  const d = (dir || '').trim().toUpperCase();
  if (!d) return null;
  const table: [RegExp, number][] = [
    [/^(NE|东北)/, -Math.PI / 4], [/^(NW|西北)/, (-3 * Math.PI) / 4],
    [/^(SE|东南)/, Math.PI / 4], [/^(SW|西南)/, (3 * Math.PI) / 4],
    [/^(N|北|上)/, -Math.PI / 2], [/^(S|南|下)/, Math.PI / 2],
    [/^(E|东)/, 0], [/^(W|西)/, Math.PI],
  ];
  for (const [re, a] of table) if (re.test(d)) return a;
  return null;
}

/* ── 地点全路径解析 ──
   「生化危机2 浣熊市 警察局 二楼回廊」→ ['浣熊市','警察局','二楼回廊']（世界名剥掉）。
   分隔符认 空白/·/•/・/＞/>/→/、/｜/|（不认 '-'，防拆「生化危机2-重制」这类名）。 */
export function splitLocationPath(location: string, worldName: string): string[] {
  let l = (location || '').trim();
  if (!l) return [];
  const wn = (worldName || '').trim();
  if (wn && l.includes(wn)) l = l.replace(wn, ' ');
  const segs = l.split(/[\s·•・＞>→、/｜|]+/).map((s) => s.trim()).filter(Boolean);
  return segs.slice(0, 4).map((s) => s.slice(0, NAME_MAX));
}

/* ── 节点匹配（名称漂移的第一道防线）──
   优先级：本名精确 > 别名精确 > 包含匹配（归一化后一方包含另一方，短方 ≥2 字，取重叠最长者）。 */
export function resolveNodeIn(nodes: MapNode[], raw: string): MapNode | null {
  const q = normName(raw);
  if (!q) return null;
  for (const n of nodes) if (normName(n.name) === q) return n;
  for (const n of nodes) if (n.aliases.some((a) => normName(a) === q)) return n;
  if (q.length < 2) return null;
  let best: MapNode | null = null, bestLen = 0;
  for (const n of nodes) {
    const m = normName(n.name);
    if (m.length < 2) continue;
    if (m.includes(q) || q.includes(m)) {
      const overlap = Math.min(m.length, q.length);
      if (overlap > bestLen) { best = n; bestLen = overlap; }
    }
  }
  return best;
}

/* ── 确定性落位 ──
   首节点居中；其后按名字 hash 定角（有方位提示则限定扇区±22.5°），螺旋外推直到与同层节点距离达标。
   椭圆拉伸贴合宽画布；夹取进画布边距。同输入恒同输出（测试钉死）。 */
export function placeNode(siblings: { x: number; y: number }[], name: string, dirHint?: string, kind: MapNodeKind = 'site'): { x: number; y: number } {
  const cx = MAP_CANVAS_W / 2, cy = MAP_CANVAS_H / 2;
  if (siblings.length === 0) return { x: cx, y: cy };
  const h = hashStr(name);
  const h1 = (h % 1000) / 1000;
  const h2 = (Math.floor(h / 1000) % 1000) / 1000;
  const sector = sectorAngle(dirHint);
  let ang = sector != null ? sector + (h1 - 0.5) * (Math.PI / 4) : h1 * Math.PI * 2;
  let r = 140 + h2 * 70;
  const minGap = kind === 'region' ? 135 : 110;
  let x = cx, y = cy;
  for (let i = 0; i < 64; i++) {
    x = clamp(cx + Math.cos(ang) * r * 1.35, 70, MAP_CANVAS_W - 70);
    y = clamp(cy + Math.sin(ang) * r * 0.9, 64, MAP_CANVAS_H - 74);
    if (siblings.every((s) => Math.hypot(s.x - x, s.y - y) >= minGap)) return { x: Math.round(x), y: Math.round(y) };
    ang += 0.9;
    r += 24;
    if (r > 720) r = 150 + ((i * 37) % 130);   // 螺旋出界则重置半径继续绕（画布有界）
  }
  return { x: Math.round(x), y: Math.round(y) };   // 兜底：宁可轻微重叠也要落位，绝不死循环
}

/* ── 节点创建/触达（内部共用）── */

export interface CreateSpec {
  name: string; kind: MapNodeKind; parentId: string; status: MapNodeStatus; turn: number;
  dirHint?: string; danger?: number; note?: string; tags?: string[];
}

export function createNode(data: WorldMapData, spec: CreateSpec): MapNode {
  data.seq += 1;
  const sibs = Object.values(data.nodes).filter((n) => n.kind === spec.kind && n.parentId === spec.parentId && !n.archived);
  const { x, y } = placeNode(sibs, spec.name, spec.dirHint, spec.kind);
  const node: MapNode = {
    id: 'n' + data.seq.toString(36),
    name: clampName(spec.name), kind: spec.kind, parentId: spec.parentId, status: spec.status,
    tags: spec.tags ?? [], danger: clampDanger(spec.danger ?? 0), note: clampNote(spec.note ?? ''), aliases: [],
    x, y, ...(spec.dirHint ? { dirHint: spec.dirHint } : {}),
    firstSeenTurn: spec.turn, lastSeenTurn: spec.turn,
    ...(spec.status === 'visited' ? { lastVisitTurn: spec.turn } : {}),
  };
  data.nodes[node.id] = node;
  return node;
}

/* 状态只升不降 + 触达时间 + 别名吸收 + 解除归档。返回是否有实际变更。 */
function touchNode(data: WorldMapData, node: MapNode, status: MapNodeStatus, turn: number, rawName?: string): boolean {
  let changed = false;
  const next: MapNode = { ...node };
  if (STATUS_RANK[status] > STATUS_RANK[next.status]) { next.status = status; changed = true; }
  if (status === 'visited' && next.lastVisitTurn !== turn) { next.lastVisitTurn = turn; changed = true; }
  if (next.lastSeenTurn !== turn) { next.lastSeenTurn = turn; changed = true; }
  if (next.archived) { next.archived = false; changed = true; }
  if (rawName) {
    const rn = clampName(rawName);
    if (rn && !nameEq(rn, next.name) && !next.aliases.some((a) => nameEq(a, rn))) {
      next.aliases = [...next.aliases, rn].slice(-ALIAS_CAP);
      changed = true;
    }
  }
  if (changed) data.nodes[node.id] = next;
  return changed;
}

function regionIdOf(data: WorldMapData, id: string): string {
  const n = data.nodes[id];
  return n ? (n.kind === 'region' ? n.id : n.parentId) : '';
}

function hasEdge(data: WorldMapData, a: string, b: string): boolean {
  return data.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

function linkable(data: WorldMapData, a: string, b: string): boolean {
  const na = data.nodes[a], nb = data.nodes[b];
  if (!na || !nb || a === b || na.kind !== nb.kind) return false;
  return na.kind === 'region' || na.parentId === nb.parentId;   // site 边只连同区域内
}

/* ── 每回合确定性建图（幂等；零 API）──
   ①主角位置全路径 → 建/触达 区域+场所（visited）+足迹+足迹成路
   ②世界大事地点 → 建/触达节点（scope=region 已探 / background 传闻）
   ③传闻超龄归档 */
export interface IngestEvent { location: string; scope?: string; }
export interface IngestInput { worldName: string; location: string; turn: number; events?: IngestEvent[]; archiveAfter?: number; }
export interface IngestResult { data: WorldMapData; changed: boolean; newNames: string[]; arrivedId?: string; }

export function ingestTurn(prev: WorldMapData, inp: IngestInput): IngestResult {
  const data: WorldMapData = { nodes: { ...prev.nodes }, edges: prev.edges.slice(), trail: prev.trail.slice(), seq: prev.seq, currentPath: prev.currentPath };
  let changed = false;
  const newNames: string[] = [];
  const allOf = (kind: MapNodeKind, parentId?: string) =>
    Object.values(data.nodes).filter((n) => n.kind === kind && (parentId === undefined || n.parentId === parentId));

  const ensure = (name: string, kind: MapNodeKind, parentId: string, status: MapNodeStatus, dirHint?: string): MapNode => {
    const found = resolveNodeIn(allOf(kind, kind === 'site' ? parentId : ''), name);
    if (found) {
      if (touchNode(data, found, status, inp.turn, name)) changed = true;
      return data.nodes[found.id];
    }
    const node = createNode(data, { name, kind, parentId, status, turn: inp.turn, dirHint });
    newNames.push(node.name);
    changed = true;
    return node;
  };

  // ① 主角位置
  const segs = splitLocationPath(inp.location, inp.worldName);
  let arrivedId: string | undefined;
  if (segs.length > 0) {
    const region = ensure(segs[0], 'region', '', 'visited');
    let target = region;
    if (segs[1]) target = ensure(segs[1], 'site', region.id, 'visited');
    arrivedId = target.id;
    const tail = data.trail[data.trail.length - 1];
    if (tail !== target.id) {
      data.trail = [...data.trail, target.id].slice(-MAP_TRAIL_CAP);
      changed = true;
      // 足迹成路：相邻两步同层可连 → 补 road 边（跨区域则连区域层）
      if (tail && data.nodes[tail]) {
        const pair: [string, string] | null =
          linkable(data, tail, target.id) ? [tail, target.id]
          : (regionIdOf(data, tail) && regionIdOf(data, target.id) && regionIdOf(data, tail) !== regionIdOf(data, target.id))
            ? [regionIdOf(data, tail), regionIdOf(data, target.id)] : null;
        if (pair && linkable(data, pair[0], pair[1]) && !hasEdge(data, pair[0], pair[1])) {
          data.edges = [...data.edges, { a: pair[0], b: pair[1], kind: 'road' }];
          changed = true;
        }
      }
    }
    if (segs.join('·') !== data.currentPath.join('·')) { data.currentPath = segs; changed = true; }
  }

  // ② 世界大事地点（region 档=主角可感知→已探；background=远处→传闻）
  for (const ev of inp.events ?? []) {
    const es = splitLocationPath(ev.location, inp.worldName);
    if (!es.length) continue;
    const st: MapNodeStatus = ev.scope === 'background' ? 'rumored' : 'discovered';
    const region = ensure(es[0], 'region', '', st);
    if (es[1]) ensure(es[1], 'site', region.id, st);
  }

  // ③ 传闻超龄归档（图钉豁免）
  const after = Math.max(3, inp.archiveAfter ?? 30);
  for (const n of Object.values(data.nodes)) {
    if (n.status === 'rumored' && !n.pinned && !n.archived && inp.turn - n.lastSeenTurn > after) {
      data.nodes[n.id] = { ...n, archived: true };
      changed = true;
    }
  }

  return { data, changed, newNames, arrivedId };
}

/* 正文提及触达（防误归档）：正文原文里出现节点本名/别名（≥2 字）→ 刷新 lastSeenTurn */
export function touchMentions(prev: WorldMapData, narrative: string, turn: number): { data: WorldMapData; changed: boolean } {
  if (!narrative) return { data: prev, changed: false };
  let changed = false;
  const data: WorldMapData = { ...prev, nodes: { ...prev.nodes } };
  for (const n of Object.values(data.nodes)) {
    if (n.lastSeenTurn === turn) continue;
    const names = [n.name, ...n.aliases].filter((s) => s.length >= 2);
    if (names.some((s) => narrative.includes(s))) {
      data.nodes[n.id] = { ...n, lastSeenTurn: turn, archived: false };
      changed = true;
    }
  }
  return { data, changed };
}

/* ── AI 指令三件套（护栏在此，mapParser 只管解析行）── */

export interface DiscoverOpts { fallbackRegionName?: string; allowCreate: boolean; }
export type DiscoverResult = 'created' | 'merged' | 'dropped';

function pick(p: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (p[k] != null && p[k] !== '') return p[k];
  return undefined;
}

function aiStatus(v: unknown): MapNodeStatus {
  // AI 只许写 rumored/discovered；违规写 visited/已访 时按「已探」收编（它在声称到场，绝不是传闻）
  return /discovered|visited|已探|已访|亲见|亲眼/i.test(String(v ?? '')) ? 'discovered' : 'rumored';
}

export function applyDiscover(prev: WorldMapData, rawName: string, p: Record<string, unknown>, turn: number, opts: DiscoverOpts): { data: WorldMapData; result: DiscoverResult } {
  const name = clampName(rawName);
  if (!name) return { data: prev, result: 'dropped' };
  const data: WorldMapData = { ...prev, nodes: { ...prev.nodes }, edges: prev.edges.slice() };
  const existing = resolveNodeIn(Object.values(data.nodes), name);
  if (existing) {   // 已有同地点 → 转 setNode 语义合并（含别名吸收）
    touchNode(data, existing, aiStatus(pick(p, 'status', '状态')), turn, name);
    patchNode(data, data.nodes[existing.id], p);
    return { data, result: 'merged' };
  }
  if (!opts.allowCreate) return { data: prev, result: 'dropped' };
  const kind: MapNodeKind = /region|区域|大区|城市/i.test(String(pick(p, 'kind', '类型') ?? '')) ? 'region' : 'site';
  let parentId = '';
  if (kind === 'site') {
    const regions = Object.values(data.nodes).filter((n) => n.kind === 'region');
    const parentRaw = String(pick(p, 'parent', '上级', '所属') ?? '');
    const parent = (parentRaw ? resolveNodeIn(regions, parentRaw) : null)
      ?? (opts.fallbackRegionName ? resolveNodeIn(regions, opts.fallbackRegionName) : null);
    if (!parent) return { data: prev, result: 'dropped' };   // 场所必须有可解析的区域（先 discoverNode 区域）
    parentId = parent.id;
  }
  const node = createNode(data, {
    name, kind, parentId, status: aiStatus(pick(p, 'status', '状态')), turn,
    dirHint: String(pick(p, 'dir', '方位') ?? '') || undefined,
    danger: clampDanger(pick(p, 'danger', '危险')),
    note: clampNote(pick(p, 'note', '备注')),
    tags: parseTags(pick(p, 'tags', '标签')),
  });
  const linkRaw = String(pick(p, 'link', '连接') ?? '');
  if (linkRaw) {
    const peer = resolveNodeIn(Object.values(data.nodes).filter((n) => n.id !== node.id), linkRaw);
    if (peer && linkable(data, node.id, peer.id) && !hasEdge(data, node.id, peer.id)) {
      data.edges.push({ a: peer.id, b: node.id, kind: 'road' });
    }
  }
  return { data, result: 'created' };
}

/* setNode 补丁（AI 不许写 visited、不许降级状态；危险/备注/标签夹取）。返回是否有变更。 */
function patchNode(data: WorldMapData, node: MapNode, p: Record<string, unknown>): boolean {
  const next: MapNode = { ...node };
  let changed = false;
  const dg = pick(p, 'danger', '危险');
  if (dg !== undefined && clampDanger(dg) !== next.danger) { next.danger = clampDanger(dg); changed = true; }
  const nt = pick(p, 'note', '备注');
  if (nt !== undefined && clampNote(nt) && clampNote(nt) !== next.note) { next.note = clampNote(nt); changed = true; }
  const tg = pick(p, 'tags', '标签');
  if (tg !== undefined) {
    const tags = parseTags(tg);
    if (tags.length && tags.join('|') !== next.tags.join('|')) { next.tags = tags; changed = true; }
  }
  const st = pick(p, 'status', '状态');
  if (st !== undefined) {
    const s = aiStatus(st);
    if (STATUS_RANK[s] > STATUS_RANK[next.status]) { next.status = s; changed = true; }
  }
  if (changed) data.nodes[node.id] = next;
  return changed;
}

export function applySetNode(prev: WorldMapData, rawName: string, p: Record<string, unknown>, turn: number): { data: WorldMapData; ok: boolean } {
  const data: WorldMapData = { ...prev, nodes: { ...prev.nodes } };
  const node = resolveNodeIn(Object.values(data.nodes), rawName);
  if (!node) return { data: prev, ok: false };
  const touched = touchNode(data, node, node.status, turn, rawName);
  const patched = patchNode(data, data.nodes[node.id], p);
  return touched || patched ? { data, ok: true } : { data: prev, ok: true };
}

export function applyLink(prev: WorldMapData, aName: string, bName: string, p: Record<string, unknown>): { data: WorldMapData; ok: boolean } {
  const nodes = Object.values(prev.nodes);
  const a = resolveNodeIn(nodes, aName);
  const b = resolveNodeIn(nodes, bName);
  if (!a || !b || !linkable(prev, a.id, b.id)) return { data: prev, ok: false };
  if (hasEdge(prev, a.id, b.id)) return { data: prev, ok: true };
  const kind: MapEdge['kind'] = /secret|隐秘|密道|暗/i.test(String(pick(p, 'kind', '类型') ?? '')) ? 'secret' : 'road';
  const note = clampNote(pick(p, 'note', '备注')).slice(0, 20) || undefined;
  return { data: { ...prev, edges: [...prev.edges, { a: a.id, b: b.id, kind, ...(note ? { note } : {}) }] }, ok: true };
}

/* 玩家点图移动：目标标记已访 + 足迹 + 足迹成路 */
export function applyVisit(prev: WorldMapData, id: string, turn: number): { data: WorldMapData; ok: boolean } {
  if (!prev.nodes[id]) return { data: prev, ok: false };
  const data: WorldMapData = { ...prev, nodes: { ...prev.nodes }, edges: prev.edges.slice(), trail: prev.trail.slice() };
  touchNode(data, data.nodes[id], 'visited', turn);
  const parent = data.nodes[id].parentId;
  if (parent && data.nodes[parent]) touchNode(data, data.nodes[parent], 'visited', turn);
  const tail = data.trail[data.trail.length - 1];
  if (tail !== id) {
    if (tail && linkable(data, tail, id) && !hasEdge(data, tail, id)) data.edges.push({ a: tail, b: id, kind: 'road' });
    data.trail = [...data.trail, id].slice(-MAP_TRAIL_CAP);
  }
  return { data, ok: true };
}

/* ── 移动报价（前端拍板耗时；risk 只作提示，不结算数值）── */
export function travelQuote(data: WorldMapData, fromId: string | undefined, toId: string): { minutes: number; risk: number; hops: number; via: string[] } {
  const to = data.nodes[toId];
  const from = fromId ? data.nodes[fromId] : undefined;
  if (!to || !from || from.id === to.id) {
    const risk = clampDanger(to?.danger ?? 0);
    return { minutes: 10, risk, hops: 1, via: [] };
  }
  const adj: Record<string, string[]> = {};
  for (const e of data.edges) {
    (adj[e.a] = adj[e.a] ?? []).push(e.b);
    (adj[e.b] = adj[e.b] ?? []).push(e.a);
  }
  const prevMap: Record<string, string> = {};
  const seen = new Set<string>([from.id]);
  const q = [from.id];
  let found = false;
  while (q.length && !found) {
    const cur = q.shift()!;
    for (const nx of adj[cur] ?? []) {
      if (seen.has(nx)) continue;
      seen.add(nx);
      prevMap[nx] = cur;
      if (nx === to.id) { found = true; break; }
      q.push(nx);
    }
  }
  let hops: number;
  const via: string[] = [];
  let risk = Math.max(from.danger, to.danger);
  if (found) {
    let cur = to.id;
    while (cur !== from.id) {
      const n = data.nodes[cur];
      if (n) { risk = Math.max(risk, n.danger); if (cur !== to.id) via.unshift(n.name); }
      cur = prevMap[cur];
    }
    hops = via.length + 1;
  } else {
    hops = regionIdOf(data, from.id) === regionIdOf(data, to.id) ? 2 : 3;   // 无已知通路 → 按跨度估
  }
  const minutes = Math.max(5, Math.round((hops * 15 * (1 + 0.25 * Math.max(0, risk - 2))) / 5) * 5);
  return { minutes, risk, hops, via };
}

/* ── 序列化（注入正文 / 杂项占位符 / 地图演化 digest 共用；空图一律返回 ''）── */

function sortForList(a: MapNode, b: MapNode): number {
  return (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || (b.lastSeenTurn - a.lastSeenTurn);
}

/** 世界层 POI 摘要（一行）：`浣熊市（已访·当前·场所4处）、森林边缘（传闻）…` */
export function serializeWorldPois(data: WorldMapData, currentRegionId?: string): string {
  const regions = Object.values(data.nodes).filter((n) => n.kind === 'region' && !n.archived).sort((a, b) =>
    (a.id === currentRegionId ? -1 : 0) - (b.id === currentRegionId ? -1 : 0) || sortForList(a, b));
  if (!regions.length) return '';
  const shown = regions.slice(0, 10);
  const parts = shown.map((r) => {
    const cnt = Object.values(data.nodes).filter((n) => n.kind === 'site' && n.parentId === r.id && !n.archived).length;
    const bits = [statusLabel(r.status), r.id === currentRegionId ? '当前' : '', cnt ? `场所${cnt}处` : '', r.danger >= 3 ? `危险${r.danger}` : ''].filter(Boolean);
    return `${r.name}（${bits.join('·')}）`;
  });
  return parts.join('、') + (regions.length > shown.length ? ` 等${regions.length}个区域` : '');
}

/** 场景层摘要（多行）：区域内场所清单 + 已知通路 */
export function serializeSceneMap(data: WorldMapData, regionId: string, cap = 12): string {
  const sites = Object.values(data.nodes).filter((n) => n.kind === 'site' && n.parentId === regionId && !n.archived).sort(sortForList);
  if (!sites.length) return '';
  const shown = sites.slice(0, cap);
  const lines = shown.map((s) => {
    const bits = [statusLabel(s.status), s.danger ? `危险${s.danger}` : '', s.tags.length ? s.tags.join('/') : ''].filter(Boolean);
    return `- ${s.name}〔${bits.join('·')}〕${s.note ? `：${s.note}` : ''}`;
  });
  if (sites.length > shown.length) lines.push(`- …等共 ${sites.length} 处`);
  const ids = new Set(shown.map((s) => s.id));
  const roads = data.edges
    .filter((e) => ids.has(e.a) && ids.has(e.b))
    .slice(0, 8)
    .map((e) => `${data.nodes[e.a]?.name}${e.kind === 'secret' ? '⇢(隐秘)' : '⇄'}${data.nodes[e.b]?.name}`);
  return lines.join('\n') + (roads.length ? `\n通路：${roads.join('、')}` : '');
}

/** 地图演化阶段用的全量 digest（既有名单=命名权威） */
export function buildMapDigest(data: WorldMapData, currentRegionId?: string): string {
  const regions = Object.values(data.nodes).filter((n) => n.kind === 'region' && !n.archived).sort((a, b) =>
    (a.id === currentRegionId ? -1 : 0) - (b.id === currentRegionId ? -1 : 0) || sortForList(a, b)).slice(0, 8);
  if (!regions.length) return '（暂无已知地点）';
  const lines: string[] = [];
  for (const r of regions) {
    lines.push(`■ ${r.name}（${statusLabel(r.status)}${r.id === currentRegionId ? '·当前' : ''}）`);
    const sites = Object.values(data.nodes).filter((n) => n.kind === 'site' && n.parentId === r.id && !n.archived).sort(sortForList).slice(0, 10);
    for (const s of sites) {
      lines.push(`  - ${s.name}〔${statusLabel(s.status)}${s.danger ? `·危险${s.danger}` : ''}${s.tags.length ? `·${s.tags.join('/')}` : ''}〕`);
    }
    if (lines.length > 44) { lines.push('  …（余略）'); break; }
  }
  return lines.join('\n');
}

/** 世界大事 → 节点事件钉（面板渲染用）：nodeId → 事件名列表 */
export function eventPinsFor(data: WorldMapData, worldName: string, events: { location?: string; name?: string; desc?: string; settledAt?: number }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const regions = Object.values(data.nodes).filter((n) => n.kind === 'region');
  for (const ev of events) {
    if (ev.settledAt || !ev.location) continue;
    const segs = splitLocationPath(ev.location, worldName);
    if (!segs.length) continue;
    const region = resolveNodeIn(regions, segs[0]);
    if (!region) continue;
    const site = segs[1] ? resolveNodeIn(Object.values(data.nodes).filter((n) => n.kind === 'site' && n.parentId === region.id), segs[1]) : null;
    const target = site ?? region;
    const label = (ev.name || ev.desc || '事件').slice(0, 20);
    (out[target.id] = out[target.id] ?? []).push(label);
  }
  return out;
}
