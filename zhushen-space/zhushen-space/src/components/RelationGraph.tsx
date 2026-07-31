import { useEffect, useMemo, useRef, useState } from 'react';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { isPetLike } from '../systems/petEvolution';
import {
  buildRelationGraph, layoutRelationGraph, egoSubgraph,
  REL_COLOR, REL_LEGEND, tierColor, PLAYER_NODE_ID,
  type RelNode, type RelEdge,
} from '../systems/relationGraph';

/* 🕸 关系图谱 · 渲染层（纯 SVG + 内置力导向布局，零第三方图库——包体与许可证都干净）。
   数据/布局全在 systems/relationGraph.ts（纯函数·可单测），这里只管画与交互：
   - 全局图：NpcPanel 头部「🕸」→ RelationGraphModal
   - ego 图：NpcDetail 关系页，以该角色为中心取 1~2 跳邻域（Obsidian local graph 范式）
   交互：滚轮/双指缩放、拖拽平移、悬停高亮邻居、点击真实角色跳详情。 */

const SIZE = 900;              // 布局坐标空间（viewBox 单位）
const MIN_W = SIZE * 0.18;     // 缩放上限（视野最小）
const MAX_W = SIZE * 2.6;      // 缩放下限（视野最大）

const C_VOID = 'rgb(var(--c-void))';
const C_PANEL = 'rgb(var(--c-panel))';
const C_EDGE = 'rgb(var(--c-edge))';
const C_INK = 'rgb(var(--c-ink))';
const C_DIM = 'rgb(var(--c-dim))';
const C_GOD = 'rgb(var(--c-god))';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 边色：好感虚拟边按正负分色（正=暖粉 / 负=冷蓝），其余按关系类别 */
function edgeColor(e: RelEdge): string {
  if (e.favorEdge) return (e.favorVal ?? 0) >= 0 ? REL_COLOR.favor : '#38bdf8';
  return REL_COLOR[e.kind];
}

/** 悬停/点选时的说明文字：把双向关系词拼成人话 */
function edgeTitle(e: RelEdge, nameOf: (id: string) => string): string {
  if (e.favorEdge) return `${nameOf(e.a)} ↔ ${nameOf(e.b)}：好感 ${e.favorVal ?? 0}`;
  const parts: string[] = [];
  if (e.ab) parts.push(`${nameOf(e.a)} 视 ${nameOf(e.b)} 为「${e.ab}」`);
  if (e.ba) parts.push(`${nameOf(e.b)} 视 ${nameOf(e.a)} 为「${e.ba}」`);
  return parts.join('\n') || `${nameOf(e.a)} ↔ ${nameOf(e.b)}`;
}

function nodeRadius(n: RelNode, centerId: string): number {
  if (n.id === centerId) return 27;
  if (n.ghost) return 13;
  if (n.isPlayer) return 23;
  return 19;
}

export interface RelationGraphViewProps {
  centerId?: string;        // ego 图中心（缺省=全局图·主角居中）
  depth?: number;           // ego 跳数（默认 1）
  favorEdges?: boolean;     // 好感虚拟边（默认 true）
  showIsolated?: boolean;   // 显示零连线角色（默认 false）
  includePets?: boolean;    // 纳入宠物/召唤物（默认 false·它们只连主人，画进来全是毛刺）
  onlyOnScene?: boolean;    // 只看在场（大图降噪）
  includePlayer?: boolean;  // 纳入主角节点（默认 true）
  onSelect?: (id: string) => void;
  className?: string;
}

