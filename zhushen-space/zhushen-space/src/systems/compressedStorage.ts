import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/* ── lz 压缩版 localStorage（给体积大的 zustand persist store 用）──────────────
   背景：localStorage 是**整个域共享 ~5-10MB 总配额**。`drpg-misc` 的「叙事长期事实」默认不限数量，
   累积到数千条后裸 JSON 就把配额顶满 → 报 `setItem 'drpg-settings' exceeded the quota`（配额没了，
   改 API / 存记忆 / 读档回退 全都写不进），并且每次变动都要序列化几千条=卡。
   修：这类 store 的 persist 值用 lz-string 压缩（中文文本压 ~5-10×），2000+ 事实轻松放下。

   兼容 & save 无碍：① 旧的**未压缩**值（无 LZ 前缀）原样读出、下次写入即转成压缩，自动迁移；
   ② saveManager.snapshotStores 读的是 localStorage 里的压缩串、读档写回也是压缩串 → reload 后本 storage
   解压即可（存档还顺带变小）；mergeKeepApi 会用 decompressMaybe/compressWithMark 处理压缩值、不丢 miscApi；
   ③ setItem 仍超配额时静默吞（别 throw 把主流程崩了）。 */

const MARK = 'LZ';   // 压缩标记前缀：zustand 存的 JSON 一定以 { 开头、绝不以 LZ 开头，用来区分「已压缩」vs「旧·未压缩」

/** 是否是本模块写出的压缩值（带 LZ 前缀）。 */
export function isCompressed(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(MARK);
}

/** 解压：带 LZ 前缀→解压；否则（旧·未压缩）原样返回。供 mergeKeepApi 等需读明文 JSON 的地方用。 */
export function decompressMaybe(v: string | null | undefined): string | null {
  if (v == null) return null;
  if (!v.startsWith(MARK)) return v;
  try { return decompressFromUTF16(v.slice(MARK.length)) || null; } catch { return null; }
}

/** 压缩：JSON 明文 → 带 LZ 前缀的压缩串。 */
export function compressWithMark(json: string): string {
  return MARK + compressToUTF16(json);
}

/* ── 合并写盘（同 key 300ms 窗口内多次写只落盘最后一次）──────────────────────────
   背景：persist 每次 set() 都同步走「stringify(整 store) → lz 压缩 → localStorage.setItem」，其中
   lz 压缩是大头（drpg-npc 明文 400KB+ 压一次可达百毫秒级）；而一回合结算连跑 ~18 个演化阶段、
   触发几十次 set() → 主线程被反复全量压缩写盘卡住。这里按 key 合并：首写起 300ms 后落盘一次
   「最后的值」，窗口固定**不重置**（连续写不会饿死、延迟有上界 300ms）。
   正确性三件套（缺一会出丢档/脏快照 bug）：
   ① 读写一致：getItem 先查未落盘的排程值，读到的永远是最新写入；
   ② 关页不丢：pagehide / beforeunload / visibilitychange(hidden) 强制 flush（手机切后台也落盘）；
   ③ 快照与读档：snapshotStores / captureEvoSnapshot / 诊断 直读 localStorage，读前必须
      flushPersistWrites()；loadSlot 则用 suspendPersistWrites()——先 flush 再挂起**丢弃**后续写，
      否则后台还活着的演化阶段的延迟写会落在 restoreStores() 与 reload 之间，把刚写回的存档快照
      又盖成读档前的值（loadSlot 苦心维持的「零 async 窗口」保证会被 300ms 定时器绕过）。 */

const FLUSH_DELAY_MS = 300;
interface PendingWrite { json: string; commit: (json: string) => void; timer: ReturnType<typeof setTimeout> }
const _pending = new Map<string, PendingWrite>();
let _suspended = false;
let _suspendTimer: ReturnType<typeof setTimeout> | null = null;

function flushKey(key: string): void {
  const p = _pending.get(key);
  if (!p) return;
  _pending.delete(key);
  clearTimeout(p.timer);
  try { p.commit(p.json); } catch { /* 落盘失败（配额满等）：与原直写行为一致，静默 */ }
}

function scheduleWrite(key: string, json: string, commit: (json: string) => void): void {
  if (_suspended) return;   // 读档挂起窗口：live state 马上被 reload 抛弃，这些写必须丢（防盖掉刚恢复的存档）
  const prev = _pending.get(key);
  if (prev) { prev.json = json; prev.commit = commit; return; }   // 已有排程：只换值，不重置计时
  const timer = setTimeout(() => flushKey(key), FLUSH_DELAY_MS);
  _pending.set(key, { json, commit, timer });
}

function cancelWrite(key: string): void {
  const p = _pending.get(key);
  if (p) { clearTimeout(p.timer); _pending.delete(key); }
}

/** 把所有排程中的写立即落盘。凡**直读 localStorage** 的快照/诊断路径（saveManager.snapshotStores、
 *  captureEvoSnapshot、saveDiagnostics 等）读之前必须先调这个，否则读到落后 ≤300ms 的旧值。 */
