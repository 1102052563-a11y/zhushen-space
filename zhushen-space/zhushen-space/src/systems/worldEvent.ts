/*
  世界事件生命周期（v5.6 世界引擎「时局动态·事件」的轮回乐园实装）
  ──────────────────────────────────────────────────────────────
  前端现状是一本**流水账**：`WorldEvent = {time, location, desc}` 扁平 40 条，只增不结算、
  无脉络、无配额、无派生。于是"世界大事"永远只是背景装饰，玩家没有任何理由关心它。

  这套升级给它补三样东西：
    · **事件脉络 chain**  —— 推进 = 追加一个日期节点，**不是覆盖 desc**（历史因此可读）
    · **结算条件 settleCond** —— 事件有终点，不会无限挂着
    · **配额 + 三级结算** —— 背景/区域各 ≤3；结算分 重大历史 / 派生后续 / 湮灭

  轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §4/§5.4）：
  · 配额压到 **背景 ≤3 / 区域 ≤3**（卡里是 5/3——任务世界短命，背景事件多了全是噪音）
  · 作用域 `world`：`worldName` 过滤已在 addWorldEvent 落库，这里只做读时筛
  · 结算 outcome='derived' → **派生一条支线**，但**不由前端直接建任务**：
    走既有任务闸门（新建配额/一世界一主线），前端只把"待派生"注入任务演化阶段，AI 建完前端标记消费。

  ⚠ 刻意**不碰 `worldSource`**：世界之源的唯一权威口径是 AI 每回合按正文末尾隐藏块发一条
    `character.B1.worldSource = X`（**绝对赋值**）。前端 += 会在下一回合被整个覆盖掉，
    看着像"加了又没加"。所以重大事件的回报走"进世界大事 + 编年史 + 派生支线"，不动那个数。

  老数据兼容：全部新字段可选；没有 chain/scope 的旧条目 = 单节点扁平事件，照常显示与注入。
*/
import type { WorldEvent } from '../store/miscStore';
import { parseGameMinutes } from './gameClock';

export type EventScope = 'background' | 'region';
export type EventOutcome = 'historic' | 'derived' | 'faded';
export type EventVisibility = 'hidden' | 'trace' | 'known' | 'direct';

/** 配额：任务世界短命，背景事件多了就是噪音 */
export const EVENT_CAP: Record<EventScope, number> = { background: 3, region: 3 };
/** 低于这个数就该派生新事件，免得世界一潭死水 */
export const EVENT_FLOOR = 2;

export const OUTCOME_LABEL: Record<EventOutcome, string> = {
  historic: '重大历史事件',
  derived: '派生后续',
  faded: '湮灭于尘埃',
};

export function scopeOf(e: WorldEvent): EventScope {
  return e.scope === 'background' ? 'background' : 'region';   // 缺省按区域（老数据多是主角身边的事）
}

export function isSettled(e: WorldEvent): boolean {
  return !!e.settledAt;
}

/* ── P1·可见性（借鉴 world-backstage：世界发生了 ≠ 正文/角色知道了）─────────
   hidden=完全不可察（同 guide 占卜锚：永不进正文）· trace=外界只见表象（只喂 publicTrace，连事件名都不给）
   known=公开可知 · direct=直接牵涉主角（显露候选永不过期）。缺省 known＝老数据行为不变。 */

export function visibilityOf(e: WorldEvent): EventVisibility {
  return e.visibility ?? 'known';
}

/** 归一 AI 写的可见性（容中英文近义），认不出返回 undefined（=不落字段，走缺省 known） */
export function normVisibility(raw?: string): EventVisibility | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (/hidden|隐匿|隐秘|隐藏|不可察/.test(s)) return 'hidden';
  if (/trace|痕迹|表象|迹象|风声/.test(s)) return 'trace';
  if (/direct|直面|亲历|当事|牵涉主角|主角在场/.test(s)) return 'direct';
  if (/known|公开|可知|周知/.test(s)) return 'known';
  return undefined;
}

/** 可见性门后的正文素材：hidden→null（整条不进正文）；trace→只给表象（无 publicTrace 就 null，别替 AI 编）；
    known/direct→最新脉络。secret=知情者名单（有值＝正文须遵守知情边界）。 */
