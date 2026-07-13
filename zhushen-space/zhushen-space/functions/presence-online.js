// Cloudflare Pages Function：同源只读统计（GET /presence-online）——聊天室轮询当前在玩人数 / 累计在线时长 / 国家分布。
// 走同源避免国内直连 *.workers.dev 被限；只读、不登记自己（登记走 POST /presence）。
// 上游 worker 地址可用 Pages 环境变量 MP_BASE 覆盖（默认=官方 worker）。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const MP_BASE = 'https://zhushen-multiplayer.1102052563.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const base = ((env && env.MP_BASE) || MP_BASE).replace(/\/+$/, '');
  try {
    const up = await fetch(base + '/api/playtime/online', { method: 'GET' });
    const body = await up.text();
    return new Response(body, { status: up.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'online proxy failed', detail: String(e) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
