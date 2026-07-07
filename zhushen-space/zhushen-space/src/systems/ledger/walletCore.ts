/* ── 货币事件溯源核心（Step 10 pilot·货币是最简的"真 bug 域"：双计/折算丢）──────
   把货币真相接进 eventCore：每次变动 = 一个不可变事件（幂等键·可审计·确定性重放·余额≥0 看门狗）。
   **本期 = 影子 + 对账**：itemStore 仍权威，walletCore 并行记账（itemStore 的 adjust/set 同步喂进来），
   `reconcileWallet` 核对二者 → 抓"绕过货币闸门的写入 / 双计"。**零行为改动**（reduce 复刻 itemStore：adjust=max(0,cur+delta)）。
   下一期翻成 walletCore 权威（itemStore.currency 变投影）。持久化 drpg-wallet（随存档由 saveManager 快照）。 */
import { createEventCore, type PendingEvent, type CommitResult } from './eventCore';
import { useMisc } from '../../store/miscStore';
import { compressWithMark, decompressMaybe } from '../compressedStorage';   // lz 压缩：与物品/NPC 核心同源
import { coreKvGet, coreKvPut, coreKvDel } from './coreKv';   // 阶段1：持久化搬去 IndexedDB（不再占 localStorage）

export type WalletBalances = Record<string, number>;
interface WalletState { balances: WalletBalances; }
type WalletOp = 'adjust' | 'set' | 'seed';
interface WalletPayload { type?: string; delta?: number; reason?: string; wallet?: Record<string, number>; balances?: Record<string, number>; }

const KEY = 'drpg-wallet';

