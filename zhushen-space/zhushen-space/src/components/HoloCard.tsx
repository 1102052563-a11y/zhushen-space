import { useRef, useId, useEffect, type CSSProperties } from 'react';
import {
  type HoloFoil, foilForGrade, foilForTier,
  GRAIN_URI, GLIT_URI, shineCss, cardBg, frameSvg, artClass,
} from '../systems/holoFoils';

export interface HoloCardProps {
  img?: string;             // 立绘（铺满整卡；缺省显示占位）
  name?: string;            // 名字 → 艺术字
  badge?: string;           // 角标（阶位/品级文字）
  grade?: string;           // 物品品级（item.gradeDesc）→ 解析箔纸
  tier?: string;            // 人物阶位（npc.realm）→ 解析箔纸
  foil?: HoloFoil;          // 显式箔纸（优先于 grade/tier）
  width?: number;           // px（高按 5:7 派生，除非给 height）
  height?: number;
  nameSize?: number;
  showName?: boolean;       // 默认 true
  power?: { label?: string; value: string };   // 顶部右侧「HP 位」徽标（人物=生物强度）
  rows?: { label: string; value: string }[];    // 底部信息面板（人物=六维 / 物品=加成）；空则不显示
  mode?: 'hover' | 'drag' | 'static';  // hover=悬停倾斜 / drag=拖动旋转 / static=不动
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** 全息卡：立绘铺满 + 箔纸/磨砂/反光 + 金雕卡框 + 艺术字名。箔纸由 grade/tier/foil 决定。 */
export default function HoloCard({
  img, name, badge, grade, tier, foil: foilProp,
  width = 220, height, nameSize, showName = true, power, rows, mode = 'hover', onClick, className, style,
}: HoloCardProps) {
  const foil: HoloFoil = foilProp ?? (grade ? foilForGrade(grade) : tier ? foilForTier(tier) : foilForGrade('白色'));
  const w = width, h = height ?? Math.round(width * 7 / 5);
  const uid = useId().replace(/[^a-z0-9]/gi, '');
  const cardRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const glitRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<HTMLDivElement>(null);

  const shine = shineCss(foil);
  const baseShineOp = 0.2 + foil.rich * 0.03;
  const autoSweep = foil.rich >= 2 && foil.pattern !== 'burst';

  useEffect(() => {
    const card = cardRef.current;
    if (!card || mode === 'static') return;
    const sh = shineRef.current, gl = glitRef.current, ga = glareRef.current, sp = specRef.current;
    const applyHolo = (lx: number, ly: number, mag: number) => {
      if (sh) { sh.style.animation = 'none'; sh.style.backgroundPosition = `${lx}% ${ly}%`; sh.style.opacity = String(baseShineOp + mag * 0.32); }
      if (gl) { gl.style.transform = `translate(${(lx - 50) * 0.4}px,${(ly - 50) * 0.4}px)`; gl.style.opacity = String(0.14 + mag * 0.4); }
      if (ga) ga.style.background = `radial-gradient(circle at ${lx}% ${ly}%, rgba(255,250,235,.5), rgba(255,255,255,0) 46%)`;
      if (sp) { sp.style.backgroundPosition = `${100 - lx}% ${100 - ly}%`; sp.style.opacity = String(0.16 + mag * 0.28); }
    };
    const reset = () => {
      if (sh) { sh.style.backgroundPosition = ''; sh.style.opacity = String(baseShineOp); sh.style.animation = autoSweep ? `holoSweep ${(4.4 - foil.rich * 0.5)}s linear infinite` : 'none'; }
      if (gl) { gl.style.transform = ''; gl.style.opacity = '0.14'; }
      if (ga) ga.style.background = 'none';
      if (sp) { sp.style.backgroundPosition = ''; sp.style.opacity = '0.16'; }
    };

    if (mode === 'hover') {
      const move = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        const mag = Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2);
        card.style.transition = 'transform .05s';
        card.style.transform = `rotateX(${(py - 0.5) * -18}deg) rotateY(${(px - 0.5) * 18}deg) scale(1.04)`;
        applyHolo(px * 100, py * 100, mag);
      };
      const leave = () => { card.style.transition = 'transform .5s ease-out'; card.style.transform = ''; reset(); };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerleave', leave);
      return () => { card.removeEventListener('pointermove', move); card.removeEventListener('pointerleave', leave); };
    }

    // mode === 'drag'
    const st = { rx: -4, ry: 10, drag: false, sx: 0, sy: 0, srx: 0, sry: 0, interacted: false };
    let raf = 0;
    const apply = () => {
      st.rx = Math.max(-72, Math.min(72, st.rx));
      card.style.transform = `rotateX(${st.rx}deg) rotateY(${st.ry}deg)`;
      const lx = Math.max(0, Math.min(100, 50 + st.ry * 0.95)), ly = Math.max(0, Math.min(100, 50 - st.rx * 0.95));
      applyHolo(lx, ly, Math.min(1, (Math.abs(st.rx) + Math.abs(st.ry)) / 80));
    };
    const sway = (t: number) => { if (st.interacted) return; st.rx = -4 + Math.sin(t / 1700) * 6; st.ry = 10 + Math.sin(t / 1300) * 13; apply(); raf = requestAnimationFrame(sway); };
    const tween = () => {
      const s0 = st.rx, s1 = st.ry; let start: number | null = null;
      const step = (t: number) => { if (start === null) start = t; const k = Math.min(1, (t - start) / 500); const e = 1 - Math.pow(1 - k, 3); st.rx = s0 + (-4 - s0) * e; st.ry = s1 + (10 - s1) * e; apply(); if (k < 1 && !st.drag) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const down = (e: PointerEvent) => { st.drag = true; st.interacted = true; cancelAnimationFrame(raf); st.sx = e.clientX; st.sy = e.clientY; st.srx = st.rx; st.sry = st.ry; card.style.transition = 'none'; card.style.cursor = 'grabbing'; try { card.setPointerCapture(e.pointerId); } catch { /* noop */ } };
    const move = (e: PointerEvent) => { if (!st.drag) return; st.ry = st.sry + (e.clientX - st.sx) * 0.42; st.rx = st.srx - (e.clientY - st.sy) * 0.42; apply(); };
    const up = () => { if (!st.drag) return; st.drag = false; card.style.cursor = 'grab'; tween(); };
    card.style.cursor = 'grab';
    apply();
    raf = requestAnimationFrame(sway);
    card.addEventListener('pointerdown', down);
    card.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { cancelAnimationFrame(raf); card.removeEventListener('pointerdown', down); card.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [mode, foil, autoSweep, baseShineOp]);

  const layer: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };
  const chipStyle: CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: Math.max(9, Math.round(w * 0.05)), fontWeight: 500, padding: '1px 8px', borderRadius: 6, background: 'rgba(10,6,14,.72)', color: foil.a1, border: `0.5px solid ${foil.a2}`, alignSelf: 'flex-start', whiteSpace: 'nowrap' };
  const tcg = !!(power || (rows && rows.length));
  return (
    <div ref={cardRef} className={className}
      onClick={onClick}
      style={{
        position: 'relative', width: w, height: h, borderRadius: 16, overflow: 'hidden',
        transformStyle: 'preserve-3d', background: cardBg(foil), border: `2px solid ${foil.a2}`,
        boxShadow: foil.rich >= 3 ? `0 10px 24px rgba(0,0,0,.5), 0 0 16px ${foil.accent}55` : '0 10px 20px rgba(0,0,0,.45)',
        transition: 'transform .3s ease-out', cursor: onClick ? 'zoom-in' : undefined, ...style,
      }}>
      {img
        ? <img src={img} alt={name ?? ''} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ ...layer, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(w * 0.3), opacity: 0.16 }}>👤</div>}
      <div style={{ ...layer, backgroundImage: GRAIN_URI, backgroundSize: 'cover', mixBlendMode: 'soft-light', opacity: 0.16 }} />
      <div ref={shineRef} style={{ ...layer, mixBlendMode: 'overlay', backgroundImage: shine.backgroundImage, backgroundSize: shine.backgroundSize, filter: 'contrast(1.1) saturate(1.35)', opacity: baseShineOp, animation: autoSweep ? `holoSweep ${(4.4 - foil.rich * 0.5)}s linear infinite` : undefined }} />
      <div ref={glitRef} style={{ position: 'absolute', inset: '-14%', width: '128%', height: '128%', pointerEvents: 'none', backgroundImage: GLIT_URI, backgroundSize: 'cover', mixBlendMode: 'color-dodge', opacity: 0.14 }} />
      <div style={layer} dangerouslySetInnerHTML={{ __html: frameSvg(foil, uid) }} />
      <div ref={glareRef} style={{ ...layer, mixBlendMode: 'overlay' }} />
      <div ref={specRef} style={{ ...layer, mixBlendMode: 'soft-light', backgroundImage: 'linear-gradient(102deg,transparent 38%,rgba(255,250,235,.5) 48%,rgba(255,250,235,.08) 53%,transparent 68%)', backgroundSize: '250% 250%', opacity: 0.16 }} />
      {!tcg && showName && name && (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', pointerEvents: 'none', background: 'linear-gradient(transparent, rgba(6,8,16,.72))' }} />
          <div style={{ position: 'absolute', left: 6, right: 6, bottom: badge ? 16 : 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, pointerEvents: 'none' }}>
            <div className={`artname ${artClass(foil)}`} style={{ fontSize: nameSize ?? Math.max(15, Math.round(w * 0.17)), maxWidth: '100%', overflow: 'hidden' }}>{name}</div>
            {badge && <span style={{ ...chipStyle, alignSelf: 'center' }}>{badge}</span>}
          </div>
        </>
      )}
      {tcg && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '32%', pointerEvents: 'none', background: 'linear-gradient(rgba(3,5,11,.92), rgba(3,5,11,.4) 52%, transparent)' }} />
          <div style={{ position: 'absolute', top: 6, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              {name && <div className={`artname ${artClass(foil)}`} style={{ fontSize: nameSize ?? Math.max(13, Math.round(w * 0.1)), maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>}
              {badge && <span style={chipStyle}>{badge}</span>}
            </div>
            {power && (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, fontFamily: 'var(--font-mono, monospace)', fontSize: Math.max(11, Math.round(w * 0.058)), fontWeight: 700, color: foil.a1, background: 'rgba(10,6,14,.8)', border: `1px solid ${foil.a2}`, borderRadius: 7, padding: '2px 7px', maxWidth: '58%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {power.label && <span style={{ fontSize: '0.72em', fontWeight: 500, opacity: 0.85 }}>{power.label}</span>}{power.value}
              </span>
            )}
          </div>
          {rows && rows.length > 0 && w >= 158 && (
            <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, pointerEvents: 'none' }}>
              <div style={{ background: 'rgba(8,8,14,.64)', border: `1px solid ${foil.a2}`, borderRadius: 10, padding: '7px 8px', display: 'flex', flexWrap: 'wrap', gap: '5px 6px' }}>
                {rows.map((r, i) => (
                  <span key={i} style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: '#e9e3d5', background: 'rgba(255,255,255,.06)', borderRadius: 5, padding: '2px 7px' }}>
                    <span style={{ color: foil.a1, marginRight: 4 }}>{r.label}</span>{r.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
