/*
  传闻流变（v5.6 世界引擎「时局动态·传闻」的轮回乐园实装）
  ────────────────────────────────────────────────────────────
  这套设计里最精妙的一处是**三分**：

      真相(truth)  ── 客观上到底发生了什么
      传闻(told)   ── 世人嘴里流传的版本
      偏差(drift)  ── 两者的具体差异

  把「世界上流传的说法」和「实际发生的事」显式分开存，于是 NPC 可以基于**错误信息**行动——
  这正是"活人感"的核心。前端此前只有 `narrativeFacts`（只存事实），没有这一层。

  轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §4/§5.1）：
  · 作用域 = `world`：绑任务世界，离世随 WorldRecord 冻结（世界名不匹配即不注入/不演化）
  · 周期按世界寿命重标：时效 **1~3 天**（卡里是数周）、压缩阈值 **3** 个节点（卡里是 5）
  · 种子来自世界卡的 `plotDrift`（前任契约者改写痕迹）与 `priorLegacy`（前人遗产）——
    那两段本身就是"世上流传着关于某个来历不明强者的说法"，天生就是传闻
  · **注入正文只给 `told`，绝不给 `truth`**：让 AI 写 NPC 时用的是流言版本；
    真相只进演化阶段与玩家面板（玩家可以选择当上帝，也可以折叠起来当局中人）

  纯函数 + 数据显式传入，便于单测；store 在 miscStore.rumors。
*/
import { parseGameMinutes } from './gameClock';

/** 影响力五档（低→高）。达「文化烙印」即升格进编年史后移除。 */
export const IMPACT_LEVELS = ['零星耳闻', '圈内谈资', '局部焦点', '全民热议', '文化烙印'] as const;
export type Impact = typeof IMPACT_LEVELS[number];

/** 注入正文的门槛：够不上「局部焦点」的传闻还没扩散开，不占正文预算 */
export const INJECT_MIN_IMPACT: Impact = '局部焦点';
/** 单世界维护上限；超出按价值裁剪 */
export const RUMOR_CAP = 5;
/** 流变历程压缩阈值（任务世界短命，卡里的 5 撑不到） */
export const COMPRESS_AT = 3;
/** 时效解析失败时的回合兜底：距该节点 N 回合后视为到期（时间口径出问题也不会让传闻永冻） */
export const FALLBACK_DUE_TURNS = 8;

export interface RumorNode {
  seq: number;      // 从 1 递增，只 append 不复用
  date: string;     // 该节点形成的世界时间
  expire: string;   // 预计时效：到这个世界时间点就该结算（AI 按本世界历法写）
  turn: number;     // 形成时的回合号（时效解析失败时的兜底基准）
  truth: string;    // 客观真相
  told: string;     // 流传版本
  drift: string;    // 事实偏差
  cause: string;    // 流变诱因
}

export interface Rumor {
  id: string;       // R_1
  name: string;
  impact: Impact;
  scope: string;    // 流传范围（地域/人群）
  worldName?: string;
  nodes: RumorNode[];
  createdAt: number;
}

/* ── 基础原语 ─────────────────────────────────────────────── */

export function impactIndex(i?: string): number {
  const k = IMPACT_LEVELS.indexOf((i ?? '') as Impact);
  return k < 0 ? 0 : k;
}

/** 归一 AI 写的影响力字符串（容忍后缀/近义），认不出回落最低档 */
export function normImpact(raw?: string): Impact {
  const s = (raw ?? '').trim();
  for (const lv of IMPACT_LEVELS) if (s.includes(lv)) return lv;
  return IMPACT_LEVELS[0];
}

export function latestNode(r: Rumor): RumorNode | null {
  return r.nodes.length ? r.nodes[r.nodes.length - 1] : null;
}

export function nextSeq(r: Rumor): number {
  return r.nodes.reduce((m, n) => Math.max(m, n.seq), 0) + 1;
}

/**
 * 该传闻本轮是否到期该结算。
 * 优先按世界时间比对 `expire`；时间串解析不出（AI 写了本世界特有历法/留空）→
 * 回落到「距该节点 FALLBACK_DUE_TURNS 回合」的回合兜底，绝不让传闻永远冻着。
 */