export function narrativeEventView(e: WorldEvent): { text: string; secret: string; trace: boolean } | null {
  const vis = visibilityOf(e);
  if (vis === 'hidden') return null;
  const secret = (e.knownBy ?? '').trim();
  if (vis === 'trace') {
    const t = (e.publicTrace ?? '').trim();
    return t ? { text: t, secret, trace: true } : null;
  }
  const n = latestChain(e);
  const text = (n?.text || e.desc || '').trim();
  return text ? { text, secret, trace: false } : null;
}

/* ── P1·暗流到期（自然流逝/预定时刻统一成 due 世界时间串；条件等待＝原有 settleCond）── */

/** 事件是否到期该结算：due 与当前世界时间都解析得出且 now≥due。解析不出=不催（settleCond 继续兜着）。 */
export function isEventDue(e: WorldEvent, worldTime: string): boolean {
  if (!e.due || isSettled(e)) return false;
  const now = parseGameMinutes(worldTime);
  const due = parseGameMinutes(e.due);
  return now != null && due != null && now >= due;
}

/** 事件脉络的最新一节；没有 chain 的老条目回退到 desc */
export function latestChain(e: WorldEvent): { date: string; text: string } | null {
  const c = e.chain ?? [];
  if (c.length) return c[c.length - 1];
  return e.desc ? { date: e.time || '', text: e.desc } : null;
}

/** 本世界 + 未结算的活跃事件（`same` 由调用方传 worldScope.sameWorld，避免本模块反向依赖） */
export function activeEvents(list: WorldEvent[], worldName: string, same: (a?: string, b?: string) => boolean): WorldEvent[] {
  return list.filter((e) => !isSettled(e) && (!e.worldName || same(e.worldName, worldName)));
}

export function byScope(list: WorldEvent[], scope: EventScope): WorldEvent[] {
  return list.filter((e) => scopeOf(e) === scope);
}

/** 某一档是否不足下限（可以派生新事件） */
export function needsMore(list: WorldEvent[], scope: EventScope): boolean {
  return byScope(list, scope).length < EVENT_FLOOR;
}

/* 价值分：有结算条件 > 脉络长（推进过的） > 新的。用于超配额时决定谁先走。 */
function eventValue(e: WorldEvent): number {
  return (e.settleCond ? 100 : 0) + Math.min(20, (e.chain?.length ?? 0) * 5) + (e.guide ? 3 : 0);
}

/**
 * 超配额裁剪（按档分别裁）。返回该被移除的事件 id —— 调用方决定是删还是标记湮灭。
 * ⚠ 不裁已结算的（那些是历史，归 worldEvents 流水账保留）。
 */
export function overflowIds(list: WorldEvent[]): string[] {
  const out: string[] = [];
  for (const scope of ['background', 'region'] as EventScope[]) {
    const arr = byScope(list.filter((e) => !isSettled(e)), scope);
    if (arr.length <= EVENT_CAP[scope]) continue;
    const sorted = [...arr].sort((a, b) => eventValue(b) - eventValue(a));
    out.push(...sorted.slice(EVENT_CAP[scope]).map((e) => e.id));
  }
  return out;
}

/* ── 派生支线（§5.4）───────────────────────────────────────── */

/** 已结算为「派生后续」、且还没被任务演化阶段消费掉的事件 */
export function pendingDerivations(list: WorldEvent[]): WorldEvent[] {
  return list.filter((e) => e.outcome === 'derived' && !e.derivedAt);
}

/**
 * 注入任务演化阶段的「待派生支线」块。
 * ⚠ 只是**建议**——建不建、建成什么样仍走既有任务闸门（新建配额、一世界一主线、路线图即锁）。
 */
