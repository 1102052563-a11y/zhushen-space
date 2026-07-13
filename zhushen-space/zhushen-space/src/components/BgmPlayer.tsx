/* 背景音乐迷你播放器（可拖动的悬浮窗）。
   - 状态经 useSyncExternalStore 订阅 systems/audio 的 BGM 快照（曲名/播放态/曲目数/总流量）。
   - 显示：跟随「背景音乐」开关，开→常驻（无曲目显占位），关→不显示。
   - 流量确认门：未点「开启」前不下载任何字节；点开启后按需逐首加载。
   - 主题分类：可先选主题只放该主题，或「🔀 全部随机」跨主题。
   - **拖动**：按住左侧抓手 ⠿ 拖到任意位置（避免压住输入/回合按钮误触）；松手固定，位置记忆（settingsStore）。
     抓手独立于按钮 → 播放/切歌/选主题等点击零干扰。收起态的 🎵 可直接按住拖动、轻点展开。 */
import { useRef, useState, useSyncExternalStore, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode, type CSSProperties } from 'react';
import { useSettings } from '../store/settingsStore';
import { subscribeBgm, getBgmSnapshot, getBgmCategories, getBgmTracks, bgmPlayCategory, bgmPlayTrack, unlockBgm, bgmToggle, bgmNext, bgmPrev } from '../systems/audio';