export function isDue(r: Rumor, worldTime: string, turn: number): boolean {
  const n = latestNode(r);
  if (!n) return true;                       // 空节点的传闻直接交给演化去补
  const now = parseGameMinutes(worldTime);
  const exp = parseGameMinutes(n.expire);
  if (now != null && exp != null) return now >= exp;
  return turn - (n.turn ?? 0) >= FALLBACK_DUE_TURNS;
}

export function needsCompress(r: Rumor, at = COMPRESS_AT): boolean {
  return r.nodes.length >= at;
}

/**
 * 压缩流变历程：把全部节点并成 1 条。
 * 取**最早**节点的日期（这条传闻是从那时起的），真相/描述/偏差取**最新**（当前认知），
 * 诱因串成一条演变简述——这样压缩不丢"它怎么一步步变成现在这样"。
 */
export function compressRumor(r: Rumor): Rumor {
  if (r.nodes.length <= 1) return r;
  const first = r.nodes[0];
  const last = r.nodes[r.nodes.length - 1];
  const trail = r.nodes.map((n) => n.cause).filter(Boolean).join(' → ');
  return {
    ...r,
    nodes: [{
      seq: 1,
      date: first.date,
      expire: last.expire,
      turn: last.turn,
      truth: last.truth,
      told: last.told,
      drift: last.drift,
      cause: trail ? `【历经${r.nodes.length}次流变】${trail}` : last.cause,
    }],
  };
}

/** 价值分：影响力为主，节点数（活跃度）次之。裁剪时分低者先走。 */
export function rankValue(r: Rumor): number {
  return impactIndex(r.impact) * 100 + Math.min(9, r.nodes.length);
}

/** 超出上限时按价值裁剪；返回保留与被裁的两份（被裁的由调用方决定归档还是丢弃） */
export function pruneRumors(list: Rumor[], cap = RUMOR_CAP): { kept: Rumor[]; dropped: Rumor[] } {
  if (list.length <= cap) return { kept: list, dropped: [] };
  const sorted = [...list].sort((a, b) => rankValue(b) - rankValue(a));
  return { kept: sorted.slice(0, cap), dropped: sorted.slice(cap) };
}

/** 达「文化烙印」= 该升格进编年史/传奇，然后从活跃传闻里移除 */
export function shouldPromote(r: Rumor): boolean {
  return r.impact === '文化烙印';
}

/* ── 世界作用域 ────────────────────────────────────────────── */

/** 只留属于该世界的（worldName 为空 = 老数据，放行；与 worldScope 的"宁漏勿误"同口径） */
export function worldRumors(list: Rumor[], worldName: string, same: (a?: string, b?: string) => boolean): Rumor[] {
  return list.filter((r) => !r.worldName || same(r.worldName, worldName));
}

/* ── 注入 ─────────────────────────────────────────────────── */

/** 够得上注入门槛的传闻（影响力 ≥ 局部焦点） */
export function injectable(list: Rumor[], min: Impact = INJECT_MIN_IMPACT): Rumor[] {
  const floor = impactIndex(min);
  return list.filter((r) => impactIndex(r.impact) >= floor && latestNode(r)?.told);
}

/**
 * 注入正文的 `<市井流言>` 块。
 * ⚠ **只出 told（流传版本）与影响力/范围，绝不出 truth/drift**——
 * 正文侧的 NPC 应该只知道街面上在传什么，真相是玩家与演化阶段的信息优势。
 */
export function buildRumorInjection(list: Rumor[]): string {
  const picked = injectable(list).sort((a, b) => impactIndex(b.impact) - impactIndex(a.impact)).slice(0, 4);
  if (!picked.length) return '';
  const rows = picked.map((r) => {
    const n = latestNode(r)!;
    return `· [${r.impact}]${r.scope ? `（${r.scope}）` : ''} ${r.name} —— ${n.told}`;
  });
  return `<市井流言>（街面上正在传的说法·**不保证属实**：NPC 可以引用、相信、怀疑或转述走样，`
    + `但**不得**当成已证实的事实来行动；主角亲历过的部分他自己清楚真假。勿整段复述，自然带出即可）\n${rows.join('\n')}\n</市井流言>`;
}

