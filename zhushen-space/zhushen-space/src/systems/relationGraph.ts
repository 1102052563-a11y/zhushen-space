import type { NpcRecord } from '../store/npcStore';
import { TIERS, normalizeTier } from './derivedStats';

/* 🕸 NPC 关系网图谱 —— 纯数据层（解析 + 确定性力导向布局），渲染在 components/RelationGraph.tsx。
   数据源：NpcRecord.relations 扁平串「目标:关系;目标:关系」。目标两种写法都存在：
   - ID 直指（C2:宿敌 / B1:旧识）—— AI 演化按列13格式写的；
   - 姓名直书（张三:盟友）—— 轨道A 的 addRelation 按姓名写（宿敌/盟友/联姻），dispatchEngine 也按姓名读。
   两种都解析；解析不到的短名保留为「悬空 ghost 节点」（角色可能已死/被并档，仍是叙事线索），
   像句子的长目标（>12 字）直接丢弃。纯函数无 store 依赖 → 可单测。 */

export type RelKind = 'enemy' | 'ally' | 'love' | 'kin' | 'lord' | 'other' | 'favor';

export const REL_COLOR: Record<RelKind, string> = {
  enemy: '#f87171',   // 宿敌/敌对
  ally:  '#4ade80',   // 盟友/同门
  love:  '#f472b6',   // 情缘/联姻
  kin:   '#fbbf24',   // 亲缘
  lord:  '#22d3ee',   // 主从/师徒
  other: '#94a3b8',
  favor: '#fb7185',   // 好感虚拟边（负值渲染层换 #38bdf8）
};

export const REL_LEGEND: { kind: RelKind; label: string }[] = [
  { kind: 'enemy', label: '宿敌' },
  { kind: 'ally',  label: '盟友' },
  { kind: 'love',  label: '情缘' },
  { kind: 'kin',   label: '亲缘' },
  { kind: 'lord',  label: '主从' },
  { kind: 'other', label: '其他' },
];

/* 关键词归类：顺序即优先级（宿敌含「敌」必须最先；师兄弟=同门先于「师/徒」的主从；
   「弟子/爱徒」在主从表里显式列出，避免被亲缘的「弟」抢走）。尽力而为的着色，认不出=other。 */
const KIND_RULES: [RelKind, RegExp][] = [
  ['enemy', /宿敌|死敌|仇|敌|恨|对头|叛/],
  ['ally',  /师兄|师姐|师弟|师妹|同门/],
  ['lord',  /师父|师尊|师傅|恩师|徒弟|弟子|爱徒|主人|主上|旧主|仆|侍|随从|部下|下属|上司|首领|老板|领主|君臣/],
  ['kin',   /父|母|兄|弟|姐|妹|儿|女儿|孩子|家人|血亲|亲人|族|祖|叔|姑|舅|婶|甥|侄|堂|表/],
  ['love',  /联姻|道侣|夫|妻|恋|情人|情侣|爱|倾心|暧昧|伴侣|未婚/],
  ['ally',  /盟|友|同伴|伙伴|队友|同僚|战友|合作|恩人|信赖/],
];

export function classifyRelation(label: string): RelKind {
  for (const [kind, re] of KIND_RULES) if (re.test(label)) return kind;
  return 'other';
}

/* 双向关系词归类不一致时（A→B 宿敌、B→A 忌惮）取「更强」的一类做边色 */
const KIND_PRIORITY: RelKind[] = ['enemy', 'love', 'kin', 'lord', 'ally', 'other'];
function strongerKind(a: RelKind, b: RelKind): RelKind {
  return KIND_PRIORITY.indexOf(a) <= KIND_PRIORITY.indexOf(b) ? a : b;
}

/* 姓名归一（与 characterStore 的 normNm 同法）：去空白/标点/分隔符 + 小写，仅做相等匹配不做包含 */
function norm(s?: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
}

export const PLAYER_NODE_ID = 'B1';

export interface RelNode {
  id: string;            // B1 / C1 / ghost:<归一名>
  name: string;
  tierIdx: number;       // TIERS 下标 0~13；认不出 = -1
  isPlayer?: boolean;
  isDead?: boolean;
  onScene?: boolean;
  favor?: number;
  ghost?: boolean;       // 档案里不存在的悬空引用
  record?: NpcRecord;    // 真实档案（跳转 NpcDetail 用）；player/ghost 无
}

export interface RelEdge {
  a: string;             // 节点 id，字典序 a < b
  b: string;
  ab?: string;           // a→b 的关系词（a 视 b 为…）
  ba?: string;           // b→a 的关系词
  kind: RelKind;
  favorEdge?: boolean;   // 好感虚拟边（B1↔NPC，|favor|≥阈值）
  favorVal?: number;
}

