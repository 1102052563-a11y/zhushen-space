#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   诸神空间 · 本地网关（仿 SillyTavern 本地后端）
   ─────────────────────────────────────────────
   作用：替浏览器向 LLM 中转站发请求——中转看到的是【你家宽带 IP + 普通服务器客户端】，
        而不是 Cloudflare 机房 IP / 带浏览器指纹的跨域请求。专治「SillyTavern 能用、
        网页版被拒/403/被盾」的中转。

   用法：
     1) 双击同目录的「启动本地网关.bat」（或命令行：node local-gateway.mjs [--port 8787]）
     2) 游戏里 设置 → 综合设置 → API 接口库 → 本地网关地址 填 http://localhost:8787
     3) 点「测试连通」出现 ✓ 即生效。之后所有代理转发优先走本机；脚本没开也不影响
        （前端连不上会自动回退云端网关）。

   路由（与云端 multiplayer-worker/gateway.js 的通用代理语义对齐）：
     OPTIONS *                → 204 + CORS（浏览器预检）
     GET  /health             → { ok:true } 连通性自检（前端「测试连通」按钮用）
     *    …/api/gw/proxy?url= → 通用转发：把 ?url= 指向的请求原样发出（透传 Authorization/
                                Content-Type，请求体缓冲、响应体【流式】回传——SSE 不断流）
     *    /api/gw/*（其余）    → 透传云端 worker（TTS 等其他网关功能不受影响）
     其他                     → 404

   零依赖 · 需 Node.js ≥ 18（自带 fetch）。只监听本机/局域网，无鉴权——别暴露到公网。
   ═══════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import os from 'node:os';
import { Readable } from 'node:stream';

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const portArg = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : NaN; })();
const PORT = Number.isFinite(portArg) && portArg > 0 ? portArg : (Number(process.env.PORT) || 8787);
// 其余 /api/gw/* 路由（TTS/AI Studio 等）透传到云端 worker；可用环境变量覆盖（测试/自部署用）
const CLOUD_GW = (process.env.ZS_CLOUD_GW || 'https://zhushen-multiplayer.1102052563.workers.dev').replace(/\/+$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upstream, Accept',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* 读完请求体（提示词最多几 MB，缓冲无压力；与云端 worker 行为一致） */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 把上游 fetch 响应流式写回浏览器（SSE 逐块透传不缓冲）；浏览器断开时中止上游 */
async function pipeUpstream(upstream, res) {
  const headers = { ...CORS, 'Cache-Control': 'no-cache' };
  const ct = upstream.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  res.writeHead(upstream.status, headers);
  if (!upstream.body) { res.end(); return; }
  const body = Readable.fromWeb(upstream.body);
  body.on('error', () => { try { res.end(); } catch { /* */ } });
  body.pipe(res);
}

async function handleProxy(req, res, reqUrl) {
  // 目标：?url=（前端 fetchViaProxy / 接口「套代理」都用它）；兼容 X-Upstream 头（同源 Pages 代理的写法）
  let target = reqUrl.searchParams.get('url') || '';
  if (!target) {
    const xu = (req.headers['x-upstream'] || '').toString().trim();
    if (xu) target = /^https?:\/\//i.test(xu) ? xu : 'https://' + xu;
  }
  if (!/^https?:\/\//i.test(target)) {
    return sendJson(res, 400, { error: { message: '通用代理：目标应放在 ?url=http://你的中转/v1/chat/completions（或 X-Upstream 头）' } });
  }
  const fwd = {};
  if (req.headers.authorization) fwd['Authorization'] = req.headers.authorization;
  fwd['Content-Type'] = req.headers['content-type'] || 'application/json';
  if (req.headers.accept) fwd['Accept'] = req.headers.accept;

  const ac = new AbortController();
  // 浏览器停止生成/断开 → 中止上游。⚠必须挂在 res 上且判 writableEnded：
  // req(IncomingMessage) 读完请求体就会 autoDestroy 发 'close'，挂 req 会把正常请求的上游也掐掉。
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: fwd,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req),
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) { try { res.end(); } catch { /* */ } return; }
    return sendJson(res, 502, { error: { message: '本地网关：连不上目标 ' + target.split('?')[0] + ' —— ' + String(e && e.message || e) } });
  }
  console.log(`[proxy] ${req.method} → ${target.split('?')[0]} · ${upstream.status}`);
  await pipeUpstream(upstream, res);
}

/* 其余 /api/gw/* → 透传云端 worker（保持 TTS/AI Studio 等网关功能可用） */
async function handleCloudPassthrough(req, res, reqUrl) {
  const target = CLOUD_GW + reqUrl.pathname + reqUrl.search;
  const fwd = {};
  if (req.headers.authorization) fwd['Authorization'] = req.headers.authorization;
  if (req.headers['content-type']) fwd['Content-Type'] = req.headers['content-type'];
  if (req.headers.accept) fwd['Accept'] = req.headers.accept;
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });   // 同 handleProxy：挂 res 而非 req（req 读完体即 close）
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: fwd,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req),
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) { try { res.end(); } catch { /* */ } return; }
    return sendJson(res, 502, { error: { message: '本地网关：透传云端失败 —— ' + String(e && e.message || e) } });
  }
  console.log(`[cloud] ${req.method} ${reqUrl.pathname} · ${upstream.status}`);
  await pipeUpstream(upstream, res);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', 'http://localhost');
  const p = reqUrl.pathname;
  Promise.resolve().then(async () => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (p === '/health' || p === '/api/gw/health') { return sendJson(res, 200, { ok: true, service: 'zhushen-local-gateway', version: VERSION, node: process.version }); }
    if (p.endsWith('/api/gw/proxy')) return handleProxy(req, res, reqUrl);
    if (p.startsWith('/api/gw/')) return handleCloudPassthrough(req, res, reqUrl);
    sendJson(res, 404, { error: { message: 'not found（本地网关只有 /health、/api/gw/proxy?url=、/api/gw/* 透传）' } });
  }).catch((e) => {
    console.error('[error]', e);
    try { sendJson(res, 500, { error: { message: String(e && e.message || e) } }); } catch { /* */ }
  });
});

server.listen(PORT, () => {
  const lans = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('══════════════════════════════════════════════════');
  console.log(`  诸神空间 · 本地网关 v${VERSION} 已启动（Node ${process.version}）`);
  console.log('──────────────────────────────────────────────────');
  console.log(`  ① 本机游玩 → 游戏设置「本地网关地址」填：`);
  console.log(`       http://localhost:${PORT}`);
  if (lans.length) {
    console.log(`  ② 手机/其他设备（同一 WiFi）→ 填：`);
    for (const ip of lans) console.log(`       http://${ip}:${PORT}`);
  }
  console.log('──────────────────────────────────────────────────');
  console.log('  中转站将看到【本机的家庭宽带 IP】（= SillyTavern 同款待遇）。');
  console.log('  关闭本窗口即停止；游戏会自动回退云端网关，不影响使用。');
  console.log('══════════════════════════════════════════════════');
});
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[x] 端口 ${PORT} 被占用——可能网关已经开着（无需重复启动），或用 --port 换端口：node local-gateway.mjs --port 8788`);
  } else {
    console.error('[x] 启动失败：', e);
  }
  process.exitCode = 1;
});
