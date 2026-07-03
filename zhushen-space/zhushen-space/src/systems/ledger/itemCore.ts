/* ── 物品事件溯源核心（Step 10 pilot 第2域·继货币之后）──────────────────────
   把物品数量真相接进 eventCore：每次增/减 = 一个不可变事件（幂等键·可审计·确定性重放·数量≥0 看门狗）。
   **本期 = 影子 + 对账**：itemStore 仍权威，itemCore 并行按**内容签名（名称｜品级）**记账
   （itemStore.addItem/consumeItem/removeItem 同步喂进来），`reconcileItems` 核对二者 → 抓"绕过物品闸门的写入 / 静默消失 / 数量漂移"。
   **为何用签名而非 id**：物品有堆叠/装备/强化/换 id，逐 id 影子会因两侧 id 分配不同产生**假漂移**；
   签名(名称｜品级)对 装备/强化/换 id 稳定，只认"这类物品总共几个"，稳健不误报。**零行为改动**（不碰 itemStore 逻辑，仅旁挂记账）。
   下一期可翻权威（itemStore.items 变投影）。持久化 drpg-items-core（随存档由 saveManager 快照）。 */
import { createEventCore, type PendingEvent, type CommitResult } from './eventCore';
import { useMisc } from '../../store/miscStore';

export type ItemQ = Record<string, number>;   // 签名 → 总数量
interface ItemCoreState { q: ItemQ; }
type ItemOp = 'create' | 'consume' | 'remove' | 'seed';
interface ItemPayload { sig?: string; delta?: number; sigs?: ItemQ; }

const KEY = 'drpg-items-core';

