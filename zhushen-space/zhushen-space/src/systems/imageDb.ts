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

/** 诊断统计：图片张数 + 孤儿数（key 不在 live 集里）+ 按 key 前缀分桶。
    ⚠手机安全：只用 getAllKeys（廉价，不读值）数 key，字节靠**采样 ≤30 个值**估算平均×总数——
    绝不把整库（可能 2GB+）dataURL 全读进内存（那会在手机上 OOM/卡死）。 */
export async function imageDbStats(live?: Set<string>): Promise<{
  count: number; orphan: number; estBytes: number; estOrphanBytes: number; byPrefix: Record<string, number>;
}> {
  const d = await db();
  const keys: string[] = await new Promise((res) => {
    let tx: IDBTransaction; try { tx = d.transaction(STORE, 'readonly'); } catch { return res([]); }
    const r = tx.objectStore(STORE).getAllKeys();
    r.onsuccess = () => res((r.result as IDBValidKey[]).map(String));
    r.onerror = () => res([]);
  });
  const count = keys.length;
  const byPrefix: Record<string, number> = {};
  let orphan = 0;
  for (const k of keys) {
    byPrefix[k.split(':')[0] || 'other'] = (byPrefix[k.split(':')[0] || 'other'] ?? 0) + 1;
    if (live && !live.has(k)) orphan++;
  }
  // 采样估算平均字节（均匀取样，别只取头部）
  const sampleKeys = count <= 30 ? keys : Array.from({ length: 30 }, (_, i) => keys[Math.floor((i * count) / 30)]);
  let sampleBytes = 0, sampled = 0;
  for (const k of sampleKeys) {
    const v: string | undefined = await new Promise((res) => {
      let tx: IDBTransaction; try { tx = d.transaction(STORE, 'readonly'); } catch { return res(undefined); }
      const r = tx.objectStore(STORE).get(k);
      r.onsuccess = () => res(typeof r.result === 'string' ? r.result : undefined);
      r.onerror = () => res(undefined);
    });
    if (typeof v === 'string') { sampleBytes += v.length; sampled++; }
  }
  const avg = sampled ? sampleBytes / sampled : 0;
  return { count, orphan, estBytes: Math.round(avg * count), estOrphanBytes: Math.round(avg * orphan), byPrefix };
}

/** 删除所有 key 不在 live 集里的图（孤儿：已删/合并的 NPC、已消耗的物品残留的头像/图）。
    单游标一次遍历、就地 delete，返回删除数与释放字节。**调用方须保证 live 已就绪**（见 imageSync.pruneOrphanImages 的防呆）。 */
export async function pruneImagesExcept(live: Set<string>): Promise<{ removed: number; freed: number; kept: number }> {
  const d = await db();
  return new Promise((resolve) => {
    let removed = 0, freed = 0, kept = 0;
    let tx: IDBTransaction; try { tx = d.transaction(STORE, 'readwrite'); } catch { return resolve({ removed, freed, kept }); }
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = () => {
      const c = cur.result; if (!c) return;
      if (!live.has(String(c.key))) { freed += typeof c.value === 'string' ? c.value.length : 0; c.delete(); removed++; }
      else kept++;
      c.continue();
    };
    tx.oncomplete = () => resolve({ removed, freed, kept });
    tx.onerror = () => resolve({ removed, freed, kept });
    tx.onabort = () => resolve({ removed, freed, kept });
  });
}
