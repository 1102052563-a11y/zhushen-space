// 账户仓库·云同步：把玩家**个人**的账户仓库（跨存档物品集合）整存进 R2，按 Discord 顺序 UID 私有寻址。
// 与聊天室/助战/交易行/丰碑共用 Discord 身份（chatToken → cuid）。每人一个 JSON blob：vault/<uid>.json。
// 纯 R2、无 D1（私有单 blob，不需索引/列表/排行）。复用云存档桶 CLOUD_BUCKET。照搬 monumentCloud.js。
//
//   GET  /api/vault   (Bearer chatToken)                         → { entries, updatedAt }
//   POST /api/vault   (Bearer chatToken, body={entries,updatedAt}) → { ok, count, updatedAt }
import { verifyChatToken, bearer } from './auth.js';

const MAX_BYTES = 6 * 1024 * 1024;   // 单人账户仓库上限 6MB（物品快照已剥图；超出请精简）

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}
const auth = async (env, request) => {
  const p = await verifyChatToken(env, bearer(request));
  return p && p.cuid ? p : null;
};
const keyOf = (uid) => 'vault/' + String(uid) + '.json';

// GET /api/vault  拉取本人云端账户仓库
export async function handleVaultGet(request, env, ch) {
  if (!env.CLOUD_BUCKET) return json({ error: '后端未配置 R2，无法使用账户仓库云同步' }, { status: 503 }, ch);
  const a = await auth(env, request);
  if (!a) return json({ error: '未登录或会话过期，请重新登录 Discord' }, { status: 401 }, ch);
  const obj = await env.CLOUD_BUCKET.get(keyOf(a.cuid)).catch(() => null);
  if (!obj) return json({ entries: {}, updatedAt: 0 }, {}, ch);
  let data;
  try { data = JSON.parse(await obj.text()); } catch { data = { entries: {}, updatedAt: 0 }; }
  return json({ entries: data.entries || {}, updatedAt: data.updatedAt || 0 }, {}, ch);
}

// POST /api/vault  整体回传本人账户仓库（覆盖云端单 blob）
export async function handleVaultPut(request, env, ch) {
  if (!env.CLOUD_BUCKET) return json({ error: '后端未配置 R2，无法使用账户仓库云同步' }, { status: 503 }, ch);
  const a = await auth(env, request);
  if (!a) return json({ error: '未登录或会话过期，请重新登录 Discord' }, { status: 401 }, ch);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: '账户仓库数据过大（上限 6MB），请精简物品' }, { status: 413 }, ch);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json({ error: '数据格式错误' }, { status: 400 }, ch); }
  const entries = (body && typeof body.entries === 'object' && body.entries) ? body.entries : {};
  const updatedAt = Number(body && body.updatedAt) || Date.now();
  const doc = JSON.stringify({ entries, updatedAt, uid: a.cuid });
  await env.CLOUD_BUCKET.put(keyOf(a.cuid), doc, { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true, count: Object.keys(entries).length, updatedAt }, {}, ch);
}