/** 内容签名：名称｜品级（大小写/空白归一）。同类物品（不管 id/装备/强化）归到一个签名。 */
export function itemSig(name: unknown, grade: unknown): string {
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const g = String(grade ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return `${n}｜${g}`;
}

const core = createEventCore<ItemCoreState, ItemOp, ItemPayload>({
  initial: () => ({ q: {} }),
  reduce: (s, ev) => {
    const q = { ...s.q };
    if (ev.op === 'create') {
      const sig = String(ev.payload.sig ?? '');
      if (sig) q[sig] = (q[sig] ?? 0) + Math.max(0, Number(ev.payload.delta || 0));
    } else if (ev.op === 'consume' || ev.op === 'remove') {
      const sig = String(ev.payload.sig ?? '');
      if (sig) { const next = (q[sig] ?? 0) - Math.max(0, Number(ev.payload.delta || 0)); if (next > 0) q[sig] = next; else delete q[sig]; }
    } else if (ev.op === 'seed') {
      const out: ItemQ = {};
      for (const [k, v] of Object.entries(ev.payload.sigs ?? {})) { const n = Number(v) || 0; if (n > 0) out[k] = n; }
      return { q: out };
    }
    return { q };
  },
  invariants: (s) => Object.entries(s.q).filter(([, v]) => v <= 0).map(([k, v]) => `物品数量非正：${k}=${v}`),
  // 默认幂等键唯一化：同回合同类物品可合法多次入库（两次掉落各1把），绝不误去重；
  // 幂等（治双计）只在**调用方显式传 id**时生效（如物品阶段对同一奖励用固定 id）。
  deriveId: (op) => `${op}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
});

let _hydrated = false;
/** dup-id 塌缩审计（facade 闸门抓到"背包里两条同 id"时记一笔·封顶 200·持久化）。 */
interface CollapseRec { id: string; kept: string; dropped: string; source: string; turn: number; }
let _collapseLog: CollapseRec[] = [];
function persist() { try { localStorage.setItem(KEY, JSON.stringify({ core: core.snapshot(), collapse: _collapseLog })); } catch { /* */ } }
function hydrate() {
  if (_hydrated) return; _hydrated = true;
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return;
    const o = JSON.parse(raw);
    if (o && o.core) { core.restore(o.core); _collapseLog = Array.isArray(o.collapse) ? o.collapse : []; }   // 新格式 {core,collapse}
    else core.restore(o);   // 兼容旧格式（裸 core snapshot）
  } catch { /* */ }
}
const curTurn = () => { try { return (useMisc.getState() as any).turnCount ?? 0; } catch { return 0; } };

/** 提交一批物品事件。显式 id → 幂等（治双计）；不传 → 唯一。 */
export function itemCommit(pending: PendingEvent<ItemOp, ItemPayload>[], meta?: { turn?: number; source?: string }): CommitResult {
  hydrate();
  const r = core.commit(pending, { turn: meta?.turn ?? curTurn(), source: meta?.source ?? 'item' });
  persist();
  return r;
}
/** 记一次入库（影子：itemStore.addItem 同步喂进来）。 */
export function itemCreate(name: unknown, grade: unknown, quantity: number, meta?: { turn?: number; source?: string; id?: string }): CommitResult {
  return itemCommit([{ op: 'create', payload: { sig: itemSig(name, grade), delta: quantity }, id: meta?.id }], meta);
}
/** 记一次消耗/移除（影子：itemStore.consumeItem/removeItem 同步喂进来）。 */
export function itemConsume(name: unknown, grade: unknown, quantity: number, meta?: { turn?: number; source?: string; id?: string }): CommitResult {
  return itemCommit([{ op: 'consume', payload: { sig: itemSig(name, grade), delta: quantity }, id: meta?.id }], meta);
}
/** 整体播种（迁移/对齐：从 itemStore.items 拷一份签名基线）。 */
export function itemSeed(sigs: ItemQ, meta?: { turn?: number; source?: string }): CommitResult {
  return itemCommit([{ op: 'seed', payload: { sigs } }], { source: 'migrate', ...meta });
}
export function itemCoreQ(): ItemQ { hydrate(); return core.getState().q; }
export function itemCoreWatchdog(): string[] { hydrate(); return core.watchdog(); }
export function itemCoreLog() { hydrate(); return core.log(); }
export function itemCoreReset(): void { core.reset(); _collapseLog = []; _hydrated = true; persist(); }

/** ── 物品 facade 闸门（唯一规范化 chokepoint）──
   把一份 items 数组按 **id 键去重**（同 id 只留首条·结构上根除"重复 id 双计"），返回规范数组 + 塌缩条数。
   塌掉的记进审计日志（谁/哪回合·供追溯）。**无 id 的条目原样保留**（不发明数据）。绝不抛出。 */
export function commitItems(arr: any[], source = 'commit'): { items: any[]; collapsed: number } {
  hydrate();
  const seen = new Map<string, any>();
  const out: any[] = [];
  let collapsed = 0;
  for (const it of arr ?? []) {
    if (!it) continue;
    const id = it.id;
    if (!id) { out.push(it); continue; }   // 无 id → 无法归并，原样留
    if (seen.has(id)) {                      // 同 id 第二条 = 重复 → 丢弃后来者（首条已在 out 里）
      collapsed++;
      _collapseLog.push({ id: String(id), kept: String(seen.get(id)?.name ?? ''), dropped: String(it.name ?? ''), source, turn: curTurn() });
      continue;
    }
    seen.set(id, it); out.push(it);
  }
  if (collapsed > 0) { _collapseLog = _collapseLog.slice(-200); try { persist(); } catch { /* */ } }
  return { items: out, collapsed };
}
/** dup-id 塌缩审计日志（供 TableManager / 诊断查"背包重复 id 是哪个源造的"）。 */
export function itemCollapseLog(): CollapseRec[] { hydrate(); return _collapseLog; }
export function itemCoreSnapshot() { hydrate(); return core.snapshot(); }
export function itemCoreRestore(s: Parameters<typeof core.restore>[0]): void { core.restore(s); _hydrated = true; }

/** 把 itemStore.items 折成 签名→总数量。 */
export function itemsToSigMap(items: any[]): ItemQ {
  const q: ItemQ = {};
  for (const it of items ?? []) {
    if (!it?.name) continue;
    const sig = itemSig(it.name, it.gradeDesc);
    q[sig] = (q[sig] ?? 0) + Math.max(0, Number(it.quantity ?? 1) || 0);
  }
  return q;
}

/** 核对事件核心 vs itemStore.items（live），返回按签名的数量漂移——抓"绕过物品闸门 / 双计 / 静默消失"。 */
export function reconcileItems(liveItems: any[]): { sig: string; core: number; live: number }[] {
  hydrate();
  const c = core.getState().q;
  if (Object.keys(c).length === 0) return [];   // 核心未播种 → 无基线可对（seedItemsIfEmpty 每回合会补），跳过防误报
  const live = itemsToSigMap(liveItems);
  const drift: { sig: string; core: number; live: number }[] = [];
  for (const k of new Set([...Object.keys(c), ...Object.keys(live)])) {
    const cv = c[k] ?? 0, lv = live[k] ?? 0;
    if (cv !== lv) drift.push({ sig: k, core: cv, live: lv });
  }
  return drift;
}

/** 启动/读档时：若事件核心还空，从当前 itemStore.items 播种对齐（影子从一致态起步）。返回是否播种。 */
export function seedItemsIfEmpty(liveItems: any[]): boolean {
  hydrate();
  if (Object.keys(core.getState().q).length > 0) return false;
  const live = itemsToSigMap(liveItems);
  if (Object.keys(live).length === 0) return false;
  itemSeed(live);
  return true;
}

export interface ItemDiag { ok: boolean; drift: { sig: string; core: number; live: number }[]; violations: string[]; }
/** 一次性对账诊断（漂移 + 不变量违规），供每回合看门狗 / TableManager 显示。 */
export function itemDiagnostics(liveItems: any[]): ItemDiag {
  const drift = reconcileItems(liveItems);
  const violations = itemCoreWatchdog();
  return { ok: drift.length === 0 && violations.length === 0, drift, violations };
}
