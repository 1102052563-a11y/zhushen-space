/**
 * 深度图生成 + 缓存（供全息卡 2.5D 深度视差用）。
 * 图入 → 深度图出：POST 到玩家配置的深度端点（自建 Depth Anything / 走生图网关）。
 * 生成一次缓存进 IndexedDB（drpg-depth，按图片内容 hash 做 key），同一张立绘只算一次。
 *
 * 端点约定（尽量宽松兼容）：
 *   请求  POST depthUrl  { image: "<base64(不含 data: 前缀)>" }   （带 depthKey 时加 Authorization: Bearer）
 *   响应  ① Content-Type: image/*      → 直接当深度图
 *        ② JSON { depth|image|output|url|data: "<dataURL|base64|http url>" } → 取出为深度图
 * 失败/未配置 → 返回 null（调用方回退平面图，不崩）。
 */
import { useImageGen } from '../store/imageGenStore';
import { localDepth, type DepthProgress } from './depthLocal';
export type { DepthProgress };

/* ── IndexedDB 迷你缓存 ── */
const DB = 'drpg-depth', STORE = 'depth';
let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
async function idbGet(key: string): Promise<string | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const rq = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      rq.onsuccess = () => res((rq.result as string) ?? null);
      rq.onerror = () => res(null);
    });
  } catch { return null; }
}
async function idbPut(key: string, val: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res(); tx.onerror = () => res();
    });
  } catch { /* 缓存失败无所谓 */ }
}

/* 快速内容 hash（djb2，取首尾+长度采样，避免对超大 dataURL 全量哈希） */
function hashImg(s: string): string {
  const sample = s.length > 4096 ? s.slice(0, 2048) + s.slice(-2048) + s.length : s;
  let h = 5381;
  for (let i = 0; i < sample.length; i++) h = ((h << 5) + h + sample.charCodeAt(i)) | 0;
  return 'd' + (h >>> 0).toString(36) + '_' + s.length.toString(36);
}

/* 任意图片 src → 纯 base64（去 data: 前缀；http 图先 fetch） */
async function toBase64(src: string): Promise<string> {
  if (src.startsWith('data:')) return src.replace(/^data:[^,]*,/, '');
  const blob = await (await fetch(src)).blob();
  const dataUrl: string = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
  return dataUrl.replace(/^data:[^,]*,/, '');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
}

/* 解析深度端点响应 → 深度图 dataURL */
async function parseDepthResponse(res: Response): Promise<string | null> {
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) return blobToDataUrl(await res.blob());
  let j: any = null;
  try { j = await res.json(); } catch { return null; }
  const cand = j?.depth ?? j?.image ?? j?.output ?? j?.url ?? j?.data ?? (Array.isArray(j?.output) ? j.output[0] : null);
  if (!cand || typeof cand !== 'string') return null;
  if (cand.startsWith('data:')) return cand;
  if (/^https?:\/\//.test(cand)) { try { return blobToDataUrl(await (await fetch(cand)).blob()); } catch { return null; } }
  return 'data:image/png;base64,' + cand;   // 裸 base64
}

/* 走 gateway 端点：POST {image:base64} → 深度图 */
async function gatewayDepth(imgSrc: string): Promise<string | null> {
  const { depthUrl, depthKey } = useImageGen.getState();
  if (!depthUrl) return null;
  try {
    const image = await toBase64(imgSrc);
    const res = await fetch(depthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(depthKey ? { Authorization: `Bearer ${depthKey}` } : {}) },
      body: JSON.stringify({ image }),
    });
    if (!res.ok) return null;
    return await parseDepthResponse(res);
  } catch { return null; }
}

/** 生成/取深度图（缓存优先）。provider=local(浏览器内 Depth Anything) / gateway(端点)。onProgress 仅 local 有效。 */
export async function getDepthMap(imgSrc?: string, onProgress?: DepthProgress): Promise<string | null> {
  if (!imgSrc) return null;
  const key = hashImg(imgSrc);
  const cached = await idbGet(key);
  if (cached) return cached;
  const { depthProvider } = useImageGen.getState();
  const depth = depthProvider === 'gateway' ? await gatewayDepth(imgSrc) : await localDepth(imgSrc, onProgress);
  if (depth) await idbPut(key, depth);
  return depth;
}

/** 仅查缓存（不触发生成），供渲染时同步兜底判断。 */
export async function getCachedDepth(imgSrc?: string): Promise<string | null> {
  if (!imgSrc) return null;
  return idbGet(hashImg(imgSrc));
}
