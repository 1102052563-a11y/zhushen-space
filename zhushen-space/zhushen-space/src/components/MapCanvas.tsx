import { useMemo, useRef } from 'react';
import { MAP_CANVAS_W as W, MAP_CANVAS_H as H, type MapEdge, type MapNode } from '../systems/mapEngine';

/* 小地图 SVG 画布（照 TreeCanvas 范式：viewBox + 节点摆位 + data-node 属性 + 确定性星空背景）。
   迷雾四态渲染：传闻=虚线空心「?」/ 已探=实线空心 / 已访=青色填充 / 当前=外圈青环+呼吸光。
   宿主用 usePinchPanZoom：节点 <g> 必须带 data-node（hook 靠 closest('[data-node]') 区分点节点 vs 拖画布）。 */

const GOD = '#46e3cf';       // --c-god 青（SVG 内硬编码，口径同 TreeCanvas）
const BLOOD = '#e0445a';     // --c-blood
const GOLD = '#d8b14e';      // --c-gold
const DIM = '#8b9db2';       // --c-dim
const EDGE = '#2a3140';

const R_BY_KIND: Record<MapNode['kind'], number> = { region: 26, site : 19 };

export interface MapCanvasProps {
  nodes: MapNode[];                       // 本层节点（调用方已滤 archived）
  edges: MapEdge[];                       // 端点都应在 nodes 里（外部过滤）
  currentId?: string;                     // 主角当前所在（青环）
  selectedId?: string;                    // 面板选中（白虚环）
  eventPins?: Record<string, string[]>;   // nodeId → 未结算世界大事名
  trail?: string[];                       // 足迹（node id 序，画青色路径）
  siteCount?: Record<string, number>;     // region id → 场所数（世界层角标）
  thumbs?: Record<string, string>;        // 🧭 nodeId → 地点图 dataURL（圆形裁剪嵌进节点）
  zoom?: number;
  heightVh?: number;
  onNodeClick?: (id: string) => void;
  onNodeDblClick?: (id: string) => void;  // 世界层双击区域 → 下钻
}

