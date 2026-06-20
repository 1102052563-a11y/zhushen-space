// 云存档后端（Discord 登录 + R2 大 blob + D1 索引）——手动上传/下载，含图片。
// 路由（由 index.js 转发 /api/cloud/*）：
//   GET  /api/cloud/config                → {enabled,clientId,redirectUri,scope}（无任何密钥，供前端构造登录URL）
//   GET  /api/cloud/callback?code=&state= → Discord 换 token→取用户→签发会话令牌→postMessage 回开窗并关闭
//   GET  /api/cloud/list      (Bearer)    → 该用户云存档「元数据」列表（不含大 blob）
//   POST /api/cloud/put       (Bearer)    → 存档 blob **流式**写入 R2 + 元数据写 D1（元数据走 X-Cloud-Meta 头=base64 JSON）
//   GET  /api/cloud/get?id=   (Bearer)    → 取回某档完整 blob（R2 流式回传，不在内存里解析）
//   POST /api/cloud/del       (Bearer)    → 删 R2 对象 + D1 行
//
// 存储：R2 桶绑定 CLOUD_BUCKET（对象 key=<uid>/<saveId>.json）；索引存 D1 绑定 DB（与工坊同库，另一张表）。
// 身份：Discord OAuth2（仅 identify scope，只取 用户id+用户名）。会话令牌 = HMAC 签名(密钥由 CLIENT_SECRET 派生)，无状态、7天。
// 安全：client_secret 仅服务端；scope 最小；state 透传给开窗校验防 CSRF；redirect_uri 由请求 origin 计算(需在 Discord 应用白名单)；
//       blob 流式进出不在内存解析，几十 MB 含图档也不爆 Worker 内存。

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_BLOB = 95 * 1024 * 1024;   // 95MB（Workers 请求体上限 ~100MB）

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cloud_saves (
  user_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  name TEXT,
  updated_at INTEGER NOT NULL,
  size INTEGER,
  turn INTEGER,
  player_name TEXT,
  location TEXT,
  app_version TEXT,
  has_images INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, save_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_user ON cloud_saves(user_id, updated_at DESC);
`;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  schemaReady = true;
}

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}

/* ── base64url 工具（Worker 无 Buffer，用 atob/btoa）── */
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

/* ── 会话令牌：payload.签名(HMAC-SHA256，密钥由 CLIENT_SECRET 派生)，无状态可验 ── */
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode('zhushen-cloud-sess|' + (secret || 'dev')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signSession(env, payload) {
  const key = await hmacKey(env.DISCORD_CLIENT_SECRET);
  const body = strToB64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + bytesToB64url(sig);
}
async function verifySession(env, token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sigB64] = token.split('.');
  try {
    const key = await hmacKey(env.DISCORD_CLIENT_SECRET);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(body));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;   // {uid, name, exp}
  } catch { return null; }
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
// 回调地址由请求 origin 计算，免去单独配 env；需在 Discord 应用 OAuth2 里白名单这个地址
function redirectUri(reqUrl) { return new URL(reqUrl).origin + '/api/cloud/callback'; }
const cleanId = (s) => String(s || '').replace(/[^\w.-]/g, '').slice(0, 80);

export async function handleCloud(request, env, ch, url) {
  const p = url.pathname;
  const method = request.method;
  const clientId = env.DISCORD_CLIENT_ID || '';
  const hasSecret = !!env.DISCORD_CLIENT_SECRET;

  // 配置（无密钥）：前端据此显示登录按钮 + 构造 Discord 授权 URL
  if (p === '/api/cloud/config' && method === 'GET') {
    return json({ enabled: !!clientId && hasSecret, clientId, redirectUri: redirectUri(request.url), scope: 'identify' }, {}, ch);
  }

  // OAuth 回调（Discord 重定向到此）：换 token→取用户→签发会话→postMessage 回开窗并关闭
  if (p === '/api/cloud/callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') || '';
    if (!clientId || !hasSecret) return new Response('云存档未配置（缺少 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET）', { status: 503 });
    if (!code) return new Response('缺少 code', { status: 400 });
    try {
      const tok = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code, redirect_uri: redirectUri(request.url),
        }),
      }).then((r) => r.json());
      if (!tok || !tok.access_token) return new Response('Discord 授权失败（code 无效或回调地址未在应用里白名单）', { status: 401 });
      const me = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
      if (!me || !me.id) return new Response('取 Discord 用户信息失败', { status: 401 });
      const user = { uid: 'discord:' + me.id, name: me.global_name || me.username || ('用户' + String(me.id).slice(-4)) };
      const token = await signSession(env, { uid: user.uid, name: user.name, exp: Date.now() + SESSION_TTL_MS });
      // 不长期保存 Discord token：换出 user id 即弃，对外只发我们自己的会话令牌
      const msg = JSON.stringify({ source: 'zhushen-cloud', token, user, state });
      const html = `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0f;color:#cbd5e1;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>✓ 登录成功，正在返回游戏…</p><script>try{window.opener&&window.opener.postMessage(${msg},'*')}catch(e){}setTimeout(function(){window.close()},300)</script></body>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
      return new Response('回调出错: ' + String((e && e.message) || e), { status: 500 });
    }
  }

  // ── 以下都需登录 + D1 + R2 ──
  const sess = await verifySession(env, bearer(request));
  if (!sess) return json({ error: '未登录或会话已过期，请重新登录' }, { status: 401 }, ch);
  const db = env.DB, bucket = env.CLOUD_BUCKET;
  if (!db || !bucket) return json({ error: '云存档后端未配置：缺少 D1(DB) 或 R2(CLOUD_BUCKET) 绑定' }, { status: 503 }, ch);
  await ensureSchema(db);
  const uid = sess.uid;
  const objKey = (saveId) => `${uid}/${saveId}.json`;

  // 列表（仅元数据，不下载 blob）
  if (p === '/api/cloud/list' && method === 'GET') {
    const rs = await db.prepare(
      'SELECT save_id,name,updated_at,size,turn,player_name,location,app_version,has_images FROM cloud_saves WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200'
    ).bind(uid).all();
    const saves = (rs.results || []).map((r) => ({
      id: r.save_id, name: r.name, updatedAt: r.updated_at, size: r.size, turn: r.turn,
      playerName: r.player_name, location: r.location, appVersion: r.app_version, hasImages: !!r.has_images,
    }));
    return json({ saves, user: { name: sess.name } }, {}, ch);
  }

  // 上传：blob 流式进 R2，元数据走 X-Cloud-Meta 头（base64url JSON，避免大体在内存里解析）
  if (p === '/api/cloud/put' && method === 'POST') {
    let meta = {};
    try { meta = JSON.parse(b64urlToStr(request.headers.get('X-Cloud-Meta') || '') || '{}'); } catch { /* 元数据缺失则用默认 */ }
    const saveId = cleanId(meta.id);
    if (!saveId) return json({ error: '缺少存档 id' }, { status: 400 }, ch);
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BLOB) return json({ error: `存档过大（上限 ${Math.floor(MAX_BLOB / 1024 / 1024)}MB）；可在设置里关掉「随档传图」或精简图片` }, { status: 413 }, ch);
    if (!request.body) return json({ error: '空请求体' }, { status: 400 }, ch);
    await bucket.put(objKey(saveId), request.body, { httpMetadata: { contentType: 'application/json' } });
    await db.prepare(
      'INSERT INTO cloud_saves (user_id,save_id,name,updated_at,size,turn,player_name,location,app_version,has_images) VALUES (?,?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(user_id,save_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,size=excluded.size,turn=excluded.turn,player_name=excluded.player_name,location=excluded.location,app_version=excluded.app_version,has_images=excluded.has_images'
    ).bind(
      uid, saveId, String(meta.name || '云存档').slice(0, 80), Number(meta.updatedAt) || Date.now(), len,
      Number(meta.turn) || 0, String(meta.playerName || '').slice(0, 40), String(meta.location || '').slice(0, 60),
      String(meta.appVersion || '').slice(0, 20), meta.hasImages ? 1 : 0,
    ).run();
    return json({ ok: true, id: saveId }, {}, ch);
  }

  // 取回（完整 blob，R2 流式回传）
  if (p === '/api/cloud/get' && method === 'GET') {
    const id = cleanId(url.searchParams.get('id'));
    const obj = await bucket.get(objKey(id));
    if (!obj) return json({ error: 'not found' }, { status: 404 }, ch);
    return new Response(obj.body, { headers: { ...ch, 'Content-Type': 'application/json' } });
  }

  // 删除
  if (p === '/api/cloud/del' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const id = cleanId(b.id);
    if (!id) return json({ error: '缺少 id' }, { status: 400 }, ch);
    await bucket.delete(objKey(id));
    await db.prepare('DELETE FROM cloud_saves WHERE user_id = ? AND save_id = ?').bind(uid, id).run();
    return json({ ok: true }, {}, ch);
  }

  return json({ error: 'not found' }, { status: 404 }, ch);
}
