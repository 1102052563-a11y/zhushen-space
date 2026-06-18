import { useEffect, useRef } from 'react';
import { parseWeather, canvasMode } from '../systems/weatherFx';
import './WeatherFx.css';

/* 顶栏天气背景层：随杂项天气在 <header> 内铺一层天空背景层(绝对定位、z 在内容之下)。
   - 雨/雪/风(落叶)/雾(烟雾) = canvas 粒子；
   - 晴(太阳)/多云阴(云)/风(吹弯的树) = CSS 景物；
   - 背景天空色 + 雷闪 + 冷/暖罩 = CSS。
   只在任务世界且有天气时挂载(active)，回归乐园/无天气时返回 null(顶栏维持原暗色)。 */
const LEAF = ['#6f8f33', '#a8772f', '#557f34', '#bf853a'];
function rnd(a: number, b: number) { return a + Math.random() * (b - a); }

/* 奇异天气：AI 生成的纯 CSS 注入 Shadow DOM 隔离渲染(选择器跑不出 shadow、影响不到主 app；
   配合 sanitizeWeatherCss 已剥 JS/外链)。scaffold = .wfx-ai 容器 + 3 个 span 供分层。 */
function AiWeatherLayer({ css }: { css: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const base = ':host{position:absolute;inset:0;overflow:hidden;pointer-events:none}.wfx-ai{position:absolute;inset:0;overflow:hidden}.wfx-ai>span{position:absolute;inset:0;display:block}';
    root.innerHTML = '<style>' + base + '</style><style>' + css + '</style><div class="wfx-ai"><span></span><span></span><span></span></div>';
    return () => { try { root.innerHTML = ''; } catch { /* */ } };
  }, [css]);
  return <div ref={hostRef} className="wfx-ai-host" aria-hidden="true" />;
}

