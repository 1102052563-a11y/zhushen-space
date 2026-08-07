/* 正文 / 用户消息 → HTML 渲染（纯函数·无副作用·从 App.tsx 抽出 2026-06-19）。
   - wrapSettlementBlocks/toHtml：把模块结算块（> 引用块 / 【…结算…】块）打包成琥珀格子，HTML 感知透传
   - renderDiceCard / renderKillCard / renderSettlementCard：检定骰子卡 / 击杀结算卡 / 世界结算卡
   - userToHtml：用户消息（转义 + 把 <检定结果> 块替换成骰子卡）
   - toHtmlWithImages：正文（占位符法插入配图 + 各结算卡）
   仅 userToHtml / toHtmlWithImages / StoryImage 对外导出，其余为内部 helper。 */
import { useSettings } from '../store/settingsStore';
import { translateNarrativeLabels, viDictReady } from '../i18n/translate';
import { getCodexIndex, scanEntities, type CodexIndex } from './codexIndex';
import { sanitizeHtmlBlock, extractStyleBlocks, renderScopedStyles } from './htmlSanitize';

export interface StoryImage { anchor: string; url: string; prompt: string; nsfw: string; ts: number }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attrEsc(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* ── 正文关键词悬浮图鉴：给已知实体名套 <span class="zs-ent">（悬浮卡由 CodexHover 委托监听接管）──
   ctx 贯穿整条消息的渲染：seen 让同一实体**只标首次**（主角名出现二十次不会变成二十条下划线）。 */
export interface ProseCtx { idx: CodexIndex | null; seen: Set<string> }
const NO_CODEX: ProseCtx = { idx: null, seen: new Set() };

function readingCodex(): { on: boolean; wiki: boolean } {
  try {
    const r = useSettings.getState().reading as { codexHl?: boolean; codexWiki?: boolean } | undefined;
    return { on: r?.codexHl !== false, wiki: r?.codexWiki === true };   // 缺省=开（老存档没这字段也生效）
  } catch { return { on: false, wiki: false }; }
}
function makeProseCtx(): ProseCtx {
  const { on, wiki } = readingCodex();
  if (!on) return NO_CODEX;
  try { return { idx: getCodexIndex(wiki), seen: new Set() }; } catch { return { idx: null, seen: new Set() }; }
}

/* 在「已转义的散文行 HTML」里标实体名。⚠ 只在纯文本段内匹配——<标签> / &实体; / @@ZS…@@ 占位符
   一律整体透传，故不会插进 narr-dialogue/narr-inner 的 span 里、不会污染 dialogue-play 的 data-line、
   也不会把待替换的骰子卡/配图占位符切断。 */
function markEntities(html: string, ctx: ProseCtx): string {
  const idx = ctx.idx;
  if (!idx) return html;
  const n = html.length;
  let out = ''; let i = 0;
  while (i < n) {
    const c = html[i];
    if (c === '<') {                                                    // 标签整体透传
      const j = html.indexOf('>', i);
      if (j < 0) { out += html.slice(i); break; }
      out += html.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '&') {                                                    // &amp; / &lt; / &gt; 整体透传
      const j = html.indexOf(';', i);
      if (j > i && j - i <= 8) { out += html.slice(i, j + 1); i = j + 1; continue; }
    }
    if (c === '@' && html.startsWith('@@ZS', i)) {                      // 占位符整体透传
      const j = html.indexOf('@@', i + 4);
      if (j > 0) { out += html.slice(i, j + 2); i = j + 2; continue; }
    }
    let j = i + 1;
    while (j < n && html[j] !== '<' && html[j] !== '&' && !(html[j] === '@' && html.startsWith('@@ZS', j))) j++;
    out += markSegment(html.slice(i, j), ctx, idx);
    i = j;
  }
  return out;
}
function markSegment(seg: string, ctx: ProseCtx, idx: CodexIndex): string {
  const ms = scanEntities(seg, idx, ctx.seen);
  if (!ms.length) return seg;
  let out = ''; let p = 0;
  for (const m of ms) {
    out += seg.slice(p, m.start);
    // key 里含实体名（可能带引号/尖括号）→ 必须转义，否则能从属性里逃逸出来
    out += `<span class="zs-ent" data-ek="${attrEsc(m.entry.key)}">${seg.slice(m.start, m.end)}</span>`;
    p = m.end;
  }
  return out + seg.slice(p);
}

/* 正文散文行「美化」：对话高亮 + 心理/旁白弱化（纯确定性·不依赖 AI 输出任何标记）。
   仅在 wrapSettlementBlocks 的「普通散文行」分支调用（结算块/HTML 行/占位符行不进这里）；入参已 escapeHtml。
   **永远输出 span**——是否真着色由正文容器的 data-dlg / data-inner 属性 + CSS 决定，故开关是纯 CSS、即时生效、
   不必重算/重渲 HTML（渲染缓存照旧有效）。
   ⚠ 悬浮图鉴的 .zs-ent 不同：它依赖词典内容，故走渲染缓存签名（codex 版本进 sig），不能纯 CSS 切。 */
function styleProse(escaped: string, ctx: ProseCtx): string {
  let s = escaped;
  // 对话：中文「」/『』 + 全角/半角双引号 → 高亮（引号一并包进去）
  s = s.replace(/(「[^「」\n]{0,400}」|『[^『』\n]{0,400}』|“[^“”\n]{0,400}”|"[^"\n]{1,300}")/g, '<span class="narr-dialogue">$1</span>');
  // 心理/旁白弱化：*…*（去掉星号）与 全角（…）（保留括号）→ 弱化色，让旁白/心声从主叙述里退后
  s = s.replace(/\*([^*\n]{1,300}?)\*/g, '<span class="narr-inner">$1</span>');
  s = s.replace(/（([^（）\n]{1,300}?)）/g, '<span class="narr-inner">（$1）</span>');
  return markEntities(s, ctx);
}

// ── 对话行内小喇叭（可点朗读该句）：说话人归属 + 图标 HTML（纯函数·归属逻辑与 tts.ts 一致，独立写以免拖 store 依赖）──
const TTS_VERB = '说|道|问|答|喊|叫|吼|笑|冷笑|轻声|低语|开口|沉声|喝|骂|叹|念|应|回答|嘟囔|嘀咕|喃喃|嘲讽|反问|补充|解释|吩咐|命令';
export function ttsAttribSpeaker(lead: string, names: string[]): string | undefined {
  if (!lead || !names.length) return undefined;
  const tail = lead.slice(-40);
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc + `[^，。！？、\\s]{0,6}(${TTS_VERB}|[：:])`).test(tail)) return n;
  }
  let best: string | undefined, bi = -1;
  for (const n of names) { const i = tail.lastIndexOf(n); if (i > bi) { bi = i; best = n; } }
  return best;
}
function dialogueIconHtml(line: string, speaker: string): string {
  const attr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');
  return `<span class="dialogue-play" role="button" tabindex="0" data-line="${attr(line)}" data-speaker="${attr(speaker)}" title="朗读这句" aria-label="朗读这句" style="cursor:pointer;font-size:0.78em;opacity:0.5;margin:0 0.12em;vertical-align:0.08em;user-select:none">🔊</span>`;
}

