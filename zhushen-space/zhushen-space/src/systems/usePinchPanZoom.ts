import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/* 星图/技能树画布通用「平移 + 缩放」交互，桌面与手机通吃：
   - 桌面：滚轮以光标为锚缩放，空白处拖动平移
   - 手机：双指捏合以中点为锚缩放，单指拖动平移
   宿主：一个 overflow-auto 容器包住按高度 ×zoom 撑开的 SVG（TreeCanvas）。
   用法：const pz = usePinchPanZoom(); <div ref={pz.scrollRef} {...pz.bind} className="... touch-none">
        缩放按钮调 pz.zoomBy(±0.2) / pz.reset()；把 pz.zoom 传给 TreeCanvas。
   scrollRef 是回调 ref：容器挂载/卸载（如切换视图重挂）时会自动重挂滚轮监听，不怕重挂丢事件。 */
export function usePinchPanZoom(opts?: { min?: number; max?: number }) {
  const min = opts?.min ?? 0.5, max = opts?.max ?? 3;
  const [zoom, setZoom] = useState(1);
  const [grabbing, setGrabbing] = useState(false);
  const elRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const zoomAnchor = useRef<{ sl: number; st: number; cx: number; cy: number; f: number } | null>(null);
  const panRef = useRef<{ cx: number; cy: number; sl: number; st: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const wheelCleanup = useRef<(() => void) | null>(null);

  const clampZoom = (z: number) => Math.min(max, Math.max(min, +z.toFixed(3)));
  // 缩放并记录锚点（cx,cy = 容器内像素坐标），重排后在 layout effect 里校正滚动使锚点下的内容不动
  const setZoomAt = (nz: number, cx: number, cy: number) => {
    const el = elRef.current; if (!el) return;
    const z = zoomRef.current;
    nz = clampZoom(nz);
    if (nz === z) return;
    zoomAnchor.current = { sl: el.scrollLeft, st: el.scrollTop, cx, cy, f: nz / z };
    zoomRef.current = nz;
    setZoom(nz);
  };

  // 回调 ref：容器挂载时挂滚轮监听（非被动，preventDefault 阻止页面滚动），卸载/重挂时先清旧的
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    elRef.current = node;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      setZoomAt(zoomRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left, e.clientY - rect.top);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    wheelCleanup.current = () => node.removeEventListener('wheel', onWheel);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // 缩放后校正滚动位（DOM 已按新 zoom 重排），保持锚点下内容点不动
  useLayoutEffect(() => {
    const el = elRef.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.sl + a.cx) * a.f - a.cx;
    el.scrollTop = (a.st + a.cy) * a.f - a.cy;
    zoomAnchor.current = null;
  }, [zoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element)?.closest?.('[data-node]')) return;   // 点节点交给选中，不平移
    const el = elRef.current; if (!el) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件忽略 */ }
    if (pointers.current.size >= 2) {   // 第二指落下 → 进入捏合
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: zoomRef.current };
      panRef.current = null; setGrabbing(false);
      return;
    }
    panRef.current = { cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setGrabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = elRef.current; if (!el) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {   // 双指捏合缩放（锚在两指中点）
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        const rect = el.getBoundingClientRect();
        setZoomAt(pinch.current.zoom * (dist / pinch.current.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      return;
    }
    const p = panRef.current; if (!p) return;
    el.scrollLeft = p.sl - (e.clientX - p.cx);
    el.scrollTop = p.st - (e.clientY - p.cy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    try { elRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {   // 捏合抬起一指 → 剩下那指接管平移
      const el = elRef.current; const [only] = [...pointers.current.values()];
      if (el && only) panRef.current = { cx: only.x, cy: only.y, sl: el.scrollLeft, st: el.scrollTop };
    }
    if (pointers.current.size === 0) { panRef.current = null; setGrabbing(false); }
  };

  const zoomBy = (d: number) => {   // 按钮缩放锚在容器中心
    const el = elRef.current;
    setZoomAt(zoomRef.current + d, el ? el.clientWidth / 2 : 0, el ? el.clientHeight / 2 : 0);
  };
  const reset = () => {
    const el = elRef.current;
    setZoomAt(1, el ? el.clientWidth / 2 : 0, el ? el.clientHeight / 2 : 0);
  };

  return {
    scrollRef, zoom, grabbing,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp, onPointerCancel: onPointerUp },
    zoomBy, reset,
  };
}
