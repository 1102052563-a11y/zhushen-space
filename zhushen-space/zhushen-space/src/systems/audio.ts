/* 游戏音效引擎（懒加载 Howler）。
   - 音频文件放 public/audio/<名>.<mp3|wav|ogg>；引擎按 mp3→wav→ogg 顺序尝试加载，加载失败自动试下一个
     （你后丢的 mp3 会优先于自带的 wav 占位）。全缺→静默跳过、绝不报错、不影响游戏。
   - Howler 仅在「开启音效 + 首次真正播放」时才动态 import（独立 chunk·不进主 chunk）。
   - 设置（开关/音量/环境音）由 App 通过 setAudioSettings 推入，引擎与 store 解耦。
   - 移动端自动播放解锁交给 Howler 内置 autoUnlock（首次用户手势后解锁音频上下文）。*/
import type { Howl as HowlT, HowlOptions } from 'howler';
import { bgmBase } from '../bgmConfig';   // BGM 来源基址（本仓库自带 或 外部音乐库地址）

type HowlerMod = typeof import('howler');
let mod: HowlerMod | null = null;
let loadingMod: Promise<HowlerMod> | null = null;

/* 一次性音效：key → public/audio/<file> 名 */
const SFX: Record<string, string> = {
  dice: 'dice', hit: 'hit', crit: 'crit', block: 'block', heal: 'heal', msg: 'msg',
  fanfare: 'fanfare', levelup: 'levelup', coin: 'coin', slot: 'slot', win: 'win', open: 'open',
};
/* 环境循环音：weatherFx 的 kind → <file> 名（sun/overcast/none 无环境音） */
const AMBIENT: Record<string, string> = {
  rain: 'amb-rain', thunder: 'amb-thunder', snow: 'amb-snow', wind: 'amb-wind', fog: 'amb-fog',
};
const EXTS = ['mp3', 'wav', 'ogg'];   // 加载优先级：用户 mp3 > 自带 wav 占位 > ogg

let settings = { enabled: true, volume: 0.7, ambient: true, ambientVolume: 0.4, music: true, musicVolume: 0.5, musicShuffle: false, musicConsent: '', musicCategory: '' };   // musicConsent: ''=未确认(先不下载)/'granted'=同意流量后才加载；musicCategory: ''=全部(可配合随机)/主题名=只放该主题
const loaded = new Map<string, Promise<HowlT | null>>();   // <file>|<file>#loop → 首个能加载的 Howl（null=全缺）
let ambient: HowlT | null = null;
let ambientKey = '';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function ensureMod(): Promise<HowlerMod> {
  if (mod) return Promise.resolve(mod);
  if (!loadingMod) loadingMod = import('howler').then((m) => { mod = m; return m; });
  return loadingMod;
}

/** 按 EXTS 依次尝试加载 public/audio/<file>.<ext>，返回首个加载成功的 Howl（都失败→null）。结果按 file(+loop) 缓存。 */
function load(m: HowlerMod, file: string, loop: boolean): Promise<HowlT | null> {
  const cacheKey = loop ? file + '#loop' : file;
  let p = loaded.get(cacheKey);
  if (!p) {
    p = new Promise<HowlT | null>((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (i >= EXTS.length) { resolve(null); return; }
        const url = `/audio/${file}.${EXTS[i++]}`;
        const h = new m.Howl({ src: [url], loop, html5: loop, preload: true, volume: loop ? 0 : clamp(settings.volume),
          onload: () => resolve(h), onloaderror: () => tryNext() } as HowlOptions);
      };
      tryNext();
    });
    loaded.set(cacheKey, p);
  }
  return p;
}