// 模块块标题（无 > 前缀时的兜底识别）。模块化输出规范见 ST_WI_Modular_Output：
// 时间结算/动作日志/击杀结算/成长结算/判定块/战斗块/信息卡/登场/离场/装备替换/任务推进/目标/提示/主角资源/敌方信息/环境效果…
const SETTLE_HEADER_RE = /^\s*\*{0,2}\s*【[^】]*(结算|日志|战报|战斗|掉落|奖励|登场|离场|信息卡|资源|敌方|环境效果|判定|目标|提示|任务|成长|装备替换|获得|获取|入手|拾取|战利品|开启|物品|宝箱|商店|交易|购买)[^】]*】/;
function renderSettleBlock(title: string, body: string[]): string {
  // 标题里若紧跟正文（AI 常把「【动作日志】+整段结算」写在同一行）→ 拆出真正的 【标题】，
  // 余下内容并入正文，避免整段挤进标题行。
  let realTitle = title;
  const merged = [...body];
  if (title) {
    const m = title.match(/^(\s*【[^】]*】)([\s\S]*)$/);
    if (m) {
      realTitle = m[1].trim();
      const rest = m[2].trim();
      if (rest) merged.unshift(rest);
    }
  }
  // 把每段正文按句末标点（。；！？等）拆成多行，避免一长串结算文字挤成一坨
  const splitClauses = (s: string): string[] => {
    const raw = s.replace(/([。；！？;!?])\s*/g, '$1\n').split('\n').map((x) => x.trim()).filter(Boolean);
    // 修复"】等收尾符号被句末标点切到下一行、独占一行"：仅由收尾括号/标点组成的碎片并回上一行
    const out: string[] = [];
    for (const c of raw) {
      if (out.length && /^[】」』）)\]》〕＞>"”'’。，、；;！!？?…·\s]+$/.test(c)) out[out.length - 1] += c;
      else out.push(c);
    }
    return out;
  };
  const lines = merged.flatMap(splitClauses);
  // 结算块「结构化标签」本地化：en/vi 界面下把块标题/字段/单位的中文换成当前语言（正文散文不受影响·仅这些模板标签）
  const _lang = (() => { try { return useSettings.getState().language; } catch { return 'zh-Hans'; } })();
  const L = (_lang === 'en' || _lang === 'vi') ? (s: string) => translateNarrativeLabels(s, _lang) : (s: string) => s;
  const head = realTitle
    ? `<div class="text-[13px] font-bold text-amber-300 mb-1 tracking-wider">${escapeHtml(L(realTitle))}</div>`
    : '';
  const bodyHtml = lines.length
    ? lines.map((l) => `<div>${escapeHtml(L(l))}</div>`).join('')
    : '';
  return '<div class="my-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2">' + head +
    `<div class="text-[15px] text-slate-200/90 leading-relaxed space-y-0.5">${bodyHtml}</div>` +
    '</div>';
}
// 把模块块（橙线引用块 + 标题块）用"格子"包起来突出显示。
// HTML 感知：含 HTML 标签的行/区域原样透传（让 ST 正则输出的 HTML 卡片正常渲染），
// 同时仍对同一条消息里的 > 引用块 / 【…结算…】块打包——修复"消息里只要有一处 HTML，
// 整条消息就跳过结算格子，导致 > 模块块退化成普通框"的问题。
function wrapSettlementBlocks(text: string, ctx: ProseCtx): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const isQuote = (l: string) => /^\s*[>＞]\s*\S/.test(l);   // 容多空格/Tab/全角＞ 前缀（AI 常缩进体行，否则散落在卡外不被包裹）
  const isHtmlLine = (l: string) => /<[a-zA-Z/][^>]*>/.test(l);
  const opensHtml = (l: string) => (l.match(/<(div|details|table|section|article|blockquote|ul|ol|pre)\b/gi) ?? []).length;
  const closesHtml = (l: string) => (l.match(/<\/(div|details|table|section|article|blockquote|ul|ol|pre)>/gi) ?? []).length;
  const unquote = (l: string) => l.replace(/^\s*[>＞]\s*/, '').replace(/\*\*/g, '');
  let i = 0;
  let htmlDepth = 0;   // 处于未闭合的 HTML 块内时，一律原样透传，不当结算块处理
  while (i < lines.length) {
    const line = lines[i];
    // 0) HTML 行：按嵌套深度整块收行到闭合、块内行以 \n 拼接——旧实现逐行 push，行间被最外层
    //    join('<br>') 插 <br>，多行卡片/表格被打碎；组装完整块后统一过 DOMPurify 白名单消毒
    //    （禁 script/事件属性/javascript:，外链媒体按设置开关），details 默认展开。
    if (htmlDepth > 0 || isHtmlLine(line)) {
      const buf: string[] = [];
      do {
        buf.push(lines[i].replace(/<details\b/gi, '<details open'));
        htmlDepth = Math.max(0, htmlDepth + opensHtml(lines[i]) - closesHtml(lines[i]));
        i++;
      } while (i < lines.length && htmlDepth > 0);
      out.push(sanitizeHtmlBlock(buf.join('\n')));
      continue;
    }
    // 1) 连续 > 引用行 = 模块块（规范要求每行带 > 前缀）→ 整段打包
    if (isQuote(line)) {
      const run: string[] = [];
      while (i < lines.length && isQuote(lines[i]) && !isHtmlLine(lines[i])) { run.push(unquote(lines[i])); i++; }
      const hasTitle = /【.+】/.test(run[0] ?? '');
      out.push(renderSettleBlock(hasTitle ? run[0].trim() : '', hasTitle ? run.slice(1) : run));
      continue;
    }
    // 2) 无 > 前缀但以【…模块名…】开头：兜底打包。连同其后的体行（含带 > 前缀的引用体行）一并并入【同一张卡】，
    //    修复"标题进了琥珀格子、> 体行却散落在卡外没被包裹"。到空行/下个标题/HTML 行止；标题与体行间允许一个空行。
    if (SETTLE_HEADER_RE.test(line)) {
      const header = line.replace(/\*\*/g, '').trim();
      i++;
      if (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length && isQuote(lines[i + 1])) i++;   // 容标题与 > 体行间一个空行
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !SETTLE_HEADER_RE.test(lines[i]) && !isHtmlLine(lines[i])) {
        body.push(unquote(lines[i])); i++;   // unquote 兼容带 > 前缀（含多空格）的体行：剥掉 > 再并入本卡
      }
      out.push(renderSettleBlock(header, body));
      continue;
    }
    out.push(styleProse(escapeHtml(line), ctx));   // 普通散文行：转义后套对话/心理美化 span（是否着色由容器 data 属性 + CSS 决定）+ 实体标注
    i++;
  }
  return out.join('<br>');
}

