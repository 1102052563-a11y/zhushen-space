/* 背景音乐迷你播放器（左下角浮动条）。
   - 状态经 useSyncExternalStore 订阅 systems/audio 的 BGM 快照（曲名/播放态/曲目数/总流量）。
   - 仅在「音效总开关 + 背景音乐开关 + 存在曲目」时出现；否则不渲染、零占位。
   - **流量确认门**：用户未点「开启」前（musicConsent≠granted），只显示一个带体积提示的开启按钮——
     一个字节都不下载；点开启后才开始按需逐首加载（绝不一次性下全部）。
   - 控制：播放/暂停·上一首·下一首·音量·收起。音量/同意态写回 settingsStore（随存档持久化）。 */
import { useState, useSyncExternalStore } from 'react';
import { useSettings } from '../store/settingsStore';
import { subscribeBgm, getBgmSnapshot, unlockBgm, bgmToggle, bgmNext, bgmPrev } from '../systems/audio';

export default function BgmPlayer() {
  const snap = useSyncExternalStore(subscribeBgm, getBgmSnapshot, getBgmSnapshot);
  const audio = useSettings((s) => s.audio);
  const setAudio = useSettings((s) => s.setAudio);
  const [collapsed, setCollapsed] = useState(false);

  if (!audio.enabled || !audio.music || !snap.hasTracks) return null;

  const btn = 'w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-god/80 hover:text-god hover:bg-god/10 transition-colors text-[13px]';
  const granted = audio.musicConsent === 'granted';
  const sizeHint = snap.totalMB > 0 ? `${snap.count} 首 · 约 ${snap.totalMB}MB` : `${snap.count} 首`;
  const enable = () => { unlockBgm(); setAudio({ musicConsent: 'granted' }); };   // 点击=一次用户手势(解锁自动播放)+记录同意

  const wrap = 'fixed bottom-3 left-3 z-[80] max-lg:bottom-2 max-lg:left-2 select-none';

  if (collapsed) {
    return (
      <div className={wrap}>
        <button
          onClick={() => setCollapsed(false)}
          title={granted ? (snap.name ? `背景音乐：${snap.name}` : '背景音乐') : `开启背景音乐（${sizeHint}）`}
          className="w-9 h-9 rounded-full border border-god/30 bg-void/90 backdrop-blur text-god/80 shadow-lg flex items-center justify-center hover:text-god transition-colors"
        >
          <span className={snap.playing ? 'animate-pulse' : 'opacity-60'}>🎵</span>
        </button>
      </div>
    );
  }

  // 未确认流量：只显示开启按钮 + 体积提示（不加载任何音频）
  if (!granted) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-3 pr-1.5 py-1 shadow-lg max-w-[80vw]">
          <span className="text-[13px]">🎵</span>
          <button
            onClick={enable}
            title="开始按需加载并播放背景音乐"
            className="text-[12px] text-god/90 hover:text-god font-medium whitespace-nowrap"
          >
            开启背景音乐
          </button>
          <span className="text-[11px] text-dim/60 whitespace-nowrap">{sizeHint} · 按需加载</span>
          <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <div className="flex items-center gap-1 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-1.5 pr-2 py-1 shadow-lg max-w-[72vw]">
        <button onClick={bgmPrev} title="上一首" className={btn}>⏮</button>
        <button onClick={bgmToggle} title={snap.playing ? '暂停' : '播放'} className={btn}>{snap.playing ? '⏸' : '▶'}</button>
        <button onClick={bgmNext} title="下一首" className={btn}>⏭</button>
        <span className={`text-[11px] truncate max-w-[9rem] ${snap.playing ? 'text-god/90' : 'text-dim/70'}`} title={snap.name}>
          {snap.name || '—'}
        </span>
        <input
          type="range" min={0} max={100} step={1}
          value={Math.round(audio.musicVolume * 100)}
          onChange={(e) => setAudio({ musicVolume: (parseInt(e.target.value) || 0) / 100 })}
          title="音乐音量"
          className="w-16 max-lg:hidden accent-god"
        />
        <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
      </div>
    </div>
  );
}
