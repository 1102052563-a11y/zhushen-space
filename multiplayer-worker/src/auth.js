// 共享令牌工具：base64url + HMAC-SHA256（密钥由 DISCORD_CLIENT_SECRET 派生）。
// 既能验证「云存档会话令牌」(复用 cloud.js 同一密钥派生串 'zhushen-cloud-sess')，
// 也能签发/验证「聊天 UID 令牌」(独立派生串 'zhushen-chat-tok')，两者互不通用。

function bytesToB64url(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const strToB64url = (str) => bytesToB64url(new TextEncoder().encode(str));
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

async function hmacKey(secret, purpose) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(purpose + '|' + (secret || 'dev')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(env, payload, purpose) {
  const key = await hmacKey(env.DISCORD_CLIENT_SECRET, purpose);
  const body = strToB64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + bytesToB64url(sig);
}
export async function verifyToken(env, token, purpose) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sigB64] = token.split('.');
  try {
    const key = await hmacKey(env.DISCORD_CLIENT_SECRET, purpose);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(body));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// 云存档会话令牌（cloud.js 用同一密钥派生串签发；这里只验证不签发）
export const verifyCloudSession = (env, token) => verifyToken(env, token, 'zhushen-cloud-sess');
// 聊天 UID 令牌（embed {cuid,name,exp}）
export const signChatToken = (env, payload) => signToken(env, payload, 'zhushen-chat-tok');
export const verifyChatToken = (env, token) => verifyToken(env, token, 'zhushen-chat-tok');

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