/** App 推入设置（开关/音量/环境音/背景音乐）。总开关关→静音并停环境音+暂停 BGM。 */
export function setAudioSettings(s: Partial<typeof settings>): void {
  const prevShuffle = settings.musicShuffle, prevCategory = settings.musicCategory;
  settings = { ...settings, ...s };
  if (mod) mod.Howler.volume(settings.enabled ? clamp(settings.volume) : 0);   // 主音量总线（同时压 SFX/环境/BGM）
  if (!settings.enabled || !settings.ambient) stopAmbient();
  else if (ambient) { try { ambient.volume(clamp(settings.ambientVolume)); } catch { /* */ } }
  if (bgm) { try { bgm.volume(clamp(settings.musicVolume)); } catch { /* */ } }   // 背景音乐相对音量（受主音量再乘）
  if (settings.musicCategory !== prevCategory) {   // 切主题：重建曲目池，从该主题第一首起播
    bgmMissStreak = 0; bgmIdx = -1; buildBgmOrder();
    if (bgmShouldPlay()) bgmPlayAt(0);
  } else if (settings.musicShuffle !== prevShuffle) {
    buildBgmOrder();
  }
  ensureBgmPlaylist().then(reconcileBgm);   // 加载清单（幂等）后按新设置起停 BGM
}

/** 播放一次性音效（未开启 / 文件全缺时静默）。 */
export function playSfx(key: string): void {
  if (!settings.enabled) return;
  const file = SFX[key];
  if (!file) return;
  ensureMod()
    .then((m) => load(m, file, false))
    .then((h) => { if (h && settings.enabled) { try { h.volume(clamp(settings.volume)); h.play(); } catch { /* */ } } })
    .catch(() => { /* */ });
}

/** 切换环境循环音（按天气 kind；无对应文件 / 关闭时停）。 */
export function setAmbient(kind: string): void {
  if (!settings.enabled || !settings.ambient) { stopAmbient(); return; }
  const file = AMBIENT[kind];
  if (!file) { stopAmbient(); return; }
  if (ambientKey === kind && ambient) return;   // 已在放同一种
  ensureMod()
    .then((m) => load(m, file, true))
    .then((h) => {
      if (!h || !settings.enabled || !settings.ambient || AMBIENT[kind] !== file) return;
      stopAmbient();
      ambient = h; ambientKey = kind;
      const vol = clamp(settings.ambientVolume);
      try { h.volume(0); h.play(); h.fade(0, vol, 800); } catch { /* */ }
    })
    .catch(() => { /* */ });
}

export function stopAmbient(): void {
  if (ambient) { try { ambient.stop(); } catch { /* */ } ambient = null; ambientKey = ''; }   // 仅停不卸载（缓存复用）
}

/* ──────────────────────────────────────────────────────────────────────────
   背景音乐（BGM）：循环播放列表。
   - 曲目来自 public/audio/bgm/manifest.json（vite 插件 build/dev 时按文件夹自动生成 = [{file,name}]）。
   - 多首＝顺序（或随机）轮播，一首 onend 自动切下一首，到底回头 → 无限循环。
   - 与环境音是两条独立轨（各自 Howl），主音量总线（Howler.volume）同时压二者。
   - 自动播放受浏览器策略限制：必须首个用户手势后 unlockBgm() 才真正起播（App 接线）。
   - 迷你播放器经 subscribeBgm/getBgmSnapshot 订阅当前曲名/播放态（useSyncExternalStore 用）。 */
type BgmTrack = { file: string; name: string; bytes?: number; category?: string };
let bgmPlaylist: BgmTrack[] = [];
let bgmOrder: number[] = [];        // 播放顺序（bgmPlaylist 的下标序列，随机时打乱）
let bgmIdx = -1;                    // 当前曲目在 bgmOrder 里的位置（-1＝还没起播）
let bgm: HowlT | null = null;      // 当前在放的 Howl
let bgmPaused = false;             // 迷你播放器的临时暂停（区别于设置里的音乐总开关）
let bgmUnlocked = false;           // 首个用户手势后置真（浏览器自动播放解锁）
let bgmMissStreak = 0;             // 连续加载失败计数（防清单与文件不符时死循环）
let bgmPlState: 'none' | 'loading' | 'loaded' = 'none';
let bgmPlPromise: Promise<void> | null = null;
const bgmCache = new Map<string, Promise<HowlT | null>>();   // file → 首个加载 Promise（并发去重：防两次 bgmPlayAt 各建一个 Howl 而多下一份）

