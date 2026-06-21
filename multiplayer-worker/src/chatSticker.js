// 聊天室·云端表情包：玩家把自己的贴纸上传到 R2（复用云存档桶 CLOUD_BUCKET），按内容哈希寻址；
// D1 表 chat_stickers 记录「谁传了哪些」，供个人「我的」包列出 + 删除。
// 发送时只广播 {hash}，各端走 GET /api/chat/sticker/<hash> 取图（公开、不可变缓存）。素材版权由上传者自负。
//
//   POST   /api/chat/sticker?name=..   (Bearer chatToken, body=图片字节, Content-Type=image/*) → { hash, name, ct }
//   GET    /api/chat/sticker/<hash>                                                            → 图片（公开·长缓存）
//   GET    /api/chat/stickers          (Bearer chatToken)                                       → { stickers:[{hash,name,ct,at}] }
//   DELETE /api/chat/sticker/<hash>    (Bearer chatToken)                                       → { ok }

import { verifyChatToken, bearer } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid INTEGER NOT NULL,
  hash TEXT NOT NULL,
  name TEXT,
  ct TEXT,
  at INTEGER,
  UNIQUE(uid, hash)
);
`;
let ready = false;
async function ensureSchema(db) {
  if (ready) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  try { await db.exec('CREATE INDEX IF NOT EXISTS idx_chat_stickers_uid ON chat_stickers(uid)'); } catch { /* 已存在 */ }
  ready = true;
}

const MAX_BYTES = 2 * 1024 * 1024;   // 单张上限 2MB（含 GIF 动图）
const MAX_PER_USER = 80;             // 每人云端贴纸数量上限
const TYPES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp']);

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}
const cleanName = (s) => (String(s || '').replace(/[\r\n\t]/g, '').trim().slice(0, 40) || '贴纸');
const cleanHash = (s) => String(s || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
async function sha256hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const auth = async (env, request) => {
  const p = await verifyChatToken(env, bearer(request));
  return p && p.cuid ? p : null;
};

// POST /api/chat/sticker?name=..  上传一张到云端（计入「我的」）
export async function handleStickerUpload(request, env, ch, url) {
  if (!env.DB || !env.CLOUD_BUCKET) return json({ error: '后端未配置 D1/R2，无法使用云端表情包' }, { status: 503 }, ch);
  const a = await auth(env, request);
  if (!a) return json({ error: '未登录或会话过期，请重新进入聊天室' }, { status: 401 }, ch);
  const ct = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.has(ct)) return json({ error: '仅支持 gif / png / jpg / webp' }, { status: 415 }, ch);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: '空文件' }, { status: 400 }, ch);
  if (buf.byteLength > MAX_BYTES) return json({ error: '图片过大（上限 2MB）' }, { status: 413 }, ch);
  await ensureSchema(env.DB);
  const uid = a.cuid;
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM chat_stickers WHERE uid=?').bind(uid).first();
  if (cnt && Number(cnt.n) >= MAX_PER_USER) return json({ error: `云端贴纸已达上限（${MAX_PER_USER} 张），先删几张再传` }, { status: 409 }, ch);
  const hash = await sha256hex(buf);
  const name = cleanName(url.searchParams.get('name'));
  // 内容寻址：同图全局只存一份（多人传同图也只占一份 R2）
  const exists = await env.CLOUD_BUCKET.head('stk/' + hash).catch(() => null);
  if (!exists) await env.CLOUD_BUCKET.put('stk/' + hash, buf, { httpMetadata: { contentType: ct } });
  await env.DB.prepare('INSERT OR IGNORE INTO chat_stickers (uid,hash,name,ct,at) VALUES (?,?,?,?,?)').bind(uid, hash, name, ct, Date.now()).run();
  return json({ hash, name, ct }, {}, ch);
}

// GET /api/chat/sticker/<hash>  取图（公开；聊天本就公开。hash 内容寻址→可不可变长缓存）
export async function handleStickerServe(request, env, hash) {
  if (!env.CLOUD_BUCKET) return new Response('no bucket', { status: 503 });
  const clean = cleanHash(hash);
  if (!clean) return new Response('bad hash', { status: 400 });
  const obj = await env.CLOUD_BUCKET.get('stk/' + clean);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// GET /api/chat/stickers               列出「我的」云端贴纸（Bearer chatToken）
// GET /api/chat/stickers?scope=public   公共池：所有人上传的（按 hash 去重·最近优先·限 200），谁都能浏览取用（聊天本就公开·无需鉴权）
export async function handleStickerList(request, env, ch, url) {
  if (!env.DB) return json({ stickers: [] }, {}, ch);
  await ensureSchema(env.DB);
  if (url && url.searchParams.get('scope') === 'public') {
    const rs = await env.DB.prepare('SELECT hash, name, MAX(at) AS at FROM chat_stickers GROUP BY hash ORDER BY at DESC LIMIT 200').all();
    return json({ stickers: (rs?.results || []).map((r) => ({ hash: r.hash, name: r.name, at: r.at })) }, {}, ch);
  }
  const a = await auth(env, request);
  if (!a) return json({ error: '未登录' }, { status: 401 }, ch);
  const rs = await env.DB.prepare('SELECT hash,name,ct,at FROM chat_stickers WHERE uid=? ORDER BY at DESC').bind(a.cuid).all();
  return json({ stickers: (rs?.results || []).map((r) => ({ hash: r.hash, name: r.name, ct: r.ct, at: r.at })) }, {}, ch);
}

// DELETE /api/chat/sticker/<hash>  从「我的」移除（只删自己的索引；R2 对象按内容寻址留作他人共用）
export async function handleStickerDelete(request, env, ch, hash) {
  if (!env.DB) return json({ error: 'no db' }, { status: 503 }, ch);
  const a = await auth(env, request);
  if (!a) return json({ error: '未登录' }, { status: 401 }, ch);
  await ensureSchema(env.DB);
  await env.DB.prepare('DELETE FROM chat_stickers WHERE uid=? AND hash=?').bind(a.cuid, cleanHash(hash)).run();
  return json({ ok: true }, {}, ch);
}
