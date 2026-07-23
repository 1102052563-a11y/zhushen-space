/* 世界详情·分层注入引擎（纯函数，无 IO/store，可单测）。
 *
 * 治「全量 1.1 万字档案每回合无差别注入正文」的三个病：token 浪费、注意力稀释、整条剧情线摊开导致抢进度/泄底。
 * 方案 = 分节解析 + 四层供给（worldDetail.ts 的 buildWorldDetailInjection 调用）：
 *   ① 常驻核心：作品来源/世界定位/力量体系|舞台设定/基调·雷区——管数值一致性与写作纪律的小节，每回合必注；
 *   ② 相关性层：其余节（人物/势力/地理/贵重物品/大事记/场景质感…）切成小块，按「最近楼层+本回合输入」
 *      做本地词条打分（专有名词命中），预算内取 top——零 API、确定性（同 rankNpcsLocal 哲学）；
 *   ③ 进度门控：「世界剧情线/故事主线」的 ①②③ 条目（全库通用结构；金标准批次另有 **卷N 细目一并识别）
 *      只放出 1..当前阶段+1，未来阶段与【隐藏剧情】对正文不可见——模型不知道的未来才真正剧透不了；
 *   ④ 规划层（细纲等）mode='full' 拿完整档案：规划者知全局、叙事者只知眼前。
 * 阶段推断：对各阶段条目的专有名词与近期正文做同款打分取 argmax（置信不足回退 1）；调用方持「只进不退」记忆。
 * 解析不出节结构（玩家自由文本修订）→ 整段注入并按上限截断，行为可预期。
 */

export interface WdStage { idx: number; label: string; text: string }
export interface WdChunk { title: string; text: string }
export interface ParsedWorldDoc {
  parsed: boolean;                 // false = 无节结构（自由文本），退化为整段注入
  core: WdChunk[];                 // ①常驻核心节（已去重）
  stages: WdStage[];               // ③剧情线条目（①..⑳ / **卷N），按 idx 升序
  pool: WdChunk[];                 // ②相关性候选块（各节已切 ≤POOL_CHUNK 字小块）
  hidden: WdChunk[];               // 隐藏剧情：仅 full 模式（规划层）可见
}

/* ── 预算（字符）──调这里即可整体控注入体量；玩家可在 变量管理→世界详情注入 选档位（成套缩放） */
export const CORE_SEC_CAP = 1200;    // 单个核心节上限
export const CORE_CAP = 2800;        // 核心层合计上限
export const STAGE_ITEM_CAP = 700;   // 单个剧情线条目上限
export const STAGE_CAP = 1600;       // 剧情线层合计上限
export const PICK_CAP = 2200;        // 相关性层合计上限
export const POOL_CHUNK = 600;       // 候选块目标大小
export const UNPARSED_CAP = 6000;    // 自由文本退化注入上限
// 体量档位 → 预算缩放系数（settingsStore.worldDetailInject.budget）
export const BUDGET_SCALE: Record<'lean' | 'standard' | 'rich', number> = { lean: 0.6, standard: 1, rich: 1.6 };

const HEADER_RE = /^\s*\*\*【([^】\n]{1,40})】\*\*.*$/gm;
const isCore = (t: string) => /作品来源|世界定位|力量体系|舞台设定|叙事基调|氛围基调|雷区/.test(t);
const isHidden = (t: string) => /隐藏剧情/.test(t);
const isStageSrc = (t: string) => /世界剧情线|故事主线/.test(t);
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 把 ·剧情 全文按 **【节名】** 分节并分类。无任何节头 → parsed:false。 */
export function parseWorldDoc(plot: string): ParsedWorldDoc {
  const doc: ParsedWorldDoc = { parsed: false, core: [], stages: [], pool: [], hidden: [] };
  const heads: { title: string; start: number; bodyStart: number }[] = [];
  for (const m of plot.matchAll(HEADER_RE)) {
    heads.push({ title: m[1].trim(), start: m.index ?? 0, bodyStart: (m.index ?? 0) + m[0].length });
  }
  if (heads.length < 2) return doc;
  doc.parsed = true;
  const seen = new Set<string>();   // 灌水批存在重复节头（如两个【作品来源】）→ 首个为准
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const body = plot.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : plot.length).trim();
    if (!body) continue;
    const dedupeKey = h.title + '|' + body.slice(0, 60);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (isHidden(h.title)) { doc.hidden.push({ title: h.title, text: body }); continue; }
    if (isCore(h.title)) { doc.core.push({ title: h.title, text: body }); continue; }
    if (isStageSrc(h.title) || /分卷细目/.test(h.title)) {
      const items = splitStageItems(body);
      if (items.length) { doc.stages.push(...items); continue; }
      // 剧情线节但切不出条目 → 当普通候选块（仍受打分门槛约束）
    }
    doc.pool.push(...chunkSection(h.title, body));
  }
  doc.stages.sort((a, b) => a.idx - b.idx);
  return doc;
}