let bgmSnap: { playing: boolean; name: string; hasTracks: boolean; count: number; totalMB: number } = { playing: false, name: '', hasTracks: false, count: 0, totalMB: 0 };
const bgmSubs = new Set<() => void>();
function bgmEmit(patch: Partial<typeof bgmSnap>): void {
  const next = { ...bgmSnap, ...patch };
  if (next.playing === bgmSnap.playing && next.name === bgmSnap.name && next.hasTracks === bgmSnap.hasTracks
      && next.count === bgmSnap.count && next.totalMB === bgmSnap.totalMB) return;
  bgmSnap = next;                                            // 引用变才通知（useSyncExternalStore 要求快照稳定）
  for (const fn of bgmSubs) { try { fn(); } catch { /* */ } }
}
/** 订阅 BGM 状态变化（返回退订函数）。 */
export function subscribeBgm(fn: () => void): () => void { bgmSubs.add(fn); return () => { bgmSubs.delete(fn); }; }
/** 当前 BGM 快照（迷你播放器读；引用稳定，未变则同一对象）。 */
export function getBgmSnapshot(): typeof bgmSnap { return bgmSnap; }
/** 可选主题列表（按清单 category 去重 + 每主题曲目数，按名排序）；空数组=曲目无分类。 */
export function getBgmCategories(): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const t of bgmPlaylist) { const c = t.category || ''; if (c) map.set(c, (map.get(c) || 0) + 1); }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

const safePlaying = (h: HowlT): boolean => { try { return h.playing(); } catch { return false; } };
// 播放门控：总开关+音乐开关+**用户已确认流量消耗**+首手势解锁+未暂停+有曲目。未 granted → 一个字节都不下载。
const bgmShouldPlay = (): boolean => settings.enabled && settings.music && settings.musicConsent === 'granted' && !bgmPaused && bgmUnlocked && bgmPlaylist.length > 0;

/** 拉取曲目清单（幂等：只成功加载一次）。缺 manifest / 离线 → 空列表、静默。 */
function ensureBgmPlaylist(): Promise<void> {
  if (bgmPlState === 'loaded') return Promise.resolve();
  if (bgmPlState === 'loading' && bgmPlPromise) return bgmPlPromise;
  bgmPlState = 'loading';
  bgmPlPromise = fetch(bgmBase() + '/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((list: unknown) => {
      bgmPlaylist = Array.isArray(list) ? list.filter((t): t is BgmTrack => !!t && typeof (t as BgmTrack).file === 'string') : [];
    })
    .catch(() => { bgmPlaylist = []; })
    .then(() => {
      bgmPlState = 'loaded'; buildBgmOrder();
      const totalBytes = bgmPlaylist.reduce((s, t) => s + (t.bytes || 0), 0);
      bgmEmit({ hasTracks: bgmPlaylist.length > 0, count: bgmPlaylist.length, totalMB: Math.round(totalBytes / 1048576) });
    });
  return bgmPlPromise;
}

/** 重建播放顺序：按当前主题(musicCategory)过滤曲目池，随机时 Fisher–Yates 打乱，尽量保留当前曲目位置。 */
function buildBgmOrder(): void {
  const cur = bgmIdx >= 0 && bgmIdx < bgmOrder.length ? bgmOrder[bgmIdx] : -1;   // 当前曲目在 playlist 里的下标
  const cat = settings.musicCategory;   // ''=全部主题；否则只收该主题
  bgmOrder = bgmPlaylist.map((_, i) => i).filter((i) => !cat || (bgmPlaylist[i].category || '') === cat);
  if (settings.musicShuffle) {
    for (let i = bgmOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = bgmOrder[i]; bgmOrder[i] = bgmOrder[j]; bgmOrder[j] = t;
    }
  }
  bgmIdx = cur >= 0 ? bgmOrder.indexOf(cur) : -1;
}

