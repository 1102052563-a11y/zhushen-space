// 👗📚 穿搭模板参考图（IndexedDB `drpg-outfit-templates`·key=模板id→dataURL）。
// 独立于 drpg-images：imageDb 随存档快照/新游戏清空，而模板库是跨存档资产（outfitTemplateStore 同理不进 STORES）。
const DB_NAME = 'drpg-outfit-templates';
const STORE = 'imgs';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbPromise = null; rej(req.error); };
  });
  return dbPromise;
}

export async function putTplImg(id: string, dataUrl: string): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function getTplImg(id: string): Promise<string | undefined> {
  const d = await db();
  return new Promise((res) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => res(typeof req.result === 'string' ? req.result : undefined);
    req.onerror = () => res(undefined);
  });
}
export async function delTplImg(id: string): Promise<void> {
  const d = await db();
  return new Promise((res) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
