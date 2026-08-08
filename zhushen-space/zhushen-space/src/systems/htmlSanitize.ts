/* 楼内 HTML/CSS 安全渲染（参考 SillyTavern messageFormatting 的「消毒 + 作用域化」思路）：
   - sanitizeHtmlBlock：DOMPurify 白名单消毒（禁 script/事件属性/javascript:，外链媒体可开关）
   - extractStyleBlocks + renderScopedStyles/scopeCss：<style> 整块抽取 → 每条选择器强制加作用域前缀
     （ST 把楼内 CSS 锁进 .mes_text 的同款做法）→ 美化卡能改聊天区观感，永远摸不到聊天区外的应用壳
   - scopeCss 为手写 CSS 解析器（引号/括号/嵌套 at 规则感知）：不依赖 CSSOM，node 测试环境可直接单测；
     DOMPurify 在无 DOM 环境（vitest node）isSupported=false → sanitizeHtmlBlock 透传，浏览器端才真消毒。 */
import DOMPurify from 'dompurify';
import { useSettings } from '../store/settingsStore';

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── 外链媒体开关（ST「Forbid external media」同款语义，默认允许）── */
function externalMediaAllowed(): boolean {
  try { return useSettings.getState().htmlExternalMedia !== false; } catch { return true; }
}

/* ── DOMPurify 消毒 ── */
// style 单独走抽取+作用域化通道（这里禁掉防漏网）；iframe 只允许经 P3 沙箱通道注入；其余为资源/表单类危险标签。
const FORBID_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];
const RESOURCE_ATTRS = /^(?:src|srcset|poster|background|xlink:href)$/i;
let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  // 外链媒体门：仅拦「加载资源」的属性（src/srcset/poster…），不拦 <a href>（点击跳转≠自动加载）；
  // javascript: 等危险协议由 DOMPurify 默认策略处理，这里不重复。
  DOMPurify.addHook('uponSanitizeAttribute', (_node, ev) => {
    if (!RESOURCE_ATTRS.test(ev.attrName)) return;
    const v = String(ev.attrValue || '').trim();
    if (/^(?:https?:)?\/\//i.test(v) && !externalMediaAllowed()) ev.keepAttr = false;
  });
}
export function sanitizeHtmlBlock(html: string): string {
  if (!html) return html;
  if (!DOMPurify.isSupported) return html;   // node/vitest：无 DOM，透传（浏览器端必真跑）
  ensureHooks();
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      FORBID_TAGS,
      ADD_ATTR: ['target'],   // 允许 <a target="_blank">（html profile 默认不含）
    });
  } catch {
    return escapeHtmlText(html);
  }
}

/* ── <style> 块抽取（在按行拆分之前对整条消息跑）──
   闭合块 → @@ZSSTYLEn@@ 占位符（独占一行，穿过行级管线后由 renderScopedStyles 还原）；
   残留未闭合的 <style…>（流式中途/坏输出）→ 其后内容本质是半截 CSS，直接渲染会把后续文本吞进样式语义，
   截断到该处并放 @@ZSSTYLEPENDING@@ 占位（闭合标签到达后自然走上面的正常抽取）。 */
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
export function extractStyleBlocks(text: string): { text: string; styles: string[] } {
  const styles: string[] = [];
  if (!/<style\b/i.test(text)) return { text, styles };
  let out = text.replace(STYLE_RE, (_m, css) => {
    const tok = `\n@@ZSSTYLE${styles.length}@@\n`;
    styles.push(String(css));
    return tok;
  });
  const open = out.search(/<style\b/i);
  if (open >= 0) out = out.slice(0, open) + '\n@@ZSSTYLEPENDING@@\n';
  return { text: out, styles };
}

/* 把抽出的 CSS 作用域化后还原成 <style> 标签（含 LRU 缓存：流式重渲/多楼同款美化卡不重复解析）。
   ⚠ 注入走 innerHTML（HTML 解析器），CSS 里出现字面 `</style` 会提前闭合标签逃逸成 HTML——无条件剥掉。 */
