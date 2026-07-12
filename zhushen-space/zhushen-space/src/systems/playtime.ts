// 游玩时长记录 + 排行榜·前端客户端（对接 multiplayer-worker /api/playtime/*）。
// 凡 Discord 登录者：每 60s 上报一段"可见活跃时长"→ 服务端按真实经过时间限幅累计；面板可看自己时长+名次+排行榜。
import { mpBase } from './mpConfig';
import { chatReady, chatToken, chatName } from './chatIdentity';

export interface PlaytimeMe { seconds: number; rank: number; players: number; recorded: boolean }
export interface PlaytimeTopEntry { uid: number; name: string; seconds: number }

/** 心跳：累加本段活跃游玩时长（秒）。仅已登录且 seconds>0 才发；服务端按真实经过时间限幅（谎报大数无效）。返回累计总秒数。 */
export async function playtimeBeat(seconds: number): Promise<number | null> {
  if (!chatReady() || seconds <= 0) return null;
  try {
    const res = await fetch(`${mpBase()}/api/playtime/beat?token=${encodeURIComponent(chatToken())}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: Math.round(seconds), name: chatName() }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d?.total === 'number' ? d.total : null;
  } catch { return null; }
}

/** 我的时长 + 名次（未登录返回 null）。 */
export async function playtimeMe(): Promise<PlaytimeMe | null> {
  if (!chatReady()) return null;
  try {
    const res = await fetch(`${mpBase()}/api/playtime/me?token=${encodeURIComponent(chatToken())}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** 排行榜 top N（公开·无需登录）。total=全服累计在线时长(秒·所有登录者之和)。 */
export async function playtimeTop(limit = 50): Promise<{ items: PlaytimeTopEntry[]; players: number; total: number }> {
  try {
    const res = await fetch(`${mpBase()}/api/playtime/top?limit=${limit}`);
    if (!res.ok) return { items: [], players: 0, total: 0 };
    const d = await res.json();
    return { items: d.items || [], players: d.players || 0, total: d.total || 0 };
  } catch { return { items: [], players: 0, total: 0 }; }
}

/* ── 心跳累计器：只统计"页面可见 + 已登录"的活跃时长，每 BEAT_MS 上报一次 ── */
const BEAT_MS = 60_000;
let hbTimer: ReturnType<typeof setInterval> | null = null;
let visSince = 0;   // 本段可见起点(ms)；0=当前不计
let accumMs = 0;    // 尚未上报的活跃毫秒

function isVisible(): boolean { return typeof document === 'undefined' || document.visibilityState === 'visible'; }
// 页面可见性变化：切到后台/切回前台时结算/重启当前累计段（后台挂机不计入游玩时长）
function onVis(): void {
  if (isVisible()) { if (!visSince) visSince = Date.now(); }
  else if (visSince) { accumMs += Date.now() - visSince; visSince = 0; }
}

/** 启动游玩时长心跳（App 在"已开始游戏"后调用一次·幂等）。内部只在已登录+页面可见时累计，未登录不上报。 */
export function startPlaytimeHeartbeat(): void {
  if (hbTimer) return;
  visSince = isVisible() ? Date.now() : 0;
  accumMs = 0;
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  hbTimer = setInterval(() => {
    if (visSince) { accumMs += Date.now() - visSince; visSince = isVisible() ? Date.now() : 0; }   // 结算至此刻并续段
    const secs = Math.floor(accumMs / 1000);
    if (secs > 0 && chatReady()) { accumMs -= secs * 1000; void playtimeBeat(secs); }   // 保留亚秒余量
  }, BEAT_MS);
}
export function stopPlaytimeHeartbeat(): void {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  visSince = 0; accumMs = 0;
}
/** 心跳是否在跑（=已开始游戏·登录者才真上报）。供面板决定"我的时长要不要逐秒往上跳"——只在真会累计时才跳，避免漂移。 */
export function isPlaytimeActive(): boolean { return hbTimer != null; }
