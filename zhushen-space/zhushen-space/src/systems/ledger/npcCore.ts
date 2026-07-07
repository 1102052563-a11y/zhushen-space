/* ── NPC 事件溯源核心（Step 10 pilot 第3域·继货币/物品之后）─────────────────
   NPC 老毛病=**幽灵**（编号无真名 name===id 凭空冒）/**重复建档**（同真名多 id·重入冲名/跨回合重复）。
   这两样 `watchdog.npcChecks` 已点态抓、`pruneGhostNpcs`/`dedupeByName` 已自愈；**npcCore 的独立增量价值**：
     · **溯源审计日志**——每个 NPC 谁/哪回合/哪条路建的（register 事件带 source），帮你追"反复冒的幽灵/重复是哪个源造的"；
     · 事件溯源结构——幂等 roster（同真名只登记一次·治重入）+ 确定性重放 + 随存档快照。
   **对账做成 store-based**（reconcileNpcs 只按 npcStore 现态报"同真名>1 / 幽灵"，不依赖完整喂数据 → 离场/漏挂创建路径都不会误报），
   审计日志用 roster 补"首建来源"。**零行为改动**（仅旁挂 upsertNpc 记账·try 兜底）。持久化 drpg-npc-core（随存档 saveManager 快照）。 */
import { createEventCore, type PendingEvent, type CommitResult } from './eventCore';
import { useMisc } from '../../store/miscStore';
import { compressWithMark, decompressMaybe } from '../compressedStorage';   // lz 压缩：溯源日志攒到 1MB+
import { coreKvGet, coreKvPut, coreKvDel } from './coreKv';   // 阶段1：持久化搬去 IndexedDB（不再占 localStorage 5MB）

interface RosterEntry { name: string; id: string; source: string; turn: number; }
interface NpcCoreState { roster: Record<string, RosterEntry>; }   // 归一真名 → 首建信息（审计）
type NpcOp = 'register' | 'remove' | 'seed';
interface NpcPayload { name?: string; id?: string; roster?: RosterEntry[]; }

const KEY = 'drpg-npc-core';

/** 归一真名（去空白+小写）。同名（不管 id）归一到一个键。跨语言别名(弗利萨/Frieren)不在此范围——那由 dedupeAliasNpcs 管。 */
export function npcNorm(name: unknown): string { return String(name ?? '').trim().toLowerCase(); }
/** 真名 NPC？（有名 且 名≠id·非幽灵）。 */
function isReal(name: unknown, id: unknown): boolean { const n = String(name ?? ''); return !!n && n !== String(id ?? ''); }

