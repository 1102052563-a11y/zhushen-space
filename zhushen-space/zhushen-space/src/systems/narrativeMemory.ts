import type { NarrativeMemConfig } from '../store/settingsStore';

/* 叙事记忆（关键词召回模式，无 embedding）
   = 最近 N 楼原文 + 从长期事实里按关键词命中召回 Top-K，注入 <相关记忆> */

export interface MemMsg {
  role: 'user' | 'assistant';
  content: string;
}

/* 一条长期事实（来源：LLM抽取事实、小/大总结、世界大事…）*/
export interface MemFact {
  title: string;
  text: string;
  kind: 'fact' | 'small' | 'large' | 'event';
}

/* ── LLM 两步法提示词（参考源前端 narrative-facts：发送前查询改写 + 回复后事实抽取）── */

/** 发送前整理：根据当前情境改写检索查询（产出关键词），让召回找"相关"而非"最新" */
export const NM_COMPILE_PROMPT = `你是轮回乐园的记忆检索规划器。根据【当前情境】，判断接下来的剧情/对话最可能需要回忆起哪些长期记忆，给出一组**检索关键词**用于召回。
要求：
- 输出 5-12 个最能定位相关记忆的检索词：相关人名、地名、物品名、势力、事件、未决线索、主题概念。
- 关键词要覆盖"当前情境暗示但未明说"的关联（例如出现某人就带上其关联事件/承诺的关键词）。
- 只输出与当前情境真正相关的词，不要堆砌无关词。
- 不要解释，不要输出多余文字。

【当前情境（最近正文 + 用户输入）】
\${context}

【候选长期记忆（仅供参考，id｜标题）】
\${candidates}

【输出格式】只输出一个 JSON 对象：
{"keywords":["关键词1","关键词2","..."]}`;

/** 回复后写入：从本轮正文抽取值得长期记忆的"事实"，供日后关键词召回 */
export const NM_INGEST_PROMPT = `你是轮回乐园的记忆书记官。请从【本轮正文】中抽取值得长期记忆的"事实"，供日后按关键词召回。
要求：
- 只抽取对后续剧情判断有用的客观事实：关键事件、约定/契约/承诺、人物关系变化、获得/失去、身份/势力/地点、未决线索。
- 每条事实包含：title（8-16字短标题）、text（1-2句完整事实，尽量含时间/地点/对象）、keywords（3-8个检索关键词，含人名/地名/物名/事件词）。
- 不抽取：寒暄、纯环境描写、无后续意义的细节、与已有事实重复的内容。
- 不可逆事实自检：区分"提出/尝试/等待回应"与"已接受/已完成/已生效"，只有有明确完成证据才写成既成事实，否则写为未决。
- 本轮没有值得长期记忆的事实，则返回空数组。
- 不要解释，不要输出多余文字。

【本轮用户输入】
\${user_input}

【本轮正文】
\${story_text}

【已有事实标题（避免重复）】
\${existing_titles}

【输出格式】只输出一个 JSON 对象：
{"facts":[{"title":"...","text":"...","keywords":["...","..."]}]}`;

/* ── 分词：中文 2-gram + 拉丁词，用于关键词命中 ── */
export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const lower = (s || '').toLowerCase();
  for (const w of lower.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  for (const seg of lower.match(/[一-龥]+/g) ?? []) {
    if (seg.length === 1) { out.add(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

function scoreFact(queryTokens: Set<string>, fact: MemFact): number {
  const ft = tokenize(fact.title + ' ' + fact.text);
  let hit = 0;
  for (const q of queryTokens) if (ft.has(q)) hit++;
  return hit;
}

/* 关键词召回：返回命中分≥minScore 的 Top-K 事实（按分降序）*/
export function recallFacts(
  query: string, facts: MemFact[], topK: number, minScore: number,
): { fact: MemFact; score: number }[] {
  const qt = tokenize(query);
  if (qt.size === 0) return [];
  return facts
    .map((f) => ({ fact: f, score: scoreFact(qt, f) }))
    .filter((x) => x.score >= Math.max(1, minScore))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

/**
 * 组装注入内容：
 * - recent：最近 recentFullTextCount 楼原文
 * - memory：<相关记忆> system 块（召回的长期事实；distantKeywordThreshold>0 且事实数超阈值时，靠后的只留标题）
 */
export function buildNarrativeHistory(
  history: MemMsg[],
  cfg: NarrativeMemConfig,
  facts: MemFact[],
  query: string,
): {
  memory: { role: 'system'; content: string }[];
  recent: { role: 'user' | 'assistant'; content: string }[];
} {
  const recentN = Math.max(0, cfg.recentFullTextCount ?? 5);
  const recent = (recentN > 0 ? history.slice(-recentN) : [])
    .map((m) => ({ role: m.role, content: m.content }));

  const topK = cfg.recallTopK ?? 6;
  const minScore = cfg.recallMinScore ?? 1;
  const distant = cfg.distantKeywordThreshold ?? 200;
  let hits = recallFacts(query, facts, topK, minScore);
  // 关键词无命中·近期兜底：库里明明有长期事实却一条都没召回到（本轮输入与任何事实都不共享关键词）时，
  // 退而注入「最近的长期事实」，确保有记忆就不会整轮空注入（最近=数组尾部，narrativeFacts 按时间追加）。
  if (hits.length === 0 && facts.length > 0) {
    const factKind = facts.filter((f) => f.kind === 'fact');
    const pool = factKind.length ? factKind : facts;
    hits = pool.slice(-topK).reverse().map((fact) => ({ fact, score: 0 }));
  }

  const lines = hits.map(({ fact }, i) => {
    const compressed = distant > 0 && i >= distant;   // 超过阈值名次只留标题
    const body = compressed ? fact.title : fact.text;
    const tag = fact.kind === 'event' ? '世界大事' : fact.kind === 'large' ? '阶段记忆' : fact.kind === 'fact' ? '长期事实' : '近期记忆';
    return `[${tag}] ${body}`;
  });

  const memory = lines.length
    ? [{ role: 'system' as const, content: `<相关记忆>\n${lines.join('\n\n')}\n</相关记忆>` }]
    : [];
  return { memory, recent };
}
