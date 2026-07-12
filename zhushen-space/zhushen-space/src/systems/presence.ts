// 当前在玩人数 + 累计在线时长·前端客户端（对接 multiplayer-worker /api/playtime/presence|online）。
// "当前在玩人数" = 按 IP 去重的当前在玩者，**含没登录 Discord 的人**；隐私上服务端只存 IP 哈希、不存原始 IP。
// "累计在线时长" = 全服所有登录者的游玩时长之和（来自 playtime 表·见 systems/playtime.ts）。
import { mpBase } from './mpConfig';

export interface PresenceStats { online: number; total: number }   // online=当前在玩人数, total=累计在线秒数

/** 上报"我在玩"心跳（无需登录·按 IP 去重），返回当前统计。 */
export async function presenceBeat(): Promise<PresenceStats | null> {
  try {
    const res = await fetch(`${mpBase()}/api/playtime/presence`, { method: 'POST' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** 只读：当前在玩人数 + 累计在线时长（聊天室展示轮询用·无需登录·不登记自己）。 */
export async function presenceStats(): Promise<PresenceStats | null> {
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