export function renderScopedStyles(styles: string[], scope: string): string[] {
  const dropExt = !externalMediaAllowed();
  return styles.map((css) => {
    let scoped = scopeCssCached(css, scope);
    if (dropExt) scoped = dropExternalCssUrls(scoped);
    scoped = scoped.replace(/<\s*\/\s*style/gi, '');
    return scoped.trim() ? `<style>${scoped}</style>` : '';
  });
}
export function dropExternalCssUrls(css: string): string {
  return css.replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)'"]*\1\s*\)/gi, 'none');
}

const _scopeCache = new Map<string, string>();
export function scopeCssCached(css: string, scope: string): string {
  const k = scope + '' + css;
  const hit = _scopeCache.get(k);
  if (hit !== undefined) { _scopeCache.delete(k); _scopeCache.set(k, hit); return hit; }
  const v = scopeCss(css, scope);
  _scopeCache.set(k, v);
  if (_scopeCache.size > 120) { const first = _scopeCache.keys().next().value; if (first !== undefined) _scopeCache.delete(first); }
  return v;
}

/* ── scopeCss：给每条 CSS 规则的选择器强制加作用域前缀 ──
   - @media/@supports/@container/@layer/@scope：递归处理内部规则
   - @keyframes/@font-face/@page/@property/@counter-style/@-vendor：原样保留（内部不是元素选择器）
   - @import/@charset/@namespace 等 at 语句：一律丢弃（楼内样式不许拉外部资源，ST 同款）
   - 选择器打头的 html/body/:root：视为作用域容器本身（美化卡常写 body{背景}，在楼内语义=聊天正文区） */
export function scopeCss(css: string, scope: string): string {
  if (!css) return '';
  if (css.length > 120_000) return '';   // 防病态超长输入拖死渲染
  try { return scopeRules(stripCssComments(css), scope); } catch { return ''; }
}

function stripCssComments(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  let quote: string | null = null;
  while (i < n) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < n) { out += s[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2; continue;
    }
    out += c; i++;
  }
  return out;
}

/* 在引号/圆括号/方括号感知下，从 from 起找第一个「顶层」目标字符 */
function scanTopLevel(s: string, from: number, targets: string): { idx: number; ch: string } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && targets.includes(c)) return { idx: i, ch: c };
  }
  return { idx: -1, ch: '' };
}

/* 从 '{' 位置找到匹配的 '}'（嵌套/引号感知）；未闭合 = 吃到结尾 */
function matchBrace(s: string, openIdx: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return s.length;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const hit = scanTopLevel(s, start, sep);
    if (hit.idx < 0) { parts.push(s.slice(start)); return parts; }
    parts.push(s.slice(start, hit.idx));
    start = hit.idx + 1;
  }
}

const KEEP_VERBATIM_AT = new Set(['keyframes', 'font-face', 'page', 'property', 'counter-style']);
const RECURSE_AT = new Set(['media', 'supports', 'container', 'layer', 'scope']);

function scopeRules(src: string, scope: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    if (i >= n) break;
    const head = scanTopLevel(src, i, '{;');
    if (head.idx < 0) break;                       // 尾部残渣（无块体也无分号）：丢弃
    const header = src.slice(i, head.idx).trim();
    if (head.ch === ';') { i = head.idx + 1; continue; }   // at 语句（@import/@charset/@namespace/@layer a,b;…）：丢弃
    const close = matchBrace(src, head.idx);
    const body = src.slice(head.idx + 1, close);
    i = close + 1;
    if (!header) continue;
    if (header[0] === '@') {
      const name = header.slice(1).split(/[\s(]/, 1)[0].toLowerCase();
      if (RECURSE_AT.has(name)) {
        const inner = scopeRules(body, scope);
        if (inner.trim()) out += `${header}{${inner}}`;
      } else if (KEEP_VERBATIM_AT.has(name) || header.startsWith('@-')) {
        out += `${header}{${body}}`;
      }
      continue;                                    // 其它未知 at 规则：丢弃（宁缺勿漏）
    }
    const sels = splitTopLevel(header, ',').map((s2) => scopeSelector(s2.trim(), scope)).filter(Boolean);
    if (!sels.length) continue;
    // 命中「作用域容器自身」的规则（body/:root/html→容器，或直接写容器选择器）：只留画布类声明，
    // 剥掉会改容器自身排版流的属性——否则美化卡的页面级 body{display:flex;align-items:center} 会把
    // 整楼正文摊成横向一列列（见 CONTAINER_LAYOUT_DROP）。其余选择器照常整块输出。
    const selfSels = sels.filter((s) => s === scope);
    const otherSels = sels.filter((s) => s !== scope);
    if (otherSels.length) out += `${otherSels.join(',')}{${body}}`;
    if (selfSels.length) {
      const safe = stripContainerLayoutDecls(body);
      if (safe.trim()) out += `${scope}{${safe}}`;
    }
  }
  return out;
}

