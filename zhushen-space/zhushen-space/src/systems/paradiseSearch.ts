/* 🔎 乐园检索（借鉴 Abstract外置手机 browser 思想·代码全自写）：拉取式情报——
   玩家输入检索词 → AI 生成 3~5 条"世界内搜索结果"（标题/来源/摘要/详情/可信度）。
   认知门与世界见闻同一道：候选=known/direct 事件+trace 表象+传闻（hidden 连候选都进不来·复用 worldNews.buildNewsCandidates）；
   AI 只可引用候选与常识性生活信息，禁止编造改变世界走向的新大事。皮肤随世界时代（搜索引擎/坊市打听/乐园数据库）。 */
import { lenientJsonParse } from './stateParser';
import type { NewsCandidate } from './worldNews';

export interface SearchHit {
  title: string;
  source: string;    // 来源（有世界风味的媒体/板块/告示处）
  preview: string;   // 摘要 ≤60字
  content: string;   // 详情（多行）
  claim: 'fact' | 'mixed' | 'rumor';
}

const CLAIMS = new Set(['fact', 'mixed', 'rumor']);
const MAX_HITS = 5;

/* 解析：宽容 JSON（代码围栏剥离→抓最外层对象→lenientJsonParse）；无效条目丢弃；夹取长度与条数 */
export function parseSearchReply(raw: string): SearchHit[] {
  const s = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  const j: any = m ? lenientJsonParse(m[0]) : null;
  const arr = Array.isArray(j?.results) ? j.results : [];
  const out: SearchHit[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const title = String(x.title ?? '').trim().slice(0, 60);
    const content = String(x.content ?? '').trim().slice(0, 1200);
    if (!title || !content) continue;
    const claim = String(x.claim ?? '').trim();
    out.push({
      title,
      source: String(x.source ?? x.outlet ?? '未知来源').trim().slice(0, 30),
      preview: String(x.preview ?? '').trim().slice(0, 80) || content.slice(0, 60),
      content,
      claim: (CLAIMS.has(claim) ? claim : 'mixed') as SearchHit['claim'],
    });
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

/* 候选块（AI 可引用的事实池）：与世界见闻同门控——调用方传入 buildNewsCandidates 的产物 */
export function searchCandidateBlock(cands: NewsCandidate[]): string {
  if (!cands.length) return '【可引用事实池】（本世界暂无已知大事——只按常识生成生活化/背景性的检索结果，禁止编造大事件）';
  const lines = cands.slice(0, 12).map((c) => `- [${c.kind === 'trace' ? '表象' : c.kind === 'rumor' ? '传闻' : '事件'}]${c.title ? `「${c.title}」` : ''}${c.text.slice(0, 80)}${c.settled ? '（已落幕）' : ''}`);
  return `【可引用事实池（检索结果只能援引这些已知事实与常识性生活信息）】\n${lines.join('\n')}`;
}