const core = createEventCore<WalletState, WalletOp, WalletPayload>({
  initial: () => ({ balances: {} }),
  reduce: (s, ev) => {
    const b = { ...s.balances };
    if (ev.op === 'adjust') {
      const type = String(ev.payload.type ?? '');
      if (type) b[type] = Math.max(0, (b[type] ?? 0) + Number(ev.payload.delta || 0));   // 复刻 itemStore.adjustCurrency
    } else if (ev.op === 'set') {
      for (const [k, v] of Object.entries(ev.payload.wallet ?? {})) b[k] = Number(v) || 0;
    } else if (ev.op === 'seed') {
      const out: WalletBalances = {};
      for (const [k, v] of Object.entries(ev.payload.balances ?? {})) out[k] = Number(v) || 0;
      return { balances: out };
    }
    return { balances: b };
  },
  invariants: (s) => Object.entries(s.balances).filter(([, v]) => v < 0).map(([k, v]) => `货币为负：${k}=${v}`),
  // 默认幂等键唯一化：货币同回合同额可合法重复（买两次各100），绝不误去重；
  // 幂等（治双计）只在**调用方显式传 id**时生效（如世界结算奖励用固定 id）。
  deriveId: (op) => `${op}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
});

let _hydrated = false;
function persist() { void coreKvPut(KEY, compressWithMark(JSON.stringify(core.snapshot()))); }   // IDB 异步落库（fire-and-forget）
function hydrate() { /* no-op：核心载入已由 preloadWalletCore 在启动时完成（IDB 异步·无法同步 hydrate）；保留仅为兼容旧调用点 */ }
/** 启动时从 IndexedDB 载入（+一次性迁旧 localStorage 值进 IDB 并清掉·释放配额）。App.tsx 启动 await。 */
export async function preloadWalletCore(): Promise<void> {
  if (_hydrated) return; _hydrated = true;   // 幂等：启动只从 IDB 载一次
  try {
    let raw = await coreKvGet(KEY);
    if (raw == null) { const legacy = decompressMaybe(localStorage.getItem(KEY)); if (legacy) { raw = compressWithMark(legacy); await coreKvPut(KEY, raw); } }
    try { localStorage.removeItem(KEY); } catch { /* */ }
    if (raw) { const plain = decompressMaybe(raw); if (plain) core.restore(JSON.parse(plain)); }
  } catch { /* 载入失败→核心空·seedWalletIfEmpty 会从现场重播基线 */ }
}
const curTurn = () => { try { return (useMisc.getState() as any).turnCount ?? 0; } catch { return 0; } };

/** 提交一批货币事件。显式 id → 幂等（治双计）；不传 → 唯一。返回统计+违规。 */
export function walletCommit(pending: PendingEvent<WalletOp, WalletPayload>[], meta?: { turn?: number; source?: string }): CommitResult {
  hydrate();
  const r = core.commit(pending, { turn: meta?.turn ?? curTurn(), source: meta?.source ?? 'item' });
  persist();
  return r;
}
/** 记一笔加减（影子：itemStore.adjustCurrency 同步喂进来）。id 显式传则幂等。reason=人类可读的增减缘由（流水展示）。 */
export function walletAdjust(type: string, delta: number, meta?: { turn?: number; source?: string; id?: string; reason?: string }): CommitResult {
  return walletCommit([{ op: 'adjust', payload: { type, delta, reason: meta?.reason }, id: meta?.id }], meta);
}
/** 记一次整体设定（影子：itemStore.setCurrency 同步喂进来）。 */
export function walletSet(wallet: Record<string, number>, meta?: { turn?: number; source?: string; id?: string }): CommitResult {
  return walletCommit([{ op: 'set', payload: { wallet }, id: meta?.id }], meta);
}
/** 整体播种（迁移：从 itemStore.currency 拷一份当基线）。 */
export function walletSeed(balances: Record<string, number>, meta?: { turn?: number; source?: string }): CommitResult {
  return walletCommit([{ op: 'seed', payload: { balances } }], { source: 'migrate', ...meta });
}
export function walletBalances(): WalletBalances { hydrate(); return core.getState().balances; }
/** 对账看门狗（内核不变量）。 */
export function walletWatchdog(): string[] { hydrate(); return core.watchdog(); }
export function walletLog() { hydrate(); return core.log(); }

/** 某货币的「流水」（每笔增减 + 缘由 + 当时余额），最新在前。折叠不可变事件日志算 running balance。
   adjust=一笔增减；set/手改=校准（delta=新−旧）；seed=基线(不列为流水项)。reason 缺省显示「未标注」。 */
export interface WalletTxn { seq: number; ts: number; turn: number; type: string; delta: number; reason: string; source: string; balance: number; kind: WalletOp; }
export function walletLedger(type = '乐园币', limit = 300): WalletTxn[] {
  hydrate();
  const bal: Record<string, number> = {};
  const txns: WalletTxn[] = [];
  for (const ev of core.log()) {
    const prev = bal[type] ?? 0;
    const p = ev.payload as WalletPayload;
    if (ev.op === 'adjust') {
      const t = String(p.type ?? ''); const d = Number(p.delta || 0);
      bal[t] = Math.max(0, (bal[t] ?? 0) + d);
      if (t === type && d !== 0) txns.push({ seq: ev.seq, ts: ev.ts, turn: ev.turn, type: t, delta: bal[t] - prev, reason: String(p.reason || '未标注'), source: ev.source, balance: bal[t], kind: 'adjust' });
    } else if (ev.op === 'set') {
      const w = p.wallet ?? {}; let touched = false;
      for (const [k, v] of Object.entries(w)) { bal[k] = Number(v) || 0; if (k === type) touched = true; }
      if (touched && bal[type] !== prev) txns.push({ seq: ev.seq, ts: ev.ts, turn: ev.turn, type, delta: bal[type] - prev, reason: String(p.reason || '手动校准'), source: ev.source, balance: bal[type], kind: 'set' });
    } else if (ev.op === 'seed') {
      for (const [k, v] of Object.entries(p.balances ?? {})) bal[k] = Number(v) || 0;   // 基线对齐，不列流水
    }
  }
  return txns.slice(-limit).reverse();   // 最新在前
}
export function walletReset(): void { core.reset(); void coreKvDel(KEY); try { localStorage.removeItem(KEY); } catch { /* */ } }
export function walletSnapshot() { hydrate(); return core.snapshot(); }
export function walletRestore(s: Parameters<typeof core.restore>[0]): void { core.restore(s); }

/** 核对事件核心 vs itemStore.currency（live），返回漂移项——抓"绕过货币闸门 / 双计"。 */
export function reconcileWallet(live: WalletBalances): { key: string; core: number; live: number }[] {
  hydrate();
  const b = core.getState().balances;
  if (Object.keys(b).length === 0) return [];   // 核心未播种（新档/读档重播前）→ 无基线可对，跳过防误报（照 reconcileItems 口径；seedWalletIfEmpty 每回合会补）
  const drift: { key: string; core: number; live: number }[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(live ?? {})])) {
    const cv = b[k] ?? 0, lv = (live ?? {})[k] ?? 0;
    if (cv !== lv) drift.push({ key: k, core: cv, live: lv });
  }
  return drift;
}

/** 启动/读档时：若事件核心还空，从当前 itemStore.currency 播种对齐（影子从一致态起步）。返回是否播种。 */
export function seedWalletIfEmpty(live: WalletBalances): boolean {
  hydrate();
  if (Object.keys(core.getState().balances).length > 0) return false;
  const nonZero = Object.entries(live ?? {}).some(([, v]) => Number(v) !== 0);
  if (!nonZero && Object.keys(live ?? {}).length === 0) return false;   // 全空/无键，不必播种
  walletSeed(live);
  return true;
}

export interface WalletDiag { ok: boolean; drift: { key: string; core: number; live: number }[]; violations: string[]; }
/** 一次性对账诊断（漂移 + 不变量违规），供每回合看门狗 / TableManager 显示。 */
export function walletDiagnostics(live: WalletBalances): WalletDiag {
  const drift = reconcileWallet(live);
  const violations = walletWatchdog();
  return { ok: drift.length === 0 && violations.length === 0, drift, violations };
}
