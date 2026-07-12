/* 向量资料库共享 IndexedDB 层（drpg-novelvec）。
   运行时(novelVec.ts)与建库/分享(novelVecBuild.ts)共用同一套 DB 原语，避免各开各的 DB / 多版本冲突。
   Schema v2：
     - kv 存 manifest:<name> / vectors:<name>(ArrayBuffer)
     - chunks 存 {k:'<name>#<id>', t, v, c}
   其中 <name> 对内置源是目录名(novel-vectors/worldbook-vectors)，对玩家自建索引是其 meta.id。 */

const DB = 'drpg-novelvec';

export interface ChunkRow { k: string; t: string; v: string; c: string }

let _dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'k' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
  // 打开失败别把坏 promise 永久缓存
  _dbPromise.catch(() => { _dbPromise = null; });
  return _dbPromise;
}

export function kvGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((res) => { const r = db.transaction('kv', 'readonly').objectStore('kv').get(key); r.onsuccess = () => res(r.result as T); r.onerror = () => res(undefined); });
}
export function kvPut(db: IDBDatabase, key: string, val: any): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
export function kvDel(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
export function chunkGet(db: IDBDatabase, key: string): Promise<ChunkRow | undefined> {
  return new Promise((res) => { const r = db.transaction('chunks', 'readonly').objectStore('chunks').get(key); r.onsuccess = () => res(r.result as ChunkRow); r.onerror = () => res(undefined); });
}
export function chunksBulk(db: IDBDatabase, rows: ChunkRow[]): Promise<void> {
  return new Promise((res) => { const tx = db.transaction('chunks', 'readwrite'); const st = tx.objectStore('chunks'); for (const r of rows) st.put(r); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
/* 删除某索引的全部 chunk（键前缀 <name>#…）+ 其 kv（vectors/manifest） */
export function chunksDeletePrefix(db: IDBDatabase, name: string): Promise<void> {
  return new Promise((res) => {
    const tx = db.transaction('chunks', 'readwrite');
    // 键区间 [name#, name#￿]
    try { tx.objectStore('chunks').delete(IDBKeyRange.bound(`${name}#`, `${name}#￿`)); } catch { /* */ }
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}
/* 取某索引的全部 chunk（按 id 升序），用于导出/上传 */
export function chunksByPrefix(db: IDBDatabase, name: string): Promise<ChunkRow[]> {
  return new Promise((res) => {
    const out: ChunkRow[] = [];
    const tx = db.transaction('chunks', 'readonly');
    const rq = tx.objectStore('chunks').openCursor(IDBKeyRange.bound(`${name}#`, `${name}#￿`));
    rq.onsuccess = () => {
      const cur = rq.result as IDBCursorWithValue | null;
      if (cur) { out.push(cur.value as ChunkRow); cur.continue(); }
    };
    tx.oncomplete = () => {
      // 按 #后数字序稳定排序（游标是字符串序，'10' < '2'，须数值化）
      out.sort((a, b) => (parseInt(a.k.slice(a.k.lastIndexOf('#') + 1), 10) || 0) - (parseInt(b.k.slice(b.k.lastIndexOf('#') + 1), 10) || 0));
      res(out);
    };
    tx.onerror = () => res(out);
  });
}

/* 完整删除一个索引（vectors + manifest + chunks） */
export async function deleteIndex(name: string): Promise<void> {
  const db = await openDb();
  await Promise.all([kvDel(db, `vectors:${name}`), kvDel(db, `manifest:${name}`)]);
  await chunksDeletePrefix(db, name);
}