export function flushPersistWrites(): void {
  for (const key of [..._pending.keys()]) flushKey(key);
}

/** 读档专用：先 flush（mergeKeepApi / KEEP_CURRENT 读到的才是最新值），随后**丢弃**一切新的
 *  persist 写，直到 reload（正常读档必 reload）或 maxMs 兜底自动恢复（读档中途抛错没走到
 *  reload 时，持久化不至于从此瘫痪）。 */
export function suspendPersistWrites(maxMs = 20000): void {
  flushPersistWrites();
  _suspended = true;
  if (_suspendTimer) clearTimeout(_suspendTimer);
  _suspendTimer = setTimeout(() => resumePersistWrites(), maxMs);
}

/** 解除挂起（suspendPersistWrites 的 maxMs 兜底走这里；测试清理也用）。 */
export function resumePersistWrites(): void {
  _suspended = false;
  if (_suspendTimer) { clearTimeout(_suspendTimer); _suspendTimer = null; }
}

// 关页/刷新/切后台强制落盘：pagehide 覆盖刷新与手机杀页，beforeunload 兜桌面，hidden 兜切后台。
// 读档挂起期间不 flush（那批写正是要丢弃的）。vitest 跑 node 环境（内存 localStorage 垫片）无 window，须守卫。
if (typeof window !== 'undefined') {
  const flushIfActive = () => { if (!_suspended) flushPersistWrites(); };
  window.addEventListener('pagehide', flushIfActive);
  window.addEventListener('beforeunload', flushIfActive);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushIfActive(); });
  }
}

export const lzLocalStorage: StateStorage = {
  getItem: (name) => {
    const p = _pending.get(name);
    if (p) return p.json;                   // 排程中未落盘：直接回明文（读写一致）
    let v: string | null = null;
    try { v = localStorage.getItem(name); } catch { return null; }
    return decompressMaybe(v);
  },
  setItem: (name, value) => {
    scheduleWrite(name, value, (json) => {
      try { localStorage.setItem(name, compressWithMark(json)); }
      catch { /* 压缩后仍超配额：静默——总比 throw 中断整条状态更新链好（配额告警另有 UI） */ }
    });
  },
  removeItem: (name) => { cancelWrite(name); try { localStorage.removeItem(name); } catch { /* */ } },
};

/** 供 zustand persist 的 `storage` 用：createJSONStorage 包一层 JSON 序列化。 */
export const lzStorage = () => createJSONStorage(() => lzLocalStorage);

/** 不压缩、但同样合并写盘的 localStorage —— 给 settings/items/skilltree 这类**大而不压**的 store 用：
 *  它们没有配额压力（不值得吃 lz 的解压启动成本），卡点在每次 set() 的全量 setItem；合并后
 *  一回合几十次写压成几次。getItem 与底层格式（裸 JSON）和 zustand 默认存储完全一致，切换零迁移。 */
export const debouncedLocalStorage: StateStorage = {
  getItem: (name) => {
    const p = _pending.get(name);
    if (p) return p.json;
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    scheduleWrite(name, value, (json) => {
      try { localStorage.setItem(name, json); } catch { /* 超配额：静默（与 zustand 默认存储行为一致） */ }
    });
  },
  removeItem: (name) => { cancelWrite(name); try { localStorage.removeItem(name); } catch { /* */ } },
};

/** 供 zustand persist 的 `storage` 用（不压缩·仅合并写盘版）。 */
export const debouncedStorage = () => createJSONStorage(() => debouncedLocalStorage);

/** 一次性迁移：把列出的 key 里**旧·未压缩**的值就地重写成压缩值——**立即**释放配额，不用等各 store 下次状态变更才压。
    对 zustand persist 值(`{state}`) 与事件核心快照都通用（只按 LZ 前缀判压、compressWithMark 与内部格式无关）。
    ⚠只在有旧值且更小时才写（覆盖同一 key 为更小值即便配额已满也能成功），静默容错，绝不因它中断启动。 */
export function migrateCompressLegacy(keys: string[]): void {
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw && !isCompressed(raw) && raw.length > 2) {
        const packed = compressWithMark(raw);
        if (packed.length < raw.length) localStorage.setItem(k, packed);   // 只在确实变小时替换
      }
    } catch { /* 配额/异常都别中断启动 */ }
  }
}

/** 仍存 localStorage 的压缩 store 的 key（migrateCompressLegacy 用；新增压缩 store 记得加进来）。
    注：事件核心 npc-core/items-core/wallet 已搬 IndexedDB（阶段1），其旧 localStorage 值由 preloadEventCores 迁移，故不在此列。 */
export const COMPRESSED_KEYS = [
  'drpg-misc', 'drpg-turn-insight',
  'drpg-npc', 'drpg-faction', 'drpg-characters', 'drpg-fanfic', 'drpg-ledger', 'drpg-tables', 'drpg-channel',
];
