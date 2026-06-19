import { type WorldOption } from './WorldSelector';

export default function WorldCardView({ worlds, index, onPrev, onNext, onJump, onSelect, onClose }: {
  worlds: WorldOption[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  onSelect: (name: string, world: WorldOption) => void;
  onClose: () => void;
}) {
  const world = worlds[index];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-void/90 backdrop-blur-sm px-6">
      {/* 关闭 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-5 text-dim hover:text-blood text-sm font-mono transition-colors"
      >
        ✕ 关闭
      </button>

      {/* 计数 */}
      <div className="mb-2 text-sm font-mono text-dim tracking-widest">
        {index + 1} / {worlds.length}
      </div>

      {/* 卡片 + 左右箭头 */}
      <div className="flex items-stretch gap-4 w-full max-w-4xl" style={{ maxHeight: 'calc(100vh - 170px)' }}>
        {/* 左箭头 */}
        <button
          onClick={onPrev}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ‹
        </button>

        {/* 卡片 */}
        <div className="flex-1 border border-god/30 rounded-2xl bg-panel shadow-[0_0_50px_rgba(70,227,207,0.08)] overflow-hidden flex flex-col min-h-0">

          {/* ── 头部：编号 + 世界名 + 类型 ── */}
          <div className="px-8 pt-4 pb-3.5 border-b border-edge shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-mono text-god/40 tracking-widest uppercase">
                World · {String(index + 1).padStart(2, '0')}
              </span>
              {world.worldType && (
                <span className="text-sm font-mono px-3 py-0.5 border border-god/20 text-god/60 rounded">
                  {world.worldType}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-slate-100 leading-snug god-glow mt-0.5">{world.name}</h2>
            {/* 阶位 + 难度 + 区域 */}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {world.tier !== '' && (
                <span className="text-base font-mono text-sky-400/80">
                  {typeof world.tier === 'number' || /^\d+$/.test(world.tier)
                    ? `${world.tier} 阶`
                    : world.tier}
                </span>
              )}
              {world.dangerLevel && (
                <span className="text-base font-mono text-amber-400/80">{world.dangerLevel}</span>
              )}
              {world.region && (
                <span className="text-sm font-mono text-dim truncate max-w-sm">📍 {world.region}</span>
              )}
            </div>
          </div>

          {/* ── 可滚动正文 ── */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-edge/40">
            {world.desc       && <CardSection label="世界简介" content={world.desc} />}
            {world.peakPower  && <CardSection label="巅峰战力" content={world.peakPower} />}
            {world.contractorDist && <CardSection label="契约者分布" content={world.contractorDist} />}
            {world.entryPoint && <CardSection label="切入点"   content={world.entryPoint}  accent="god" />}
            {world.mainMission && <CardSection label="主线任务" content={world.mainMission} accent="amber" />}
            {world.sideMission && <CardSection label="支线任务" content={world.sideMission} />}
            {world.warning    && <CardSection label="警告"     content={world.warning}     accent="blood" />}
            {world.reward     && <CardSection label="奖励预览" content={world.reward}      accent="gold" />}
          </div>

          {/* ── 底部按钮 ── */}
          <div className="px-8 py-3 border-t border-edge text-center shrink-0">
            <button
              onClick={() => onSelect(world.name, world)}
              className="px-12 py-2.5 border border-god/50 text-god text-base rounded-xl hover:bg-god/10 font-mono transition-colors"
            >
              进入此世界
            </button>
          </div>
        </div>

        {/* 右箭头 */}
        <button
          onClick={onNext}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ›
        </button>
      </div>

      {/* 缩略点导航 */}
      <div className="mt-3 flex gap-2">
        {worlds.map((_, i) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === index ? 'bg-god scale-125' : 'bg-dim/40 hover:bg-dim'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

const accentMap: Record<string, string> = {
  god:   'text-god/60',
  amber: 'text-amber-400/70',
  blood: 'text-blood/70',
  gold:  'text-gold/70',
};

function CardSection({ label, content, accent }: { label: string; content: string; accent?: string }) {
  const labelColor = accent ? accentMap[accent] ?? 'text-dim' : 'text-dim';
  return (
    <div className="px-8 py-3">
      <div className={`text-sm font-mono mb-1 ${labelColor}`}>{label}</div>
      <p className="text-[15px] text-slate-300 leading-relaxed">{content}</p>
    </div>
  );
}
