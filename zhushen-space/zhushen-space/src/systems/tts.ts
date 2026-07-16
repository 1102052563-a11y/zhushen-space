// TTS 朗读（MVP：Web Speech 引擎 + 句队列播放器）
// ───────────────────────────────────────────────────────────────────────────
// 设计要点：**引擎藏在接口后，管线与引擎无关**。MVP 用浏览器自带 Web Speech(零依赖/瞬开)把
// 「清洗→切句→队列→逐句播→控制」这套引擎无关的管线立起来；日后 kokoro-js(本地中文·82M)
// 只要实现同一个 TtsEngine 接口，在 getEngine() 里按 ttsStore.engine 选择即可无痛替换。
// 播放序列用 generation token 防竞态（新朗读/停止会作废上一段的循环）。

import { useSyncExternalStore } from 'react';
import { useTts, type CloudProvider, type SovitsVoice } from '../store/ttsStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { gwProxyBase } from './apiChat';

export interface TtsVoice { id: string; label: string; lang: string; gender?: 'male' | 'female' }
export interface TtsSpeakOpts { rate?: number; voiceURI?: string }
export interface TtsEngine {
  speak(text: string, opts: TtsSpeakOpts): Promise<void>;   // 播完一段(resolve)；被 stop 打断也应尽快 settle
  stop(): void;
  voices(): TtsVoice[];
  /** 可选：预热下一句。本地大模型合成一句要 1–3 秒，不预热就每句之间断档。云/Web Speech 不需要，不实现即可。 */
  prefetch?(text: string, opts: TtsSpeakOpts): void;
}

