import { useEffect, useRef } from 'react';

interface StartScreenProps {
  onStart: () => void;
  onContinue: () => void;
  onSettings: () => void;
  hasSave: boolean;
}

/* 封面背景原始比例（1672 x 941）。封面盒子锁同比例并居中。
   动态层（从下到上）：背景缓慢呼吸位移 → 月晕 / 中央光柱 / 脚下魔法阵 → 底部蓝雾 →
   蓝色火星粒子(Canvas，精灵+lighter 叠加) → 暗角 → 三个发光浮动按钮。
   为帧率考虑：不使用 mix-blend-mode（合成开销大），发光层用普通透明色；
   动画仅改 transform/opacity（纯合成层），尊重 prefers-reduced-motion。 */
const COVER_W = 1672;
const COVER_H = 941;

export default function StartScreen({ onStart, onContinue, onSettings }: StartScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 蓝色火星 / 星尘：预渲染精灵 + drawImage + lighter 叠加（避免每帧创建渐变）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 一次性预渲染一个柔光圆点精灵
    const SS = 24;
    const sprite = document.createElement('canvas');
    sprite.width = SS;
    sprite.height = SS;
    const sctx = sprite.getContext('2d');
    if (sctx) {
      const sg = sctx.createRadialGradient(SS / 2, SS / 2, 0, SS / 2, SS / 2, SS / 2);
      sg.addColorStop(0, 'rgba(185,218,255,0.95)');
      sg.addColorStop(0.45, 'rgba(120,180,255,0.40)');
      sg.addColorStop(1, 'rgba(90,150,255,0)');
      sctx.fillStyle = sg;
      sctx.fillRect(0, 0, SS, SS);
    }

    // 粒子画布按 CSS 像素渲染（不乘 DPR，柔光点无需高清，省一半填充）
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = parent.getBoundingClientRect();
      w = Math.round(r.width);
      h = Math.round(r.height);
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    type P = { x: number; y: number; r: number; vy: number; vx: number; tw: number; tws: number; a: number };
    const spawn = (atBottom = false): P => ({
      x: Math.random(),
      y: atBottom ? 1.04 + Math.random() * 0.1 : Math.random(),
      r: 0.6 + Math.random() * 1.9,
      vy: 0.0005 + Math.random() * 0.0016,
      vx: (Math.random() - 0.5) * 0.0005,
      tw: Math.random() * Math.PI * 2,
      tws: 0.015 + Math.random() * 0.04,
      a: 0.18 + Math.random() * 0.5,
    });
    const parts: P[] = Array.from({ length: 36 }, () => spawn(false));

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        p.y -= p.vy;
        p.x += p.vx;
        p.tw += p.tws;
        if (p.y < -0.05) Object.assign(p, spawn(true));
        const size = p.r * 7;
        ctx.globalAlpha = Math.max(0, p.a * (0.45 + 0.55 * Math.sin(p.tw)));
        ctx.drawImage(sprite, p.x * w - size / 2, p.y * h - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    if (!reduce) raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-black grid place-items-center max-lg:flex max-lg:flex-col overflow-hidden select-none">
      <style>{CSS_ANIM}</style>
      <div className="zs-cover relative overflow-hidden">
        {/* 背景：缓慢呼吸位移 */}
        <img
          src="/cover-bg.jpg"
          alt="轮回乐园"
          draggable={false}
          className="zs-anim absolute inset-0 w-full h-full object-cover"
          style={{ animation: 'zsDrift 28s ease-in-out infinite', willChange: 'transform' }}
        />

        {/* 月晕脉动 */}
        <div
          className="zs-anim absolute pointer-events-none"
          style={{
            left: '49%',
            top: '12%',
            width: '22%',
            aspectRatio: '1',
            transform: 'translate(-50%,-50%)',
            background:
              'radial-gradient(circle, rgba(185,212,255,0.42) 0%, rgba(120,170,255,0.18) 38%, rgba(120,170,255,0) 70%)',
            animation: 'zsMoon 6.5s ease-in-out infinite',
            willChange: 'opacity, transform',
          }}
        />

        {/* 中央光柱呼吸 */}
        <div
          className="zs-anim absolute pointer-events-none"
          style={{
            left: '48.5%',
            top: '30%',
            width: '5%',
            height: '60%',
            transform: 'translateX(-50%)',
            background:
              'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(130,190,255,0.42) 0%, rgba(120,180,255,0) 72%)',
            animation: 'zsBeam 5s ease-in-out infinite',
            willChange: 'opacity',
          }}
        />

        {/* 脚下魔法阵光晕 */}
        <div
          className="zs-anim absolute pointer-events-none"
          style={{
            left: '48.5%',
            top: '90%',
            width: '30%',
            aspectRatio: '1',
            transform: 'translate(-50%,-50%)',
            background:
              'radial-gradient(circle, rgba(95,168,255,0.40) 0%, rgba(70,140,255,0.10) 45%, rgba(70,140,255,0) 68%)',
            animation: 'zsRune 5.5s ease-in-out infinite',
            willChange: 'opacity, transform',
          }}
        />

        {/* 底部蓝雾漂移 */}
        <div
          className="zs-anim absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 40% 30% at 28% 82%, rgba(60,115,210,0.14), transparent 60%), radial-gradient(ellipse 45% 30% at 72% 86%, rgba(45,95,190,0.11), transparent 60%)',
            animation: 'zsMist 16s ease-in-out infinite',
            willChange: 'opacity, transform',
          }}
        />

        {/* 蓝色火星 / 星尘粒子 */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* 暗角 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 44%, transparent 56%, rgba(0,0,0,0.42) 100%)' }}
        />

        {/* 三个发光浮动按钮（独立 PNG，本身即点击区）—— 仅桌面：浮在封面右侧 */}
        <div className="hidden lg:flex absolute z-30 flex-col top-[40%] right-[6.5%] w-[28%] gap-[2.2%]">
          <CoverButton src="/btn-start.png" label="开始游戏" onClick={onStart} delay={0} />
          <CoverButton src="/btn-continue.png" label="读取存档" onClick={onContinue} delay={0.5} />
          <CoverButton src="/btn-settings.png" label="系统设置" onClick={onSettings} delay={1} />
        </div>

        {/* 版本号 */}
        <div className="absolute z-30 bottom-2 left-3 text-[10px] font-mono text-white/30 tracking-widest">
          轮回乐园 · V0.0.1
        </div>
      </div>

      {/* 手机端：封面在上 + 按钮在下方深色区（桌面 lg: 隐藏，桌面用上方封面内的右侧浮层按钮）*/}
      <div className="lg:hidden flex-1 w-full flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#0a0e18] to-[#02040a]">
        <div className="w-[80%] max-w-xs flex flex-col gap-4">
          <CoverButton src="/btn-start.png" label="开始游戏" onClick={onStart} delay={0} />
          <CoverButton src="/btn-continue.png" label="读取存档" onClick={onContinue} delay={0.5} />
          <CoverButton src="/btn-settings.png" label="系统设置" onClick={onSettings} delay={1} />
        </div>
      </div>
    </div>
  );
}

