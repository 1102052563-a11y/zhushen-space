/* 名单预筛 Gate（借鉴 SoulLink 思想·代码自写）────────────────────────────────
   通用「候选名单 + 本回合正文 → 谁真的有变化/戏份」的廉价前置判定件。
   第一个用户是 NPC 演化阶段：在场 NPC 现状是每回合全员各发一次大演化调用，
   Gate 先花一次小调用问"谁真的变了"，没变的本轮不再烧大调用；
   后续同构判定（如 NPC 主动来讯的意图 Gate）可复用本模块。

   纪律（钉死，改前先想清楚）：
   · 输出契约唯一：只回一个 JSON 名单；名字必须与名单逐字一致（正文用简称也要写全名），
     程序按归一化名精确求交，不做模糊容错——匹配不上就当没选；
   · 唯一候选集：只从名单里挑人，正文里名单之外的人一律不认；
   · 收紧参数：max_tokens 1024 + temperature 0.1 +「最快返回」语义，防思考/话痨模型拖慢；
   · fail-open：调用失败/解析失败 → ok:false，**调用方必须回退全跑**。Gate 只省调用，绝不拦功能。 */
import type { ApiConfig } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';

export interface RosterGateItem {
  id: string;      // 稳定 id（如 C3）
  name: string;    // 展示名（求交按它归一化比对）
  hint?: string;   // 名单行附注（在场/离场/职业等，帮模型判断）
}

export interface RosterGateResult {
  ok: boolean;             // Gate 调用+解析是否成功；false=调用方应视为「全选」fail-open
  selected: Set<string>;   // 入选 id 集（与名单求交后）
  rawNames: string[];      // 模型原始输出名单（含没匹配上的，审计漏选/幻觉用）
  raw: string;             // 模型原文（截断，审计用）
  error?: string;          // 失败原因（fail-open 时给日志）
}

/* 名称归一化（与 mapEngine/calendarStore 的 nameEq 同口径：去空白/标点/大小写）。
   本模块自带一份而不 import mapEngine——纯逻辑件不该拖上地图引擎的依赖。 */