export default function WeatherFx({ weather, active, aiCss }: { weather?: string; active: boolean; aiCss?: string }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const { kind, intensity, tone } = parseWeather(weather);
  const useAi = active && kind === 'none' && !!aiCss;   // 奇异天气：预设认不出、但有 AI 生成的 CSS
  const show = active && (kind !== 'none' || useAi);
  const mode = canvasMode(kind);

  useEffect(() => {
    if (!show || mode === 'off') return;
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const host = cv.parentElement as HTMLElement; if (!host) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);
    const wind = -3.2;
    let W = 0, H = 0, raf = 0;
    let P: any[] = [];

    function size() {
      const r = host.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function build() {
      P = [];
      if (mode === 'rain') {
        const n = intensity === 'light' ? 40 : intensity === 'heavy' ? 150 : 88;
        const s0 = intensity === 'light' ? 5 : intensity === 'heavy' ? 12 : 8;
        const s1 = intensity === 'light' ? 9 : intensity === 'heavy' ? 19 : 14;
        for (let i = 0; i < n; i++) P.push({ x: rnd(0, W), y: rnd(-H, H), len: rnd(9, 20), s: rnd(s0, s1), o: rnd(.18, .55) });
      } else if (mode === 'snow') {
        const m = intensity === 'light' ? 26 : intensity === 'heavy' ? 95 : 54;
        for (let j = 0; j < m; j++) P.push({ x: rnd(0, W), y: rnd(-H, H), r: rnd(1, 2.7), s: rnd(.4, 1.3), o: rnd(.65, 1), ph: rnd(0, 100) });
      } else if (mode === 'wind') {
        const k = intensity === 'heavy' ? 34 : 20;
        for (let l = 0; l < k; l++) P.push({ x: rnd(0, W), y: rnd(0, H), w: rnd(3, 6), h: rnd(2, 3.5), vx: -rnd(intensity === 'heavy' ? 5 : 3, intensity === 'heavy' ? 9 : 6), vy: rnd(-.5, .6), rot: rnd(0, 6.28), vr: rnd(-.2, .2), c: LEAF[(Math.random() * 4) | 0], ph: rnd(0, 100) });
      } else if (mode === 'fog') {
        const q = intensity === 'heavy' ? 13 : 9;
        for (let p = 0; p < q; p++) P.push({ x: rnd(-40, W), y: rnd(4, H - 4), r: rnd(20, 44), vx: -rnd(.15, .6), o: rnd(.1, .3), light: Math.random() < .55, ph: rnd(0, 100) });
      }
    }
    function draw() {
      ctx!.clearRect(0, 0, W, H);
      if (mode === 'rain') {
        ctx!.lineWidth = 1.1; ctx!.lineCap = 'round';
        for (const d of P) { ctx!.strokeStyle = 'rgba(186,210,255,' + d.o + ')'; ctx!.beginPath(); ctx!.moveTo(d.x, d.y); ctx!.lineTo(d.x + wind * 0.45, d.y + d.len); ctx!.stroke(); d.y += d.s; d.x += wind * 0.05; if (d.y > H) { d.y = -d.len - rnd(0, 28); d.x = rnd(0, W); } }
      } else if (mode === 'snow') {
        for (const f of P) { ctx!.fillStyle = 'rgba(255,255,255,' + f.o + ')'; ctx!.beginPath(); ctx!.arc(f.x, f.y, f.r, 0, 6.283); ctx!.fill(); f.y += f.s; f.x += Math.sin((f.y + f.ph) / 18) * 0.5; if (f.y > H + 3) { f.y = -3; f.x = rnd(0, W); } }
      } else if (mode === 'wind') {
        for (const e of P) { ctx!.save(); ctx!.translate(e.x, e.y); ctx!.rotate(e.rot); ctx!.fillStyle = e.c; ctx!.globalAlpha = .85; ctx!.beginPath(); ctx!.ellipse(0, 0, e.w, e.h, 0, 0, 6.283); ctx!.fill(); ctx!.restore(); e.x += e.vx; e.y += e.vy + Math.sin((e.x + e.ph) / 26) * 0.5; e.rot += e.vr; if (e.x < -12) { e.x = W + 12; e.y = rnd(0, H); } } ctx!.globalAlpha = 1;
      } else if (mode === 'fog') {
        for (const u of P) { const col = u.light ? '235,239,244' : '110,118,130'; const g = ctx!.createRadialGradient(u.x, u.y, 0, u.x, u.y, u.r); g.addColorStop(0, 'rgba(' + col + ',' + u.o + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(u.x, u.y, u.r, 0, 6.283); ctx!.fill(); u.x += u.vx; u.y += Math.sin((u.x + u.ph) / 40) * 0.18; if (u.x < -u.r) { u.x = W + u.r; u.y = rnd(4, H - 4); } }
      }
    }
    function loop() { if (document.hidden) { raf = requestAnimationFrame(loop); return; } draw(); raf = requestAnimationFrame(loop); }

    size(); build();
    const ro = new ResizeObserver(() => { size(); build(); });
    ro.observe(host);
    if (reduced) draw(); else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [show, mode, intensity]);

  if (!show) return null;
  if (useAi) return <div className="wfx-bg"><AiWeatherLayer css={aiCss!} /></div>;
  const cls = `wfx-bg wfx-${kind} wfx-i-${intensity}${tone ? ' wfx-tone-' + tone : ''}`;
  return (
    <div className={cls} aria-hidden="true">
      <canvas ref={cvRef} className="wfx-cv" />
      {kind === 'sun' && <div className="wfx-sun"><span className="wfx-rays" /></div>}
      {(kind === 'sun' || kind === 'overcast') && (
        <div className="wfx-clouds"><span className="wfx-cloud wfx-c1" /><span className="wfx-cloud wfx-c2" /><span className="wfx-cloud wfx-c3" /></div>
      )}
      {kind === 'wind' && <div className="wfx-tree"><span className="wfx-canopy" /><span className="wfx-trunk" /></div>}
    </div>
  );
}
