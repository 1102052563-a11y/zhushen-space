/* 游戏音效引擎（懒加载 Howler）。
   - 音频文件放 public/audio/<名>.<mp3|wav|ogg>；引擎按 mp3→wav→ogg 顺序尝试加载，加载失败自动试下一个
     （你后丢的 mp3 会优先于自带的 wav 占位）。全缺→静默跳过、绝不报错、不影响游戏。
   - Howler 仅在「开启音效 + 首次真正播放」时才动态 import（独立 chunk·不进主 chunk）。
   - 设置（开关/音量/环境音）由 App 通过 setAudioSettings 推入，引擎与 store 解耦。
   - 移动端自动播放解锁交给 Howler 内置 autoUnlock（首次用户手势后解锁音频上下文）。*/
import type { Howl as HowlT, HowlOptions } from 'howler';

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

let settings = { enabled: true, volume: 0.7, ambient: true, ambientVolume: 0.4 };
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