// 将正文内容转为 HTML：始终走 HTML 感知的结算块打包（既渲染 ST 正则输出的 HTML，
// 又对 > 模块块/【…结算…】块统一打琥珀格子，二者可在同一条消息里共存）。
function toHtml(text: string, ctx: ProseCtx = NO_CODEX): string {
  // <style> 块先整体抽出（跨行·只认闭合对），行级管线跑完再以「作用域化+消毒」形态还原：
  // 每条选择器强制加 .narrative-content 前缀（ST 把楼内 CSS 锁进 .mes_text 的同款思路）——
  // 美化卡可从任意楼层改聊天区观感（含其他楼层），但永远摸不到聊天区外的应用壳。
  const { text: work, styles } = extractStyleBlocks(text);
  let html = wrapSettlementBlocks(work, ctx);
  if (styles.length) {
    // 替换必须用回调形式：CSS 里可能含 $&/$1 等序列，字符串形式会被当替换模板解析
    renderScopedStyles(styles, '.narrative-content').forEach((tag, idx) => {
      html = html.replace(new RegExp(`(?:<br>)?@@ZSSTYLE${idx}@@(?:<br>)?`, 'g'), () => tag);
    });
  }
  html = html.replace(/(?:<br>)?@@ZSSTYLEPENDING@@(?:<br>)?/g,
    '<span class="text-[12px] text-dim/50 font-mono">🎨 样式加载中…</span>');
  return html;
}

