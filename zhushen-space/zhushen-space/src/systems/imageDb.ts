/* ════════════════════════════════════════════
   图片专用 IndexedDB（drpg-images）——头像/装备图体积大，放这里而不是 localStorage(5MB上限)。
   key→dataURL。key 规则：player / npc:<id> / item:<itemId> / npcitem:<ownerId>:<itemId>
════════════════════════════════════════════ */
const DB_NAME = 'drpg-images';
const STORE = 'img';
const VERSION = 1;

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

export async function putImg(key: string, dataUrl: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delImg(key: string): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** 读取全部 key→dataURL（启动时回填用）*/
export async function getAllImg(): Promise<Record<string, string>> {
  const d = await db();
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    const tx = d.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const kReq = store.getAllKeys();
    const vReq = store.getAll();
    tx.oncomplete = () => {
      const keys = kReq.result as IDBValidKey[];
      const vals = vReq.result as string[];
      keys.forEach((k, i) => { out[String(k)] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => resolve(out);
  });
}

/** 批量写入（导入存档用）*/
export async function bulkPutImg(record: Record<string, string>): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [k, v] of Object.entries(record)) if (typeof v === 'string') store.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllImg(): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