const core = createEventCore<NpcCoreState, NpcOp, NpcPayload>({
  initial: () => ({ roster: {} }),
  reduce: (s, ev) => {
    const roster = { ...s.roster };
    if (ev.op === 'register') {
      const { name, id } = ev.payload;
      if (isReal(name, id)) { const k = npcNorm(name); if (!roster[k]) roster[k] = { name: String(name), id: String(id ?? ''), source: ev.source, turn: ev.turn }; }   // 保首建（原始来源·供追溯）
    } else if (ev.op === 'remove') {
      delete roster[npcNorm(ev.payload.name)];
    } else if (ev.op === 'seed') {
      const out: Record<string, RosterEntry> = {};
      for (const e of ev.payload.roster ?? []) if (isReal(e.name, e.id)) { const k = npcNorm(e.name); if (!out[k]) out[k] = e; }
      return { roster: out };
    }
    return { roster };
  },
  invariants: () => [],   // roster 按构造干净（幂等键·已滤幽灵）；对账走 store-based reconcileNpcs
  deriveId: (op) => `${op}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
});

let _hydrated = false;
function persist() { void coreKvPut(KEY, compressWithMark(JSON.stringify(core.snapshot()))); }   // IDB 异步落库（fire-and-forget·下次提交会再写）
function hydrate() { /* no-op：核心载入已由 preloadNpcCore 在启动时完成（IDB 异步·无法同步 hydrate）；保留仅为兼容旧调用点 */ }
/** 启动时从 IndexedDB 载入核心（+一次性把旧 localStorage 值迁进 IDB 并清掉·释放 5MB 配额）。App.tsx 启动 await。 */
export async function preloadNpcCore(): Promise<void> {
  if (_hydrated) return; _hydrated = true;   // 幂等：启动只从 IDB 载一次
  try {
    let raw = await coreKvGet(KEY);
    if (raw == null) { const legacy = decompressMaybe(localStorage.getItem(KEY)); if (legacy) { raw = compressWithMark(legacy); await coreKvPut(KEY, raw); } }   // 旧版在 localStorage → 迁进 IDB
    try { localStorage.removeItem(KEY); } catch { /* */ }   // 无论如何清掉旧键（腾 localStorage）
    if (raw) { const plain = decompressMaybe(raw); if (plain) core.restore(JSON.parse(plain)); }
  } catch { /* 载入失败→核心空·seedNpcsIfEmpty 会从现场 store 重播基线 */ }
}
const curTurn = () => { try { return (useMisc.getState() as any).turnCount ?? 0; } catch { return 0; } };

export function npcCommit(pending: PendingEvent<NpcOp, NpcPayload>[], meta?: { turn?: number; source?: string }): CommitResult {
  hydrate();
  const r = core.commit(pending, { turn: meta?.turn ?? curTurn(), source: meta?.source ?? 'npc' });
  persist();
  return r;
}
/** 登记一个 NPC 存在（影子：upsertNpc 等创建路径同步喂进来）。幽灵（名===id）自动忽略。 */
export function npcRegister(name: string, id: string, source?: string, turn?: number): void {
  if (!isReal(name, id)) return;
  try { npcCommit([{ op: 'register', payload: { name, id } }], { source: source ?? 'upsert', turn }); } catch { /* */ }
}
export function npcRemove(name: string, meta?: { turn?: number; source?: string }): CommitResult {
  return npcCommit([{ op: 'remove', payload: { name } }], meta);
}
export function npcSeed(roster: RosterEntry[], meta?: { turn?: number; source?: string }): CommitResult {
  return npcCommit([{ op: 'seed', payload: { roster } }], { source: 'migrate', ...meta });
}
export function npcCoreRoster(): Record<string, RosterEntry> { hydrate(); return core.getState().roster; }
export function npcCoreLog() { hydrate(); return core.log(); }
export function npcCoreReset(): void { core.reset(); void coreKvDel(KEY); try { localStorage.removeItem(KEY); } catch { /* */ } }
export function npcCoreSnapshot() { hydrate(); return core.snapshot(); }
export function npcCoreRestore(s: Parameters<typeof core.restore>[0]): void { core.restore(s); }

/** 对账（store-based·仿 npcChecks）：报 幽灵/重复建档/id不一致，重复项用 roster 补"首建来源"。liveNpcs=npcStore.npcs。 */
export function reconcileNpcs(liveNpcs: Record<string, any>): string[] {
  hydrate();
  const roster = core.getState().roster;
  const v: string[] = [];
  const nameSeen = new Map<string, string>();   // 归一名 → 首个 id
  for (const [id, n] of Object.entries(liveNpcs ?? {})) {
    if (!n) continue;
    if (!n.name || n.name === id) { v.push(`幽灵 NPC（编号无真名）：${id}`); continue; }
    if (n.id && n.id !== id) v.push(`id 不一致：键 ${id} vs 内 ${n.id}（${n.name}）`);
    if (n.isDead) continue;
    const k = npcNorm(n.name);
    const prev = nameSeen.get(k);
    if (prev) {
      const src = roster[k]?.source ? `（首建源：${roster[k].source}·回合${roster[k].turn}）` : '';
      v.push(`重复建档：「${n.name}」= ${prev} 与 ${id}${src}`);
    } else nameSeen.set(k, id);
  }
  return v;
}

/** 启动/读档时：若核心 roster 还空，从当前 npcStore 播种（审计基线）。 */
export function seedNpcsIfEmpty(liveNpcs: Record<string, any>): boolean {
  hydrate();
  if (Object.keys(core.getState().roster).length > 0) return false;
  const list: RosterEntry[] = [];
  for (const [id, n] of Object.entries(liveNpcs ?? {})) if (n && isReal(n.name, id)) list.push({ name: n.name, id, source: 'seed', turn: curTurn() });
  if (list.length === 0) return false;
  npcSeed(list);
  return true;
}

export interface NpcDiag { ok: boolean; violations: string[]; }
/** 一次性对账诊断，供每回合看门狗 / 面板显示。 */
export function npcDiagnostics(liveNpcs: Record<string, any>): NpcDiag {
  const violations = reconcileNpcs(liveNpcs);
  return { ok: violations.length === 0, violations };
}
