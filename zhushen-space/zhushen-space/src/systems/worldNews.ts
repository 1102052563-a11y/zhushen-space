/* 🌍 世界见闻（P2·借鉴 world-backstage 舆情层）——纯逻辑：候选构造 / 回复解析夹取 / 过期判定。
   铁则（照抄参考插件被实战验证的三条）：
   ① 只从**已公开**的素材生成：known/direct 事件全文、trace 事件只有 publicTrace 表象、传闻只有「流传」版本；
     hidden 事件与传闻的 truth/drift **连候选都进不来**——舆情层与世人认知同构，不是上帝视角。
   ② trace 来源强制降级：只能出论坛/小道（kind=forum、sourceType=unofficial、claim∈{mixed,rumor}），
     归一化阶段硬夹——模型格式跑偏也不会把"表象"升级成"事实报道"。
   ③ 只读：见闻绝不写回世界事实/NPC 认知/正文因果（没有任何写 store 的出口）。 */
import type { WorldEvent } from '../store/miscStore';
import { visibilityOf, isSettled, latestChain } from './worldEvent';
import { latestNode, worldRumors, type Rumor } from './rumor';
import type { NewsItem } from '../store/worldNewsStore';
import { lenientJsonParse } from './stateParser';

type SameFn = (a?: string, b?: string) => boolean;

export interface NewsCandidate {
  refId: string;
  kind: 'event' | 'trace' | 'rumor';
  title: string;        // trace 不给真名（内情保护）
  text: string;
  location?: string;
  settled?: boolean;
}

const CANDIDATE_CAP = 14;

/** 候选清单：本世界 known/direct 事件（含已落幕）+ trace 表象 + 传闻流传版。空数组=无可传播素材（调用方别白花 API）。 */
export function buildNewsCandidates(events: WorldEvent[], rumors: Rumor[], worldName: string, same: SameFn): NewsCandidate[] {
  const out: NewsCandidate[] = [];
  for (const e of events) {
    if (e.worldName && !same(e.worldName, worldName)) continue;
    const vis = visibilityOf(e);
    if (vis === 'hidden') continue;
    if (vis === 'trace') {
      const t = (e.publicTrace || '').trim();
      if (t) out.push({ refId: e.id, kind: 'trace', title: '', text: t, location: e.location, settled: isSettled(e) });
      continue;
    }
    const n = latestChain(e);
    if (!n?.text) continue;
    out.push({ refId: e.id, kind: 'event', title: e.name || '', text: n.text, location: e.location, settled: isSettled(e) });
  }
  for (const r of worldRumors(rumors, worldName, same)) {
    const n = latestNode(r);
    if (n?.told) out.push({ refId: r.id, kind: 'rumor', title: r.name, text: n.told });
  }
  return out.slice(-CANDIDATE_CAP);
}

/** 候选清单序列化（进提示词）。trace 行明确标注"只能进论坛、不得点破内情"。 */
export function serializeNewsCandidates(list: NewsCandidate[]): string {
  return list.map((c) => {
    if (c.kind === 'trace') return `- [${c.refId}·表象]${c.location ? `@${c.location}` : ''}：${c.text}（⚠只见表象不知内情：只能进论坛猜测，claim 只能 rumor/mixed，禁止点破真相或编造官方定论）`;
    if (c.kind === 'rumor') return `- [${c.refId}·传闻]「${c.title}」：${c.text}（世人嘴里的说法，未必为真）`;
    return `- [${c.refId}·事件${c.settled ? '·已落幕' : ''}]「${c.title}」${c.location ? `@${c.location}` : ''}：${c.text}`;
  }).join('\n');
}

/* ── 回复解析 + 归一化夹取 ── */

const NEWS_CAP = 4;
const FORUM_CAP = 4;
const REPLY_CAP = 4;

function normClaim(raw: unknown): 'fact' | 'mixed' | 'rumor' {
  const s = String(raw ?? '').toLowerCase();
  if (/fact|事实|属实/.test(s)) return 'fact';
  if (/rumor|谣|传闻|道听/.test(s)) return 'rumor';
  return 'mixed';
}
function normSource(raw: unknown, fallback: 'official' | 'unofficial'): 'official' | 'unofficial' {
  const s = String(raw ?? '').toLowerCase();
  if (/official|官方|官府|权威/.test(s)) return 'official';
  if (/unofficial|非官方|民间|小道|匿名/.test(s)) return 'unofficial';
  return fallback;
}
const trimTo = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