/** 取某曲目的 Howl（按 file 缓存 Promise·并发去重）；播完 onend 自动切下一首。加载失败→null。 */
function getTrackHowl(m: HowlerMod, track: BgmTrack): Promise<HowlT | null> {
  let p = bgmCache.get(track.file);
  if (!p) {
    p = new Promise<HowlT | null>((resolve) => {
      const url = bgmBase() + '/' + track.file.split('/').map(encodeURIComponent).join('/');
      const h = new m.Howl({
        src: [url], loop: false, html5: true, preload: true, volume: 0,   // html5 流式：长音频不吃内存
        onload: () => resolve(h),
        onloaderror: () => resolve(null),
        onend: () => bgmAdvance(+1),
      } as HowlOptions);
    });
    bgmCache.set(track.file, p);   // 立即缓存 Promise：并发调用共享同一次加载，不会重复 new Howl 多下一份
  }
  return p;
}

/** 播放 bgmOrder[orderIdx]（环形取模）；淡入。文件缺失→跳下一首（有防死循环上限）。 */
function bgmPlayAt(orderIdx: number): void {
  if (!bgmPlaylist.length) return;
  const n = bgmOrder.length;
  bgmIdx = ((orderIdx % n) + n) % n;
  const track = bgmPlaylist[bgmOrder[bgmIdx]];
  if (!track) return;
  ensureMod()
    .then((m) => getTrackHowl(m, track))
    .then((h) => {
      if (!h) {   // 加载失败：清单与实际文件不符时跳过，最多试一轮就停
        if (bgmPlaylist.length > 1 && bgmMissStreak < bgmOrder.length) { bgmMissStreak++; bgmAdvance(+1); }
        else { bgmMissStreak = 0; bgmEmit({ playing: false }); }
        return;
      }
      bgmMissStreak = 0;
      if (bgm && bgm !== h) { try { bgm.stop(); } catch { /* */ } }
      bgm = h;
      bgmEmit({ name: track.name, hasTracks: true });
      if (bgmShouldPlay()) {
        // 直接设目标音量再播（html5 音频上 Howler.fade 不可靠——淡入常停在 0 导致换歌静音，须动音量条才响）
        try { h.seek(0); h.volume(clamp(settings.musicVolume)); h.play(); } catch { /* */ }
        bgmEmit({ playing: true });
      }
    })
    .catch(() => { /* */ });
}

function bgmAdvance(dir: number): void { if (bgmPlaylist.length) bgmPlayAt((bgmIdx < 0 && dir < 0 ? 0 : bgmIdx) + dir); }

/** 按当前设置/暂停/解锁态起停 BGM（幂等；设置或手势变化后调用）。 */
function reconcileBgm(): void {
  if (bgmShouldPlay()) {
    if (!bgm) bgmPlayAt(bgmIdx < 0 ? 0 : bgmIdx);            // 首播或续播当前曲
    else if (!safePlaying(bgm)) { try { bgm.play(); } catch { /* */ } }
    bgmEmit({ playing: !!bgm });
  } else {
    if (bgm && safePlaying(bgm)) { try { bgm.pause(); } catch { /* */ } }   // 暂停保位置（缓存续放）
    bgmEmit({ playing: false });
  }
}

/** 首个用户手势后调用：解锁自动播放并按设置起播。 */
export function unlockBgm(): void {
  if (bgmUnlocked) return;
  bgmUnlocked = true;
  ensureBgmPlaylist().then(reconcileBgm);
}
/** 迷你播放器：播放/暂停切换（按「当前是否在放」判定，避免首次点 ▶ 反被暂停）。 */
export function bgmToggle(): void {
  if (!settings.enabled || !settings.music) return;
  bgmUnlocked = true;                 // 点播放按钮本身即一次用户手势
  bgmPaused = bgmSnap.playing;        // 正在放→暂停；没在放→起播
  reconcileBgm();
}
/** 迷你播放器：下一首。 */
export function bgmNext(): void { bgmUnlocked = true; bgmPaused = false; bgmMissStreak = 0; if (bgmPlaylist.length) bgmAdvance(+1); }
/** 迷你播放器：上一首。 */
export function bgmPrev(): void { bgmUnlocked = true; bgmPaused = false; bgmMissStreak = 0; if (bgmPlaylist.length) bgmAdvance(-1); }
