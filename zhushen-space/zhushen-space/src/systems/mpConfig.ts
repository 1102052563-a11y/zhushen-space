// 联机配置 + 本机身份。后端地址默认指向已部署的 Worker，可被 localStorage / vite env 覆盖。

const DEFAULT_MP_BASE = 'https://zhushen-multiplayer.1102052563.workers.dev';

export function mpBase(): string {
  try {
    const o = localStorage.getItem('drpg-mp-base');
    if (o) return o.replace(/\/+$/, '');
  } catch {}
  const env = (import.meta as any)?.env?.VITE_MP_BASE;
  return String(env || DEFAULT_MP_BASE).replace(/\/+$/, '');
}
export function mpWsBase(): string {
  return mpBase().replace(/^http/i, 'ws');
}
export function setMpBase(url: string) {
  try { localStorage.setItem('drpg-mp-base', url.replace(/\/+$/, '')); } catch {}
}

// 本机稳定身份（建房/进房都带这个 pid；房主权威靠 pid===hostId 判定）
export function myPlayerId(): string {
  try {
    let id = localStorage.getItem('drpg-mp-pid');
    if (!id) {
      id = 'p-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      localStorage.setItem('drpg-mp-pid', id);
    }
    return id;
  } catch {
    return 'p-' + Math.random().toString(36).slice(2);
  }
}
export function myMpName(): string {
  try { return localStorage.getItem('drpg-mp-name') || ''; } catch { return ''; }
}
export function setMpName(n: string) {
  try { localStorage.setItem('drpg-mp-name', n); } catch {}
}
