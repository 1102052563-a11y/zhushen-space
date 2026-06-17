import { useMemo, useRef } from 'react';
import type { TreeDef, TreeNode } from '../store/skillTreeStore';
import { treeBounds, nodeMaxRank } from '../systems/skillTree';

/* 职业技能树共享 SVG 画布：玩家面板(只读) 与 编辑器(可拖/连线) 复用。
   节点按 x/y 摆位，连线 = prereq 边；按 分支配色 + 点数(豆子)状态 着色。 */

const R_BY_KIND: Record<TreeNode['kind'], number> = { minor: 20, major: 26, capstone: 32 };

export interface TreeCanvasProps {
  tree: TreeDef;
  ranks?: Record<string, number>;    // 节点当前点数（rank≥1 即已点）
  availableIds?: Set<string>;        // 可再点一次（玩家模式发光）
  mode?: 'play' | 'edit';
  selectedId?: string;               // 编辑器选中节点
  connectFrom?: string;              // 编辑器「连线模式」起点（高亮）
  onNodeClick?: (id: string) => void;
  onNodeMove?: (id: string, x: number, y: number) => void;   // 编辑器拖动
  onBlankClick?: (x: number, y: number) => void;             // 编辑器空白处加点
  zoom?: number;                     // 缩放倍数（1=适配高度，>1 放大可滚动）
  heightVh?: number;                 // 基准高度(vh)，默认 70
  highlightConstId?: string;         // 高亮某星座（玩家面板悬停/点击）
  expressBranches?: Set<string>;     // 传承提前解锁的 branch（节点花费显 1·免阶位）
}

