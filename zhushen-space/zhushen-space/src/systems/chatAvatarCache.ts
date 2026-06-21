import { mpBase } from './mpConfig';

// 自定义头像按 uid+版本拉取并缓存（像素动物为零传输默认，仅 avv>0 才拉）。
// 同一 uid+ver 只拉一次；ver 变了才重拉（天然 cache-busting）。

const cache = new Map<string, string>();              // key=`${uid}:${ver}` → dataURL（'' = 无）
const inflight = new Map<string, Promise<string>>();

export function cachedAvatar(uid: number, ver: number): string | undefined {
  return cache.get(`${uid}:${ver}`);
}

export async function fetchAvatar(uid: number, ver: number): Promise<string> {
  if (!uid || !ver) return '';
  const key = `${uid}:${ver}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const r = await fetch(`${mpBase()}/api/chat/avatar?uid=${uid}`);
      const d = await r.json();
      const av = (d && typeof d.avatar === 'string') ? d.avatar : '';
      cache.set(key, av);
      return av;
    } catch { cache.set(key, ''); return ''; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}
