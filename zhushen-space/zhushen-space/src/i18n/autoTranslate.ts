/* 在线内容自动翻译（跨玩家 UGC）。与静态 UI 词库(en.ts/vi.ts)不同：交易行挂牌、聊天室消息、
   助战/竞技场/工坊/家族等来自**其他玩家**的中文（或任意语言）内容，无法预置词库 → 运行时机翻。
   ── 取向：贴近本土语言习惯 ──
   • 引擎=复用玩家自己配置的 LLM(resolveApiChain+apiChatFallback)，用「本地化」提示词+术语表，
     产出地道口语而非生硬直译；
   • 中文→繁體走 OpenCC(免费、免调用)；其余走 LLM；
   • 目标语=当前 UI 语言；源语=viewer 语言时不译；
   • 批处理(一屏多条合一次调用)+永久缓存(每条只译一次)，省额度省延迟。 */
import { useEffect, useState } from 'react';
import { useSettings, resolveApiChain, type UiLang } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { getTwConverter, twConverterSync } from './opencc';

// ── 语言检测（够用即可：本项目只在简/繁/英/越之间流转）──
const CJK = /[㐀-鿿豈-﫿]/;
const VI_MARK = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/;
type Src = 'zh' | 'vi' | 'en' | 'other';
export function detectLang(s: string): Src {
  if (CJK.test(s)) return 'zh';
  if (VI_MARK.test(s)) return 'vi';
  if (/[A-Za-z]/.test(s)) return 'en';
  return 'other';
}

/** 该段文本在目标 UI 语言下是否需要翻译（源≠目标；zh→繁體算"需要"，走 OpenCC）。 */
export function needsAutoTranslate(text: string, target: UiLang): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const src = detectLang(t);
  if (src === 'other') return false;
  switch (target) {
    case 'zh-Hans': return src !== 'zh';           // en/vi → 简体
    case 'zh-Hant': return true;                    // zh→繁(OpenCC) / en·vi→繁(LLM)
    case 'en':      return src !== 'en';
    case 'vi':      return src !== 'vi';
    default:        return false;
  }
}

// ── 永久缓存（每条只译一次，跨会话存活）──
const CACHE_KEY = 'drpg-mt-cache';
const CACHE_CAP = 4000;
const cache = new Map<string, string>();
let cacheLoaded = false;
function ck(text: string, target: UiLang) { return target + '' + text; }
function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, string][]) cache.set(k, v);
  } catch { /* */ }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveCacheSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      let entries = [...cache.entries()];
      if (entries.length > CACHE_CAP) entries = entries.slice(entries.length - CACHE_CAP);   // FIFO 裁剪
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch { /* 配额满则跳过，内存缓存仍在 */ }
  }, 1500);
}
export function peekMt(text: string, target: UiLang): string | null {
  loadCache();
  return cache.get(ck(text, target)) ?? null;
}

// ── 本地化提示词 + 术语表（让机翻贴近本土用法、且与 UI 词库术语一致）──
const LANG_NAME: Record<UiLang, string> = {
  'zh-Hans': '简体中文', 'zh-Hant': '繁體中文（台灣）', 'en': 'English', 'vi': 'Tiếng Việt (Vietnamese)',
};
const GLOSSARY: Partial<Record<UiLang, string>> = {
  en: '轮回乐园=Samsara Paradise; 契约者=Contractor; 乐园=Paradise; 战力=Combat Power; 阶位=Tier; 天赋=Talent; 品级=Grade; 词缀=Affix; 乐园币=Paradise Coin; 魂币=Soul Coin.',
  vi: '轮回乐园=Lạc Viên Luân Hồi; 契约者=Khế Ước Giả; 乐园=Lạc Viên; 战力=Lực Chiến; 阶位=Bậc; 天赋=Thiên Phú; 品级=Phẩm Cấp; 词缀=Thuộc Tính Phụ; 乐园币=Xu Lạc Viên; 魂币=Xu Hồn.',
};
function buildPrompt(target: UiLang): string {
  const name = LANG_NAME[target];
  const gloss = GLOSSARY[target];
  return `You are a native game localizer for a Chinese web-novel-style infinite-flow RPG (轮回乐园 / Samsara Paradise). `
    + `Localize each input string into ${name}, as written by a native ${name} gamer — natural, idiomatic, concise; NOT stiff literal machine translation. `
    + `These are short UGC fragments (item names, chat lines, seller notes, character bios). Keep numbers, symbols and formatting; do not add quotes, notes or explanations. `
    + `For cultivation/xianxia terms use community-standard readings.${gloss ? ' Glossary (keep consistent): ' + gloss : ''} `
    + `Input is a JSON array of strings. Output ONLY a JSON array of the same length and order with each string localized.`;
}
function robustParseArray(raw: string, n: number): string[] | null {
  let s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const lb = s.indexOf('['), rb = s.lastIndexOf(']');
  if (lb >= 0 && rb > lb) s = s.slice(lb, rb + 1);
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr) && arr.length === n) return arr.map((x) => String(x));
  } catch { /* */ }
  return null;
}