export interface RelationGraphOpts {
  playerName: string;
  playerTier?: string;
  favorEdges?: boolean;      // 好感虚拟边开关（默认 true）
  favorThreshold?: number;   // 默认 60（与 favorCls 的「亲密/敌视」档一致）
  showIsolated?: boolean;    // 显示没有任何连线的角色（默认 false）
}

export function buildRelationGraph(
  records: NpcRecord[],
  opts: RelationGraphOpts,
): { nodes: RelNode[]; edges: RelEdge[] } {
  const favorEdges = opts.favorEdges ?? true;
  const favorThreshold = opts.favorThreshold ?? 60;
  const showIsolated = opts.showIsolated ?? false;
  const tierIdxOf = (realm?: string) => (TIERS as readonly string[]).indexOf(normalizeTier(realm));

  const nodeMap = new Map<string, RelNode>();
  nodeMap.set(PLAYER_NODE_ID, {
    id: PLAYER_NODE_ID,
    name: opts.playerName || '主角',
    tierIdx: tierIdxOf(opts.playerTier),
    isPlayer: true,
  });

  const byId = new Map<string, NpcRecord>();
  const byName = new Map<string, string>();   // 归一名 → npc id（首个同名者赢，与撞名合并语义一致）
  for (const r of records) {
    if (!r || r.id === PLAYER_NODE_ID) continue;
    byId.set(r.id, r);
    const nm = norm(r.name);
    if (nm && !byName.has(nm)) byName.set(nm, r.id);
    nodeMap.set(r.id, {
      id: r.id,
      name: r.name || r.id,
      tierIdx: tierIdxOf(r.realm),
      isDead: !!r.isDead,
      onScene: !!r.onScene && !r.archived,
      favor: r.favor ?? 0,
      record: r,
    });
  }

  const edgeMap = new Map<string, RelEdge>();
  const putRel = (from: string, to: string, label: string) => {
    if (from === to) return;   // 自引用丢弃
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = `${a}|${b}`;
    let e = edgeMap.get(key);
    if (!e) { e = { a, b, kind: 'other' }; edgeMap.set(key, e); }
    if (from === a) e.ab = label; else e.ba = label;
    const kinds: RelKind[] = [];
    if (e.ab) kinds.push(classifyRelation(e.ab));
    if (e.ba) kinds.push(classifyRelation(e.ba));
    e.kind = kinds.reduce(strongerKind);
  };

  const playerNm = norm(opts.playerName);
  const resolveTarget = (tid: string): string | null => {
    if (tid === PLAYER_NODE_ID) return PLAYER_NODE_ID;
    if (byId.has(tid)) return tid;
    const nm = norm(tid);
    if (!nm) return null;
    if (playerNm && nm === playerNm) return PLAYER_NODE_ID;   // AI 偶尔直书主角名
    const hit = byName.get(nm);
    if (hit) return hit;
    if (tid.length > 12) return null;   // 像句子的悬空目标 → 丢弃
    const gid = `ghost:${nm}`;
    if (!nodeMap.has(gid)) nodeMap.set(gid, { id: gid, name: tid, tierIdx: -1, ghost: true });
    return gid;
  };

  for (const r of records) {
    if (!r || r.id === PLAYER_NODE_ID) continue;
    const raw = typeof r.relations === 'string' ? r.relations : '';
    if (!raw) continue;
    for (const pair of raw.split(/[;；\n]+/)) {
      const p = pair.trim();
      if (!p || /\[object Object\]/i.test(p)) continue;
      const ci = p.search(/[:：]/);
      if (ci <= 0) continue;   // 无目标的自由描述行，图上不画
      const tid = p.slice(0, ci).trim();
      const label = p.slice(ci + 1).trim();
      if (!tid || !label) continue;
      const to = resolveTarget(tid);
      if (!to) continue;
      putRel(r.id, to, label);
    }
  }

  // 好感虚拟边：|favor|≥阈值 才连（全量连成星形只会糊成一团）
  if (favorEdges) {
    for (const r of records) {
      if (!r || r.id === PLAYER_NODE_ID) continue;
      const f = r.favor ?? 0;
      if (Math.abs(f) < favorThreshold) continue;
      const [a, b] = PLAYER_NODE_ID < r.id ? [PLAYER_NODE_ID, r.id] : [r.id, PLAYER_NODE_ID];
      edgeMap.set(`${a}|${b}|favor`, { a, b, kind: 'favor', favorEdge: true, favorVal: f });
    }
  }

  // 稳定排序（布局确定性依赖节点/边的遍历顺序）
  const edges = [...edgeMap.values()].sort((x, y) =>
    `${x.a}|${x.b}|${x.favorEdge ? 'f' : ''}`.localeCompare(`${y.a}|${y.b}|${y.favorEdge ? 'f' : ''}`));
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const nodes = [...nodeMap.values()]
    .filter((n) => n.isPlayer || showIsolated || (degree.get(n.id) ?? 0) > 0)
    .sort((x, y) => (x.isPlayer ? -1 : y.isPlayer ? 1 : x.id.localeCompare(y.id)));
  const keep = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => keep.has(e.a) && keep.has(e.b)) };
}

