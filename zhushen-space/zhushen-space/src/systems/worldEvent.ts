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

export type EventScope = 'background' | 'region';
export type EventOutcome = 'historic' | 'derived' | 'faded';

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

/** 喂给杂项演化：带档位/脉络/结算条件/占卜锚，让 AI 知道该推进谁、该结算谁 */
export function serializeEventsForEvo(list: WorldEvent[]): string {
  if (!list.length) return '（当前无活跃世界事件）';
  return list.map((e) => {
    const sc = scopeOf(e) === 'background' ? '背景' : '区域';
    const chain = (e.chain ?? []).slice(-3).map((c) => `      ${c.date}：${c.text}`).join('\n');
    const g = e.guide ? `\n    走向锚:${e.guide.macro}｜${e.guide.dev}｜${e.guide.detail}` : '';
    return `- ${e.id}[${sc}]「${e.name || e.desc?.slice(0, 16) || ''}」${e.location ? `@${e.location}` : ''}`
      + `${e.actors ? `\n    参与:${e.actors}` : ''}`
      + `${e.settleCond ? `\n    结算条件:${e.settleCond}` : '\n    ⚠未设结算条件（本轮补上）'}`
      + g
      + (chain ? `\n    脉络(最近3节):\n${chain}` : `\n    脉络:（仅初始描述）${e.desc ?? ''}`);
  }).join('\n');
}

/**
 * 注入正文的活跃事件块：**只给最新脉络节点 + 结算条件**，比原先截断 desc 有用得多
 * （原来喂的是"事件刚发生时的一句话"，推进了几轮之后正文读到的还是最初那句）。
 */
export function buildActiveEventInjection(list: WorldEvent[]): string {
  const picked = list.slice(0, 4);
  if (!picked.length) return '';
  const rows = picked.map((e) => {
    const n = latestChain(e);
    const sc = scopeOf(e) === 'background' ? '远处' : '近处';
    return `· [${sc}] ${e.name || ''}${e.location ? `（${e.location}）` : ''}${n ? `：${n.text}` : ''}`;
  });
  return `<时局动态>（正在推进的后台事件·背景事实：可自然呼应、可让 NPC 议论，**勿整段复述、勿替主角决定介入**）\n${rows.join('\n')}\n</时局动态>`;
}
