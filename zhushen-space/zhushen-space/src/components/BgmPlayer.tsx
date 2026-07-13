/* 背景音乐迷你播放器（左下角浮动条）。
   - 状态经 useSyncExternalStore 订阅 systems/audio 的 BGM 快照（曲名/播放态/曲目数/总流量）。
   - 仅在「音效总开关 + 背景音乐开关 + 存在曲目」时出现；否则不渲染、零占位。
   - 流量确认门：未点「开启」前不下载任何字节；点开启后按需逐首加载（绝不一次下全部）。
   - 主题分类：曲目按文件夹分主题，可先选主题只放该主题，或「🔀 全部随机」跨主题随机。
   - 控制：主题·播放/暂停·上一首·下一首·音量·收起。选择/音量/同意态写回 settingsStore（随存档持久化）。 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useSettings } from '../store/settingsStore';
import { subscribeBgm, getBgmSnapshot, getBgmCategories, unlockBgm, bgmToggle, bgmNext, bgmPrev } from '../systems/audio';

export default function BgmPlayer() {
  const snap = useSyncExternalStore(subscribeBgm, getBgmSnapshot, getBgmSnapshot);
  const audio = useSettings((s) => s.audio);
  const setAudio = useSettings((s) => s.setAudio);
  const [collapsed, setCollapsed] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const cats = useMemo(() => getBgmCategories(), [snap.count]);   // 主题列表随清单加载重算

  if (!audio.enabled || !audio.music) return null;   // 跟随「背景音乐」开关：开→常驻显示，关→不显示（与是否有曲目无关）

  const btn = 'w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-god/80 hover:text-god hover:bg-god/10 transition-colors text-[13px]';
  const granted = audio.musicConsent === 'granted';
  const sizeHint = snap.totalMB > 0 ? `${snap.count} 首 · 约 ${snap.totalMB}MB` : `${snap.count} 首`;
  const enable = () => { unlockBgm(); setAudio({ musicConsent: 'granted' }); };   // 点击=手势解锁 + 记录同意
  const curCat = audio.musicCategory;
  const pickTheme = (cat: string) => {
    setThemeOpen(false);
    if (cat === '') setAudio({ musicCategory: '', musicShuffle: true });   // 全部随机：跨主题 + 打乱
    else setAudio({ musicCategory: cat });                                 // 选定主题：只放该主题
  };
  const wrap = 'fixed bottom-3 left-3 z-[80] max-lg:bottom-2 max-lg:left-2 select-none';

  if (collapsed) {
    return (
      <div className={wrap}>
        <button
          onClick={() => setCollapsed(false)}
          title={!snap.hasTracks ? '背景音乐（暂无曲目）' : granted ? (snap.name ? `背景音乐：${snap.name}` : '背景音乐') : `开启背景音乐（${sizeHint}）`}
          className="w-9 h-9 rounded-full border border-god/30 bg-void/90 backdrop-blur text-god/80 shadow-lg flex items-center justify-center hover:text-god transition-colors"
        >
          <span className={snap.playing ? 'animate-pulse' : 'opacity-60'}>🎵</span>
        </button>
      </div>
    );
  }

  // 无曲目（还没上传 R2 / 清单空）：仍常驻显示占位，提示暂无音乐（不加载任何东西）
  if (!snap.hasTracks) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 rounded-full border border-god/20 bg-void/85 backdrop-blur pl-3 pr-1.5 py-1 shadow-lg">
          <span className="text-[13px] opacity-60">🎵</span>
          <span className="text-[11px] text-dim/55 whitespace-nowrap">背景音乐 · 暂无曲目</span>
          <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
        </div>
      </div>
    );
  }

  // 未确认流量：只显示开启按钮 + 体积提示（不加载任何音频）
  if (!granted) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-3 pr-1.5 py-1 shadow-lg max-w-[80vw]">
          <span className="text-[13px]">🎵</span>
          <button onClick={enable} title="开始按需加载并播放背景音乐" className="text-[12px] text-god/90 hover:text-god font-medium whitespace-nowrap">开启背景音乐</button>
          <span className="text-[11px] text-dim/60 whitespace-nowrap">{sizeHint} · 按需加载</span>
          <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      {/* 主题下拉（在 pill 上方弹出） */}
      {themeOpen && cats.length > 0 && (
        <div className="mb-1 max-h-[42vh] overflow-y-auto rounded-2xl border border-god/25 bg-void/95 backdrop-blur shadow-[0_0_30px_rgba(0,0,0,0.6)] py-1 min-w-[9.5rem]">
          <button onClick={() => pickTheme('')} className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-god/10 ${!curCat ? 'text-god font-medium' : 'text-dim/80'}`}>🔀 全部随机</button>
          <div className="h-px bg-edge/60 my-1" />
          {cats.map((c) => (
            <button key={c.name} onClick={() => pickTheme(c.name)} className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-god/10 flex items-center justify-between gap-3 ${curCat === c.name ? 'text-god font-medium' : 'text-dim/80'}`}>
              <span className="truncate">{c.name}</span><span className="text-dim/45 text-[10px] shrink-0">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-1.5 pr-2 py-1 shadow-lg max-w-[82vw]">
        {cats.length > 0 && (
          <button onClick={() => setThemeOpen((v) => !v)} title="选择主题" className="flex items-center gap-1 shrink-0 px-2 h-7 rounded-full text-[11px] text-god/85 hover:bg-god/10 max-w-[7rem]">
            <span className="truncate">{curCat || '🔀 全部随机'}</span><span className="text-[9px] opacity-70">▾</span>
          </button>
        )}
        <button onClick={bgmPrev} title="上一首" className={btn}>⏮</button>
        <button onClick={bgmToggle} title={snap.playing ? '暂停' : '播放'} className={btn}>{snap.playing ? '⏸' : '▶'}</button>
        <button onClick={bgmNext} title="下一首" className={btn}>⏭</button>
        <span className={`text-[11px] truncate max-w-[8rem] ${snap.playing ? 'text-god/90' : 'text-dim/70'}`} title={snap.name}>{snap.name || '—'}</span>
        <input
          type="range" min={0} max={100} step={1}
          value={Math.round(audio.musicVolume * 100)}
          onChange={(e) => setAudio({ musicVolume: (parseInt(e.target.value) || 0) / 100 })}
          title="音乐音量"
          className="w-14 max-lg:hidden accent-god"
        />
        <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
      </div>
    </div>
  );
}
