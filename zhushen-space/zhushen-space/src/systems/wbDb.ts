// 世界书 / 正文世界书 / 文本预设 改存 IndexedDB（localStorage 仅 ~5MB，存不下大世界书）。
// 只存玩家自己导入/编辑的（非 builtin）；内置项每次启动从 public/presets 重载，不入库。
const DB_NAME = 'drpg-wb';
const STORE = 'kv';
const KEY = 'books';

export interface WbBlob {
  worldBooks: any[];
  textWorldBooks: any[];
  textPresets: any[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadWb(): Promise<WbBlob | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      rq.onsuccess = () => resolve((rq.result as WbBlob) ?? null);
      rq.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function saveWb(data: WbBlob): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* */ }
}

export async function clearWb(): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
  } catch { /* */ }
}
