// TTS 朗读（MVP：Web Speech 引擎 + 句队列播放器）
// ───────────────────────────────────────────────────────────────────────────
// 设计要点：**引擎藏在接口后，管线与引擎无关**。MVP 用浏览器自带 Web Speech(零依赖/瞬开)把
// 「清洗→切句→队列→逐句播→控制」这套引擎无关的管线立起来；日后 kokoro-js(本地中文·82M)
// 只要实现同一个 TtsEngine 接口，在 getEngine() 里按 ttsStore.engine 选择即可无痛替换。
// 播放序列用 generation token 防竞态（新朗读/停止会作废上一段的循环）。

import { useSyncExternalStore } from 'react';
import { useTts, type CloudProvider } from '../store/ttsStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { gwProxyBase } from './apiChat';

export interface TtsVoice { id: string; label: string; lang: string; gender?: 'male' | 'female' }
export interface TtsSpeakOpts { rate?: number; voiceURI?: string }
export interface TtsEngine {
  speak(text: string, opts: TtsSpeakOpts): Promise<void>;   // 播完一段(resolve)；被 stop 打断也应尽快 settle
  stop(): void;
  voices(): TtsVoice[];
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
export function unlockAudio(): void { try { const c = audioCtx(); if (c && c.state === 'suspended') void c.resume(); } catch { /* */ } }

// ── 云 TTS 引擎（经网关统一入口 → 按 cloudProvider 翻译成 edge/openai/azure/google，一律回 MP3）──
let _cloudSrc: AudioBufferSourceNode | null = null;
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
      const audioBuf = await ctx.decodeAudioData(await res.arrayBuffer());
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* */ } }
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);
        _cloudSrc = src;
        src.onended = () => resolve();
        try { src.start(); } catch { resolve(); }
      });
    } catch (e) { console.warn('[TTS] 云 TTS 异常', e); }
  },
  stop() { if (_cloudSrc) { try { _cloudSrc.stop(); } catch { /* */ } _cloudSrc = null; } },
  voices() { return cloudVoices(useTts.getState().cloudProvider); },
};

// 引擎选择：本地 Web Speech / 云 TTS（engine !== 'webspeech' 即云；兼容旧持久化值 'edge'）
function getEngine(): TtsEngine { return useTts.getState().engine === 'webspeech' ? webSpeechEngine : cloudTtsEngine; }

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
    for (const u of units) {
      if (myToken !== _token) return;            // 被新朗读/停止取代
      await engine.speak(u.text, { rate: st.rate, voiceURI: u.voiceURI });
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
    for (const c of chunks) {
      if (myToken !== _token) return;
      await engine.speak(c, { rate: st.rate, voiceURI: voice });
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
