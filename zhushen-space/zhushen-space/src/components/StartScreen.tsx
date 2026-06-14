interface StartScreenProps {
  onStart: () => void;
  onContinue: () => void;
  onSettings: () => void;
  hasSave: boolean;
}

/* 封面图原始比例（1706 x 955）。把封面盒子锁成同比例并居中，
   这样画在图上的按钮始终在固定百分比位置，点击热区可精确对齐。 */
const COVER_W = 1706;
const COVER_H = 955;

export default function StartScreen({ onStart, onContinue, onSettings }: StartScreenProps) {
  return (
    <div className="h-screen w-screen bg-black grid place-items-center overflow-hidden select-none">
      <div
        className="relative"
        style={{
          width: `min(100vw, calc(100vh * ${COVER_W} / ${COVER_H}))`,
          height: `min(100vh, calc(100vw * ${COVER_H} / ${COVER_W}))`,
        }}
      >
        <img src="/cover.jpg" alt="轮回乐园" className="block w-full h-full" draggable={false} />

        {/* 透明点击热区——精确盖在封面画好的三个按钮上 */}
        <HotZone label="开始游戏" onClick={onStart}    style={{ left: '71%', top: '56.5%', width: '26%', height: '10%' }} />
        <HotZone label="读取存档" onClick={onContinue} style={{ left: '71%', top: '67.5%', width: '26%', height: '10%' }} />
        <HotZone label="系统设置" onClick={onSettings} style={{ left: '71%', top: '78.5%', width: '26%', height: '10%' }} />

        {/* 版本号 */}
        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-white/25 tracking-widest">
          轮回乐园 · V0.0.1
        </div>
      </div>
    </div>
  );
}

function HotZone({ label, onClick, style }: { label: string; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="absolute rounded-sm transition-all duration-150
        hover:bg-red-500/10 hover:shadow-[0_0_24px_rgba(220,40,40,0.35)]
        focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
      style={style}
    />
  );
}
