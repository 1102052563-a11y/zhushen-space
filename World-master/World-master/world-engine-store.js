// world-engine-store.js — 存储中间层
// 把世界引擎的所有存档从狭小的 localStorage（约 5MB，与酒馆共用）迁移到 IndexedDB（容量大几十倍）。
// 对上层暴露与 localStorage 相同的同步读写接口：启动时把 IndexedDB 数据灌入内存镜像，
// 读直接走镜像（同步），写同步更新镜像并异步刷入 IndexedDB。IndexedDB 不可用时自动回退 localStorage。
window.WORLD_ENGINE_STORE = (function() {
  const DB_NAME = 'world_engine';
  const STORE_NAME = 'kv';
  const PREFIX = 'world_engine_';

  let db = null;
  let ready = false;
  const mirror = new Map(); // key -> string value（内存镜像，支持同步读）

  function openDB() {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      const out = [];
      const cur = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { out.push([c.key, c.value]); c.continue(); }
        else resolve(out);
      };
      cur.onerror = () => reject(cur.error);
    });
  }

  function idbPut(key, value) {
    if (!db) return;
    try { db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key); }
    catch (e) { console.warn('[世界引擎] IndexedDB 写入失败', e); }
  }

  function idbDel(key) {
    if (!db) return;
    try { db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key); }
    catch (e) {}
  }

  // 启动时调用一次：打开 IndexedDB、灌入镜像、迁移并清理 localStorage 中的旧存档
  async function hydrate() {
    if (ready) return;
    try {
      db = await openDB();
      for (const [k, v] of await idbGetAll()) mirror.set(k, v);
    } catch (e) {
      console.warn('[世界引擎] IndexedDB 不可用，回退到 localStorage', e);
      db = null;
    }
    // 把 localStorage 里遗留的 world_engine_* 搬进 IndexedDB，并腾出 localStorage 空间
    try {
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) legacyKeys.push(k);
      }
      for (const k of legacyKeys) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        if (!mirror.has(k)) { mirror.set(k, v); idbPut(k, v); }
        if (db) localStorage.removeItem(k); // 仅在 IDB 可用（已落盘）时才删，避免丢数据
      }
      if (db && legacyKeys.length) {
        console.log(`[世界引擎] 已迁移 ${legacyKeys.length} 条存档至 IndexedDB`);
      }
    } catch (e) { console.warn('[世界引擎] 旧存档迁移失败（非致命）', e); }
    ready = true;
  }

  function getItem(key) {
    if (mirror.has(key)) return mirror.get(key);
    // 镜像未命中（未 hydrate 或 IDB 不可用）时回退到 localStorage
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function setItem(key, value) {
    value = String(value);
    mirror.set(key, value);
    if (db) idbPut(key, value);
    else localStorage.setItem(key, value); // IDB 不可用时退回 localStorage（可能抛配额错误）
  }

  function removeItem(key) {
    mirror.delete(key);
    if (db) idbDel(key);
    else { try { localStorage.removeItem(key); } catch (e) {} }
  }

  // 返回镜像中所有 key（替代 localStorage.length / localStorage.key(i)）
  function keys() {
    if (mirror.size || db) return [...mirror.keys()];
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out;
  }

  return { hydrate, getItem, setItem, removeItem, keys };
})();