// ── 批处理队列：一屏内多个 useAutoText 合并成一次(每次≤40条)调用 ──
type Pending = { text: string; target: UiLang; resolve: (v: string) => void }[];
let queue: Pending = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function llmTranslate(texts: string[], target: UiLang): Promise<string[]> {
  const s = useSettings.getState();
  const legacy = s.textUseSharedApi ? s.api : s.textApi;
  const chain = resolveApiChain('autotranslate', legacy);
  const { content } = await apiChatFallback(
    chain,
    [{ role: 'system', content: buildPrompt(target) }, { role: 'user', content: JSON.stringify(texts) }],
    { timeoutMs: 45000, label: '在线内容机翻', extra: { temperature: 0.3 } },
  );
  const parsed = robustParseArray(content, texts.length);
  return parsed ?? texts;   // 解析失败 → 回退原文（不崩、不卡）
}

async function flush() {
  flushTimer = null;
  const batch = queue; queue = [];
  // 按目标语言分组；同一批内去重
  const byTarget = new Map<UiLang, Map<string, ((v: string) => void)[]>>();
  for (const p of batch) {
    let m = byTarget.get(p.target); if (!m) { m = new Map(); byTarget.set(p.target, m); }
    let arr = m.get(p.text); if (!arr) { arr = []; m.set(p.text, arr); }
    arr.push(p.resolve);
  }
  for (const [target, texts] of byTarget) {
    // 繁體 + 中文源 → OpenCC（免调用）
    const zhToHant: string[] = [], llmTexts: string[] = [];
    for (const t of texts.keys()) (target === 'zh-Hant' && detectLang(t) === 'zh' ? zhToHant : llmTexts).push(t);
    if (zhToHant.length) {
      try {
        const conv = twConverterSync() ?? await getTwConverter();
        for (const t of zhToHant) { const out = conv(t); cache.set(ck(t, target), out); texts.get(t)!.forEach((r) => r(out)); }
      } catch { for (const t of zhToHant) texts.get(t)!.forEach((r) => r(t)); }
    }
    for (let i = 0; i < llmTexts.length; i += 40) {
      const slice = llmTexts.slice(i, i + 40);
      try {
        const out = await llmTranslate(slice, target);
        slice.forEach((t, j) => { const v = out[j] ?? t; cache.set(ck(t, target), v); texts.get(t)!.forEach((r) => r(v)); });
      } catch { slice.forEach((t) => texts.get(t)!.forEach((r) => r(t))); }
    }
    saveCacheSoon();
  }
}

function enqueue(text: string, target: UiLang): Promise<string> {
  return new Promise((resolve) => {
    queue.push({ text, target, resolve });
    if (!flushTimer) flushTimer = setTimeout(flush, 80);   // 攒 80ms 合批
  });
}

/** 传入一段跨玩家 UGC 文本，返回当前 UI 语言下的显示文本。
 *  未开启/无需翻译时原样返回；有缓存立即返回；否则先返回原文、译好后自动重渲染。 */
export function useAutoText(text: string | undefined | null): string {
  const target = useSettings((s) => s.language);
  const on = useSettings((s) => s.autoTranslateOnline);
  const src = text || '';
  const active = on && !!src && needsAutoTranslate(src, target);
  const [out, setOut] = useState<string>(() => (active ? (peekMt(src, target) ?? src) : src));

  useEffect(() => {
    if (!active) { setOut(src); return; }
    const hit = peekMt(src, target);
    if (hit != null) { setOut(hit); return; }
    setOut(src);                       // 先显原文，避免闪烁空白
    let alive = true;
    enqueue(src, target).then((v) => { if (alive) setOut(v); }).catch(() => {});
    return () => { alive = false; };
  }, [src, target, active]);

  return out;
}
