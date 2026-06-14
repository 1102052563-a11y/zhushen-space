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

export const saveDb = {
  put: (slot: unknown) => run<IDBValidKey>('readwrite', (s) => s.put(slot)),
  get: <T = any>(id: string) => run<T>('readonly', (s) => s.get(id)),
  all: <T = any>() => run<T[]>('readonly', (s) => s.getAll()),
  del: (id: string) => run<undefined>('readwrite', (s) => s.delete(id)),
};