/** 解析模型回复 → NewsItem[]。trace 来源硬夹（新闻降论坛、官方降民间、fact 降 mixed）；空壳/超额裁掉。 */
export function parseNewsReply(reply: string, candidates: NewsCandidate[]): NewsItem[] {
  const jsonText = /\{[\s\S]*\}/.exec(reply || '')?.[0];
  if (!jsonText) return [];
  const p = lenientJsonParse(jsonText) as { news?: unknown[]; forums?: unknown[] } | null;
  if (!p || typeof p !== 'object') return [];
  const traceIds = new Set(candidates.filter((c) => c.kind === 'trace').map((c) => c.refId));
  const out: NewsItem[] = [];
  let seq = 0;
  const push = (raw: Record<string, unknown>, kindIn: 'news' | 'forum') => {
    const title = trimTo(raw.title ?? raw['标题'], 40);
    const body = trimTo(raw.body ?? raw['正文'] ?? raw['内容'], 400);
    if (!title && !body) return;
    const refId = trimTo(raw.ref ?? raw.refId ?? raw['关联'], 12) || undefined;
    const fromTrace = !!refId && traceIds.has(refId);
    const kind = fromTrace ? 'forum' : kindIn;   // trace 只能出论坛
    const sourceType = fromTrace ? 'unofficial' : normSource(raw.source_type ?? raw.sourceType ?? raw['来源'], kind === 'news' ? 'official' : 'unofficial');
    let claim = normClaim(raw.claim ?? raw.claim_status ?? raw['性质']);
    if (fromTrace && claim === 'fact') claim = 'mixed';   // 表象不许升级成事实
    const replies = Array.isArray(raw.replies ?? raw['回帖'])
      ? (raw.replies as unknown[] ?? []).map((r) => trimTo(r, 120)).filter(Boolean).slice(0, REPLY_CAP)
      : undefined;
    out.push({
      id: `N_${Date.now().toString(36)}_${seq++}`,
      kind, sourceType, claim, title: title || body.slice(0, 20), body,
      outlet: trimTo(raw.outlet ?? raw['媒体'] ?? raw['板块'], 24) || undefined,
      heat: trimTo(raw.heat ?? raw['热度'] ?? raw['传播范围'], 20) || undefined,
      ...(kind === 'forum' && replies?.length ? { replies } : {}),
      refId,
    });
  };
  for (const raw of (Array.isArray(p.news) ? p.news : []).slice(0, NEWS_CAP)) {
    if (raw && typeof raw === 'object') push(raw as Record<string, unknown>, 'news');
  }
  for (const raw of (Array.isArray(p.forums) ? p.forums : []).slice(0, FORUM_CAP)) {
    if (raw && typeof raw === 'object') push(raw as Record<string, unknown>, 'forum');
  }
  return out;
}

/** 快照是否可能已过期（世界又走了 ≥6 回合）——只提示不删除 */
export function newsStale(snapTurn: number, currentTurn: number): boolean {
  return currentTurn - snapTurn >= 6;
}

/* ── 📰 本世界日报解析（借鉴Zsd报纸板块）──
   与见闻同一套可见性门控候选喂料；这里只管把模型回复归一成 NewsPaper 主体字段。
   头条缺失=整期作废（返回 null，调用方提示重试）；栏目/来信超额裁掉、空壳剔除。 */
const ARTICLE_CAP = 4;
const LETTER_CAP = 5;

export interface ParsedPaper {
  outlet: string; issueLabel: string;
  headline: { column: string; title: string; body: string };
  articles: { column: string; title: string; body: string }[];
  letters: { id: string; body: string }[];
}

export function parsePaperReply(reply: string): ParsedPaper | null {
  const jsonText = /\{[\s\S]*\}/.exec(reply || '')?.[0];
  if (!jsonText) return null;
  const p = lenientJsonParse(jsonText) as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  const art = (raw: unknown): { column: string; title: string; body: string } | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const title = trimTo(r.title ?? r['标题'], 40);
    const body = trimTo(r.body ?? r['正文'] ?? r['内容'], 500);
    if (!title || !body) return null;
    return { column: trimTo(r.column ?? r['栏目'], 12) || '栏目', title, body };
  };
  const headline = art(p.headline ?? p['头条']);
  if (!headline) return null;
  headline.column = '头条';
  const articles = (Array.isArray(p.articles ?? p['栏目文章']) ? (p.articles ?? p['栏目文章']) as unknown[] : [])
    .map(art).filter((a): a is NonNullable<ReturnType<typeof art>> => !!a).slice(0, ARTICLE_CAP);
  const letters = (Array.isArray(p.letters ?? p['读者来信']) ? (p.letters ?? p['读者来信']) as unknown[] : [])
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const body = trimTo(r.body ?? r['内容'] ?? r['来信'], 160);
      if (!body) return null;
      return { id: trimTo(r.id ?? r['署名'] ?? r['读者'], 20) || '匿名读者', body };
    })
    .filter((l): l is { id: string; body: string } => !!l).slice(0, LETTER_CAP);
  return {
    outlet: trimTo(p.outlet ?? p['报馆'] ?? p['媒体'], 24) || '本地报馆',
    issueLabel: trimTo(p.issueLabel ?? p['期号'] ?? p['刊行'], 30) || '',
    headline, articles, letters,
  };
}