export default function BgmPlayer() {
  const snap = useSyncExternalStore(subscribeBgm, getBgmSnapshot, getBgmSnapshot);
  const audio = useSettings((s) => s.audio);
  const setAudio = useSettings((s) => s.setAudio);
  const [collapsed, setCollapsed] = useState(true);   // 开局默认缩成 🎵 图标（轻点展开控制条），避免占地方/误触
  const [themeOpen, setThemeOpen] = useState(false);
  const [browseCat, setBrowseCat] = useState<string | null>(null);   // 二级菜单：null=看主题列表；主题名=看该主题歌单
  const cats = useMemo(() => getBgmCategories(), [snap.count]);
  const songs = useMemo(() => (browseCat != null ? getBgmTracks(browseCat) : []), [browseCat, snap.count]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => audio.musicPos ?? null);
  const [dragging, setDragging] = useState(false);

  if (!audio.enabled || !audio.music) return null;

  const btn = 'w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-god/80 hover:text-god hover:bg-god/10 transition-colors text-[13px]';
  const granted = audio.musicConsent === 'granted';
  const sizeHint = snap.totalMB > 0 ? `${snap.count} 首 · 约 ${snap.totalMB}MB` : `${snap.count} 首`;
  const enable = () => { unlockBgm(); setAudio({ musicConsent: 'granted' }); };
  const curCat = cats.some((c) => c.name === audio.musicCategory) ? audio.musicCategory : '';   // 残留/失效主题名→当作全部随机
  const openThemeMenu = () => { setBrowseCat(null); setThemeOpen((v) => !v); };            // 主题按钮：开/关下拉，回到主题列表
  const pickAll = () => { setThemeOpen(false); setAudio({ musicCategory: '', musicShuffle: true }); bgmPlayCategory(''); };   // 全部随机
  const playWholeTheme = (cat: string) => { setThemeOpen(false); setAudio({ musicCategory: cat }); bgmPlayCategory(cat); };  // 随机放整个主题
  const playSong = (file: string, cat: string) => { setThemeOpen(false); setAudio({ musicCategory: cat }); bgmPlayTrack(file); };  // 放该主题里指定一首

  // ── 拖动（仅从抓手 / 收起态图标发起；不触碰其它按钮）──
  const startDrag = (e: ReactPointerEvent, onTap?: () => void) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startPos = pos;
    const ds = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false, last: { x: rect.left, y: rect.top } };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* */ }
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.sx, dy = ev.clientY - ds.sy;
      if (!ds.moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;   // 抖动内不算拖动
      if (!ds.moved) setDragging(true);
      ds.moved = true;
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = Math.max(4, Math.min(ds.ox + dx, window.innerWidth - w - 4));
      const y = Math.max(4, Math.min(ds.oy + dy, window.innerHeight - h - 4));
      ds.last = { x, y };
      setPos({ x, y });
      ev.preventDefault();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (ds.moved) { setDragging(false); setPos(ds.last); setAudio({ musicPos: ds.last }); }
      else { setPos(startPos); onTap?.(); }   // 没移动=轻点：还原 + 触发轻点动作（收起态=展开）
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
  };
  const grip = (
    <span onPointerDown={(e) => { e.preventDefault(); startDrag(e); }} title="按住拖动播放器" className="shrink-0 px-1 self-stretch flex items-center cursor-grab active:cursor-grabbing text-god/35 hover:text-god/70 text-[12px] leading-none touch-none">⠿</span>
  );

  const wrapClass = `fixed z-[80] select-none ${pos ? '' : 'bottom-3 left-3 max-lg:bottom-2 max-lg:left-2'} ${dragging ? 'ring-2 ring-god/60 rounded-full' : ''}`;
  const wrapStyle: CSSProperties = { ...(pos ? { left: pos.x, top: pos.y } : {}) };
  const dropdownBelow = pos !== null && pos.y < 220;

  let inner: ReactNode;
  if (collapsed) {
    inner = (
      <button
        onPointerDown={(e) => startDrag(e, () => setCollapsed(false))}
        title={!snap.hasTracks ? '背景音乐（暂无曲目）· 按住拖动' : granted ? (snap.name ? `背景音乐：${snap.name}（按住拖动·轻点展开）` : '背景音乐') : `开启背景音乐（${sizeHint}）`}
        className="w-9 h-9 rounded-full border border-god/30 bg-void/90 backdrop-blur text-god/80 shadow-lg flex items-center justify-center hover:text-god transition-colors touch-none"
      >
        <span className={snap.playing ? 'animate-pulse' : 'opacity-60'}>🎵</span>
      </button>
    );
  } else if (!snap.hasTracks) {
    inner = (
      <div className="flex items-center gap-1 rounded-full border border-god/20 bg-void/85 backdrop-blur pl-1 pr-1.5 py-1 shadow-lg">
        {grip}
        <span className="text-[13px] opacity-60">🎵</span>
        <span className="text-[11px] text-dim/55 whitespace-nowrap">背景音乐 · 暂无曲目</span>
        <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
      </div>
    );
  } else if (!granted) {
    inner = (
      <div className="flex items-center gap-1.5 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-1 pr-1.5 py-1 shadow-lg max-w-[84vw]">
        {grip}
        <span className="text-[13px]">🎵</span>
        <button onClick={enable} title="开始按需加载并播放背景音乐" className="text-[12px] text-god/90 hover:text-god font-medium whitespace-nowrap">开启背景音乐</button>
        <span className="text-[11px] text-dim/60 whitespace-nowrap">{sizeHint} · 按需加载</span>
        <button onClick={() => setCollapsed(true)} title="收起" className={btn}>▾</button>
      </div>
    );
  } else {
    const dropdown = themeOpen && cats.length > 0 && (
      <div className={`${dropdownBelow ? 'mt-1 order-last' : 'mb-1'} max-h-[46vh] overflow-y-auto rounded-2xl border border-god/25 bg-void/95 backdrop-blur shadow-[0_0_30px_rgba(0,0,0,0.6)] py-1 min-w-[11rem] max-w-[76vw]`}>
        {browseCat == null ? (   // 一级：主题列表
          <>
            <button onClick={pickAll} className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-god/10 ${!curCat ? 'text-god font-medium' : 'text-dim/80'}`}>🔀 全部随机</button>
            <div className="h-px bg-edge/60 my-1" />
            {cats.map((c) => (
              <button key={c.name} onClick={() => setBrowseCat(c.name)} title={`查看「${c.name}」的歌曲`} className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-god/10 flex items-center justify-between gap-3 ${curCat === c.name ? 'text-god font-medium' : 'text-dim/80'}`}>
                <span className="truncate">{c.name}</span><span className="text-dim/45 text-[10px] shrink-0">{c.count} ›</span>
              </button>
            ))}
          </>
        ) : (   // 二级：某主题的歌单
          <>
            <button onClick={() => setBrowseCat(null)} className="w-full text-left px-3 py-1.5 text-[12px] text-dim/70 hover:bg-god/10">‹ 返回主题</button>
            <button onClick={() => playWholeTheme(browseCat)} className="w-full text-left px-3 py-1.5 text-[12px] text-god/90 font-medium hover:bg-god/10 truncate">🔀 随机放「{browseCat}」</button>
            <div className="h-px bg-edge/60 my-1" />
            {songs.map((t) => {
              const isCur = curCat === browseCat && snap.name === t.name;
              return (
                <button key={t.file} onClick={() => playSong(t.file, browseCat)} className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-god/10 flex items-center gap-2 ${isCur ? 'text-god font-medium' : 'text-dim/80'}`}>
                  <span className="text-[9px] shrink-0 w-2">{isCur ? '▶' : ''}</span>
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    );
    inner = (
      <div className="flex flex-col">
        {!dropdownBelow && dropdown}
        <div className="flex items-center gap-1 rounded-full border border-god/25 bg-void/90 backdrop-blur pl-0.5 pr-2 py-1 shadow-lg max-w-[86vw]">
          {grip}
          {cats.length > 0 && (
            <button onClick={openThemeMenu} title="选择主题 / 歌曲" className="flex items-center gap-1 shrink-0 px-2 h-7 rounded-full text-[11px] text-god/85 hover:bg-god/10 max-w-[7rem]">
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
        {dropdownBelow && dropdown}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={wrapClass} style={wrapStyle}>
      {inner}
    </div>
  );
}
