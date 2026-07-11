// 云存档客户端（手动·含图）：Discord 登录 + 上传/下载/删除，走联机同一个 Worker（mpBase）。
// 会话令牌由后端签发，存 localStorage；每次请求带 Bearer。上传=把本地存档槽整档(含图)流式 PUT 到 R2；
// 下载=取回整档，经 importSlot 落成一个**新的本地存档槽**（不覆盖现有本地档）。
import { mpBase } from './mpConfig';
import { saveDb } from './saveDb';
import { importSlot } from './saveManager';

const TOKEN_KEY = 'drpg-cloud-token';
const USER_KEY = 'drpg-cloud-user';
const LOCAL_ID_KEY = 'drpg-local-acct';   // 本地身份码（免 Discord 登录）：既是身份也是凭证

export interface CloudUser { name: string; uid?: string }
export interface CloudSaveMeta {
  id: string; name: string; updatedAt: number; size: number; turn: number;
  playerName?: string; location?: string; appVersion?: string; hasImages?: boolean;
}

const base = () => mpBase();

export function cloudToken(): string { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function cloudUser(): CloudUser | null { try { const r = localStorage.getItem(USER_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
export function cloudLoggedIn(): boolean { return !!cloudToken() && !!cloudUser(); }
export function cloudLogout(): void { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* */ } }

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${cloudToken()}`, ...extra };
}
/** 小 JSON → base64url（供 X-Cloud-Meta 头；含中文用 encodeURIComponent 兜底）*/
function b64urlMeta(meta: unknown): string {
  const s = btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function failMsg(r: Response, fallback: string): Promise<never> {
  if (r.status === 401) { cloudLogout(); throw new Error('云端会话已过期，请重新登录'); }
  let msg = fallback;
  try { const e = await r.json(); if (e?.error) msg = e.error; } catch { /* */ }
  throw new Error(msg);
}

export async function cloudConfig(): Promise<{ enabled: boolean; clientId: string; redirectUri: string; scope: string }> {
  const r = await fetch(`${base()}/api/cloud/config`);
  if (!r.ok) throw new Error('云存档后端连不上（检查联机后端地址）');
  return r.json();
}

/** 弹窗登录 Discord：打开授权页 → 后端回调 postMessage 回会话令牌（带 state 防 CSRF）。 */
export async function cloudLogin(): Promise<CloudUser> {
  const cfg = await cloudConfig();
  if (!cfg.enabled) throw new Error('云存档未启用：后端还没配置 Discord（DISCORD_CLIENT_ID / SECRET）');
  const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const auth = new URL('https://discord.com/api/oauth2/authorize');
  auth.searchParams.set('client_id', cfg.clientId);
  auth.searchParams.set('redirect_uri', cfg.redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', cfg.scope || 'identify');   // 仅 identify：只拿 用户id+用户名
  auth.searchParams.set('state', state);
  const popup = window.open(auth.toString(), 'discord-login', 'width=520,height=760');
  if (!popup) throw new Error('弹窗被拦截，请允许本站弹窗后重试');
  return new Promise<CloudUser>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('登录超时，请重试')); }, 180000);
    const poll = setInterval(() => { if (popup?.closed) { cleanup(); reject(new Error('登录窗口被关闭')); } }, 800);
    function onMsg(ev: MessageEvent) {
      const d = ev.data;
      if (!d || d.source !== 'zhushen-cloud') return;
      if (d.state !== state) return;   // state 必须匹配本次发起（防 CSRF / 串台）
      if (!d.token || !d.user) { cleanup(); reject(new Error('登录失败')); return; }
      try { localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(USER_KEY, JSON.stringify(d.user)); } catch { /* */ }
      cleanup(); resolve(d.user);
    }
    function cleanup() { clearTimeout(timer); clearInterval(poll); window.removeEventListener('message', onMsg); try { popup?.close(); } catch { /* */ } }
    window.addEventListener('message', onMsg);
  });
}

/* ── 本地身份登录（免 Discord，供受限网络玩家）──
   身份码=高熵随机串，既是身份也是凭证：丢失=丢号，泄露=被冒名。可导出/导入在设备间迁移。
   登录成功后把令牌写进与 Discord 登录**完全相同**的键 → 云存档/聊天/交易/公会等全部下游零改动照旧。 */
function genLocalId(): string {
  const rnd = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  return ('la_' + rnd() + rnd()).replace(/-/g, '');
}
/** 本机身份码：首次调用生成并持久化（像 API key 一样长期不变）。 */
export function localAccountId(): string {
  try {
    let id = localStorage.getItem(LOCAL_ID_KEY) || '';
    if (!id) { id = genLocalId(); localStorage.setItem(LOCAL_ID_KEY, id); }
    return id;
  } catch { return genLocalId(); }
}
/** 导入他处的身份码（跨设备迁移账号）。返回是否格式合法。 */
export function setLocalAccountId(v: string): boolean {
  const t = String(v || '').trim();
  if (t.length < 16 || t.length > 200 || !/^[\w:.~-]+$/.test(t)) return false;
  try { localStorage.setItem(LOCAL_ID_KEY, t); } catch { /* */ }
  return true;
}
/** 当前登录方式：'discord' | 'local' | ''（未登录）。 */
export function loginKind(): 'discord' | 'local' | '' {
  const u = cloudUser();
  if (!cloudToken() || !u) return '';
  return String(u.uid || '').startsWith('local:') ? 'local' : 'discord';
}
/** 本地登录：交身份码换会话令牌，存进和 Discord 相同的键。name 为可选显示名（后端会再清洗）。 */
export async function localLogin(name?: string): Promise<CloudUser> {
  const r = await fetch(`${base()}/api/cloud/local`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: localAccountId(), name: (name || '').trim() }),
  });
  if (!r.ok) {
    let msg = '本地登录失败';
    if (r.status === 403) msg = '本地登录已被后端关闭';
    else { try { const e = await r.json(); if (e?.error) msg = e.error; } catch { /* */ } }
    throw new Error(msg);
  }
  const d = await r.json();
  if (!d?.token || !d?.user) throw new Error('本地登录失败：后端响应无效');
  try { localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(USER_KEY, JSON.stringify(d.user)); } catch { /* */ }
  return d.user as CloudUser;
}

export async function cloudListSaves(): Promise<CloudSaveMeta[]> {
  const r = await fetch(`${base()}/api/cloud/list`, { headers: authHeaders() });
  if (!r.ok) return failMsg(r, '云端列表获取失败');
  const j = await r.json();
  return j.saves || [];
}

/** 上传一个本地存档槽到云端（整档含图，流式）。云端按存档 id 覆盖同一条。 */
export async function cloudUpload(localSlotId: string): Promise<void> {
  const slot: any = await saveDb.get(localSlotId);
  if (!slot) throw new Error('本地存档不存在');
  const blob = JSON.stringify(slot);
  const meta = {
    id: slot.id, name: slot.name, updatedAt: slot.updatedAt || Date.now(),
    turn: slot.preview?.turn || 0, playerName: slot.preview?.playerName || '',
    location: slot.preview?.location || '', appVersion: slot.appVersion || '',
    hasImages: !!(slot.data && slot.data.images),
  };
  const r = await fetch(`${base()}/api/cloud/put`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', 'X-Cloud-Meta': b64urlMeta(meta) }),
    body: blob,
  });
  if (!r.ok) return failMsg(r, '上传失败');
}

/** 从云端下载到本地（落成一个新的本地存档槽，不覆盖现有）。返回新本地槽 id。 */
export async function cloudDownload(cloudId: string): Promise<string> {
  const r = await fetch(`${base()}/api/cloud/get?id=${encodeURIComponent(cloudId)}`, { headers: authHeaders() });
  if (!r.ok) return failMsg(r, '下载失败');
  const raw = await r.text();
  return importSlot(raw);   // 生成新本地 id 写入 saveDb（含图原样保留）
}

export async function cloudDelete(cloudId: string): Promise<void> {
  const r = await fetch(`${base()}/api/cloud/del`, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: cloudId }),
  });
  if (!r.ok) return failMsg(r, '删除失败');
}