/* 检定结果卡片：把 <检定结果>…</检定结果> 块渲染成彩色骰子卡（按成功等级着色）。
   注意：类名用 DICE_STYLE 里的【完整字面量】，勿做片段拼接（Tailwind 只收录源码里出现的完整类名）。*/
const DICE_STYLE: Record<string, { b: string; t: string }> = {
  大成功: { b: 'border-amber-500/50 bg-amber-900/20', t: 'text-amber-300' },
  碾压成功: { b: 'border-emerald-600/50 bg-emerald-900/15', t: 'text-emerald-300' },
  极难成功: { b: 'border-emerald-600/50 bg-emerald-900/15', t: 'text-emerald-300' },
  困难成功: { b: 'border-emerald-700/40 bg-emerald-900/15', t: 'text-emerald-300' },
  成功: { b: 'border-emerald-700/40 bg-emerald-900/15', t: 'text-emerald-300' },
  失败: { b: 'border-slate-600/40 bg-slate-800/30', t: 'text-slate-300' },
  大失败: { b: 'border-red-700/50 bg-red-900/20', t: 'text-red-300' },
};
const DICE_LEVELS = ['大成功', '碾压成功', '极难成功', '困难成功', '大失败', '失败', '成功'];
function renderDiceCard(inner: string): string {
  const text = String(inner).trim();
  const firstLine = text.split('\n')[0];
  const arrow = firstLine.indexOf('→');
  const head = arrow >= 0 ? firstLine.slice(0, arrow).trim() : '';
  const after = arrow >= 0 ? firstLine.slice(arrow + 1) : firstLine;
  const level = DICE_LEVELS.find((L) => after.includes(L)) || DICE_LEVELS.find((L) => text.includes(L)) || '成功';
  // 取最后一个括号组作算式（格式可能是「（后果×2）（d20:…）」，算式总在最后）
  const groups = [...after.matchAll(/[（(]([^（）()]*)[）)]/g)].map((x) => x[1]);
  const calc = groups.length ? groups[groups.length - 1] : '';
  const reasonM = text.match(/裁定[:：]\s*([^\n]*)/);
  const consM = text.match(/后果[:：]\s*([^\n]*)/);
  const isBacklash = /反噬/.test(after);
  const multM = after.match(/后果[×x]\s*([\d.]+)/);
  const st = DICE_STYLE[level] || DICE_STYLE['成功'];
  const badge = isBacklash
    ? '<span class="text-[11px] font-mono text-red-300">反噬己方</span>'
    : multM ? `<span class="text-[11px] font-mono ${st.t}">后果×${escapeHtml(multM[1])}</span>` : '';
  return '<div class="my-2 rounded-lg border ' + st.b + ' px-3 py-2">'
    + '<div class="flex items-center gap-2 mb-0.5"><span>🎲</span>'
    + '<span class="text-[13px] font-bold ' + st.t + ' tracking-wider">' + escapeHtml(level) + '</span>' + badge + '</div>'
    + (head ? '<div class="text-[13px] text-slate-200/90">' + escapeHtml(head) + '</div>' : '')
    + (calc ? '<div class="text-[12px] font-mono text-slate-400">' + escapeHtml(calc) + '</div>' : '')
    + (reasonM ? '<div class="text-[12px] text-slate-300 mt-1">裁定：' + escapeHtml(reasonM[1]) + '</div>' : '')
    + (consM ? '<div class="text-[12px] font-mono text-slate-400">后果：' + escapeHtml(consM[1]) + '</div>' : '')
    + '</div>';
}
/* 击杀结算卡：把已算定的 <击杀结算> 文本块渲染成卡片
   （首行=主角增量/当前(/队友合计)，其余每行=被击杀者|阶差|受益方+点数）。 */