export function RelationGraphView({
  centerId, depth = 1, favorEdges = true, showIsolated = false,
  includePets = false, onlyOnScene = false, includePlayer = true,
  onSelect, className,
}: RelationGraphViewProps) {
  const npcs = useNpc((s) => s.npcs);
  const playerName = usePlayer((s) => s.profile.name);
  const playerTier = usePlayer((s) => s.profile.tier);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SIZE, h: SIZE });
  const [hoverId, setHoverId] = useState<string | null>(null);

  /* 参与建图的档案：排除无名空壳；宠物/召唤物、离场角色按开关过滤。
     中心角色永远保留（否则点开一只宠物的关系页会得到空图）。 */
  const records = useMemo(() => Object.values(npcs).filter((r) => {
    if (!r || !hasRealNpcName(r)) return false;
    if (r.id === centerId) return true;
    if (!includePets && isPetLike(r)) return false;
    if (onlyOnScene && (!r.onScene || r.archived)) return false;
    return true;
  }), [npcs, centerId, includePets, onlyOnScene]);

  const full = useMemo(
    () => buildRelationGraph(records, { playerName, playerTier, favorEdges, showIsolated, centerId }),
    [records, playerName, playerTier, favorEdges, showIsolated, centerId],
  );

  const graph = useMemo(() => {
    const g = centerId ? egoSubgraph(full, centerId, depth) : full;
    if (includePlayer) return g;
    const nodes = g.nodes.filter((n) => n.id !== PLAYER_NODE_ID);
    return { nodes, edges: g.edges.filter((e) => e.a !== PLAYER_NODE_ID && e.b !== PLAYER_NODE_ID) };
  }, [full, centerId, depth, includePlayer]);

  const pos = useMemo(
    () => layoutRelationGraph(graph.nodes, graph.edges, SIZE, centerId),
    [graph, centerId],
  );

  const nameOf = useMemo(() => {
    const m = new Map(graph.nodes.map((n) => [n.id, n.name]));
    return (id: string) => m.get(id) ?? id;
  }, [graph]);

  /* 悬停降噪：只把与悬停节点直接相连的节点/边保持高亮 */
  const near = useMemo(() => {
    if (!hoverId) return null;
    const s = new Set<string>([hoverId]);
    for (const e of graph.edges) {
      if (e.a === hoverId) s.add(e.b);
      if (e.b === hoverId) s.add(e.a);
    }
    return s;
  }, [hoverId, graph]);

  /* 滚轮缩放：必须原生非被动监听才能 preventDefault（否则页面跟着滚） */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      setVb((v) => {
        const nw = clamp(v.w * (e.deltaY > 0 ? 1.14 : 1 / 1.14), MIN_W, MAX_W);
        const nh = nw;
        return { x: v.x + (v.w - nw) * px, y: v.y + (v.h - nh) * py, w: nw, h: nh };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  /* 拖拽平移 + 双指捏合（手机）：pointer 事件统一处理 */
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const toViewUnits = (dxPx: number, dyPx: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return { dx: 0, dy: 0 };
    return { dx: (dxPx / rect.width) * vb.w, dy: (dyPx / rect.height) * vb.h };
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y) || null;
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const base = pinch.current;
      if (base && dist > 0) {
        pinch.current = dist;
        setVb((v) => {
          const nw = clamp(v.w * (base / dist), MIN_W, MAX_W);
          return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nw) / 2, w: nw, h: nw };
        });
      }
      return;
    }
    const { dx, dy } = toViewUnits(e.clientX - prev.x, e.clientY - prev.y);
    if (!dx && !dy) return;
    setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  }

  function endPointer(e: React.PointerEvent<SVGSVGElement>) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
  }

  if (graph.nodes.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-edge bg-void/60 text-[13px] font-mono text-dim/50 ${className ?? 'h-[320px]'}`}>
        暂无可绘制的关系连线
      </div>
    );
  }

  const dragging = ptrs.current.size > 0;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-edge bg-void/60 ${className ?? 'h-[320px]'}`}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={`w-full h-full touch-none select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
      >
        <defs>
          {graph.nodes.filter((n) => n.record?.avatar).map((n) => (
            <clipPath key={n.id} id={`rg-clip-${n.id.replace(/[^\w]/g, '_')}`}>
              <circle cx={0} cy={0} r={nodeRadius(n, centerId ?? PLAYER_NODE_ID) - 2} />
            </clipPath>
          ))}
        </defs>

        {/* 连线（先画，压在节点下） */}
        <g>
          {graph.edges.map((e, i) => {
            const pa = pos[e.a], pb = pos[e.b];
            if (!pa || !pb) return null;
            const faded = near ? !(near.has(e.a) && near.has(e.b)) : false;
            const col = edgeColor(e);
            return (
              <g key={`${e.a}|${e.b}|${e.favorEdge ? 'f' : 'r'}|${i}`} opacity={faded ? 0.12 : 1}>
                <title>{edgeTitle(e, nameOf)}</title>
                <line
                  x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke={col}
                  strokeWidth={e.favorEdge ? 1.6 : 2.4}
                  strokeOpacity={e.favorEdge ? 0.45 : 0.75}
                  strokeDasharray={e.favorEdge ? '5 6' : undefined}
                  strokeLinecap="round"
                />
                {/* 小图才直接标关系词，大图靠悬停 tooltip，免得糊成一片 */}
                {!e.favorEdge && graph.nodes.length <= 14 && (e.ab || e.ba) && (
                  <text
                    x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 5}
                    textAnchor="middle" fontSize={13} fill={col} fillOpacity={0.85}
                    style={{ pointerEvents: 'none' }}
                  >
                    {(e.ab || e.ba)!.slice(0, 6)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* 节点 */}
        <g>
          {graph.nodes.map((n) => {
            const p = pos[n.id];
            if (!p) return null;
            const r = nodeRadius(n, centerId ?? PLAYER_NODE_ID);
            const faded = near ? !near.has(n.id) : false;
            const stroke = n.ghost ? C_EDGE : n.isPlayer ? C_GOD : tierColor(n.tierIdx);
            const clickable = !!n.record && !!onSelect;
            const label = (n.name || n.id).split('|')[0].trim();
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={faded ? 0.2 : n.isDead ? 0.55 : 1}
                className={clickable ? 'cursor-pointer' : undefined}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                onClick={() => { if (n.record && onSelect) onSelect(n.id); }}
              >
                <title>
                  {`${label}${n.isPlayer ? '（你）' : ''}${n.ghost ? '（仅被提及·无档案）' : ''}`
                    + `${n.record?.realm ? `\n${n.record.realm}` : ''}`
                    + `${n.isDead ? '\n已死亡' : ''}`
                    + `${!n.isPlayer && !n.ghost ? `\n好感 ${n.favor ?? 0}` : ''}`}
                </title>
                <circle
                  r={r}
                  fill={n.isPlayer ? C_PANEL : C_VOID}
                  stroke={stroke}
                  strokeWidth={n.id === centerId || n.isPlayer ? 3 : 2}
                  strokeDasharray={n.ghost ? '4 4' : undefined}
                />
                {n.record?.avatar
                  ? (
                    <image
                      href={n.record.avatar}
                      x={-(r - 2)} y={-(r - 2)} width={(r - 2) * 2} height={(r - 2) * 2}
                      clipPath={`url(#rg-clip-${n.id.replace(/[^\w]/g, '_')})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  )
                  : (
                    <text
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={n.ghost ? 12 : 15}
                      fill={n.isPlayer ? C_GOD : C_INK}
                      style={{ pointerEvents: 'none' }}
                    >
                      {label.slice(0, n.ghost ? 1 : 2)}
                    </text>
                  )}
                {n.onScene && !n.isPlayer && (
                  <circle cx={r * 0.72} cy={-r * 0.72} r={4} fill="#4ade80" stroke={C_VOID} strokeWidth={1.5} />
                )}
                {n.isDead && (
                  <text x={r * 0.7} y={-r * 0.6} fontSize={13} textAnchor="middle" style={{ pointerEvents: 'none' }}>☠</text>
                )}
                <text
                  y={r + 15} textAnchor="middle" fontSize={13}
                  fill={n.isPlayer ? C_GOD : C_INK} fillOpacity={n.ghost ? 0.5 : 0.9}
                  style={{ pointerEvents: 'none' }}
                >
                  {label.length > 7 ? `${label.slice(0, 6)}…` : label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* 重置视图 */}
      <button
        onClick={() => setVb({ x: 0, y: 0, w: SIZE, h: SIZE })}
        title="重置视图"
        className="absolute right-2 top-2 px-2 py-1 rounded-lg border border-edge bg-void/80 text-[12px] font-mono text-dim/60 hover:text-god hover:border-god/40 transition-colors"
      >
        ⤢ 复位
      </button>
    </div>
  );
}

