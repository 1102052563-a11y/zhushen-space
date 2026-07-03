/* ── 事件溯源内核（Step 10 地基·真相源）────────────────────────────────────
   state = fold(事件流)。这是 ledgerStore 注释里说的「后续阶段：把账本升级为投影真相源(事件→store)」。
   终结「就地改可变状态 → 静默丢/双计/幽灵/读档丢」的**结构性**修法（[[item-evolution-architecture-redesign]] 理想8条 / ACU v2 帧）：
     · 单一提交闸门 commit()  —— 状态唯一的改动路径（不是"大家自觉调的函数"）
     · 幂等键 id             —— 同一逻辑命令做两次 = 一次（治双计/复读）
     · 不可变事件日志         —— 改了什么都在日志里，藏不住（治静默丢·可审计）
     · 确定性 fold/重放       —— state 可从 checkpoint+log 重建（治读档丢·可回滚）
     · 对账看门狗 invariants  —— 每次提交后核对不变量，漂移**当场被抓**（这条=可验证地修好，而非又修一次）
   纯逻辑·无依赖·域无关。持久化/响应式在「接域」时再包（见后续 domain facade）。 */

export interface SourcedEvent<Op extends string = string, P = unknown> {
  seq: number;     // 单调递增序号（仅接受时分配）
  id: string;      // 幂等键：同 id 只应用一次
  ts: number;      // 时间戳
  turn: number;    // 游戏回合
  source: string;  // 写入方（narrative / item-phase / audit …）
  op: Op;          // 操作类型
  payload: P;      // 数据
}

/** 待提交事件（id 可省，省则按 deriveId 派生）。 */
export interface PendingEvent<Op extends string = string, P = unknown> {
  id?: string;
  op: Op;
  payload: P;
}

export interface CommitResult {
  applied: number;
  deduped: number;   // 被幂等键拦下的
  rejected: { id: string; op: string; reason: string }[];   // reduce 抛错拒绝的
  violations: string[];   // 提交后不变量违规（看门狗）
  seqStart: number;
  seqEnd: number;
}

export interface EventCoreSnapshot<State, Op extends string, P> {
  version: 1;
  checkpoint: State;
  log: SourcedEvent<Op, P>[];
  seq: number;
  seen: string[];
}

export interface EventCoreConfig<State, Op extends string, P> {
  initial: () => State;
  /** 纯 reducer：把一个事件应用到 state → 新 state。**抛错 = 拒绝该事件**（不入日志、不改状态）。禁止就地改入参。 */
  reduce: (state: State, ev: SourcedEvent<Op, P>) => State;
  /** 不变量核对：给定 state，返回违规描述列表（空=通过）。看门狗用。 */
  invariants?: (state: State) => string[];
  /** 缺省幂等键（事件未带 id 时）。默认 `turn:op:稳定序列化(payload)` —— 同回合同命令视为重复。 */
  deriveId?: (op: Op, payload: P, turn: number) => string;
  /** 幂等去重窗口上限（防无界增长；超出按 FIFO 淘汰最旧 id）。默认 5000。 */
  seenCap?: number;
}

export interface EventCore<State, Op extends string, P> {
  /** 唯一写入口：提交一批事件（幂等去重→reduce→折叠→看门狗）。返回统计+违规。 */
  commit: (pending: PendingEvent<Op, P>[], meta: { turn: number; source: string }) => CommitResult;
  /** 当前状态（深拷贝·外部只读，杜绝就地改）。 */
  getState: () => State;
  /** 从 checkpoint + 日志确定性重建（应恒等于 getState；用于回滚/校验/读档）。 */
  rebuild: () => State;
  /** 压实：把当前状态设为新 checkpoint、清空日志（幂等窗口保留）。 */
  checkpoint: () => void;
  /** 跑一次不变量核对（对账看门狗）。 */
  watchdog: () => string[];
  /** 只读日志（审计）。 */
  log: () => ReadonlyArray<SourcedEvent<Op, P>>;
  /** 导出快照（持久化/存档）。 */
  snapshot: () => EventCoreSnapshot<State, Op, P>;
  /** 从快照恢复（读档）。 */
  restore: (s: EventCoreSnapshot<State, Op, P>) => void;
  /** 重置为初始（新游戏）。 */
  reset: () => void;
}

