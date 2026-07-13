// Cloudflare Pages Function：同源「在玩」心跳（POST /presence）。
// 为什么需要它：presence 心跳原本直连 *.workers.dev，国内裸连常被 RST → 大陆用户上报不了、也就统计不到、更判不出 CN。
// Pages 站（*.pages.dev）用户既然能打开页面，同源 /presence 就能通；这里在 Pages 边缘读到用户【真实国家 + 真实 IP】，
// 显式透传给 worker（Pages→worker 走 Cloudflare 内网、不受国内公网限制），从而把「裸连大陆用户」正确计入在玩统计与国家分布。
// ⚠ 挂 VPN/机场的用户仍会被判成出口国——那是 Cloudflare 边缘只见出口 IP 的物理限制，无解。
// 隐私：真实 IP 仅在 Cloudflare 内部透传给 worker 做哈希去重，worker 只存 SHA-256、不存原文（与直连时的 CF-Connecting-IP 等价，无恶化）。
// 上游 worker 地址可用 Pages 环境变量 MP_BASE 覆盖（默认=官方 worker）。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const MP_BASE = 'https://zhushen-multiplayer.1102052563.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const base = ((env && env.MP_BASE) || MP_BASE).replace(/\/+$/, '');
  const country = (request.cf && request.cf.country) || '';                 // Pages 边缘按用户真实 IP 判定的国家码（JP/CN/US…）
  const ip = request.headers.get('CF-Connecting-IP') || '';                 // 用户真实 IP（仅透传给 worker 做去重哈希，worker 不存原文）
  try {
    const up = await fetch(base + '/api/playtime/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Country': country, 'X-Client-Ip': ip },
      body: '{}',
    });
    const body = await up.text();
    return new Response(body, { status: up.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'presence proxy failed', detail: String(e) }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