/** 剧情线节 → 条目：①..⑳ 行（全库通用）；**卷N（金标准批次分卷细目）。 */
function splitStageItems(body: string): WdStage[] {
  const out: WdStage[] = [];
  const marks: { idx: number; at: number; label: string }[] = [];
  const itemRe = /^\s*(?:([①-⑳])|\*\*(卷[一二三四五六七八九十]+)[：:])/gm;
  for (const m of body.matchAll(itemRe)) {
    const at = m.index ?? 0;
    if (m[1]) marks.push({ idx: CIRCLED.indexOf(m[1]) + 1, at, label: '' });
    else if (m[2]) marks.push({ idx: CN_NUM[m[2].slice(1, 2)] ?? marks.length + 1, at, label: m[2] });
  }
  for (let i = 0; i < marks.length; i++) {
    const text = body.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : body.length).trim();
    const firstLine = text.split('\n', 1)[0].replace(/[*#①-⑳\s]/g, '').slice(0, 24);
    if (text) out.push({ idx: marks[i].idx, label: marks[i].label || firstLine, text });
  }
  return out;
}

/** 普通节 → ≤POOL_CHUNK 字的段落块（空行分段后贪心合并），供逐块打分。 */
function chunkSection(title: string, body: string): WdChunk[] {
  const paras = body.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length >= 20);
  const out: WdChunk[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length > POOL_CHUNK) { out.push({ title, text: buf }); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf) out.push({ title, text: buf });
  return out;
}

/* ── 词条提取与打分 ── */
// 泛用词黑名单：节名/模板词/叙事套话——它们在任何正文里都高频，不构成"相关"证据
const TERM_BLACKLIST = /^(作品来源|世界定位|力量体系|世界观|世界剧情线|故事主线|情感线|主要人物|可攻略角色|势力图谱|人际关系|贵重物品|隐藏剧情|大事记|时间线|叙事基调|氛围基调|雷区|地理|舞台|名场面|可介入事件|可介入|危险|规避|世界|剧情|故事|主角|玩家|任务|事件|阶段|结局|设定|原作|正典|注意|铁则|写作|禁区|补记|细目|以及|但是|然后|随着|开始|最终|之后|同时)$/;

/** 从块里抽「专有名词」词条：粗体/引号/书名号/段首命名 + 权重（长词更有辨识度）。 */
export function extractTerms(text: string): { term: string; w: number }[] {
  const found = new Map<string, number>();
  const add = (raw: string, w: number) => {
    const t = raw.replace(/[\s*＊·　]/g, '').trim();
    if (t.length < 2 || t.length > 14 || TERM_BLACKLIST.test(t) || /^[\d.]+$/.test(t)) return;
    found.set(t, Math.max(found.get(t) ?? 0, w));
  };
  for (const m of text.matchAll(/\*\*([^*\n]{2,16})\*\*/g)) add(m[1], 2);
  for (const m of text.matchAll(/[「『]([^」』\n]{2,12})[」』]/g)) add(m[1], 2);
  for (const m of text.matchAll(/《([^》\n]{2,16})》/g)) add(m[1], 2);
  for (const m of text.matchAll(/^([一-鿿A-Za-z·]{2,10})(?:（[^）\n]{0,24}）)?[：:]/gm)) add(m[1], 2);   // 段首「名：」（人物/地点列表体）
  // 兜底：高频 CJK 词（同块内出现≥2 次的 2~6 字串，取长优先），补齐无标记排版的专名
  const runs = text.match(/[一-鿿]{2,6}/g) || [];
  const freq = new Map<string, number>();
  for (const r of runs) freq.set(r, (freq.get(r) ?? 0) + 1);
  for (const [r, c] of freq) if (c >= 2) add(r, 1);
  return [...found.entries()].map(([term, w]) => ({ term, w: w + (term.length >= 4 ? 1 : 0) }));
}

/** 词条组对上下文的命中分：Σ min(出现次数,3) × 权重。ctx 请先 toLowerCase。 */
export function scoreAgainst(terms: { term: string; w: number }[], ctxLower: string): number {
  let score = 0;
  for (const { term, w } of terms) {
    const t = term.toLowerCase();
    let n = 0, at = -1;
    while (n < 3 && (at = ctxLower.indexOf(t, at + 1)) !== -1) n++;
    score += n * w;
  }
  return score;
}

/** 阶段推断：各条目专名对近期正文打分取 argmax；置信不足（<MIN）回 1；无剧情线回 0。 */
export function inferStage(doc: ParsedWorldDoc, ctxLower: string): number {
  if (!doc.stages.length) return 0;
  const MIN = 6;
  let best = 1, bestScore = -1;
  for (const s of doc.stages) {
    const sc = scoreAgainst(extractTerms(s.text), ctxLower);
    if (sc > bestScore) { bestScore = sc; best = s.idx; }
  }
  return bestScore >= MIN ? best : 1;
}