function renderKillCard(inner: string): string {
  const lines = String(inner).trim().split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const head = lines[0];
  const rows = lines.slice(1).map((r) => {
    const seg = r.split('|').map((s) => s.trim());
    const name = seg[0] || '', gap = seg[1] || '', pts = seg[2] || '';
    const gapColor = /越阶/.test(gap) ? 'text-rose-300' : /碾压/.test(gap) ? 'text-slate-500' : 'text-slate-300';
    const ptsColor = /未建档/.test(pts) ? 'text-slate-500' : /^主角/.test(pts) ? 'text-amber-300' : 'text-sky-300';
    return '<div class="flex items-center justify-between text-[12px] py-0.5">'
      + '<span class="text-slate-200/90">' + escapeHtml(name) + '</span>'
      + '<span class="flex items-center gap-2"><span class="' + gapColor + '">' + escapeHtml(gap) + '</span>'
      + '<span class="font-mono ' + ptsColor + '">' + escapeHtml(pts) + '</span></span></div>';
  }).join('');
  return '<div class="my-2 rounded-lg border border-amber-700/40 bg-amber-900/10 px-3 py-2">'
    + '<div class="flex items-center gap-2 mb-1"><span>⚔️</span>'
    + '<span class="text-[13px] font-bold text-amber-300 tracking-wider">击杀结算</span>'
    + '<span class="text-[12px] font-mono text-amber-200/80">' + escapeHtml(head) + '</span></div>'
    + rows + '</div>';
}
/* 世界结算卡：把 <世界结算>…</世界结算> 的 markdown 面板渲染成华丽边框结算卡（内部 markdown 走 toHtml）。 */
function renderSettlementCard(inner: string, ctx: ProseCtx): string {
  const body = toHtml(String(inner).trim(), ctx);
  return '<div class="settlement-card">'
    + '<div class="settlement-corner tl"></div><div class="settlement-corner tr"></div>'
    + '<div class="settlement-corner bl"></div><div class="settlement-corner br"></div>'
    + '<div class="settlement-body">' + body + '</div></div>';
}
const DICE_BLOCK_RE = /<检定结果>([\s\S]*?)<\/检定结果>\s*(（[^）\n]*）)?/g;
/* 用户消息渲染：转义文本 + 把检定结果块替换成卡片（用户消息原本是纯文本） */
export function userToHtml(text: string): string {
  let out = ''; let last = 0; let m: RegExpExecArray | null;
  DICE_BLOCK_RE.lastIndex = 0;
  while ((m = DICE_BLOCK_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index)).replace(/\n/g, '<br>');
    out += renderDiceCard(m[1]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last)).replace(/\n/g, '<br>');
  return out;
}