export default function TreeCanvas({
  tree, ranks, availableIds, mode = 'play', selectedId, connectFrom,
  onNodeClick, onNodeMove, onBlankClick, zoom = 1, heightVh = 70, highlightConstId, expressBranches,
}: TreeCanvasProps) {
  const rankOf = (id: string) => Math.max(0, Math.floor(ranks?.[id] ?? 0));
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const { w, h } = treeBounds(tree);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const branchColor = (id: string) => tree.branches.find((b) => b.id === id)?.color ?? '#64748b';

  // 背景星点（确定性伪随机，避免每次渲染抖动 / 截图卡顿）
  const stars = useMemo(() => {
    let seed = (Math.floor(w * 7 + h * 13) || 1) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const count = Math.min(140, Math.max(50, Math.round((w * h) / 8500)));
    return Array.from({ length: count }, () => ({ x: rnd() * w, y: rnd() * h, r: 0.4 + rnd() * 1.4, o: 0.12 + rnd() * 0.5 }));
  }, [w, h]);

  // client px → svg 坐标（viewBox 可能缩放）
  const toSvg = (clientX: number, clientY: number) => {
    const el = svgRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left) * (w / r.width), y: (clientY - r.top) * (h / r.height) };
  };

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    if (mode !== 'edit' || !onNodeMove) return;
    e.stopPropagation();
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* 合成事件/无效 pointerId 时忽略 */ }
    drag.current = { id, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !onNodeMove) return;
    const { x, y } = toSvg(e.clientX, e.clientY);
    drag.current.moved = true;
    onNodeMove(drag.current.id, Math.round(x), Math.round(y));
  };
  const onUp = (_e: React.PointerEvent, id: string) => {
    if (mode !== 'edit') return;       // 只读模式走 onClick，避免双触发
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (!wasDrag) onNodeClick?.(id);   // 编辑模式：没拖动=点击（选中/连线）
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      className="select-none touch-none block mx-auto"
      style={{ height: `${heightVh * zoom}vh`, width: 'auto', maxWidth: 'none' }}
      onPointerMove={onMove}
      onClick={(e) => {
        if (mode === 'edit' && onBlankClick && e.target === svgRef.current) {
          const { x, y } = toSvg(e.clientX, e.clientY);
          onBlankClick(Math.round(x), Math.round(y));
        }
      }}
    >
      {/* 星空背景 + 散落星点 */}
      <defs>
        <radialGradient id="stBg" cx="50%" cy="44%" r="78%">
          <stop offset="0%" stopColor="#0c1322" />
          <stop offset="60%" stopColor="#080d18" />
          <stop offset="100%" stopColor="#04060c" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="url(#stBg)" rx={16} />
      {stars.map((s, i) => <circle key={'st' + i} cx={s.x} cy={s.y} r={s.r} fill="#cbd5e1" opacity={s.o} />)}

      {/* 星座连线：按 nodeIds 顺序连成图案；成型/高亮 时琥珀色发光，未点亮成员标虚环 */}
      {(tree.constellations ?? []).map((cst) => {
        const pts = cst.nodeIds.map((id) => byId.get(id)).filter(Boolean) as TreeNode[];
        if (pts.length < 2) return null;
        const complete = pts.every((p) => rankOf(p.id) >= 1);
        const hl = highlightConstId === cst.id;
        const op = complete ? 0.85 : (hl ? 0.7 : 0.22);
        const ww = complete ? 2.6 : (hl ? 2.2 : 1.4);
        const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x ?? 0},${p.y ?? 0}`).join(' ');
        return (
          <g key={'cst' + cst.id} style={{ pointerEvents: 'none' }}>
            <path d={path} fill="none" stroke="#fbbf24" strokeWidth={ww} strokeOpacity={op} strokeDasharray={complete ? undefined : '6 5'} strokeLinejoin="round" />
            {(complete || hl) && pts.map((p) => (
              <circle key={'cm' + p.id} cx={p.x ?? 0} cy={p.y ?? 0} r={rankOf(p.id) >= 1 ? 4 : 10}
                fill={rankOf(p.id) >= 1 ? '#fbbf24' : 'none'} fillOpacity={0.5}
                stroke="#fbbf24" strokeWidth={1.5} strokeOpacity={rankOf(p.id) >= 1 ? 0.8 : 0.9}
                strokeDasharray={rankOf(p.id) >= 1 ? undefined : '3 3'} />
            ))}
          </g>
        );
      })}

      {/* 连线（prereq 边）*/}
      {tree.nodes.map((n) =>
        (n.prereqs ?? []).map((pid) => {
          const p = byId.get(pid); if (!p) return null;
          const lit = rankOf(n.id) >= 1 && rankOf(pid) >= 1;
          return (
            <line
              key={`${pid}-${n.id}`}
              x1={p.x ?? 0} y1={p.y ?? 0} x2={n.x ?? 0} y2={n.y ?? 0}
              stroke={lit ? branchColor(n.branch) : '#2a3140'}
              strokeWidth={lit ? 2.5 : 1.5}
              strokeOpacity={lit ? 0.9 : 0.6}
            />
          );
        }),
      )}

      {/* 节点 */}
      {tree.nodes.map((n) => {
        const r = R_BY_KIND[n.kind] ?? 20;
        const col = n.socket ? '#d946ef' : branchColor(n.branch);   // 星核位用品红
        const rank = rankOf(n.id);
        const maxR = nodeMaxRank(n);
        const unlocked = rank >= 1;
        const maxed = !n.sink && rank >= maxR;
        const avail = availableIds?.has(n.id) ?? false;   // 可再点一次
        const selected = selectedId === n.id;
        const isConnSrc = connectFrom === n.id;
        const fill = (unlocked || n.socket) ? col : '#12151d';
        const fillOpacity = n.socket ? 0.45 : (unlocked ? (maxed ? 0.95 : 0.7) : 1);
        const stroke = (unlocked || avail || isConnSrc || n.socket) ? col : '#3a4150';
        const cx = n.x ?? 0, cy = n.y ?? 0;
        return (
          <g
            key={n.id}
            data-node={n.id}
            transform={`translate(${cx},${cy})`}
            style={{ cursor: mode === 'edit' ? 'move' : (avail ? 'pointer' : 'default') }}
            onPointerDown={(e) => onNodeDown(e, n.id)}
            onPointerUp={(e) => onUp(e, n.id)}
            onClick={(e) => { e.stopPropagation(); if (mode !== 'edit') onNodeClick?.(n.id); }}
          >
            {(unlocked || avail) && <circle r={r * 1.8} fill={col} opacity={unlocked ? 0.22 : 0.1} />}
            {(selected || isConnSrc) && <circle r={r + 6} fill="none" stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="3 3" />}
            {avail && <circle r={r + 4} fill={col} fillOpacity={0.14} stroke={col} strokeOpacity={0.7} strokeWidth={1.5} />}
            <circle r={r} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={unlocked ? 3 : 2} />
            {n.socket
              ? <text textAnchor="middle" dy={6} fontSize={18} fill="#fff">◆</text>
              : n.sink
                ? <text textAnchor="middle" dy={6} fontSize={18} fill={unlocked ? '#fff' : col} opacity={unlocked ? 1 : 0.85}>∞</text>
                : n.kind === 'capstone'
                  ? <text textAnchor="middle" dy={6} fontSize={20} fill={unlocked ? '#fff' : col} opacity={unlocked ? 1 : 0.8}>★</text>
                  : maxed && <text textAnchor="middle" dy={5} fontSize={14} fill="#fff">✓</text>}
            {/* 名称 */}
            <text textAnchor="middle" y={r + 14} fontSize={12} fill={(unlocked || n.socket) ? '#e2e8f0' : (avail ? '#cbd5e1' : '#64748b')}>
              {n.name}
            </text>
            {/* 豆子：maxRank 个小圆，已点的填满；sink 显示 ∞；socket 无豆子 */}
            {n.socket ? null : n.sink
              ? <text textAnchor="middle" y={r + 28} fontSize={11} fill={rank > 0 ? col : '#64748b'}>∞ 已投 {rank}</text>
              : Array.from({ length: Math.min(maxR, 6) }, (_, i) => (
                  <circle key={'b' + i} cx={(i - (Math.min(maxR, 6) - 1) / 2) * 8} cy={r + 25} r={2.7}
                    fill={i < rank ? col : '#161b27'} stroke={i < rank ? col : '#3a4150'} strokeWidth={0.8} />
                ))}
            {/* 花费（还能再点时）；传承提前解锁的路线 → 花费 1、免阶位、标「传承」*/}
            {avail && (() => {
              const express = expressBranches?.has(n.branch) ?? false;
              return (
                <text textAnchor="middle" y={r + 40} fontSize={10} fill={express ? '#fbbf24' : '#a3e635'}>
                  潜能 {express ? 1 : n.cost}{express ? ' · 传承' : (n.tierGate ? ` · ${n.tierGate}` : '')}
                </text>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}
