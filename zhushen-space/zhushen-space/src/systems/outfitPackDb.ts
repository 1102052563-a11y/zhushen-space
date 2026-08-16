/* ════════════════════════════════════════════
   👗📦 成衣库（IndexedDB `drpg-outfit-packs`·跨存档资产）。
   ⚠ 铁则：绝不进 saveManager 快照、绝不放 imageDb——imageDb 随存档快照打包，
   数百套×图会把 autosnap×5 撑爆；本库与 outfitTemplateDb 同一模式：
   跨存档、不注册 STORES、新游戏/读档都保留。图与元数据同店同记录（key=<charName>#<源id>），
   列表读取用 cursor 剥离 img（缩略图分页按需 packGetImg 单取）。
════════════════════════════════════════════ */

export interface PackDbEntry {
  key: string;       // <charName>#<源id>
  charName: string;  // 来源包名（按包分组/整包删除）
  name: string;
  desc: string;
  tags: string;
  hasImage: boolean;
  createdAt: number;
}
type StoredEntry = PackDbEntry & { img?: string };

const DB_NAME = 'drpg-outfit-packs';
const STORE = 'entries';

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

/** 入库/覆盖一条（img 只在有图时带）。 */
export async function packPut(entry: PackDbEntry, img?: string): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    const rec: StoredEntry = img ? { ...entry, img } : { ...entry };
    tx.objectStore(STORE).put(rec, entry.key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** 已有 key 集合（导入去重用）。 */
export async function packKeys(): Promise<Set<string>> {
  const d = await db();
  return new Promise((res) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    req.onsuccess = () => res(new Set((req.result ?? []).map(String)));
    req.onerror = () => res(new Set());
  });
}

/** 全部元数据（不含 img·cursor 逐条剥离，避免整库图一次进内存）。 */
export async function packList(): Promise<PackDbEntry[]> {
  const d = await db();
  return new Promise((res) => {
    const out: PackDbEntry[] = [];
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        out.sort((a, b) => (a.createdAt - b.createdAt) || a.key.localeCompare(b.key));
        res(out);
        return;
      }
      const meta = (cur.value ?? {}) as Partial<StoredEntry>;   // 显式逐字段构造：类型干净 + 防御脏记录
      out.push({
        key: String(cur.key),
        charName: String(meta.charName ?? ''),
        name: String(meta.name ?? ''),
        desc: String(meta.desc ?? ''),
        tags: String(meta.tags ?? ''),
        hasImage: !!meta.hasImage,
        createdAt: Number(meta.createdAt) || 0,
      });
      cur.continue();
    };
    req.onerror = () => res([]);
  });
}

/** 单取一条的图（无图/无记录返回 undefined）。 */
export async function packGetImg(key: string): Promise<string | undefined> {
  const d = await db();
  return new Promise((res) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => {
      const v = req.result as StoredEntry | undefined;
      res(typeof v?.img === 'string' && v.img.startsWith('data:image/') ? v.img : undefined);
    };
    req.onerror = () => res(undefined);
  });
}

/** 删一条。 */
export async function packDel(key: string): Promise<void> {
  const d = await db();
  return new Promise((res) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

/** 整包删除（按来源包名）。返回删除条数。 */
export async function packClearPack(charName: string): Promise<number> {
  const d = await db();
  return new Promise((res) => {
    let n = 0;
    const tx = d.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const v = cur.value as StoredEntry;
      if (v?.charName === charName) { cur.delete(); n++; }
      cur.continue();
    };
    tx.oncomplete = () => res(n);
    tx.onerror = () => res(n);
  });
}
