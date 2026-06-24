/* 对话跨刷新自动保留：对话逐条存 IndexedDB，按消息 id 做行键，
   每次只写"内容变化的那几条"（流式时只有正在生成的 1 条在变 → 只写 1 行，不卡）。
   参考 fanren-remake 的 archiveChatMessages 增量写法。 */

import { logWarn } from '../utils/log';

const DB_NAME = 'drpg-chat';
const STORE = 'messages';
// 「正文归档」：append-only 的过往世界对话日志。进入新世界会清空当前对话（messages 只剩当前世界），
// 旧世界正文本会丢，导出小说便只剩当前世界——归档在切换世界时把"将被清掉的那一局"留下来，让导出能拿到全部世界。
const ARCHIVE = 'archive';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);   // v2：新增 archive 存储（旧库自动升级，messages 不动）
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(ARCHIVE)) d.createObjectStore(ARCHIVE, { keyPath: 'seq', autoIncrement: true });
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
  } catch (e) { logWarn('chatDb.loadAll', e); return []; }   // 读失败→历史看起来空了，出声便于排查
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
  } catch (e) { logWarn('chatDb.putChanged', e); }   // 写失败→对话没增量落库（不阻断游戏，但出声）
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
  } catch (e) { logWarn('chatDb.replaceAll', e); }   // 读档整表替换失败→对话没还原
}

export async function clearAll(): Promise<void> {
  await replaceAll([]);
}

/* ───────────── 正文归档（跨世界 append-only，供「导出全部正文」用）───────────── */
export interface ArchivedMsg { seq?: number; role: 'user' | 'assistant'; content: string; world?: string }

/** 追加一批消息到归档（进入新世界、即将清空当前对话前调用）。只收 user/assistant 非空内容。 */
export async function appendArchive(entries: { role: string; content: string; world?: string }[]): Promise<void> {
  try {
    const clean = (entries || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content && String(m.content).trim());
    if (!clean.length) return;
    const d = await db();
    const tx = d.transaction(ARCHIVE, 'readwrite');
    const store = tx.objectStore(ARCHIVE);
    for (const m of clean) store.put({ role: m.role, content: m.content, world: m.world || '' });   // 不带 seq → autoIncrement 自增分配，保持追加顺序
    await txDone(tx);
  } catch (e) { logWarn('chatDb.appendArchive', e); }
}

/** 读出全部归档（按 seq 升序＝时间/世界顺序）。 */
export async function loadArchive(): Promise<ArchivedMsg[]> {
  try {
    const d = await db();
    const all = await new Promise<ArchivedMsg[]>((res, rej) => {
      const r = d.transaction(ARCHIVE, 'readonly').objectStore(ARCHIVE).getAll();
      r.onsuccess = () => res(r.result as ArchivedMsg[]);
      r.onerror = () => rej(r.error);
    });
    all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return all;
  } catch (e) { logWarn('chatDb.loadArchive', e); return []; }
}

/** 整表替换归档（读档：把存档里随身带的归档还原成当前归档）。 */
export async function replaceArchive(entries: ArchivedMsg[]): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(ARCHIVE, 'readwrite');
    const store = tx.objectStore(ARCHIVE);
    store.clear();
    for (const m of entries || []) store.put({ role: m.role, content: m.content, world: m.world || '' });   // 剥 seq → 顺序按数组重新自增
    await txDone(tx);
  } catch (e) { logWarn('chatDb.replaceArchive', e); }
}

/** 清空归档（新游戏：上一局的过往世界不带进新局）。 */
export async function clearArchive(): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(ARCHIVE, 'readwrite');
    tx.objectStore(ARCHIVE).clear();
    await txDone(tx);
  } catch (e) { logWarn('chatDb.clearArchive', e); }
}