export function buildDerivationInjection(list: WorldEvent[]): string {
  const pending = pendingDerivations(list);
  if (!pending.length) return '';
  const rows = pending.map((e) => {
    const n = latestChain(e);
    return `- 「${e.name || e.desc?.slice(0, 20) || e.id}」${e.location ? `（${e.location}）` : ''}：${n?.text ?? ''}${e.settleCond ? `｜原结算条件：${e.settleCond}` : ''}`;
  });
  return `\n\n【后台事件已结算·可派生支线（建议·非强制）】以下后台事件刚刚落幕，且判定为"会产生后续影响"。`
    + `如果其中某条**确实与主角当前处境有钩子**（同地域／涉及已认识的人／影响主角目标），可据它新建**一条支线**；`
    + `钩不上就跳过，**不要为了用上建议而硬造任务**。新建仍受既有任务闸门约束（支线新建配额、绝不改主线）。\n${rows.join('\n')}`;
}

/* ── 序列化 ────────────────────────────────────────────────── */

/** 喂给杂项演化：带档位/脉络/结算条件/占卜锚/可见性/到期，让 AI 知道该推进谁、该结算谁。
    worldTime 用于 ⏰到期判定（不传=不判，兼容旧调用）。 */
export function serializeEventsForEvo(list: WorldEvent[], worldTime = ''): string {
  if (!list.length) return '（当前无活跃世界事件）';
  return list.map((e) => {
    const sc = scopeOf(e) === 'background' ? '背景' : '区域';
    const chain = (e.chain ?? []).slice(-3).map((c) => `      ${c.date}：${c.text}`).join('\n');
    const g = e.guide ? `\n    走向锚:${e.guide.macro}｜${e.guide.dev}｜${e.guide.detail}` : '';
    const vis = visibilityOf(e);
    const due = e.due ? (isEventDue(e, worldTime) ? `\n    ⏰已到预计结算时刻(${e.due})——本轮必须 settleEvent 结算，或 eventChain 推进并 setEvent 改写新的 due（写明为何延期）` : `\n    到期:${e.due}`) : '';
    return `- ${e.id}[${sc}]「${e.name || e.desc?.slice(0, 16) || ''}」${e.location ? `@${e.location}` : ''}｜可见性:${vis}${vis === 'trace' ? (e.publicTrace ? `（表象:${e.publicTrace.slice(0, 30)}）` : '（⚠trace 必须补 publicTrace 表象）') : ''}${e.knownBy ? `｜知情者:${e.knownBy}` : ''}`
      + `${e.actors ? `\n    参与:${e.actors}` : ''}`
      + `${e.settleCond ? `\n    结算条件:${e.settleCond}` : '\n    ⚠未设结算条件（本轮补上）'}`
      + due
      + g
      + (chain ? `\n    脉络(最近3节):\n${chain}` : `\n    脉络:（仅初始描述）${e.desc ?? ''}`);
  }).join('\n');
}

/**
 * 注入正文的活跃事件块：**只给最新脉络节点 + 结算条件**，比原先截断 desc 有用得多
 * （原来喂的是"事件刚发生时的一句话"，推进了几轮之后正文读到的还是最初那句）。
 * P1 起过可见性门：hidden 整条不出现；trace 只给表象、不给事件名。
 */
export function buildActiveEventInjection(list: WorldEvent[]): string {
  const picked = list.map((e) => ({ e, v: narrativeEventView(e) })).filter((x) => x.v).slice(0, 4);
  if (!picked.length) return '';
  const rows = picked.map(({ e, v }) => {
    const sc = scopeOf(e) === 'background' ? '远处' : '近处';
    return `· [${sc}] ${v!.trace ? '' : (e.name || '')}${e.location ? `（${e.location}）` : ''}：${v!.text}${v!.secret ? `（仅 ${v!.secret} 知情）` : ''}`;
  });
  return `<时局动态>（正在推进的后台事件·背景事实：可自然呼应、可让 NPC 议论，**勿整段复述、勿替主角决定介入**）\n${rows.join('\n')}\n</时局动态>`;
}

/* ── P1·显露递交（借鉴 world-backstage「结果递交」：后台演了 ≠ 正文知道了）──────
   落幕(settleWorldEvent)时非 hidden 事件带上 reveal={pending,0}；注入侧每轮至多给正文 2 条
   「已落幕待显露」候选；回合末对账：正文接住(名字/表象命中 或 杂项 AI 发 eventRevealed) → delivered；
   没接住 attempts+1；满 3 次且非 direct → shelved 不再注入（事件仍在流水账/编年史，只是不再骚扰正文）。 */

