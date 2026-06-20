/* 存档底层存储：IndexedDB（容量大，适合多存档 + 全对话历史）*/
const DB_NAME = 'drpg-archive';
const STORE = 'slots';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/* 仅取所有存档的「元数据」(剥掉巨大的 data 字段)：用游标逐条读、当场剥 data，
   避免 getAll() 把所有存档(各可能几十 MB 含图)同时载入内存——多档时会撑爆标签页内存导致崩溃。
   峰值内存 = 单条记录，而非全部之和。供存档列表(listSlots)用。 */
function allMeta<T = any>(): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const out: T[] = [];
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) { const { data, ...meta } = cur.value as any; void data; out.push(meta as T); cur.continue(); }
          else resolve(out);
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export const saveDb = {
  put: (slot: unknown) => run<IDBValidKey>('readwrite', (s) => s.put(slot)),
  get: <T = any>(id: string) => run<T>('readonly', (s) => s.get(id)),
  all: <T = any>() => run<T[]>('readonly', (s) => s.getAll()),
  keys: () => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys()),   // 仅主键，零数据加载——供按 id 前缀清理(滚动备份裁剪/新游戏)
  allMeta,                                                              // 仅元数据(无 data)——供存档列表，避免一次性载入所有大存档
  del: (id: string) => run<undefined>('readwrite', (s) => s.delete(id)),
};
