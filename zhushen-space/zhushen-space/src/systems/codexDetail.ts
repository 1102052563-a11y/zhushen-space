/* 悬浮图鉴 · 完整档案页数据层（2026-07-25）
   ─────────────────────────────────────────────────────────────────────────────
   悬浮卡受 LINE_MAX=3 / LINE_CHARS=90 压制，只能给一瞥；这里取**未截断的原文**供详情页渲染。

   数据早就在内存里，不需要新数据源：
     · wiki 人物  → lunhuiChars 的 content 就是完整 markdown（2.2MB 人物库，之前只用了首段 brief）
     · 世界档案   → getWorldDetail().plot 是 ≥1 万字全文（进程内缓存，callApi 每回合已预取）

   ⚠ 零侵入：不读 codexIndex 的私有状态，只按 data-ek 反查。世界档案那条会重跑一次
     parseWorldDetailCodex——纯函数、几十条、只在玩家点开详情页时发生，开销可忽略。

   ⚠ 范围只到「原著档案」三类（wiki/wchar/witem）。本档实体（NPC/物品/技能…）各有管理面板，
     不在这里重造；NPC 仍走悬浮卡底栏既有的「查看详情 →」。 */

import { KIND_CODE, type CodexKind } from './codexIndex';
import { lunhuiCharsCached, loadLunhuiCharacters, parseLunhuiChar, stripMd } from './lunhuiChars';
import { getWorldDetail } from './worldDetail';
import { parseWorldDetailCodex } from './worldDetailCodex';

export interface CodexDoc {
  title: string;
  meta?: string;
  /** wiki 条目：完整 markdown 原文（详情页按行渲染，内部链接可点） */
  md?: string;
  /** 世界档案：未截断的结构化短句 */
  lines?: string[];
  source: string;
  spoiler: boolean;
}

/** data-ek 短码 → kind（KIND_CODE 的反表） */
const KIND_BY_CODE: Record<string, CodexKind> = Object.fromEntries(
  Object.entries(KIND_CODE).map(([k, c]) => [c, k as CodexKind]),
) as Record<string, CodexKind>;

/** 拆 `o:诡秘之主/克莱恩·莫雷蒂` → { kind:'wchar', id:'诡秘之主/克莱恩·莫雷蒂' } */
export function parseEk(ek: string): { kind: CodexKind; id: string } | null {
  const i = (ek || '').indexOf(':');
  if (i <= 0) return null;
  const kind = KIND_BY_CODE[ek.slice(0, i)];
  return kind ? { kind, id: ek.slice(i + 1) } : null;
}

/** 详情页只对原著档案开放——本档实体有自己的面板 */
export function hasDetailDoc(ek: string): boolean {
  const p = parseEk(ek);
  return !!p && (p.kind === 'wiki' || p.kind === 'wchar' || p.kind === 'witem');
}

async function wikiDoc(name: string): Promise<CodexDoc | null> {
  const all = lunhuiCharsCached() ?? (await loadLunhuiCharacters());
  const hit = all.find((c) => c.name === name);
  if (!hit) return null;
  const d = parseLunhuiChar(hit);
  return {
    title: d.name,
    meta: [d.front['身份'] ? stripMd(d.front['身份']) : '', d.world].filter(Boolean).join(' · ') || undefined,
    md: String(hit.content ?? ''),
    source: `轮回乐园 wiki${d.world ? ` · ${d.world}` : ''}`,
    spoiler: true,
  };
}

async function worldDoc(id: string, kind: 'wchar' | 'witem'): Promise<CodexDoc | null> {
  const slash = id.indexOf('/');
  if (slash <= 0) return null;
  const worldName = id.slice(0, slash);
  const name = id.slice(slash + 1);
  const detail = await getWorldDetail(worldName);
  if (!detail) return null;
  const hit = parseWorldDetailCodex(detail.plot, detail.name).find((e) => e.name === name && e.kind === kind);
  if (!hit) return null;
  return {
    title: hit.name,
    meta: hit.aliases.length ? `别名：${hit.aliases.join('、')}` : undefined,
    lines: hit.lines,
    source: `世界档案 · ${detail.name}`,
    spoiler: true,
  };
}

/** 按 data-ek 取完整档案；查不到 → null（详情页据此不弹）。 */
export async function loadCodexDoc(ek: string): Promise<CodexDoc | null> {
  const p = parseEk(ek);
  if (!p) return null;
  try {
    if (p.kind === 'wiki') return await wikiDoc(p.id);
    if (p.kind === 'wchar' || p.kind === 'witem') return await worldDoc(p.id, p.kind);
  } catch { /* 取不到就不弹详情，悬浮卡照常 */ }
  return null;
}

/* ── markdown 极简渲染模型 ──
   只认详情页真正需要的几种块，够用即可——不引第三方 md 库（首屏体积铁则）。 */

export type DocBlock =
  | { t: 'h'; level: number; spans: DocSpan[] }
  | { t: 'p'; spans: DocSpan[] }
  | { t: 'li'; spans: DocSpan[] }
  | { t: 'quote'; spans: DocSpan[] }
  | { t: 'hr' };

/** 行内片段：纯文字，或一个指向别的 wiki 条目的内链 */
export type DocSpan = { text: string; link?: string };

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** wiki 链接目标 → 条目名。⚠ 顺序要紧：先剥锚点，`.md` 才会落到结尾。 */
function linkTarget(href: string): string {
  let s = href;
  try { s = decodeURIComponent(href); } catch { /* 非法编码就用原样 */ }
  return s.replace(/#.*$/, '').replace(/^.*\//, '').replace(/\.md$/i, '');
}

/** 行内解析：`[苏晓](苏晓.md)` → 可点内链；图片先剥掉。 */
export function parseSpans(line: string): DocSpan[] {
  const src = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const out: DocSpan[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(src))) {
    if (m.index > last) out.push({ text: clean(src.slice(last, m.index)) });
    const target = linkTarget(m[2]);
    out.push({ text: clean(m[1]), link: target || undefined });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: clean(src.slice(last)) });
  // 判空用 trim，但保留 text 原样——词间空格是正文的一部分，纯空白段才丢
  return out.filter((s) => s.text.trim());
}

/** 剥粗体/斜体/行内码记号，但**保留**原有空格与标点（详情页要读，不做 stripMd 那种压空白） */
const clean = (s: string) => s.replace(/[*`_~]+/g, '');

/** markdown → 块序列。前言区（--- … ---）跳过：它的字段已经进了 meta。 */
export function parseDocBlocks(md: string): DocBlock[] {
  let body = String(md ?? '');
  const fm = body.match(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (fm) body = body.slice(fm[0].length);

  const out: DocBlock[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*_]{3,}$/.test(line)) { out.push({ t: 'hr' }); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ t: 'h', level: h[1].length, spans: parseSpans(h[2]) }); continue; }
    const li = line.match(/^[-*+]\s+(.*)$/);
    if (li) { out.push({ t: 'li', spans: parseSpans(li[1]) }); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { out.push({ t: 'quote', spans: parseSpans(q[1]) }); continue; }
    out.push({ t: 'p', spans: parseSpans(line) });
  }
  return out;
}

/** 内链目标 → 该 wiki 条目的 data-ek（找不到 → null，详情页把它渲染成死文字） */
export function ekForWikiName(name: string): string | null {
  const all = lunhuiCharsCached();
  if (!all) return null;
  const hit = all.find((c) => c.name === name);
  return hit ? `${KIND_CODE.wiki}:${hit.name}` : null;
}