function norm(s: string): string {
  return (s || '').replace(/[\s·•・\-—_,，.。、|｜()（）【】[\]:：「」『』"'“”]/g, '').trim().toLowerCase();
}

/** 从模型回复里抠出第一个平衡的 {...} 或 [...] 块（剥 think/代码围栏后）。 */
export function extractFirstJsonBlock(reply: string): string {
  const t = (reply || '')
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*\n?/gi, '')
    .trim();
  const start = t.search(/[{[]/);
  if (start < 0) return '';
  const open = t[start], close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === open) depth++;
    else if (t[i] === close && --depth === 0) return t.slice(start, i + 1);
  }
  return t.slice(start);   // 没闭合（被 max_tokens 截断）→ 原样交给 lenientJsonParse 碰运气
}

/** 解析 Gate 回复 → 与名单求交。兼容 {"selected":[...]}/{"characters":[...]}/裸数组；
 *  元素可以是名字字符串或 {name}/{id} 对象。返回 null 表示整体解析失败（调用方 fail-open）。 */
export function parseRosterGateReply(
  reply: string,
  roster: RosterGateItem[],
): { selected: Set<string>; rawNames: string[] } | null {
  const block = extractFirstJsonBlock(reply);
  if (!block) return null;
  const j = lenientJsonParse(block);
  if (j === undefined) return null;
  const arr: unknown[] = Array.isArray(j) ? j
    : Array.isArray(j?.selected) ? j.selected
    : Array.isArray(j?.characters) ? j.characters
    : Array.isArray(j?.names) ? j.names
    : [];
  const rawNames = arr
    .map((x: any) => typeof x === 'string' ? x : String(x?.name ?? x?.id ?? ''))
    .map((s) => s.trim()).filter(Boolean);
  // 空数组是合法结果（本轮没人变化）；解析出非数组结构才算失败（上面已兜成 []，但 j 必须是对象/数组）
  if (typeof j !== 'object' || j === null) return null;
  const selected = new Set<string>();
  for (const nm of rawNames) {
    const key = norm(nm);
    if (!key) continue;
    const hit = roster.find((r) => norm(r.name) === key || norm(r.id) === key);
    if (hit) selected.add(hit.id);
  }
  return { selected, rawNames };
}

/** 零 API 的本地档：名单成员的名字在正文里出现即算入选（归一化后子串匹配）。
 *  抓不到「没点名的沉默目击者」，但一分钱不花——AI 档才有目击者判定。 */
export function localNameScan(roster: RosterGateItem[], narrative: string): Set<string> {
  const normNarr = norm(narrative);
  const out = new Set<string>();
  for (const r of roster) {
    const key = norm(r.name);
    if (key && normNarr.includes(key)) out.add(r.id);
  }
  return out;
}

/** 组装 Gate 请求消息（criteria=业务判定标准，由调用方传入；本模块只管协议与纪律）。 */
export function buildRosterGateMessages(
  criteria: string,
  roster: RosterGateItem[],
  narrative: string,
): { role: string; content: string }[] {
  const system =
    `【名单预筛·轻量前置判定】这是高频轻量调用，必须尽快返回结论：不要输出分析过程、不要解释、不要任何多余文字。\n`
    + `${criteria.trim()}\n`
    + `【候选集铁则】<名单> 是唯一候选集：**逐个过名单**判断每个人是否入选；只能从名单里挑人，名单之外的人物哪怕在正文里出现也一律不列。\n`
    + `【输出契约·最高优先级】回复必须且只能是一个 JSON 对象：{"selected":["名字1","名字2"]}\n`
    + `- 名字必须与名单**逐字一致**：正文里用简称/代称/头衔时，也要写名单里的全名；\n`
    + `- 没有任何人入选就输出 {"selected":[]}；\n`
    + `- 不要 markdown 代码块、不要前后缀文字，回复越短越好。`;
  const rosterLines = roster.map((r) => `${r.id}｜${r.name}${r.hint ? `（${r.hint}）` : ''}`).join('\n');
  const user =
    `<名单>\n${rosterLines}\n</名单>\n`
    + `<本回合正文>\n${narrative}\n</本回合正文>\n`
    + `按判定标准从名单中挑出入选者，只输出 JSON 对象。`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export interface RosterGateOpts {
  chain: ApiConfig[];      // 接口链（调用方先 resolveApiChain 好）
  criteria: string;        // 业务判定标准（如 promptRules.NPC_EVO_GATE_RULE）
  roster: RosterGateItem[];
  narrative: string;       // 本回合正文（调用方裁剪好长度）
  label?: string;          // apiDebugLog 标签
  timeoutMs?: number;      // 空闲超时，默认 20s
}

/** 跑一次名单预筛。任何失败都不抛：返回 ok:false（调用方 fail-open 全跑）。 */
export async function runRosterGate(opts: RosterGateOpts): Promise<RosterGateResult> {
  const failOpen = (error: string, raw = ''): RosterGateResult =>
    ({ ok: false, selected: new Set(), rawNames: [], raw: raw.slice(0, 400), error });
  if (!opts.roster.length) return { ok: true, selected: new Set(), rawNames: [], raw: '' };
  if (!opts.chain?.[0]?.baseUrl || !opts.chain?.[0]?.apiKey) return failOpen('接口未配置');
  try {
    const messages = buildRosterGateMessages(opts.criteria, opts.roster, opts.narrative);
    const { content } = await apiChatFallback(opts.chain, messages, {
      timeoutMs: opts.timeoutMs ?? 20000,
      // Gate 专用收紧：短输出+低温（extra 优先于接口自带参数）；名字要与名单逐字一致，禁多语言指令改写
      extra: { max_tokens: 1024, temperature: 0.1 },
      label: opts.label || '名单预筛Gate',
      rawLang: true,
    });
    const parsed = parseRosterGateReply(content, opts.roster);
    if (!parsed) return failOpen('回复解析失败', content);
    return { ok: true, selected: parsed.selected, rawNames: parsed.rawNames, raw: (content || '').slice(0, 400) };
  } catch (e: any) {
    return failOpen(String(e?.message ?? e ?? '调用失败'));
  }
}