/* 正文配图：在 anchor 命中处插入 <img>，无命中则追加到末尾。
   先在原文锚点后插入安全占位符（不含 HTML 特殊字符，能穿过 escapeHtml/wrap），再替换为图片标签。*/
// —— 渲染层记忆化（性能）——
// toHtmlWithImages 是纯函数（仅依赖 text/images/opts），但主聊天每次打字都会触发整个 App 重渲染，
// 对每个可见楼层重跑一遍这套正则替换/建卡；长档 + 高历史楼层数下，这就是「打字要等几秒才出字」的主因。
// 按楼层 id + 内容签名缓存产出：内容没变（打字等无关重渲染）→ 直接返回上次 HTML，彻底跳过重算。
const _htmlCache = new Map<number, { sig: string; html: string }>();
export function toHtmlWithImagesCached(id: number, text: string, images?: StoryImage[], opts?: { speakable?: boolean; npcNames?: string[] }): string {
  // 语言进签名：楼层里结算块标签的本地化随界面语言走（en/vi），语言或 vi 词库就绪态变化必须重建——
  // 否则切语言后命中旧缓存、标签停在旧语言；vi0→vi1 = 动态词库迟到后自动重建。
  const langTok = (() => { try { const l = useSettings.getState().language; return l === 'vi' ? (viDictReady() ? 'vi1' : 'vi0') : l; } catch { return 'zh-Hans'; } })();
  // 悬浮图鉴同理进签名：开关翻转 / 实体词典变了（新 NPC、拿到新装备…）→ 本楼层重渲时自动重标，不会停在旧标注。
  // getCodexIndex 内部只做 ~12 次引用比较，缓存命中路径上也几乎免费。
  const codexTok = (() => { try { const c = readingCodex(); return c.on ? 'x' + getCodexIndex(c.wiki).version : 'x0'; } catch { return 'x0'; } })();
  // 外链媒体开关进签名：翻转后消毒结果不同（外链 img/css url 是否剥掉），不进签名会命中旧缓存停在旧口径
  const extTok = (() => { try { return useSettings.getState().htmlExternalMedia !== false ? 'e1' : 'e0'; } catch { return 'e1'; } })();
  const sig = `${langTok}${codexTok}${extTok}${text}${JSON.stringify(images ?? [])}${opts?.speakable ? '1' : '0'}${(opts?.npcNames ?? []).join(',')}`;
  const hit = _htmlCache.get(id);
  if (hit && hit.sig === sig) { _htmlCache.delete(id); _htmlCache.set(id, hit); return hit.html; }   // LRU：命中挪到末尾
  const html = toHtmlWithImages(text, images, opts);
  _htmlCache.delete(id); _htmlCache.set(id, { sig, html });
  if (_htmlCache.size > 240) { const k = _htmlCache.keys().next().value; if (k !== undefined) _htmlCache.delete(k); }   // 只留最近 ~240 楼，防无界增长
  return html;
}

