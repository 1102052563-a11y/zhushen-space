// 聊天室身份：Discord 登录(复用云存档同一套) → 用云会话令牌换「顺序专属 UID + chatToken」。
// chatToken 存 localStorage，连 WS 时带上；后端验签后把 pid 设为 chat:<uid>。
import { mpBase } from './mpConfig';
import { cloudToken, cloudLoggedIn, cloudLogin, cloudUser, cloudLogout, localLogin } from './cloudSave';

const CHAT_TOKEN_KEY = 'drpg-chat-token';
const CHAT_UID_KEY = 'drpg-chat-uid';
const CHAT_NAME_KEY = 'drpg-chat-name';
const CHAT_AVV_KEY = 'drpg-chat-avv';       // 自己上传头像版本号（变更即 ++，供其他端 cache-busting 重拉）
const CHAT_DS_KEY = 'drpg-chat-ds';         // 自己 DiceBear 种子（非空=用 DiceBear 头像，优先于上传）
const CHAT_DUID_KEY = 'drpg-chat-duid';     // 显示号（自定义靓号 custom ?? 内部 uid）——展示用，身份仍是内部 uid
const CHAT_BOUND_KEY = 'drpg-chat-bound';   // 「绑定到此存档」标志：全局持久(随 reload/读档存活，像 API 配置)，置位后进聊天室免门禁自动进

export interface ChatIdentity {
  uid: number; name: string; chatToken: string;
  avatarVer: number; dicebearSeed: string; nameLocked?: boolean; nameLockMsg?: string; nameChangedAt?: number;
  displayUid?: number; customUid?: number | null; uidChangedAt?: number; uidLocked?: boolean; uidLockMsg?: string;
}

export function chatToken(): string { try { return localStorage.getItem(CHAT_TOKEN_KEY) || ''; } catch { return ''; } }
export function chatUid(): number { try { return Number(localStorage.getItem(CHAT_UID_KEY) || 0) || 0; } catch { return 0; } }
export function chatDisplayUid(): number { try { return Number(localStorage.getItem(CHAT_DUID_KEY) || 0) || chatUid(); } catch { return chatUid(); } }   // 显示号(自定义靓号·缺省=内部 uid)
export function chatName(): string { try { return localStorage.getItem(CHAT_NAME_KEY) || ''; } catch { return ''; } }
export function chatAvatarVer(): number { try { return Number(localStorage.getItem(CHAT_AVV_KEY) || 0) || 0; } catch { return 0; } }
export function chatDicebearSeed(): string { try { return localStorage.getItem(CHAT_DS_KEY) || ''; } catch { return ''; } }
export function chatReady(): boolean { return !!chatToken() && chatUid() > 0; }
export function chatBound(): boolean { try { return localStorage.getItem(CHAT_BOUND_KEY) === '1'; } catch { return false; } }
export function setChatBound(b: boolean): void { try { if (b) localStorage.setItem(CHAT_BOUND_KEY, '1'); else localStorage.removeItem(CHAT_BOUND_KEY); } catch { /* */ } }
export function clearChatIdentity(): void {
  try { [CHAT_TOKEN_KEY, CHAT_UID_KEY, CHAT_NAME_KEY, CHAT_AVV_KEY, CHAT_DS_KEY, CHAT_DUID_KEY, CHAT_BOUND_KEY].forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
}

// 复用云存档的登录态/动作（Discord + 免 Discord 的本地登录，两者写同一套令牌键）
export { cloudLoggedIn as discordLoggedIn, cloudLogin as discordLogin, cloudUser as discordUser, localLogin };
export function fullLogout(): void { cloudLogout(); clearChatIdentity(); }

/** 用云会话令牌换/更新聊天身份（顺序 UID + chatToken + 头像版本）。
 *  name=起名/改名（受 2 天冷却，被拒时返回 nameLocked 但仍发身份）；avatar=上传新头像(dataURL)。 */
export async function fetchChatIdentity(name?: string, avatar?: string, extra?: { dicebearSeed?: string; avatarMode?: string; customUid?: number }): Promise<ChatIdentity> {
  if (!cloudToken()) throw new Error('请先登录（Discord 或本地登录）');
  const payload: any = { name: (name || '').trim(), avatar: avatar || '' };
  if (extra?.dicebearSeed !== undefined) payload.dicebearSeed = extra.dicebearSeed;
  if (extra?.avatarMode) payload.avatarMode = extra.avatarMode;
  if (extra?.customUid !== undefined) payload.customUid = extra.customUid;   // 自定义靓号
  const r = await fetch(`${mpBase()}/api/chat/me`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cloudToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let msg = '获取聊天身份失败';
    if (r.status === 401) msg = 'Discord 会话已过期，请重新登录';
    else { try { const e = await r.json(); if (e?.error) msg = e.error; } catch { /* */ } }
    throw new Error(msg);
  }
  const d = await r.json();
  try {
    localStorage.setItem(CHAT_TOKEN_KEY, d.chatToken);
    localStorage.setItem(CHAT_UID_KEY, String(d.uid));
    localStorage.setItem(CHAT_NAME_KEY, d.name || '');
    localStorage.setItem(CHAT_AVV_KEY, String(d.avatarVer || 0));
    localStorage.setItem(CHAT_DS_KEY, String(d.dicebearSeed || ''));
    localStorage.setItem(CHAT_DUID_KEY, String(d.displayUid ?? d.uid));
  } catch { /* */ }
  return { uid: d.uid, name: d.name, chatToken: d.chatToken, avatarVer: d.avatarVer || 0, dicebearSeed: d.dicebearSeed || '', nameLocked: !!d.nameLocked, nameLockMsg: d.nameLockMsg || '', nameChangedAt: d.nameChangedAt || 0, displayUid: d.displayUid ?? d.uid, customUid: d.customUid ?? null, uidChangedAt: d.uidChangedAt || 0, uidLocked: !!d.uidLocked, uidLockMsg: d.uidLockMsg || '' };
}

/** 更新个人资料（昵称/头像/DiceBear 种子/回退像素动物）；薄封装 fetchChatIdentity。 */
export function updateChatProfile(opts: { name?: string; avatar?: string; dicebearSeed?: string; avatarMode?: string; customUid?: number }): Promise<ChatIdentity> {
  return fetchChatIdentity(opts.name, opts.avatar, { dicebearSeed: opts.dicebearSeed, avatarMode: opts.avatarMode, customUid: opts.customUid });
}
