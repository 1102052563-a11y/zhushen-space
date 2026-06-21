// 聊天室身份：把「Discord 登录(复用云存档会话令牌)」映射成「从 1 起的顺序专属 UID」+ 个人资料(头像/改名冷却)。
// GET/POST /api/chat/me  (Bearer = 云存档会话令牌)  → { uid, name, chatToken, avatarVer, nameChangedAt, nameLocked, nameLockMsg }
//   · D1 表 chat_identity：uid AUTOINCREMENT(从 1)、discord_id 唯一、name、avatar(dataURL)、avatar_ver、name_changed_at。
//   · 改名 2 天冷却：name 变更且距上次变更 < 2 天 → 不改、返回 nameLocked+剩余(不阻断进入)。
//   · 传 avatar → 存 + avatar_ver++（前端按 uid+ver 拉取并缓存；像素动物为零传输默认，自定义头像才拉）。
// GET /api/chat/avatar?uid=N  → { avatar }（公开读；聊天本就公开）。

import { verifyCloudSession, signChatToken, bearer } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_identity (
  uid INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at INTEGER,
  avatar TEXT,
  avatar_ver INTEGER DEFAULT 0,
  name_changed_at INTEGER DEFAULT 0,
  dicebear_seed TEXT DEFAULT ''
);
`;
// 老表(只有基础列)就地补列；列已存在的 ALTER 会报错，忽略即可
const ALTERS = [
  'ALTER TABLE chat_identity ADD COLUMN avatar TEXT',
  'ALTER TABLE chat_identity ADD COLUMN avatar_ver INTEGER DEFAULT 0',
  'ALTER TABLE chat_identity ADD COLUMN name_changed_at INTEGER DEFAULT 0',
  "ALTER TABLE chat_identity ADD COLUMN dicebear_seed TEXT DEFAULT ''",
];
let ready = false;
async function ensureSchema(db) {
  if (ready) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, ' ').trim());
  for (const a of ALTERS) { try { await db.exec(a); } catch { /* 列已存在 */ } }
  ready = true;
}

const CHAT_TTL_MS = 7 * 24 * 3600 * 1000;
const NAME_COOLDOWN_MS = 2 * 24 * 3600 * 1000;   // 昵称改名冷却：2 天
const MAX_AVATAR = 40000;                        // 头像 dataURL 长度上限(~30KB)
function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}
const cleanName = (s) => String(s || '').replace(/[ -]/g, '').trim().slice(0, 24);
const cleanSeed = (s) => String(s || '').replace(/[^a-zA-Z0-9_~-]/g, '').slice(0, 48);   // DiceBear 描述符 `style~seed`：字母数字下划线连字符波浪号

export async function handleChatMe(request, env, ch, url) {
  const sess = await verifyCloudSession(env, bearer(request));
  if (!sess || !sess.uid) return json({ error: '未登录或会话已过期，请用 Discord 登录' }, { status: 401 }, ch);
  if (!env.DB) return json({ error: '后端未配置 D1（DB），无法分配 UID' }, { status: 503 }, ch);
  await ensureSchema(env.DB);

  const discordId = String(sess.uid).slice(0, 80);
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const wantName = cleanName(url.searchParams.get('name')) || cleanName(body.name);
  let avatar = typeof body.avatar === 'string' ? body.avatar : '';
  if (avatar && (avatar.length > MAX_AVATAR || !/^data:image\//.test(avatar))) avatar = ''; // 非法/超大 → 忽略
  const dicebearSeed = typeof body.dicebearSeed === 'string' ? cleanSeed(body.dicebearSeed) : undefined;  // DiceBear 种子(非空=用 DiceBear)
  const avatarMode = String(body.avatarMode || '');                                                       // 'pal' = 回退像素动物

  // 首次出现 → 分配下一个顺序 UID（AUTOINCREMENT 原子，从 1 起）
  await env.DB.prepare('INSERT OR IGNORE INTO chat_identity (discord_id,name,created_at,avatar_ver,name_changed_at,dicebear_seed) VALUES (?,?,?,0,0,?)')
    .bind(discordId, wantName || cleanName(sess.name) || '道友', Date.now(), '').run();
  let row = await env.DB.prepare('SELECT uid,name,avatar_ver,name_changed_at,dicebear_seed FROM chat_identity WHERE discord_id=?').bind(discordId).first();
  if (!row) return json({ error: 'UID 分配失败' }, { status: 500 }, ch);

  const now = Date.now();
  let name = row.name || '道友';
  let nameLocked = false, nameLockMsg = '';

  // 改名冷却：想改且与现名不同
  if (wantName && wantName !== name) {
    const since = Number(row.name_changed_at) || 0;
    if (since > 0 && now - since < NAME_COOLDOWN_MS) {
      nameLocked = true;
      const days = Math.ceil((NAME_COOLDOWN_MS - (now - since)) / (24 * 3600 * 1000));
      nameLockMsg = `昵称 ${days} 天后才能再次更改`;
    } else {
      await env.DB.prepare('UPDATE chat_identity SET name=?, name_changed_at=? WHERE discord_id=?').bind(wantName, now, discordId).run();
      name = wantName;
      row.name_changed_at = now;
    }
  }

  // 头像：优先级 dicebear > 上传 > 像素动物。三者互斥切换。
  let avatarVer = Number(row.avatar_ver) || 0;
  let seed = String(row.dicebear_seed || '');
  if (avatar) {                                       // 上传新头像 → 清 DiceBear，升版本
    avatarVer += 1; seed = '';
    await env.DB.prepare('UPDATE chat_identity SET avatar=?, avatar_ver=?, dicebear_seed=? WHERE discord_id=?').bind(avatar, avatarVer, '', discordId).run();
  } else if (avatarMode === 'pal') {                  // 回退像素动物 → 清 DiceBear + 上传版本归 0
    avatarVer = 0; seed = '';
    await env.DB.prepare('UPDATE chat_identity SET avatar_ver=0, dicebear_seed=? WHERE discord_id=?').bind('', discordId).run();
  } else if (dicebearSeed !== undefined) {            // 选用 DiceBear（种子非空即激活）
    seed = dicebearSeed;
    await env.DB.prepare('UPDATE chat_identity SET dicebear_seed=? WHERE discord_id=?').bind(seed, discordId).run();
  }

  const cuid = row.uid;
  const chatToken = await signChatToken(env, { cuid, name, exp: now + CHAT_TTL_MS });
  return json({ uid: cuid, name, chatToken, avatarVer, dicebearSeed: seed, nameChangedAt: Number(row.name_changed_at) || 0, nameLocked, nameLockMsg }, {}, ch);
}

export async function handleChatAvatar(request, env, ch, url) {
  if (!env.DB) return json({ error: 'no db' }, { status: 503 }, ch);
  await ensureSchema(env.DB);
  const uid = parseInt(url.searchParams.get('uid') || '0', 10);
  if (!uid) return json({ error: 'bad uid' }, { status: 400 }, ch);
  const row = await env.DB.prepare('SELECT avatar FROM chat_identity WHERE uid=?').bind(uid).first();
  if (!row || !row.avatar) return json({ avatar: '' }, {}, ch);
  return json({ avatar: row.avatar }, {}, ch);
}