export function toHtmlWithImages(text: string, images?: StoryImage[], opts?: { speakable?: boolean; npcNames?: string[] }): string {
  const ctx = makeProseCtx();   // 整条消息共用一份（seen 去重跨行/跨结算卡生效）
  // 检定结果块 → 占位符（能穿过 escape/wrap，最后替换成骰子卡）
  const diceCards: string[] = [];
  let work = text.replace(DICE_BLOCK_RE, (_m, inner) => {
    const tok = `@@ZSDICE${diceCards.length}@@`;
    diceCards.push(renderDiceCard(String(inner)));
    return `\n${tok}\n`;
  });
  // 击杀结算块 → 占位符（最后替换成击杀结算卡）
  const killCards: string[] = [];
  work = work.replace(/<击杀结算>([\s\S]*?)<\/击杀结算>/gi, (_m, inner) => {
    const tok = `@@ZSKILL${killCards.length}@@`;
    killCards.push(renderKillCard(String(inner)));
    return `\n${tok}\n`;
  });
  // 世界结算块 → 占位符（最后替换成结算卡）
  const settleCards: string[] = [];
  work = work.replace(/<世界结算>([\s\S]*?)<\/世界结算>/gi, (_m, inner) => {
    const tok = `@@ZSSETTLE${settleCards.length}@@`;
    settleCards.push(renderSettlementCard(String(inner), ctx));
    return `\n${tok}\n`;
  });
  // 图片占位符
  const tokens: string[] = [];
  (images ?? []).forEach((img, i) => {
    const token = `@@ZSIMG${i}@@`;
    tokens.push(token);
    const at = img.anchor && work.includes(img.anchor) ? work.indexOf(img.anchor) + img.anchor.length : -1;
    if (at >= 0) work = work.slice(0, at) + `\n${token}\n` + work.slice(at);
    else work += `\n${token}\n`;
  });
  // 对话小喇叭占位符（speakable 时注入·复用占位符法穿过 escape）：每句「…」/“…”/『…』末尾插一个可点朗读的小喇叭
  const dlgIcons: string[] = [];
  if (opts?.speakable) {
    const names = opts.npcNames || [];
    work = work.replace(/「[^「」<>]{1,400}」|“[^“”<>]{1,400}”|『[^『』<>]{1,400}』/g, (m: string, offset: number, whole: string) => {
      const inner = m.slice(1, -1).trim();
      if (!inner) return m;
      const spk = ttsAttribSpeaker(whole.slice(Math.max(0, offset - 120), offset), names) || '';
      const tok = `@@ZSDLG${dlgIcons.length}@@`;
      dlgIcons.push(dialogueIconHtml(inner, spk));
      return m + tok;
    });
  }
  let html = toHtml(work, ctx);
  (images ?? []).forEach((img, i) => {
    const tag = `<span class="story-illust-wrap" style="position:relative;display:block;width:fit-content;max-width:100%;margin:10px auto">`
      + `<img src="${img.url}" alt="${escapeHtml(img.nsfw || '')}" data-img-idx="${i}" title="单击看大图 · 双击或点右上🔄 重新生成 · ✏️ 编辑提示词" class="story-illust" style="display:block;max-width:100%;border-radius:10px;border:1px solid rgba(255,255,255,0.08);cursor:zoom-in" loading="lazy" />`
      + `<button type="button" class="illust-regen" data-img-idx="${i}" title="重新生成这张配图" aria-label="重新生成配图" style="position:absolute;top:6px;right:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.55);color:#e2e8f0;font-size:16px;line-height:1;cursor:pointer">🔄</button>`
      + `<button type="button" class="illust-edit-prompt" data-img-idx="${i}" title="编辑生图提示词后重新生成" aria-label="编辑生图提示词" style="position:absolute;top:6px;right:44px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.55);color:#e2e8f0;font-size:15px;line-height:1;cursor:pointer">✏️</button>`
      + `</span>`;
    html = html.split(tokens[i]).join(tag);
  });
  diceCards.forEach((card, i) => { html = html.split(`@@ZSDICE${i}@@`).join(card); });
  killCards.forEach((card, i) => { html = html.split(`@@ZSKILL${i}@@`).join(card); });
  settleCards.forEach((card, i) => { html = html.split(`@@ZSSETTLE${i}@@`).join(card); });
  dlgIcons.forEach((h, i) => { html = html.split(`@@ZSDLG${i}@@`).join(h); });
  return html;
}
