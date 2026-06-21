/* 游戏音效引擎（懒加载 Howler）。
   - 音频文件放 public/audio/<名>.<mp3|wav|ogg>；引擎首次用到某个音时用 HEAD 探测哪个扩展存在（mp3 优先→
     你后丢的 mp3 会覆盖自带的 wav 占位）。全缺→静默跳过、绝不报错、不影响游戏。
   - Howler 仅在「开启音效 + 首次真正播放」时才动态 import（独立 chunk·不进主 chunk）。
   - 设置（开关/音量/环境音）由 App 通过 setAudioSettings 推入，引擎与 store 解耦。
   - 移动端自动播放解锁交给 Howler 内置 autoUnlock（首次用户手势后解锁音频上下文）。*/
import type { Howl as HowlT, HowlOptions } from 'howler';

type HowlerMod = typeof import('howler');
let mod: HowlerMod | null = null;
let loadingMod: Promise<HowlerMod> | null = null;

/* 一次性音效：key → public/audio/<file>.<ext> 的 <file> 名 */
const SFX: Record<string, string> = {
  dice: 'dice', hit: 'hit', crit: 'crit', block: 'block', heal: 'heal', msg: 'msg',
  fanfare: 'fanfare', levelup: 'levelup', coin: 'coin', slot: 'slot', win: 'win', open: 'open',
};
/* 环境循环音：weatherFx 的 kind → <file> 名（sun/overcast/none 无环境音） */
const AMBIENT: Record<string, string> = {
  rain: 'amb-rain', thunder: 'amb-thunder', snow: 'amb-snow', wind: 'amb-wind', fog: 'amb-fog',
};
const EXTS = ['mp3', 'wav', 'ogg'];   // 探测优先级：用户 mp3 > 自带 wav 占位 > ogg

let settings = { enabled: true, volume: 0.7, ambient: true, ambientVolume: 0.4 };
const cache = new Map<string, HowlT>();        // 已加载的一次性音效（Howler 自带池化叠放）
const urlCache = new Map<string, string | null>();   // <file> → 实际存在的 url（null=都没有，不再探测）
let ambient: HowlT | null = null;
let ambientKey = '';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function ensureMod(): Promise<HowlerMod> {
  if (mod) return Promise.resolve(mod);
  if (!loadingMod) loadingMod = import('howler').then((m) => { mod = m; return m; });
  return loadingMod;
}

/** 探测某音频文件实际的扩展（mp3→wav→ogg）；都不存在返回 null（缓存结果，只探一次）。 */
async function resolveUrl(file: string): Promise<string | null> {
  if (urlCache.has(file)) return urlCache.get(file) ?? null;
  for (const ext of EXTS) {
    try {
      const r = await fetch(`/audio/${file}.${ext}`, { method: 'HEAD', cache: 'force-cache' });
      if (r.ok) { const u = `/audio/${file}.${ext}`; urlCache.set(file, u); return u; }
    } catch { /* */ }
  }
  urlCache.set(file, null);
  return null;
}

/** App 推入设置（开关/音量/环境音开关与音量）。关闭→静音并停环境音。 */
export function setAudioSettings(s: Partial<typeof settings>): void {
  settings = { ...settings, ...s };
  if (mod) mod.Howler.volume(settings.enabled ? clamp(settings.volume) : 0);
  if (!settings.enabled || !settings.ambient) stopAmbient();
  else if (ambient) { try { ambient.volume(clamp(settings.ambientVolume)); } catch { /* */ } }
}

/** 播放一次性音效（未开启 / 文件全缺时静默）。 */
export function playSfx(key: string): void {
  if (!settings.enabled) return;
  const file = SFX[key];
  if (!file || urlCache.get(file) === null) return;
  ensureMod().then(async (m) => {
    if (!settings.enabled) return;
    let s = cache.get(key);
    if (!s) {
      const url = await resolveUrl(file);
      if (!url || !settings.enabled) return;
      s = new m.Howl({ src: [url], volume: clamp(settings.volume), html5: false, preload: true } as HowlOptions);
      cache.set(key, s);
    }
    try { s.volume(clamp(settings.volume)); s.play(); } catch { /* */ }
  }).catch(() => { /* */ });
}

/** 切换环境循环音（按天气 kind；无对应文件 / 关闭时停）。 */
export function setAmbient(kind: string): void {
  if (!settings.enabled || !settings.ambient) { stopAmbient(); return; }
  const file = AMBIENT[kind];
  if (!file || urlCache.get(file) === null) { stopAmbient(); return; }
  if (ambientKey === kind && ambient) return;   // 已在放同一种
  ensureMod().then(async (m) => {
    if (!settings.enabled || !settings.ambient) return;
    const url = await resolveUrl(file);
    if (!url || AMBIENT[kind] !== file || !settings.enabled || !settings.ambient) return;
    stopAmbient();
    const vol = clamp(settings.ambientVolume);
    const a = new m.Howl({ src: [url], loop: true, volume: 0, html5: true } as HowlOptions);
    ambient = a; ambientKey = kind;
    try { a.play(); a.fade(0, vol, 800); } catch { /* */ }
  }).catch(() => { /* */ });
}

export function stopAmbient(): void {
  if (ambient) { try { ambient.stop(); ambient.unload(); } catch { /* */ } ambient = null; ambientKey = ''; }
}