// ── 纯逻辑①：清洗成可朗读的纯文（剥游戏指令块 / 卡片标签 / markdown / 行首 UI 符号）──
export function cleanForTts(raw: string): string {
  let s = raw || '';
  // 成对机器指令块连内文整段删（正常入库前已剥，这里兜底旧数据/归档）
  s = s.replace(/<(state|upstore|battle|image|世界结算|检定结果|状态结算|世界源|击杀结算)>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?[a-zA-Z一-龥][^>]*>/g, '');      // 残留任意尖括号标签(HTML 卡片/自闭合)
  s = s.split('\n').map((line) => {
    const t = line.trim();
    if (/^[>＞]/.test(t)) return '';                  // 引用/结算块
    if (/^【.*结算.*】/.test(t)) return '';           // 结算标题块
    return line;
  }).join('\n');
  s = s.replace(/^#{1,6}\s*/gm, '')                   // markdown 标题
    .replace(/\*\*|__|~~|`+/g, '')                    // 强调/代码符
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')          // 单星斜体
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');         // 链接留文字
  // 去装饰性 emoji/符号（保留中英文标点与文字），压缩空白
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ');
  return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

// ── 纯逻辑②：按句切块（中英句末标点 + 换行），合并过短、切分过长(>180)，防 Web Speech 长文截断 ──
export function chunkSentences(text: string, maxLen = 180): string[] {
  const parts = (text.replace(/[ \t]+/g, ' ').match(/[^。！？!?…\n]+[。！？!?…」』"]*|\n/g) || []);
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    const s = p.replace(/\n/g, '').trim();
    if (!s) continue;
    if (s.length >= maxLen) {                 // 单句就超长：先冲掉 buf，再硬切
      if (buf) { out.push(buf); buf = ''; }
      for (let i = 0; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen));
    } else if ((buf + s).length > maxLen) {
      if (buf) out.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ── 纯逻辑③：把正文切成「旁白 / 台词」段，并给台词归属说话人（治"一个声音念全部"）──
export interface TtsSegment { kind: 'narration' | 'dialogue'; text: string; speaker?: string }

const SPEECH_VERB = '说|道|问|答|喊|叫|吼|笑|冷笑|轻声|低语|开口|沉声|喝|骂|叹|念|应|回答|嘟囔|嘀咕|喃喃|嘲讽|反问|补充|解释|吩咐|命令';
function escapeReg(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 从台词前的旁白尾巴归属说话人：优先「名字+(修饰)+说话动词/：」，兜底取最后出现的已知名字。 */
export function attributeSpeaker(lead: string, knownNames: string[]): string | undefined {
  if (!lead || !knownNames.length) return undefined;
  const tail = lead.slice(-40);
  for (const name of knownNames) {
    if (new RegExp(escapeReg(name) + `[^，。！？、\\s]{0,6}(${SPEECH_VERB}|[：:])`).test(tail)) return name;
  }
  let best: string | undefined, bestIdx = -1;
  for (const name of knownNames) { const i = tail.lastIndexOf(name); if (i > bestIdx) { bestIdx = i; best = name; } }
  return best;
}

/** 按中英引号切成旁白+台词段；台词尽量归属说话人（据传入的已知名字）。 */
export function parseSegments(text: string, knownNames: string[] = []): TtsSegment[] {
  const segs: TtsSegment[] = [];
  const pushNarr = (s: string) => { const t = s.trim(); if (t) segs.push({ kind: 'narration', text: t }); };
  const re = /[「『“"]([^」』”"]*?)[」』”"]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lead = text.slice(last, m.index);
    pushNarr(lead);
    const quote = (m[1] || '').trim();
    if (quote) segs.push({ kind: 'dialogue', text: quote, speaker: attributeSpeaker(lead, knownNames) });
    last = re.lastIndex;
  }
  pushNarr(text.slice(last));
  return segs;
}

// ── 音色分配（Web Speech 无性别字段：用已知中文音色名做提示，按 NPC 性别确定性挑）──
const FEMALE_HINT = /huihui|yaoyao|xiaoxiao|xiaoyi|xiaomeng|female|女|晓|云希/i;
const MALE_HINT = /kangkang|yunyang|yunjian|yunxi|male|男|云扬/i;
function zhVoicePool(): TtsVoice[] {
  const zh = ttsVoices().filter((v) => /^zh|cmn/i.test(v.lang));
  return zh.length ? zh : ttsVoices();
}
function voiceGender(v: TtsVoice): 'male' | 'female' | undefined {
  if (v.gender) return v.gender;                 // edge 音色带显式性别；Web Speech 无 → 回退名字提示
  if (FEMALE_HINT.test(v.label)) return 'female';
  if (MALE_HINT.test(v.label)) return 'male';
  return undefined;
}
function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function npcGender(name: string): 'male' | 'female' | undefined {
  try {
    const npc = Object.values(useNpc.getState().npcs).find((r: { name?: string }) => r.name === name) as { gender?: string } | undefined;
    const g = String(npc?.gender || '');
    if (/男|male/i.test(g)) return 'male';
    if (/女|female/i.test(g)) return 'female';
  } catch { /* ignore */ }
  return undefined;
}

function pickFromPool(seed: string, gender: 'male' | 'female' | undefined): string {
  const pool = zhVoicePool();
  if (!pool.length) return '';
  const sub = gender ? pool.filter((v) => voiceGender(v) === gender) : [];
  const use = sub.length ? sub : pool;
  return use[hashStr(seed) % use.length].id;
}

/** NPC 说话人 → voiceURI：手动指定优先；否则按 NPC 性别从中文音色池确定性挑（同名恒定同音色）。 */
export function resolveNpcVoice(name: string): string {
  const st = useTts.getState();
  if (st.npcVoices[name]) return st.npcVoices[name];
  return pickFromPool(name, npcGender(name));
}

function playerGender(): 'male' | 'female' | undefined {
  try {
    const g = String((usePlayer.getState().profile as { gender?: string } | undefined)?.gender || '');
    if (/男|male/i.test(g)) return 'male';
    if (/女|female/i.test(g)) return 'female';
  } catch { /* ignore */ }
  return undefined;
}

/** 任意说话人（NPC 或 主角）→ voiceURI：主角走 playerVoice（未设按性别自动），其余走 NPC 逻辑。 */
export function resolveSpeakerVoice(name: string): string {
  try {
    const pname = usePlayer.getState().profile?.name;
    if (pname && name === pname) {
      const st = useTts.getState();
      return st.playerVoice || pickFromPool(name, playerGender());
    }
  } catch { /* ignore */ }
  return resolveNpcVoice(name);
}

// ── 引擎支持判定 ──
function webSpeechOk(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}
export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && (webSpeechOk() || typeof Audio !== 'undefined');
}

// ── Web Speech 引擎（浏览器本地·离线免费·质量一般）──
const webSpeechEngine: TtsEngine = {
  speak(text, opts) {
    return new Promise<void>((resolve) => {
      if (!webSpeechOk()) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
      if (opts.voiceURI) {
        const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === opts.voiceURI);
        if (v) u.voice = v;
      }
      u.onend = () => resolve();
      u.onerror = () => resolve();   // canceled/interrupted(stop 触发) 也 settle，交由 token 决定是否继续
      window.speechSynthesis.speak(u);
    });
  },
  stop() { if (webSpeechOk()) window.speechSynthesis.cancel(); },
  voices() {
    if (!webSpeechOk()) return [];
    const all = window.speechSynthesis.getVoices();
    const zh = all.filter((v) => /^zh|cmn/i.test(v.lang));
    const base = zh.length ? zh : all;
    const local = base.filter((v) => v.localService);
    const use = local.length ? local : base;   // 有本地音色就只用本地：Web Speech 云端音色(localService=false)常静默失败，治"试听不了"
    return use.map((v) => ({ id: v.voiceURI, label: v.name, lang: v.lang }));
  },
};

// ── Edge-TTS 引擎（经网关·微软神经语音·免 key·20+ 中文音色·质量好·需 worker 部署）──
// ⚠ 仅列**实测网关能出声**的音色（2026-07-11 逐个探针验证）——微软已下架大量 zh 音色(晓涵/晓梦/晓睿/晓辰/晓墨/云枫…返回0字节)，
// 别凭静态清单加，加前先打 /api/gw/edgetts/speech 验一遍非空音频。
const EDGE_ZH_VOICES: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（温柔女声）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（活泼女声）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北（东北话·女声）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮（陕西话·女声）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼（粤语·女声）', lang: 'zh-HK', gender: 'female' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻（台湾·女声）', lang: 'zh-TW', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: '云希（阳光男声）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（专业男声）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健（浑厚男声）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏（少年音·男）', lang: 'zh-CN', gender: 'male' },
];
// ── 云 TTS 各 provider 音色清单。Azure/Google 名多，无 key 无法逐个探针验证（报错就换一个）；OpenAI 是官方 6 音色，自建后端音色不同的话按需扩。──
const AZURE_ZH_VOICES: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（温柔女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（活泼女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵（温暖女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaomoNeural', label: '晓墨（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoqiuNeural', label: '晓秋（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿（成熟女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱（中性）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaoyanNeural', label: '晓颜（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-XiaozhenNeural', label: '晓甄（女）', lang: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: '云希（阳光男）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（专业男）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健（浑厚男）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏（少年）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunfengNeural', label: '云枫（男）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunhaoNeural', label: '云皓（男）', lang: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-YunzeNeural', label: '云泽（成熟男）', lang: 'zh-CN', gender: 'male' },
];
const GOOGLE_ZH_VOICES: TtsVoice[] = [
  { id: 'cmn-CN-Wavenet-A', label: '普通话 Wavenet-A（女）', lang: 'cmn-CN', gender: 'female' },
  { id: 'cmn-CN-Wavenet-B', label: '普通话 Wavenet-B（男）', lang: 'cmn-CN', gender: 'male' },
  { id: 'cmn-CN-Wavenet-C', label: '普通话 Wavenet-C（男）', lang: 'cmn-CN', gender: 'male' },
  { id: 'cmn-CN-Wavenet-D', label: '普通话 Wavenet-D（女）', lang: 'cmn-CN', gender: 'female' },
  { id: 'cmn-CN-Standard-A', label: '普通话 Standard-A（女）', lang: 'cmn-CN', gender: 'female' },
  { id: 'cmn-CN-Standard-B', label: '普通话 Standard-B（男）', lang: 'cmn-CN', gender: 'male' },
  { id: 'cmn-CN-Standard-C', label: '普通话 Standard-C（男）', lang: 'cmn-CN', gender: 'male' },
  { id: 'cmn-CN-Standard-D', label: '普通话 Standard-D（女）', lang: 'cmn-CN', gender: 'female' },
  { id: 'cmn-TW-Wavenet-A', label: '台湾 Wavenet-A（女）', lang: 'cmn-TW', gender: 'female' },
  { id: 'cmn-TW-Wavenet-B', label: '台湾 Wavenet-B（男）', lang: 'cmn-TW', gender: 'male' },
  { id: 'cmn-TW-Wavenet-C', label: '台湾 Wavenet-C（男）', lang: 'cmn-TW', gender: 'male' },
];
const OPENAI_VOICES: TtsVoice[] = [
  { id: 'alloy', label: 'alloy（中性）', lang: '', gender: 'female' },
  { id: 'echo', label: 'echo（男）', lang: '', gender: 'male' },
  { id: 'fable', label: 'fable（英音）', lang: '' },
  { id: 'onyx', label: 'onyx（低沉男）', lang: '', gender: 'male' },
  { id: 'nova', label: 'nova（女）', lang: '', gender: 'female' },
  { id: 'shimmer', label: 'shimmer（女）', lang: '', gender: 'female' },
];
function cloudVoices(p: CloudProvider): TtsVoice[] {
  switch (p) {
    case 'azure': return AZURE_ZH_VOICES;
    case 'google': return GOOGLE_ZH_VOICES;
    case 'openai': return OPENAI_VOICES;
    default: return EDGE_ZH_VOICES;
  }
}
function unifiedTtsEndpoint(): string { return gwProxyBase().replace(/\/api\/gw\/proxy$/, '/api/gw/tts/speech'); }

// ── 音频解锁（治浏览器自动播放策略）──
// 浏览器要求 play() 在用户手势内；edge 的 `await fetch` 之后手势已过期 → `new Audio().play()` 被拦(NotAllowedError)。
// 解法：改用 AudioContext，在点击的【同步前缀】里 resume() 一次(见 speakText/speakLine 开头的 unlockAudio)，
// AudioContext 一旦被手势 resume 便整会话保持 running，之后解码播放 MP3 不再需要新手势。
let _actx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!_actx) _actx = new AC();
  return _actx;
}
/** 必须在用户手势(点击)的同步路径里调一次以解锁音频；speakText/speakLine 开头已调。 */
export function unlockAudio(): void {
  try { const c = audioCtx(); if (c && c.state === 'suspended') void c.resume(); } catch { /* */ }
  unlockAudioEls();   // local 引擎走 <audio>（绕 CORS），它有自己的一套解锁，见下
}

// ── Web Audio 播放（云 / 本地 OpenAI 兼容共用：拿到整段音频字节 → 解码 → 播）──
let _ctxSrc: AudioBufferSourceNode | null = null;
async function playViaCtx(ctx: AudioContext, data: ArrayBuffer): Promise<void> {
  const audioBuf = await ctx.decodeAudioData(data);
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* */ } }
  await new Promise<void>((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    _ctxSrc = src;
    src.onended = () => resolve();
    try { src.start(); } catch { resolve(); }
  });
}
function stopCtxSrc(): void { if (_ctxSrc) { try { _ctxSrc.stop(); } catch { /* */ } _ctxSrc = null; } }

// ── 云 TTS 引擎（经网关统一入口 → 按 cloudProvider 翻译成 edge/openai/azure/google，一律回 MP3）──
const cloudTtsEngine: TtsEngine = {
  async speak(text, opts) {
    const ctx = audioCtx();
    if (!ctx) return;
    const st = useTts.getState();
    const body: Record<string, unknown> = {
      provider: st.cloudProvider,
      input: text,
      voice: opts.voiceURI || (st.cloudProvider === 'edge' ? 'zh-CN-XiaoxiaoNeural' : ''),
      rate: opts.rate ?? 1,
    };
    if (st.cloudProvider === 'openai') { body.baseUrl = st.openaiBaseUrl; body.apiKey = st.openaiKey; body.model = st.openaiModel || 'tts-1'; }
    else if (st.cloudProvider === 'azure') { body.apiKey = st.azureKey; body.region = st.azureRegion; }
    else if (st.cloudProvider === 'google') { body.apiKey = st.googleKey; }
    try {
      const res = await fetch(unifiedTtsEndpoint(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.warn('[TTS] 云 TTS 失败', st.cloudProvider, res.status, await res.text().catch(() => '')); return; }
      await playViaCtx(ctx, await res.arrayBuffer());
    } catch (e) { console.warn('[TTS] 云 TTS 异常', e); }
  },
  stop() { stopCtxSrc(); },
  voices() { return cloudVoices(useTts.getState().cloudProvider); },
};

// ═══ 本地自部署引擎（GPT-SoVITS api_v2 / 任意本地 OpenAI 兼容服务）═══════════════════════
// ⚠ **必须浏览器直连**：本地服务跑在玩家自己机器上，网关(Cloudflare Worker)只能连到它自己的
//   localhost，永远够不着玩家的 127.0.0.1 → 这条路不能复用 cloud 的 /api/gw/tts/speech。
//   同 imageGen 的 ComfyUI 直连（systems/imageGen.ts genComfy）。
// ⚠ **CORS**：GPT-SoVITS 的 api_v2.py 不带 CORSMiddleware → fetch 读不到响应。故播放走
//   `<audio src=GET_URL>`：媒体元素加载不受 CORS 约束，而 /tts 支持 GET 全参数、URL 能纯客户端
//   拼出来 → **玩家零改 Python 即可用**。代价=拿不到 HTTP 错误详情，只有 onerror（见下方兜底提示）。
// ⚠ **混合内容**：页面是 HTTPS，但 127.0.0.1/localhost 属"可信源"，不会被 mixed-content 拦。
// ⚠ **Chrome 142+ LNA**：公网源(pages.dev)→回环 会弹一次「允许访问本地网络」，点允许即可；
//   npm run dev(localhost) 与目标同属回环空间，不弹。
// ⚠ 本地 OpenAI 兼容那条是 POST + JSON → 绕不开 CORS，服务端必须自己开（多数已默认开）。

export interface SovitsCfg { url: string; textLang: string; streaming: boolean; extra: string }

/** 拼 GPT-SoVITS api_v2 的 GET /tts URL。纯函数（可单测）——本地引擎全靠它，不经网关。 */
export function buildSovitsUrl(cfg: SovitsCfg, v: SovitsVoice | undefined, text: string, rate = 1): string {
  const base = (cfg.url || '').trim().replace(/\/+$/, '') || 'http://127.0.0.1:9880';
  const q = new URLSearchParams({
    text,
    text_lang: cfg.textLang || 'zh',
    ref_audio_path: v?.refAudioPath || '',
    prompt_text: v?.promptText || '',
    prompt_lang: v?.promptLang || 'zh',
    speed_factor: String(Math.min(2, Math.max(0.5, rate || 1))),
    media_type: 'wav',
    streaming_mode: cfg.streaming ? 'true' : 'false',
  });
  for (const [k, val] of new URLSearchParams(cfg.extra || '')) q.set(k, val);   // 高级：额外参数覆盖默认
  return `${base}/tts?${q.toString()}`;
}

function sovitsCfg(): SovitsCfg {
  const st = useTts.getState();
  return { url: st.sovitsUrl, textLang: st.sovitsTextLang, streaming: st.sovitsStreaming, extra: st.sovitsExtra };
}
function sovitsBase(): string { return (useTts.getState().sovitsUrl || '').trim().replace(/\/+$/, '') || 'http://127.0.0.1:9880'; }
/** 指定 id 找音色；没指定/指定的已删 → 退回第一个（别让整段哑掉）。 */
function findSovitsVoice(id?: string): SovitsVoice | undefined {
  const list = useTts.getState().sovitsVoices;
  return list.find((v) => v.id === id) || list[0];
}
function weightsKey(v?: SovitsVoice): string {
  if (!v || (!v.gptWeights && !v.sovitsWeights)) return '';   // 零样本克隆（多数玩家）：不切权重
  return `${v.gptWeights || ''}|${v.sovitsWeights || ''}`;
}
let _loadedWeights = '';
/** 切角色专训权重（可选）。GPT-SoVITS 是**全局**切换且慢 → 只在与当前不同才发。
 *  ⚠ 没 CORS 读不到响应 → no-cors 只管发出去（服务端照样执行）；await 只为保证排在 /tts 之前。 */
async function ensureWeights(v: SovitsVoice | undefined): Promise<void> {
  const key = weightsKey(v);
  if (!key || key === _loadedWeights) return;
  const base = sovitsBase();
  const hit = async (path: string, w: string) => {
    try { await fetch(`${base}/${path}?weights_path=${encodeURIComponent(w)}`, { mode: 'no-cors' }); } catch { /* */ }
  };
  if (v?.gptWeights) await hit('set_gpt_weights', v.gptWeights);
  if (v?.sovitsWeights) await hit('set_sovits_weights', v.sovitsWeights);
  _loadedWeights = key;
}

// ── <audio> 元素池：乒乓 2 个，一个在播、另一个预热下一句（本地合成一句 1–3 秒，不预热句句断档）──
// ⚠ 自动播放策略：元素必须在**用户手势里**成功 play 过一次，之后换 src 再 play 才不被拦
//   → unlockAudio() 里拿一段静音 wav 解锁（与 AudioContext 那套同理，见上方注释）。
let _elPool: HTMLAudioElement[] | null = null;
let _elUnlocked = false;
let _curEl: HTMLAudioElement | null = null;
let _warm: { url: string; el: HTMLAudioElement } | null = null;
let _pendingDone: (() => void) | null = null;
let _silentUrl = '';

function silentWavUrl(): string {
  if (_silentUrl) return _silentUrl;
  const b = new Uint8Array(44);                       // 44 字节 wav 头 + 0 采样 = 合法的空音频
  const dv = new DataView(b.buffer);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); dv.setUint32(4, 36, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, 0, true);
  _silentUrl = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  return _silentUrl;
}
function elPool(): HTMLAudioElement[] | null {
  if (typeof Audio === 'undefined') return null;
  if (!_elPool) _elPool = [new Audio(), new Audio()].map((e) => { e.preload = 'auto'; return e; });
  return _elPool;
}
function idleEl(): HTMLAudioElement | null {
  const p = elPool();
  if (!p) return null;
  return p[0] === _curEl ? p[1] : p[0];
}
function unlockAudioEls(): void {
  try {
    if (_elUnlocked || useTts.getState().engine !== 'local') return;
    const p = elPool();
    if (!p) return;
    _elUnlocked = true;
    for (const el of p) { el.src = silentWavUrl(); const r = el.play(); if (r) r.then(() => el.pause()).catch(() => { /* */ }); }
  } catch { /* */ }
}
/** 播一个 URL（<audio> 直连·不受 CORS 限制）；命中预热则复用那个已经在下载的元素。 */
function playUrl(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const pool = elPool();
    if (!pool) return resolve();
    let el: HTMLAudioElement;
    if (_warm && _warm.url === url) { el = _warm.el; _warm = null; }        // 预热命中：已经在下载了
    else {
      el = idleEl() as HTMLAudioElement;
      if (_warm && _warm.el === el) _warm = null;                            // 预热的是别的句子 → 作废
      el.src = url;
    }
    _curEl = el;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.onended = null; el.onerror = null;
      if (_pendingDone === done) _pendingDone = null;
      resolve();
    };
    // 一次失败会同时触发 onerror 和 play() 的 reject → 只让先到的那条报，另一条闭嘴（否则一个错刷两行、还互相打架）
    const fail = (why: string, e?: unknown) => { if (!settled) console.warn(`[TTS] 本地 TTS ${why}`, url, e ?? ''); done(); };
    _pendingDone = done;                                                     // stop() 要能把它 settle 掉，否则队列卡死
    el.onended = done;
    el.onerror = () => fail('取不到音频（服务没启动 / 参考音频路径不存在 / 参数不对 / 未授权本地网络）：');
    const p = el.play();
    if (p) {
      p.catch((e: unknown) => {
        // ⚠ 只有 NotAllowedError 才是自动播放策略；NotSupportedError 等一律是上面那条请求没成功，
        //   别把「服务没开」误报成「先点一下页面」——会把人带到完全错的方向去查。
        if ((e as { name?: string } | null)?.name === 'NotAllowedError') fail('被自动播放策略拦下（先在页面上点一下，再朗读）：', e);
        else fail('无法播放（音频没能加载，看上一条）：', e);
      });
    }
  });
}

/** 本地 OpenAI 兼容端（POST /v1/audio/speech）：绕不开 CORS，服务端得自己开。 */
async function speakLocalOpenai(text: string, opts: TtsSpeakOpts): Promise<void> {
  const st = useTts.getState();
  const base = (st.localOpenaiUrl || '').trim().replace(/\/+$/, '');
  if (!base) { console.warn('[TTS] 未填本地 OpenAI 兼容端地址'); return; }
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(st.localOpenaiKey ? { Authorization: `Bearer ${st.localOpenaiKey}` } : {}) },
      body: JSON.stringify({
        model: st.localOpenaiModel || 'tts-1',
        input: text,
        voice: opts.voiceURI || '',
        speed: Math.min(2, Math.max(0.5, opts.rate ?? 1)),
      }),
    });
    if (!res.ok) { console.warn('[TTS] 本地 OpenAI 兼容端失败', res.status, await res.text().catch(() => '')); return; }
    await playViaCtx(ctx, await res.arrayBuffer());
  } catch (e) { console.warn('[TTS] 本地 OpenAI 兼容端异常（多半是服务没开 CORS，或没启动）', e); }
}

const localTtsEngine: TtsEngine = {
  async speak(text, opts) {
    const st = useTts.getState();
    if (st.localProvider === 'openai') return speakLocalOpenai(text, opts);
    const v = findSovitsVoice(opts.voiceURI);
    if (!v || !v.refAudioPath) { console.warn('[TTS] GPT-SoVITS 还没配音色 → 到「🔊 语音」页加一个（要填参考音频路径）'); return; }
    await ensureWeights(v);
    await playUrl(buildSovitsUrl(sovitsCfg(), v, text, opts.rate));
  },
  stop() {
    for (const el of elPool() || []) { try { el.pause(); } catch { /* */ } }
    _curEl = null; _warm = null;
    if (_pendingDone) { const d = _pendingDone; _pendingDone = null; d(); }   // pause 不触发 onended → 手动 settle
    stopCtxSrc();
  },
  voices() {
    const st = useTts.getState();
    if (st.localProvider === 'openai') {
      return (st.localOpenaiVoiceList || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ id: s, label: s, lang: '' }));
    }
    return st.sovitsVoices.map((v) => ({ id: v.id, label: v.label || v.id, lang: v.promptLang || 'zh', gender: v.gender }));
  },
  prefetch(text, opts) {
    const st = useTts.getState();
    if (st.localProvider !== 'gptsovits' || !text) return;
    const v = findSovitsVoice(opts.voiceURI);
    if (!v || !v.refAudioPath) return;
    if (weightsKey(v) && weightsKey(v) !== _loadedWeights) return;   // 需切权重 → 预热会拿上个角色的权重合成，放弃
    const url = buildSovitsUrl(sovitsCfg(), v, text, opts.rate);
    if (_warm?.url === url) return;
    const el = idleEl();
    if (!el || el === _curEl) return;
    el.src = url;
    try { el.load(); } catch { /* */ }
    _warm = { url, el };
  },
};

// 引擎选择：Web Speech(浏览器本地) / local(玩家自部署·直连) / 云 TTS（兼容旧持久化值 'edge' → 云）
function getEngine(): TtsEngine {
  const e = useTts.getState().engine;
  if (e === 'webspeech') return webSpeechEngine;
  if (e === 'local') return localTtsEngine;
  return cloudTtsEngine;
}

// ── 队列管理器（引擎无关）──
let _speaking = false;
let _token = 0;                                  // 每次朗读/停止自增，作废上一段循环
const _subs = new Set<() => void>();
function notify() { _subs.forEach((f) => f()); }

export function isTtsSpeaking(): boolean { return _speaking; }
export function subscribeTts(cb: () => void): () => void { _subs.add(cb); return () => _subs.delete(cb); }

/** 朗读一段原始正文：清洗 → 切句 → 逐句经当前引擎播；再次调用会打断上一段。 */
export async function speakText(raw: string): Promise<void> {
  unlockAudio();                                 // 必须在点击的同步前缀里解锁音频（治自动播放拦截）
  const myToken = ++_token;                      // 作废任何在跑的循环
  const engine = getEngine();
  engine.stop();
  const st = useTts.getState();
  const clean = cleanForTts(raw);

  // 组装「(文本, 音色)」播放单元：开了旁白/台词分离就按段分配音色，否则整段单声
  const units: { text: string; voiceURI: string }[] = [];
  if (st.dialogueSplit) {
    let knownNames: string[] = [];
    try {
      knownNames = Object.values(useNpc.getState().npcs).filter((r: { name?: string; id: string }) => r.name && r.name !== r.id).map((r) => r.name as string);
      const pname = usePlayer.getState().profile?.name; if (pname) knownNames.push(pname);   // 主角台词也归属→用主角音色
    } catch { /* ignore */ }
    for (const seg of parseSegments(clean, knownNames)) {
      const voice = seg.kind === 'dialogue' && seg.speaker ? resolveSpeakerVoice(seg.speaker) : (st.narratorVoice || '');
      for (const c of chunkSentences(seg.text)) units.push({ text: c, voiceURI: voice });
    }
  } else {
    for (const c of chunkSentences(clean)) units.push({ text: c, voiceURI: st.voiceURI });
  }

  if (!units.length) { if (_speaking) { _speaking = false; notify(); } return; }
  _speaking = true; notify();
  try {
    for (let i = 0; i < units.length; i++) {
      if (myToken !== _token) return;            // 被新朗读/停止取代
      const next = units[i + 1];                 // 边播这句边预热下一句（本地大模型合成一句 1–3 秒，不预热句句断档）
      if (next) engine.prefetch?.(next.text, { rate: st.rate, voiceURI: next.voiceURI });
      await engine.speak(units[i].text, { rate: st.rate, voiceURI: units[i].voiceURI });
      if (myToken !== _token) return;
    }
  } finally {
    if (myToken === _token) { _speaking = false; notify(); }
  }
}

export function stopTts(): void {
  _token++;                                      // 作废在跑的循环
  getEngine().stop();
  if (_speaking) { _speaking = false; notify(); }
}

/** 朗读单独一句（供正文行内小喇叭点击用）：指定 voiceURI 则用它，否则用旁白音色。会打断当前朗读。 */
export async function speakLine(raw: string, voiceURI?: string): Promise<void> {
  unlockAudio();                                 // 点击同步前缀里解锁音频（治自动播放拦截）
  const myToken = ++_token;
  const engine = getEngine();
  engine.stop();
  const chunks = chunkSentences(cleanForTts(raw));
  if (!chunks.length) { if (_speaking) { _speaking = false; notify(); } return; }
  _speaking = true; notify();
  const st = useTts.getState();
  const voice = voiceURI ?? st.narratorVoice ?? '';
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (myToken !== _token) return;
      if (chunks[i + 1]) engine.prefetch?.(chunks[i + 1], { rate: st.rate, voiceURI: voice });
      await engine.speak(chunks[i], { rate: st.rate, voiceURI: voice });
      if (myToken !== _token) return;
    }
  } finally {
    if (myToken === _token) { _speaking = false; notify(); }
  }
}

export function ttsVoices(): TtsVoice[] { return getEngine().voices(); }

// ── React 绑定：朗读状态订阅（button 图标据此切换 🔊/⏹）──
export function useTtsSpeaking(): boolean {
  return useSyncExternalStore(subscribeTts, () => _speaking, () => false);
}