export default function MapCanvas({
  nodes, edges, currentId, selectedId, eventPins, trail, siteCount, thumbs,
  zoom = 1, heightVh = 62, onNodeClick, onNodeDblClick,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // 背景星点（确定性伪随机，口径同 TreeCanvas：绝不 Math.random，防重渲抖动）
  const stars = useMemo(() => {
    let seed = (Math.floor(W * 7 + H * 13) || 1) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    return Array.from({ length: 90 }, () => ({ x: rnd() * W, y: rnd() * H, r: 0.4 + rnd() * 1.3, o: 0.1 + rnd() * 0.4 }));
  }, []);

  const trailPts = (trail ?? []).map((id) => byId.get(id)).filter(Boolean) as MapNode[];
  const trailPath = trailPts.length >= 2 ? trailPts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="select-none touch-none block mx-auto"
      style={{ height: `${heightVh * zoom}vh`, width: 'auto', maxWidth: 'none' }}
    >
      <defs>
        <radialGradient id="mapBg" cx="50%" cy="44%" r="78%">
          <stop offset="0%" stopColor="#0c1322" />
          <stop offset="60%" stopColor="#080d18" />
          <stop offset="100%" stopColor="#04060c" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#mapBg)" rx={16} />
      {stars.map((s, i) => <circle key={'st' + i} cx={s.x} cy={s.y} r={s.r} fill="#cbd5e1" opacity={s.o} />)}

      {/* 通路（隐秘=密虚线；端点是传闻=淡化长虚线） */}
      {edges.map((e, i) => {
        const a = byId.get(e.a), b = byId.get(e.b);
        if (!a || !b) return null;
        const rumor = a.status === 'rumored' || b.status === 'rumored';
        return (
          <line key={'e' + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={e.kind === 'secret' ? '#7a6a9e' : EDGE}
            strokeWidth={e.kind === 'secret' ? 1.4 : 1.7}
            strokeOpacity={rumor ? 0.45 : 0.85}
            strokeDasharray={e.kind === 'secret' ? '3 4' : rumor ? '7 5' : undefined}>
            {e.note ? <title>{e.note}</title> : null}
          </line>
        );
      })}

      {/* 足迹（最近路径·青色） */}
      {trailPath && <path d={trailPath} fill="none" stroke={GOD} strokeWidth={2.2} strokeOpacity={0.35} strokeLinejoin="round" strokeLinecap="round" />}

      {/* 节点 */}
      {nodes.map((n) => {
        const r = R_BY_KIND[n.kind];
        const isCur = n.id === currentId;
        const isSel = n.id === selectedId;
        const pins = eventPins?.[n.id];
        const dangerous = n.danger >= 4;
        const ring = dangerous ? BLOOD : n.status === 'visited' ? GOD : '#3a4150';
        return (
          <g key={n.id} data-node={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onNodeClick?.(n.id); }}
            onDoubleClick={(e) => { e.stopPropagation(); onNodeDblClick?.(n.id); }}>
            {isCur && (
              <>
                <circle r={r * 1.9} fill={GOD} opacity={0.12} />
                <circle r={r + 7} fill="none" stroke={GOD} strokeWidth={1.8} strokeOpacity={0.9} />
              </>
            )}
            {isSel && <circle r={r + 12} fill="none" stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="3 3" />}
            {thumbs?.[n.id] ? (
              <>
                {/* 🧭 地点图：圆形裁剪嵌进节点本体，迷雾状态由描边样式延续表达 */}
                <clipPath id={`mapclip-${n.id}`}><circle r={r - 1.5} /></clipPath>
                <image href={thumbs[n.id]} x={-r + 1.5} y={-r + 1.5} width={(r - 1.5) * 2} height={(r - 1.5) * 2}
                  clipPath={`url(#mapclip-${n.id})`} preserveAspectRatio="xMidYMid slice" />
                <circle r={r} fill="none" stroke={n.status === 'rumored' ? (dangerous ? BLOOD : '#64748b') : ring}
                  strokeWidth={n.status === 'visited' ? 2.4 : 1.8}
                  strokeDasharray={n.status === 'rumored' ? '5 4' : undefined} strokeOpacity={0.95} />
              </>
            ) : n.status === 'rumored' ? (
              <>
                <circle r={r} fill="none" stroke={dangerous ? BLOOD : '#64748b'} strokeWidth={1.6} strokeDasharray="5 4" strokeOpacity={0.75} />
                <text textAnchor="middle" dy={5} fontSize={15} fill={DIM} opacity={0.8}>?</text>
              </>
            ) : (
              <>
                <circle r={r} fill={n.status === 'visited' ? GOD : '#12151d'} fillOpacity={n.status === 'visited' ? 0.2 : 1} stroke={ring} strokeWidth={n.status === 'visited' ? 2.4 : 1.8} strokeOpacity={0.9} />
                {n.kind === 'region' && <text textAnchor="middle" dy={5} fontSize={14} fill={n.status === 'visited' ? GOD : DIM} opacity={0.9}>{siteCount?.[n.id] || ''}</text>}
              </>
            )}
            {/* 事件钉（未结算世界大事） */}
            {pins && pins.length > 0 && (
              <g transform={`translate(${r * 0.85},${-r * 0.85})`}>
                <circle r={8} fill="#04060c" stroke={BLOOD} strokeWidth={1.6} />
                <text textAnchor="middle" dy={4} fontSize={11} fontWeight={600} fill={BLOOD}>!</text>
                <title>{pins.join('；')}</title>
              </g>
            )}
            {/* 玩家图钉 */}
            {n.pinned && <text x={-r - 6} y={-r + 2} textAnchor="middle" fontSize={12} fill={GOLD}>★</text>}
            {/* 名称 */}
            <text textAnchor="middle" y={r + 15} fontSize={n.kind === 'region' ? 13 : 12}
              fill={n.status === 'visited' ? '#e2e8f0' : n.status === 'discovered' ? '#cbd5e1' : '#64748b'}>
              {n.name}
            </text>
            {/* 危险豆（1~5·≥4 血色） */}
            {n.danger > 0 && (
              <g transform={`translate(0,${r + 24})`}>
                {Array.from({ length: n.danger }, (_, i) => (
                  <circle key={'d' + i} cx={(i - (n.danger - 1) / 2) * 7} r={2.2}
                    fill={dangerous ? BLOOD : '#8a6d3b'} fillOpacity={0.85} />
                ))}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