export const REVEAL_OFFER_MAX = 2;
export const REVEAL_MAX_ATTEMPTS = 3;

type SameFn = (a?: string, b?: string) => boolean;

/** 本世界·待显露的落幕事件（老→新：先落幕的先显露/先过期） */
export function pendingReveals(list: WorldEvent[], worldName: string, same: SameFn): WorldEvent[] {
  return list
    .filter((e) => isSettled(e) && e.reveal?.state === 'pending' && visibilityOf(e) !== 'hidden'
      && (!e.worldName || same(e.worldName, worldName)))
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
}

/** 本轮实际注入正文的显露候选（≤REVEAL_OFFER_MAX；对账侧用同一选择器保证两头一致） */
export function offeredReveals(list: WorldEvent[], worldName: string, same: SameFn): WorldEvent[] {
  return pendingReveals(list, worldName, same).slice(0, REVEAL_OFFER_MAX);
}

/** 注入正文的「镜头外已落幕」块：结果只作候选，情境合适才自然带出（勿硬塞） */
export function buildRevealInjection(list: WorldEvent[], worldName: string, same: SameFn): string {
  const picked = offeredReveals(list, worldName, same);
  if (!picked.length) return '';
  const rows = picked.map((e) => {
    const v = narrativeEventView(e);
    if (!v) return '';
    return `· ${v.trace ? '' : (e.name ? `「${e.name}」` : '')}${e.location ? `@${e.location}` : ''}${v.trace ? '（外界只见表象）' : ''}：${v.text.slice(0, 80)}${v.secret ? `｜仅 ${v.secret} 知情` : ''}`;
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<镜头外已落幕>（这些后台事件已有结果——若本回合情境沾边（同地点/相关人物/话题相近），让消息以合理渠道自然传到：目击、风闻、通报、后果波及皆可；情境不合就整块忽略，**勿硬塞、勿一次全倒、勿替主角决定反应**）\n${rows.join('\n')}\n</镜头外已落幕>`;
}

const normAckText = (s: string) => String(s || '').replace(/[\s·•・\-—_,，。、|｜()（）【】「」《》:：*＊"'"'‘’“”]/g, '');

/** 正文是否承接了该落幕结果：事件名（≥2字）整体命中，或表象文本的**任意连续 6 字窗口**命中即算
    （正文常会改写表象措辞，整段前缀匹配太脆；6 字连续窗共享仍然低误报）。宁严勿松——漏判只是多催一轮，
    且杂项 AI 侧还有 eventRevealed 兜底。 */
export function revealAcked(narrative: string, e: WorldEvent): boolean {
  const hay = normAckText(narrative);
  if (!hay) return false;
  const name = normAckText(e.name || '');
  if (name.length >= 2 && hay.includes(name)) return true;
  const trace = normAckText(e.publicTrace || '');
  if (trace.length < 6) return false;
  const end = Math.min(trace.length, 30) - 6;
  for (let i = 0; i <= end; i++) if (hay.includes(trace.slice(i, i + 6))) return true;
  return false;
}

/** 回合末显露对账计划（纯函数·调用方按计划写 store）：deliver=正文已接住；bump=没接住计数+1；shelve=满额搁置。 */
export function planRevealReconcile(list: WorldEvent[], worldName: string, same: SameFn, narrative: string):
  { deliver: string[]; bump: { id: string; attempts: number }[]; shelve: string[] } {
  const out: { deliver: string[]; bump: { id: string; attempts: number }[]; shelve: string[] } = { deliver: [], bump: [], shelve: [] };
  for (const e of offeredReveals(list, worldName, same)) {
    if (revealAcked(narrative, e)) { out.deliver.push(e.id); continue; }
    const attempts = (e.reveal?.attempts ?? 0) + 1;
    if (attempts >= REVEAL_MAX_ATTEMPTS && visibilityOf(e) !== 'direct') out.shelve.push(e.id);
    else out.bump.push({ id: e.id, attempts });
  }
  return out;
}
