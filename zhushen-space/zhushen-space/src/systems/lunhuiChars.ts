/* 轮回 wiki「人物条目」加载器（public/lunhui-characters.json，由 vite 插件 build-lunhui-characters 生成）。
   2026-07-24 从 App.tsx 抽出：小剧场取材与正文悬浮图鉴（codexIndex）都要用，抽成独立模块避免
   codexIndex→App.tsx 的循环依赖。**模块级缓存共享**——两处功能只会拉一次这 2.2MB。 */

export type LunhuiChar = { name: string; world: string; content: string };

let _cache: LunhuiChar[] | null = null;
let _inflight: Promise<LunhuiChar[]> | null = null;

export function lunhuiCharsCached(): LunhuiChar[] | null {
  return _cache;
}

export async function loadLunhuiCharacters(): Promise<LunhuiChar[]> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;                     // 并发去重：小剧场与图鉴可能同帧触发
  _inflight = (async () => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const r = await fetch(base + 'lunhui-characters.json');
      if (r.ok) {
        const data = await r.json();
        _cache = Array.isArray(data) ? data : [];
        return _cache;
      }
    } catch { /* 取材失败 → 无档案，静默降级 */ }
    _cache = [];
    return _cache;
  })();
  try { return await _inflight; } finally { _inflight = null; }
}

/* ── 条目正文（markdown）解析：前言区 key: value + 首段摘要 ──
   条目形如：
     ---
     title: 苏晓
     分类: 人物
     身份: 契约者（猎杀者·主角）
     阶位: 🏆 **顶峰·星界监守者**…
     ---
     # 苏晓
     正文首段……
   前言区字段值可能很长且含 markdown/剧透，取用方自行截断。 */
export interface LunhuiCharDigest {
  name: string;
  world: string;
  front: Record<string, string>;
  brief: string;      // 首个非标题段落（已去 markdown 链接/强调）
  aliases: string[];  // 别名字段拆出的可索引名
}

const FRONT_KEYS_MAX = 24;

export function parseLunhuiChar(c: LunhuiChar): LunhuiCharDigest {
  const md = String(c.content ?? '');
  const front: Record<string, string> = {};
  let rest = md;
  const m = md.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    rest = md.slice(m[0].length);
    let n = 0;
    for (const line of m[1].split(/\r?\n/)) {
      if (++n > FRONT_KEYS_MAX) break;
      const i = line.indexOf(':');
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k && v && !front[k]) front[k] = v;
    }
  }
  // 首段：跳过 # 标题行 / 空行 / 分隔线，取第一段落文本
  let brief = '';
  for (const line of rest.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t) || /^[>|]/.test(t)) { if (brief) break; continue; }
    brief = t;
    break;
  }
  const aliases = splitAliases(front['别名'] || front['又名'] || '');
  return { name: String(c.name ?? ''), world: String(c.world ?? ''), front, brief: stripMd(brief), aliases };
}

/** 去 markdown 修饰：wiki 链接 [文字](页.md) → 文字；粗体 / 斜体 / 行内码 的记号一并剥掉 */
export function stripMd(s: string): string {
  return (s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitAliases(v: string): string[] {
  return stripMd(v).split(/[、,，\/／|｜]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 12);
}