function CoverButton({
  src,
  label,
  onClick,
  delay,
}: {
  src: string;
  label: string;
  onClick: () => void;
  delay: number;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="zs-anim group relative block w-full focus:outline-none hover:[animation-play-state:paused]"
      style={{ animation: `zsFloat 4.8s ease-in-out ${delay}s infinite`, willChange: 'transform' }}
    >
      <img
        src={src}
        alt={label}
        draggable={false}
        className="w-full h-auto transition duration-200 ease-out
          drop-shadow-[0_0_10px_rgba(70,140,255,0.25)]
          group-hover:drop-shadow-[0_0_26px_rgba(110,180,255,0.7)]
          group-hover:brightness-125 group-hover:scale-[1.035]
          group-active:scale-[0.99]"
      />
    </button>
  );
}

const CSS_ANIM = `
.zs-cover { width: min(100vw, calc(100vh * ${COVER_W} / ${COVER_H})); height: min(100vh, calc(100vw * ${COVER_H} / ${COVER_W})); }
@media (max-width: 1023px){ .zs-cover { width: 100vw; height: auto; aspect-ratio: ${COVER_W} / ${COVER_H}; max-height: 58vh; flex: 0 0 auto; } }
@keyframes zsDrift { 0%,100%{transform:scale(1.03) translate(0,0)} 50%{transform:scale(1.05) translate(-0.5%,-0.5%)} }
@keyframes zsMoon { 0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(1)} 50%{opacity:.85;transform:translate(-50%,-50%) scale(1.07)} }
@keyframes zsBeam { 0%,100%{opacity:.4} 50%{opacity:.85} }
@keyframes zsRune { 0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(0.97)} 50%{opacity:.8;transform:translate(-50%,-50%) scale(1.1)} }
@keyframes zsMist { 0%,100%{transform:translate(-2%,0);opacity:.6} 50%{transform:translate(2%,-1%);opacity:.95} }
@keyframes zsFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2.4%)} }
@media (prefers-reduced-motion: reduce){ .zs-anim{ animation:none !important } }
`;