/* 会改「容器自身排版流」的属性：一旦落到正文容器上就不是美化而是毁版式。
   美化卡常按独立页面写 body{display:flex;align-items:center;justify-content:center;height:100vh}，
   楼内作用域化后 body→正文容器 → 每个段落变成横向 flex 项、纵向居中错落，正文被摊成一列列还得横向拖
   （2026-08-08 用户实拍）。背景/颜色/字体/圆角/内外边距等"画布"声明不受影响，照常生效。 */
const CONTAINER_LAYOUT_DROP = /^(?:display|position|float|clear|writing-mode|direction|zoom|contain|aspect-ratio|order|columns|column-(?:count|width|span|fill|gap|rule(?:-[a-z]+)?)|flex(?:-[a-z]+)?|grid(?:-[a-z-]+)?|align-(?:items|content|self)|justify-(?:items|content|self)|place-(?:items|content|self)|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|overflow(?:-[xy])?|inset(?:-[a-z-]+)?|top|right|bottom|left|transform(?:-[a-z]+)?)$/i;

/** 从一条规则体里剔掉 CONTAINER_LAYOUT_DROP 命中的声明（嵌套块原样留，交给浏览器）。 */
export function stripContainerLayoutDecls(body: string): string {
  return splitTopLevel(body, ';')
    .filter((d) => {
      if (!d.trim()) return false;
      if (d.includes('{')) return true;                       // CSS 嵌套规则：不是声明，别动
      const prop = d.slice(0, d.indexOf(':')).trim();
      return !(prop && CONTAINER_LAYOUT_DROP.test(prop));
    })
    .join(';');
}

/* ── 前端卡围栏抽取（P3·对齐酒馆助手 JS-Slash-Runner 的「```html 代码块 → iframe」思路）──
   只认「已闭合」的围栏：```html/```htm 显式标注，或无语言标注但内容以 <!doctype html>/<html 开头（完整文档）。
   流式期间围栏未闭合 = 原样当文本（不抽），闭合到达那一帧才抽出 → HtmlSandbox（memo）挂载后 html 不再变，
   后续流式重渲不会重建 iframe。```css/```js 等普通代码块不碰。 */
export function extractHtmlFences(text: string): { text: string; fences: string[] } {
  if (!text || !text.includes('```')) return { text, fences: [] };
  const fences: string[] = [];
  const out = text.replace(/```([A-Za-z]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g, (m, lang: string, body: string) => {
    const l = (lang || '').toLowerCase();
    const isHtml = l === 'html' || l === 'htm' || (!l && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(body));
    if (!isHtml) return m;
    fences.push(body);
    return `\n【🧩 前端卡 ${fences.length} · 已在本楼下方渲染】\n`;
  });
  return { text: out, fences };
}

function scopeSelector(sel: string, scope: string): string {
  if (!sel) return '';
  if (sel.startsWith(scope)) return sel;           // 已带作用域：不重复加
  // 打头的 html/body/:root 链（可带类/属性附加，如 body.dark）→ 换成作用域容器本身
  const m = sel.match(/^(?:(?:html|body|:root)(?:\.[\w-]+|\[[^\]]*\])*\s*)+/i);
  if (m) {
    const rest = sel.slice(m[0].length).trim();
    return rest ? `${scope} ${rest}` : scope;
  }
  return `${scope} ${sel}`;
}