/* ── 播种（世界卡 → 初始传闻）─────────────────────────────── */

export interface SeedInput {
  /** 世界卡·剧情偏移：本世界已被前任契约者改写成什么样 */
  plotDrift?: string;
  /** 世界卡·前人遗产：前任契约者留下的遗物/组织/传说/烂摊子 */
  priorLegacy?: string;
  worldTime?: string;
  turn?: number;
}

export interface RumorSeed {
  name: string;
  impact: Impact;
  scope: string;
  node: Pick<RumorNode, 'truth' | 'told' | 'drift' | 'cause' | 'date' | 'expire' | 'turn'>;
}

/* 从一段自由文本里切出可用的句子：按中文句读切、去掉太短的、最多取 n 条。 */
function pickSentences(text: string, n: number): string[] {
  return (text ?? '')
    .split(/[。！？!?\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12)
    .slice(0, n);
}

/**
 * 进世界时的**零 API 播种**：把世界卡的「剧情偏移」「前人遗产」直接变成 1~2 条初始传闻。
 *
 * 为什么这两段天生就是传闻：它们描述的正是"世上流传着关于某个来历不明的强者做过什么的说法"——
 * 而主角（作为新来的契约者）恰恰知道那是**前任契约者**干的，世人却只当是奇闻。
 * 真相/流传/偏差三分在这里天然成立，一行 AI 调用都不用花。
 *
 * 播种出的传闻起步影响力压在「圈内谈资」——它们是陈年旧事，不该一进世界就全民热议。
 */
export function seedRumorsFromWorldCard(input: SeedInput): RumorSeed[] {
  const out: RumorSeed[] = [];
  const date = input.worldTime ?? '';
  const turn = input.turn ?? 0;

  const mk = (name: string, told: string, truth: string, drift: string, cause: string, scope: string): RumorSeed => ({
    name, impact: '圈内谈资', scope,
    node: { date, expire: '', turn, truth, told, drift, cause },
  });

  for (const s of pickSentences(input.priorLegacy ?? '', 1)) {
    out.push(mk(
      '旧事·前人遗留', s,
      `实为前任契约者所为，其人早已离开本世界。${s}`,
      '世人只当是奇人异事或天灾人祸，不知背后是外来闯关者，更不知其人已不在此世',
      '世界卡·前人遗产（进入世界时播种）',
      '知情者之间口耳相传',
    ));
  }
  for (const s of pickSentences(input.plotDrift ?? '', 1)) {
    out.push(mk(
      '旧事·世事已变', s,
      `本世界已被前任契约者改写：${s}`,
      '本地人只知"如今世道与老辈人讲的不一样了"，说不出所以然，各有各的解释',
      '世界卡·剧情偏移（进入世界时播种）',
      '市井闲谈',
    ));
  }
  return out;
}

/** 喂给演化阶段的完整序列化（含真相/偏差/到期标记），让 AI 知道该推进哪几条 */
export function serializeRumorsForEvo(list: Rumor[], worldTime: string, turn: number): string {
  if (!list.length) return '（当前无活跃传闻）';
  return list.map((r) => {
    const n = latestNode(r);
    const due = isDue(r, worldTime, turn) ? ' ⏰到期待结算' : ' （未到时效·本轮勿动）';
    const cmp = needsCompress(r) ? ' 📦节点已满待压缩' : '';
    const body = n
      ? `\n    真相:${n.truth}\n    流传:${n.told}\n    偏差:${n.drift}\n    诱因:${n.cause}\n    形成:${n.date} 时效:${n.expire}`
      : '\n    （无节点）';
    return `- ${r.id}「${r.name}」影响力:${r.impact} 范围:${r.scope} 节点数:${r.nodes.length}${due}${cmp}${body}`;
  }).join('\n');
}
