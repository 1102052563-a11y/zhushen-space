/* 对话跨刷新自动保留：对话逐条存 IndexedDB，按消息 id 做行键，
   每次只写"内容变化的那几条"（流式时只有正在生成的 1 条在变 → 只写 1 行，不卡）。
   参考 fanren-remake 的 archiveChatMessages 增量写法。 */

const DB_NAME = 'drpg-chat';
const STORE = 'messages';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// 记录每条消息上次落库的 JSON，用于增量 diff（避免重复写未变化的消息）
const lastJson = new Map<number, string>();

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export interface StoredMsg { id: number; role: 'user' | 'assistant'; content: string; smallSummary?: string; largeSummary?: string }

/** 读出全部已存对话（按 id 升序）；同时重建 diff 缓存 */
export async function loadAll(): Promise<StoredMsg[]> {
  try {
    const d = await db();
    const all = await new Promise<StoredMsg[]>((res, rej) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result as StoredMsg[]);
      r.onerror = () => rej(r.error);
    });
    all.sort((a, b) => a.id - b.id);
    lastJson.clear();
    for (const m of all) lastJson.set(m.id, JSON.stringify(m));
    return all;
  } catch { return []; }
}

/** 增量写：只写内容变化/新增的消息，删除已不存在的消息 */
export async function putChanged(messages: StoredMsg[]): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const seen = new Set<number>();
    for (const m of messages) {
      seen.add(m.id);
      const json = JSON.stringify(m);
      if (lastJson.get(m.id) !== json) { store.put(m); lastJson.set(m.id, json); }
    }
    for (const id of [...lastJson.keys()]) {
      if (!seen.has(id)) { store.delete(id); lastJson.delete(id); }
    }
    await txDone(tx);
  } catch { /* 忽略写入失败，不影响游戏 */ }
}

/** 整表替换（读档时用：把存档里的对话写成当前对话）*/
export async function replaceAll(messages: StoredMsg[]): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const m of messages) store.put(m);
    await txDone(tx);
    lastJson.clear();
    for (const m of messages) lastJson.set(m.id, JSON.stringify(m));
  } catch { /* ignore */ }
}

export async function clearAll(): Promise<void> {
  await replaceAll([]);
}
