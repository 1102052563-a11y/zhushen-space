// 当前在玩人数 + 累计在线时长·前端客户端（对接 multiplayer-worker /api/playtime/presence|online）。
// "当前在玩人数" = 按 IP 去重的当前在玩者，**含没登录 Discord 的人**；隐私上服务端只存 IP 哈希、不存原始 IP。
// "累计在线时长" = 全服所有登录者的游玩时长之和（来自 playtime 表·见 systems/playtime.ts）。
import { mpBase } from './mpConfig';

export interface PresenceStats {
  online: number;   // 当前在玩人数（按 IP 去重·近 3 分钟）
  total: number;    // 累计在线秒数（全服 playtime 之和）
  byCountry?: { country: string; n: number }[];   // 按国家/地区分布（Cloudflare 边缘按 IP 判定的 2 位国家码）
}

/* 部署环境（*.pages.dev 等非 localhost）有同源 Pages Function：presence 心跳优先走同源 /presence，
   由 Pages 边缘读到用户真实国家/IP 后转发 worker——绕过国内直连 *.workers.dev 被 RST，让裸连大陆用户也能上报、并被正确判成 CN。
   本地 vite dev 无 Functions → 回退直连 worker。判定同 apiChat.sameOriginProxyAvailable。 */
function hasSameOriginFns(): boolean {
  try {
    if (typeof location === 'undefined' || location.protocol === 'file:') return false;
    const h = location.hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]');
  } catch { return false; }
}
/** 响应确是我们的 Pages Function（带 ACAO 头）而非 SPA 404 兜底页/index.html。 */
function isOurFn(res: Response): boolean { return res.ok && !!res.headers.get('access-control-allow-origin'); }

/** 上报"我在玩"心跳（无需登录·按 IP 去重），返回当前统计。同源优先 → 回退直连。 */
export async function presenceBeat(): Promise<PresenceStats | null> {
  if (hasSameOriginFns()) {
    try { const res = await fetch('/presence', { method: 'POST' }); if (isOurFn(res)) return await res.json(); } catch { /* 落直连 */ }
  }
  try {
    const res = await fetch(`${mpBase()}/api/playtime/presence`, { method: 'POST' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** 只读：当前在玩人数 + 累计在线时长（聊天室展示轮询用·无需登录·不登记自己）。同源优先 → 回退直连。 */
export async function presenceStats(): Promise<PresenceStats | null> {
  if (hasSameOriginFns()) {
    try { const res = await fetch('/presence-online'); if (isOurFn(res)) return await res.json(); } catch { /* 落直连 */ }
  }
  try {
    const res = await fetch(`${mpBase()}/api/playtime/online`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

let timer: ReturnType<typeof setInterval> | null = null;
function visible(): boolean { return typeof document === 'undefined' || document.visibilityState === 'visible'; }

/** App 挂载后调一次（幂等）：每 60s 报一次在玩心跳（仅页面可见时·无需登录）。让"当前在玩人数"把所有开着页面的玩家都算上。 */
export function startPresenceHeartbeat(): void {
  if (timer) return;
  if (visible()) void presenceBeat();
  timer = setInterval(() => { if (visible()) void presenceBeat(); }, 60_000);
}
export function stopPresenceHeartbeat(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