/** 关系图例（六类关系 + 好感虚拟边） */
export function RelationLegend({ favorEdges }: { favorEdges?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-mono text-dim/60">
      {REL_LEGEND.map((l) => (
        <span key={l.kind} className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: REL_COLOR[l.kind] }} />
          {l.label}
        </span>
      ))}
      {favorEdges && (
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 rounded-full opacity-60" style={{ background: REL_COLOR.favor }} />
          好感 ≥60
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full border border-dashed" style={{ borderColor: C_DIM }} />
        仅被提及
      </span>
    </div>
  );
}

/** 全局关系图谱弹窗（NpcPanel 头部「🕸」入口） */
export default function RelationGraphModal({
  onClose, onSelect, initialCenterId,
}: { onClose: () => void; onSelect?: (id: string) => void; initialCenterId?: string }) {
  const [favorEdges, setFavorEdges] = useState(true);
  const [onlyOnScene, setOnlyOnScene] = useState(false);
  const [includePets, setIncludePets] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  const npcCount = useNpc((s) => Object.keys(s.npcs).length);

  const Toggle = ({ on, set, label, title }: { on: boolean; set: (v: boolean) => void; label: string; title: string }) => (
    <button
      onClick={() => set(!on)}
      title={title}
      className={`px-2 py-1 rounded-lg border text-[12px] font-mono transition-colors ${
        on ? 'border-god/40 text-god bg-god/10' : 'border-edge text-dim/50 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_80px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🕸</span>
          <div>
            <div className="text-sm font-bold text-slate-100">关系图谱</div>
            <div className="text-[12px] font-mono text-dim/60">档案 {npcCount} · 滚轮/双指缩放 · 拖拽平移 · 点击角色查看档案</div>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-edge text-dim hover:text-blood hover:border-blood/40 transition-colors text-sm"
          >✕</button>
        </header>

        <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-edge bg-panel">
          <Toggle on={favorEdges} set={setFavorEdges} label="好感边" title="把 |好感|≥60 的角色与主角连一条虚线" />
          <Toggle on={onlyOnScene} set={setOnlyOnScene} label="只看在场" title="只画当前在场角色（大图降噪）" />
          <Toggle on={includePets} set={setIncludePets} label="含宠物" title="纳入宠物/召唤物（它们通常只连主人）" />
          <Toggle on={showIsolated} set={setShowIsolated} label="含孤立" title="显示没有任何关系连线的角色" />
        </div>

        <div className="flex-1 min-h-0 p-3">
          <RelationGraphView
            centerId={initialCenterId}
            depth={2}
            favorEdges={favorEdges}
            onlyOnScene={onlyOnScene}
            includePets={includePets}
            showIsolated={showIsolated}
            onSelect={onSelect}
            className="w-full h-full"
          />
        </div>

        <div className="shrink-0 px-4 py-2 border-t border-edge bg-panel">
          <RelationLegend favorEdges={favorEdges} />
        </div>
      </div>
    </div>
  );
}

/** 详情页内嵌的 ego 局部图（以该角色为中心的 1 跳邻域） */
export function RelationEgoGraph({ npc, onSelect }: { npc: NpcRecord; onSelect?: (id: string) => void }) {
  const [depth, setDepth] = useState(1);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 p-0.5 bg-void rounded-lg border border-edge">
          {[1, 2].map((d) => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              title={`显示 ${d} 跳以内的关系`}
              className={`px-2 py-0.5 rounded text-[12px] font-mono transition-colors ${
                depth === d ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'
              }`}
            >{d} 跳</button>
          ))}
        </div>
        <div className="flex-1" />
        <RelationLegend />
      </div>
      <RelationGraphView
        centerId={npc.id}
        depth={depth}
        includePets
        onSelect={onSelect}
        className="h-[300px] sm:h-[380px]"
      />
    </div>
  );
}
