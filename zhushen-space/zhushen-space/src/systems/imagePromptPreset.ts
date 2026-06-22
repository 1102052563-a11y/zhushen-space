/* ════════════════════════════════════════════
   NAI 生图提示词预设（SillyTavern 世界书格式 {名:{entries:[…]}}）→ 适配到「正文配图提示词 LLM」
   - 常驻(triggerMode=always)条目按数组序进消息；关键词(trigger)条目命中正文才注入（绿灯）
   - ST 宏前端不支持，统一替换/剥离（{{上下文}}/{{用户需求}}/{@getvar::生图数量@}/{{roll}}…）
   - 末尾追加「输出格式覆盖」，把模型拉回前端解析器认的 <image><anchor><nsfw_rating><prompt> 格式
   预设体积大（数十万字），单独存 localStorage(drpg-img-prompt-preset) + 模块缓存，
   **不进 imageGenStore**（否则每次改生图设置都要重写几百 KB 到 drpg-image-gen）。
════════════════════════════════════════════ */

export interface ImgPromptEntry {
  id: string;
  name: string;
  content: string;
  role: 'system' | 'user' | 'assistant';
  triggerMode: 'always' | 'trigger';
  triggerWords: string;
  enabled: boolean;
}

const LS_KEY = 'drpg-img-prompt-preset';
let _cache: { name: string; entries: ImgPromptEntry[] } | null | undefined; // undefined = 尚未从 LS 读取

export function getImgPromptPreset(): { name: string; entries: ImgPromptEntry[] } | null {
  if (_cache === undefined) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      _cache = raw ? JSON.parse(raw) : null;
    } catch {
      _cache = null;
    }
  }
  return _cache ?? null;
}

export function saveImgPromptPreset(name: string, entries: ImgPromptEntry[]): void {
  _cache = { name, entries };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_cache));
  } catch (e) {
    console.warn('[imgPreset] 写入 localStorage 失败（可能超配额）:', e);
  }
}

export function clearImgPromptPreset(): void {
  _cache = null;
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

/* 解析导入的 JSON：兼容 {名:{entries:[…]}} / {entries:[…]} / [entries] 三种 */
export function parseImgPromptPreset(text: string): { name: string; entries: ImgPromptEntry[] } {
  const j = JSON.parse(text);
  let raw: any[] | undefined;
  let name = '生图预设';
  if (Array.isArray(j)) raw = j;
  else if (Array.isArray(j?.entries)) raw = j.entries;
  else if (j && typeof j === 'object') {
    const k = Object.keys(j).find((key) => j[key] && Array.isArray(j[key].entries));
    if (k) { name = k; raw = j[k].entries; }
  }
  if (!Array.isArray(raw)) throw new Error('未找到 entries 数组（应为 {名:{entries:[…]}} 世界书格式）');
  const entries: ImgPromptEntry[] = raw.map((e: any, i: number) => ({
    id: String(e?.id ?? `e${i}`),
    name: String(e?.name ?? ''),
    content: String(e?.content ?? ''),
    role: (e?.role === 'user' || e?.role === 'assistant') ? e.role : 'system',
    triggerMode: e?.triggerMode === 'trigger' ? 'trigger' : 'always',
    triggerWords: String(e?.triggerWords ?? ''),
    enabled: e?.enabled !== false,
  })).filter((e) => e.content.trim());
  if (!entries.length) throw new Error('entries 为空或没有有效 content');
  return { name, entries };
}

/* 输出格式覆盖：放在最后（最高优先/最近），把模型从预设自带的 <images>/Character N/坐标/UC 格式拉回前端解析器认的格式 */
export const IMG_OUTPUT_OVERRIDE = `【输出格式 · 最高优先 · 覆盖以上一切格式规定】
忽略上文里关于 <images> 外层包裹 / <thinking> / <Tag_think> / Character N Prompt / centers 坐标 / 逐角色 UC 的所有格式要求。本次**只允许**输出 {count} 个 <image> 块，严格如下，块外不要任何其它文字：
<image><anchor>正文里连续出现、可 Ctrl+F 命中的 8~30 字原文片段</anchor><nsfw_rating>sfw / nsfw_mild / nsfw_moderate / nsfw_explicit 之一</nsfw_rating><prompt>英文 NAI danbooru tags，主体数量+性别开头（1girl/1boy…），充分运用你掌握的标签库与 Tag 规则，忠实正文</prompt></image>
重复 {count} 个。不要 <Tag_think>/<thinking>、不要坐标/UC、不要中文说明。`;

function applyMacros(s: string, ctx: { story: string; count: number }): string {
  const rnd = () => String(Math.floor(Math.random() * 900000) + 100000);
  return (s || '')
    .replace(/\{@setvar::[^@]*@\}/g, '')                         // setvar → 删
    .replace(/\{@getvar::\s*生图数量\s*@\}/g, String(ctx.count)) // getvar 生图数量 → 张数
    .replace(/\{@getvar::[^@]*@\}/g, '')                          // 其它 getvar → 删
    .replace(/\{\{\s*roll[^}]*\}\}/gi, rnd)                       // roll → 随机数（防缓存噪音）
    .replace(/\{\{\s*上下文\s*\}\}/g, ctx.story)                  // 上下文 → 正文
    .replace(/\{\{\s*世界书触发\s*\}\}/g, '')                     // 触发库占位 → 留空（命中条目已按序在消息里）
    .replace(/\{\{\s*用户需求\s*\}\}/g, ctx.story)                // 用户需求 → 正文
    .replace(/\{\{[^}]*\}\}/g, '');                               // 兜底剥掉其它 ST 宏
}

/* 组装「正文配图提示词 LLM」的 messages：常驻 + 命中绿灯 → 合并连续同 role → 末尾追加可调用角色 + 格式覆盖 + 本轮正文 */
export function buildImagePromptMessages(
  entries: ImgPromptEntry[],
  ctx: { story: string; charsFull: string; count: number; time: string; location: string },
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const scan = `${ctx.story}\n${ctx.charsFull}`.toLowerCase();
  const hit = (words: string) =>
    words.split(/[,，、\s]+/).map((w) => w.trim()).filter(Boolean)
      .some((w) => scan.includes(w.toLowerCase()));
  const picked = entries.filter((e) => e.enabled && (e.triggerMode !== 'trigger' || hit(e.triggerWords)));

  const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  for (const e of picked) {
    const content = applyMacros(e.content, { story: ctx.story, count: ctx.count }).trim();
    if (!content) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === e.role) last.content += '\n\n' + content;  // 合并连续同 role，减少碎消息
    else msgs.push({ role: e.role, content });
  }

  // 末尾自包含的 user 回合：可调用角色 + 格式覆盖 + 本轮正文（即便预设条目残缺也能正确出图）
  msgs.push({
    role: 'user',
    content:
      `${IMG_OUTPUT_OVERRIDE.replace(/\{count\}/g, String(ctx.count))}\n\n` +
      `【在场可调用角色（沿用其外观/标签保持同角色一致）】\n${ctx.charsFull || '（无）'}\n` +
      `【场景】时间：${ctx.time || '未设定'}　地点：${ctx.location || '未设定'}\n\n` +
      `【本轮要配图的正文】\n${ctx.story}\n\n请据此输出 ${ctx.count} 个 <image> 块。`,
  });
  return msgs;
}