const clone = <T>(x: T): T => (x == null ? x : JSON.parse(JSON.stringify(x)));

/** 稳定序列化（键排序）——同一逻辑 payload 得同一字符串，供默认幂等键。 */
function stableStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (x: unknown): unknown => {
    if (x && typeof x === 'object') {
      if (seen.has(x as object)) return null;
      seen.add(x as object);
      if (Array.isArray(x)) return x.map(walk);
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = walk((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  try { return JSON.stringify(walk(v)); } catch { return String(v); }
}

export function createEventCore<State, Op extends string = string, P = unknown>(
  cfg: EventCoreConfig<State, Op, P>,
): EventCore<State, Op, P> {
  const seenCap = cfg.seenCap ?? 5000;
  let checkpoint: State = cfg.initial();
  let state: State = cfg.initial();
  let logArr: SourcedEvent<Op, P>[] = [];
  let seq = 0;
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  const derive = (op: Op, payload: P, turn: number): string =>
    cfg.deriveId ? cfg.deriveId(op, payload, turn) : `${turn}:${op}:${stableStringify(payload)}`;

  const remember = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    seenOrder.push(id);
    while (seenOrder.length > seenCap) { const old = seenOrder.shift(); if (old !== undefined) seen.delete(old); }
  };

  const runInvariants = (s: State): string[] => {
    try { return cfg.invariants ? cfg.invariants(s) : []; } catch (e) { return [`invariants 抛错: ${e instanceof Error ? e.message : String(e)}`]; }
  };

  return {
    commit(pending, meta) {
      const rejected: CommitResult['rejected'] = [];
      let applied = 0, deduped = 0;
      const seqStart = seq + 1;
      for (const pe of pending) {
        const id = pe.id ?? derive(pe.op, pe.payload, meta.turn);
        if (seen.has(id)) { deduped++; continue; }
        const evSeq = seq + 1;
        const ev: SourcedEvent<Op, P> = { seq: evSeq, id, ts: Date.now(), turn: meta.turn, source: meta.source, op: pe.op, payload: pe.payload };
        let next: State;
        try { next = cfg.reduce(clone(state), ev); }
        catch (e) { rejected.push({ id, op: String(pe.op), reason: e instanceof Error ? e.message : String(e) }); continue; }
        seq = evSeq;
        state = next;
        logArr.push(ev);
        remember(id);
        applied++;
      }
      return { applied, deduped, rejected, violations: runInvariants(state), seqStart, seqEnd: seq };
    },
    getState: () => clone(state),
    rebuild: () => {
      let s = clone(checkpoint);
      for (const ev of logArr) s = cfg.reduce(s, ev);
      return s;
    },
    checkpoint: () => { checkpoint = clone(state); logArr = []; },
    watchdog: () => runInvariants(state),
    log: () => logArr as ReadonlyArray<SourcedEvent<Op, P>>,
    snapshot: () => ({ version: 1, checkpoint: clone(checkpoint), log: clone(logArr), seq, seen: [...seenOrder] }),
    restore: (s) => {
      checkpoint = clone(s.checkpoint);
      logArr = clone(s.log);
      seq = s.seq;
      seen.clear(); seenOrder.length = 0;
      for (const id of s.seen ?? []) remember(id);
      state = clone(checkpoint);
      for (const ev of logArr) state = cfg.reduce(state, ev);
    },
    reset: () => { checkpoint = cfg.initial(); state = cfg.initial(); logArr = []; seq = 0; seen.clear(); seenOrder.length = 0; },
  };
}
