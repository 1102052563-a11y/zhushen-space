// 漫画库持久化（IndexedDB `drpg-comics`）——独立于 drpg-images / saveManager：
// 整页漫画 1~3MB×N 页×M 批，进存档快照会把导出/云存档撑爆；且漫画是「库房」性质（跨存档保留、清进度不清、删除=玩家显式操作）。
// 结构：batches（批次元数据+分镜 JSON）/ pages（页图 dataURL，id=`${batchId}_p${page}`，重绘原位覆盖）。
export interface ComicBatch {
  id: string;
  title: string;
  createdAt: number;
  sourceFloors: number[];      // 取材楼层号（展示用）
  sourceDigest: string;        // 剧情摘要（前 80 字，列表预览用）
  language: string;
  plan: unknown;               // 分镜 JSON（zs_comic_v1，重绘/补页/查提示词都靠它）
  pageTotal: number;           // 计划页数
  status: 'done' | 'partial';  // partial=有页缺图（可补齐）
}
export interface ComicPage {
  id: string;                  // `${batchId}_p${page}`
  batchId: string;
  page: number;
  dataUrl: string;
  pagePrompt: string;          // 分镜给的本页提示词（原文）
  finalPrompt: string;         // 实际发给绘画模型的完整提示词（重绘复用）
  createdAt: number;
}

const DB_NAME = 'drpg-comics';
const BATCHES = 'batches';
const PAGES = 'pages';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(BATCHES)) d.createObjectStore(BATCHES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(PAGES)) {
        const s = d.createObjectStore(PAGES, { keyPath: 'id' });
        s.createIndex('batchId', 'batchId', { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbPromise = null; rej(req.error); };
  });
  return dbPromise;
}
function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const r = run(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  }));
}

export function putBatch(b: ComicBatch): Promise<unknown> { return tx(BATCHES, 'readwrite', (s) => s.put(b)); }
export function getBatch(id: string): Promise<ComicBatch | undefined> { return tx(BATCHES, 'readonly', (s) => s.get(id)); }
export async function listBatches(): Promise<ComicBatch[]> {
  const all = await tx<ComicBatch[]>(BATCHES, 'readonly', (s) => s.getAll());
  return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
}
export function putPage(p: ComicPage): Promise<unknown> { return tx(PAGES, 'readwrite', (s) => s.put(p)); }
export function getPage(id: string): Promise<ComicPage | undefined> { return tx(PAGES, 'readonly', (s) => s.get(id)); }
export async function pagesOfBatch(batchId: string): Promise<ComicPage[]> {
  const d = await db();
  const rows = await new Promise<ComicPage[]>((res, rej) => {
    const r = d.transaction(PAGES, 'readonly').objectStore(PAGES).index('batchId').getAll(batchId);
    r.onsuccess = () => res(r.result as ComicPage[]);
    r.onerror = () => rej(r.error);
  });
  return rows.sort((a, b) => a.page - b.page);
}
/** 删一批（批次记录 + 全部页图）。玩家显式操作才调用。 */
export async function deleteBatch(batchId: string): Promise<void> {
  const pages = await pagesOfBatch(batchId);
  const d = await db();
  await new Promise<void>((res, rej) => {
    const t = d.transaction([BATCHES, PAGES], 'readwrite');
    t.objectStore(BATCHES).delete(batchId);
    for (const p of pages) t.objectStore(PAGES).delete(p.id);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
