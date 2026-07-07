/* ── 事件核心快照的 IndexedDB 持久层（drpg-core-kv）── 阶段1：把 npc-core/items-core/wallet 从
   localStorage(全域~5MB) 挪进 IndexedDB(GB 级·可申请持久化)，根除长档（上千回合·事件日志越滚越大）把
   localStorage 顶爆 → 写入失败（改 API/存记忆/物品演化全崩）。key=核心名（沿用旧 localStorage 键），
   value=压缩后的快照串（compressWithMark·与旧 localStorage 值格式一致，迁移零解析差异）。

   与 localStorage 的关键差别：IndexedDB 读是**异步**的 → 核心改为「启动 await preload 一次性载入内存、
   之后同步用」；写走 fire-and-forget（像 imageDb）。存档不再快照这几个核心（snapshotStores 读 localStorage
   为空即跳过），读档/新游戏时清掉 IDB → 靠 seedIfEmpty 从现场 store 重新播种影子基线（影子账本本就该跟随现态）。 */

const DB_NAME = 'drpg-core-kv';
const STORE = 'kv';
const VERSION = 1;

/** 三个事件核心的键（= 旧 localStorage 键，迁移时按此读旧值）。saveManager 读档/新游戏用它统一清 IDB。 */
export const EVENT_CORE_KEYS = ['drpg-npc-core', 'drpg-items-core', 'drpg-wallet'] as const;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function coreKvGet(key: string): Promise<string | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}

export async function coreKvPut(key: string, val: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* 落库失败不阻断游戏（影子账本·下次提交会再写） */ }
}

export async function coreKvDel(key: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* */ }
}

/** 读档/新游戏：清掉三个事件核心的 IDB 快照（awaitable·在 reload 前调用），
    使 reload 后 preload 读到空 → seedIfEmpty 从现场 store 重播影子基线（防读档后旧核心 vs 新 store 假漂移）。 */
export async function resetEventCoresIdb(): Promise<void> {
  for (const k of EVENT_CORE_KEYS) { try { localStorage.removeItem(k); } catch { /* */ } }   // 顺带清掉可能残留的旧 localStorage 键
  await Promise.all(EVENT_CORE_KEYS.map((k) => coreKvDel(k)));
}
