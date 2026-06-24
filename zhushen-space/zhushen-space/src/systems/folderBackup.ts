/* ── 本地文件夹存档（File System Access API）─────────────────────────────────
   把存档写到用户**选定的真实磁盘文件夹**，不受浏览器对 IndexedDB 的「整源淘汰」影响
   （文件在磁盘上，浏览器清存储也删不掉）——这是抗「存档被浏览器清掉」的根治备份。

   - 仅桌面版 Chromium（Chrome/Edge/Opera）支持 showDirectoryPicker；
     手机浏览器 / Firefox / Safari 不支持 → isFolderBackupSupported()=false，调用方回退到云存档/导出。
   - 目录句柄(FileSystemDirectoryHandle)可结构化克隆进 IndexedDB 持久化（跨刷新免重选）；
     即便这个小库也被淘汰，重选一次文件夹即可，磁盘上已写出的存档文件不会丢。
   - 权限：恢复句柄后权限可能回落到 'prompt'，需在**用户手势**内 requestPermission 才能写；
     每回合自动备份不在手势内 → 只用已 'granted' 的权限，未授权则跳过（面板里引导点一下重新授权）。
   FSA 的若干方法不在标准 TS DOM lib 里 → 用 any 兜，避免类型报错（构建本就跳过 tsc）。*/

const DB = 'drpg-fsa';
const STORE = 'kv';
const HANDLE_KEY = 'dirHandle';
const ENABLED_KEY = 'autoEnabled';

/** 自动备份固定文件名（每回合覆盖同一个，保持文件夹整洁；不含图、体积小）。 */
export const FOLDER_AUTOSAVE_FILE = '主神空间-自动备份.json';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result as T);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(key: string, val: any): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
    q.onsuccess = () => res();
    q.onerror = () => rej(q.error);
  });
}
async function idbDel(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    q.onsuccess = () => res();
    q.onerror = () => rej(q.error);
  });
}

export function isFolderBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

let cachedHandle: any = null;

/** 取当前已选文件夹句柄（内存缓存优先，否则从 IndexedDB 恢复）。未选过则 null。 */
export async function getFolderHandle(): Promise<any> {
  if (cachedHandle) return cachedHandle;
  try { cachedHandle = (await idbGet<any>(HANDLE_KEY)) || null; } catch { cachedHandle = null; }
  return cachedHandle;
}

/** 让用户选一个文件夹（须用户手势）。选完即记住句柄，返回文件夹名。 */
export async function pickFolder(): Promise<string> {
  const h = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'zhushen-saves' });
  cachedHandle = h;
  try { await idbSet(HANDLE_KEY, h); } catch { /* 句柄存不进库也不影响本会话写入 */ }
  return h.name;
}

/** 忘记文件夹（只清句柄，**不删磁盘上的文件**）。 */
export async function forgetFolder(): Promise<void> {
  cachedHandle = null;
  try { await idbDel(HANDLE_KEY); } catch { /* */ }
}

export async function folderAutoEnabled(): Promise<boolean> {
  try { return (await idbGet<boolean>(ENABLED_KEY)) === true; } catch { return false; }
}
export async function setFolderAutoEnabled(v: boolean): Promise<void> {
  try { await idbSet(ENABLED_KEY, v); } catch { /* */ }
}

/** 查询/申请文件夹读写权限。request=true 会弹权限（**必须在用户手势内调用**，否则浏览器拒绝）。 */
export async function checkPermission(request: boolean): Promise<'granted' | 'prompt' | 'denied' | 'none'> {
  const h = await getFolderHandle();
  if (!h) return 'none';
  try {
    const opts: any = { mode: 'readwrite' };
    let p: string = await h.queryPermission(opts);
    if (p !== 'granted' && request) p = await h.requestPermission(opts);
    return (p as any) || 'prompt';
  } catch { return 'denied'; }
}

/** 把文本写进文件夹里的某个文件（存在则覆盖）。 */
export async function writeFile(name: string, text: string): Promise<void> {
  const h = await getFolderHandle();
  if (!h) throw new Error('未选择文件夹');
  const fh = await h.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/** 列出文件夹里的 .json 文件名（按名倒序：带时间戳的新档在前）。 */
export async function listJsonFiles(): Promise<string[]> {
  const h = await getFolderHandle();
  if (!h) return [];
  const names: string[] = [];
  for await (const [name, entry] of (h as any).entries()) {
    if (entry?.kind === 'file' && typeof name === 'string' && name.toLowerCase().endsWith('.json')) names.push(name);
  }
  return names.sort().reverse();
}

/** 读取文件夹里某个文件的文本内容。 */
export async function readJsonFile(name: string): Promise<string> {
  const h = await getFolderHandle();
  if (!h) throw new Error('未选择文件夹');
  const fh = await h.getFileHandle(name);
  const f = await fh.getFile();
  return await f.text();
}