/* ── 确定性力导向布局（Fruchterman-Reingold 简化版）──
   种子来自节点 id 集合 → 同一批角色两次打开图不跳位；主角钉死画布中心。
   n≈几十为常态，O(n²·iters) 一次性算完（useMemo），n>150 时降迭代数兜底。 */
export interface LayoutPoint { x: number; y: number }

export function layoutRelationGraph(nodes: RelNode[], edges: RelEdge[], size: number): Record<string, LayoutPoint> {
  const pos: Record<string, LayoutPoint> = {};
  const n = nodes.length;
  if (n === 0) return pos;
  const cx = size / 2, cy = size / 2;

  let seed = 2166136261 >>> 0;
  for (const nd of nodes) for (let i = 0; i < nd.id.length; i++) {
    seed ^= nd.id.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  seed = (seed || 1) >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const others = nodes.filter((nd) => !nd.isPlayer);
  others.forEach((nd, i) => {
    const ang = (i / Math.max(1, others.length)) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const rr = size * (0.2 + 0.18 * rnd());
    pos[nd.id] = { x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr };
  });
  for (const nd of nodes) if (nd.isPlayer) pos[nd.id] = { x: cx, y: cy };

  const k = (size / Math.sqrt(Math.max(2, n))) * 0.7;
  const pad = 56;
  let t = size * 0.11;
  const iters = n > 150 ? 130 : 240;
  const disp = new Map<string, { x: number; y: number }>();

  for (let it = 0; it < iters; it++) {
    for (const nd of nodes) disp.set(nd.id, { x: 0, y: 0 });
    // 斥力：所有点两两相斥
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pa = pos[nodes[i].id], pb = pos[nodes[j].id];
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = dx * dx + dy * dy + 0.01; }
        const rep = (k * k) / d2;
        const da = disp.get(nodes[i].id)!, db = disp.get(nodes[j].id)!;
        da.x += dx * rep; da.y += dy * rep;
        db.x -= dx * rep; db.y -= dy * rep;
      }
    }
    // 引力：有边的互相拉近（好感虚拟边弱一档，别把高好感全吸到主角脸上）
    for (const e of edges) {
      const pa = pos[e.a], pb = pos[e.b];
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x, dy = pa.y - pb.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const att = (d / k) * (e.favorEdge ? 0.35 : 1);
      const da = disp.get(e.a)!, db = disp.get(e.b)!;
      da.x -= dx * att; da.y -= dy * att;
      db.x += dx * att; db.y += dy * att;
    }
    // 向心：不连通的小团不飘出画布
    for (const nd of nodes) {
      const p = pos[nd.id], d = disp.get(nd.id)!;
      d.x += (cx - p.x) * 0.045;
      d.y += (cy - p.y) * 0.045;
    }
    // 施加位移（限幅 t 退火）；主角钉死中心
    for (const nd of nodes) {
      if (nd.isPlayer) continue;
      const p = pos[nd.id], d = disp.get(nd.id)!;
      const dl = Math.sqrt(d.x * d.x + d.y * d.y) || 1e-6;
      const step = Math.min(dl, t);
      p.x = Math.min(size - pad, Math.max(pad, p.x + (d.x / dl) * step));
      p.y = Math.min(size - pad, Math.max(pad, p.y + (d.y / dl) * step));
    }
    t = Math.max(1.5, t * 0.96);
  }
  for (const id of Object.keys(pos)) {
    pos[id] = { x: Math.round(pos[id].x * 10) / 10, y: Math.round(pos[id].y * 10) / 10 };
  }
  return pos;
}

/* 节点描边色：14 阶各取 index.css tier-fx 渐变的中间色（SVG stroke 用不了文字渐变） */
const TIER_NODE_COLOR: string[] = [
  '#d8cfae', '#94a3b8', '#34d399', '#059669', '#2dd4bf', '#22d3ee', '#38bdf8',
  '#0ea5e9', '#0284c7', '#f59e0b', '#d97706', '#a855f7', '#f97316', '#fbbf24',
];
export function tierColor(tierIdx: number): string {
  return TIER_NODE_COLOR[tierIdx] ?? '#64748b';
}