export interface AssembleResult { content: string; stage: number; mode: 'layered' | 'full' | 'raw' }

/** 组装注入正文。mode='full'（规划层）=整份档案；layered=①核心+③门控剧情线+②相关块；无节结构=整段截断。 */
export function assembleInjection(
  name: string,
  plot: string,
  ctxText: string,
  opts: { mode?: 'layered' | 'full'; minStage?: number; scale?: number } = {}
): AssembleResult {
  const mode = opts.mode ?? 'layered';
  if (mode === 'full') {
    return { content: fullHeader(name) + plot, stage: 0, mode };
  }
  const S = Math.max(0.3, Math.min(3, opts.scale ?? 1));   // 体量档位缩放（BUDGET_SCALE），夹在合理区间
  const coreSecCap = Math.round(CORE_SEC_CAP * S), coreCap = Math.round(CORE_CAP * S);
  const stageItemCap = Math.round(STAGE_ITEM_CAP * S), stageCap = Math.round(STAGE_CAP * S);
  const pickCap = Math.round(PICK_CAP * S), unparsedCap = Math.round(UNPARSED_CAP * S);
  const doc = parseWorldDoc(plot);
  if (!doc.parsed) {
    return { content: layeredHeader(name) + cap(plot, unparsedCap), stage: 0, mode: 'raw' };
  }
  const ctxLower = (ctxText || '').toLowerCase();
  const stage = Math.max(inferStage(doc, ctxLower), opts.minStage ?? 0) || 1;
  const parts: string[] = [];

  // ① 常驻核心
  let used = 0;
  for (const c of doc.core) {
    if (used >= coreCap) break;
    const t = cap(c.text, Math.min(coreSecCap, coreCap - used));
    parts.push(`【${c.title}】\n${t}`);
    used += t.length;
  }

  // ③ 剧情线：只放 1..stage+1；预算不足时优先当前与下一阶段，再往回补
  const eligible = doc.stages.filter((s) => s.idx <= stage + 1);
  if (eligible.length) {
    const prio = [...eligible].sort((a, b) => {
      const pa = a.idx === stage ? 0 : a.idx === stage + 1 ? 1 : 2 + (stage - a.idx);
      const pb = b.idx === stage ? 0 : b.idx === stage + 1 ? 1 : 2 + (stage - b.idx);
      return pa - pb;
    });
    const taken = new Map<number, string>();   // idx→渲染文本（①条目与 **卷N 同 idx 时首个为准）
    let sUsed = 0;
    for (const s of prio) {
      if (sUsed >= stageCap) break;
      if (taken.has(s.idx)) continue;
      const t = cap(s.text, Math.min(stageItemCap, stageCap - sUsed));
      taken.set(s.idx, t);
      sUsed += t.length;
    }
    const lines = [...taken.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
    parts.push(`【世界剧情线·至当前阶段（当前≈第${stage}阶段；后续阶段档案未列出，禁止预告或抢进度）】\n${lines.join('\n\n')}`);
  }

  // ② 相关性层：块打分取 top（0 分不取——没证据相关就不占上下文）
  const scored = doc.pool
    .map((c, i) => ({ c, i, sc: scoreAgainst(extractTerms(c.text), ctxLower) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.i - b.i);
  let pUsed = 0;
  const picks: string[] = [];
  for (const { c } of scored) {
    if (pUsed >= pickCap) break;
    const t = cap(c.text, Math.min(Math.round(1000 * S), pickCap - pUsed));
    picks.push(`〔${c.title}〕${t}`);
    pUsed += t.length;
  }
  if (picks.length) parts.push(`【本回合相关·档案节选】\n${picks.join('\n\n')}`);

  return { content: layeredHeader(name) + parts.join('\n\n'), stage, mode };
}

function layeredHeader(name: string): string {
  return `<本世界·世界详情（正典档案·按当前剧情节选·主角当前所在世界「${name}」）>\n` +
    '以下是本世界正典档案的**节选**（常驻设定 + 与当前剧情相关的部分）。据此保持人物性格·立场、势力关系、' +
    '阶位映射与世界既定状态一致。**未展示的档案内容不代表不存在**——只写正文当下需要的；' +
    '剧情推进以正文实际进度为准，**严禁抢进度、预告或直奔档案未给出的后续阶段/结局**。它是骨架非剧本，主角的介入可改变走向。\n\n';
}
function fullHeader(name: string): string {
  return `<本世界·世界详情（正典档案·完整版·规划参考·世界「${name}」）>\n` +
    '以下是本世界完整正典档案（含全部剧情阶段与隐藏剧情，仅供规划参考）。规划时可用全局视野，' +
    '但产出的计划/细纲只应推进当前阶段，不得把未来阶段直接剧透进正文。\n\n';
}
