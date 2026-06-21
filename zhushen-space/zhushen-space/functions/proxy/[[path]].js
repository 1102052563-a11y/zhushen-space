// Cloudflare Pages Function：同源 API 代理，绕过浏览器跨域(CORS)。
// 部署后，玩家在 app 的「API 接口」里把「接口地址(baseUrl)」填成：
//     https://你的站点.pages.dev/proxy/<上游API地址，可省略 https://>
//   例 1（官方 OpenAI）   https://你的站点.pages.dev/proxy/api.openai.com/v1
//   例 2（某中转站）       https://你的站点.pages.dev/proxy/api.baimeow.icu/v1
// app 会自动在后面接 /chat/completions（或 /models），本函数据此转发到真正的上游，
// 并把上游响应（含流式 SSE）原样回传。玩家的 API Key 只是被透传给上游，绝不会存在你这边。
//
// 路由：文件名 [[path]].js 是 catch-all，匹配 /proxy/ 下的任意层级路径。
// 可选白名单：在 Cloudflare Pages → 设置 → 环境变量 里加 ALLOWED_HOSTS
//             （逗号分隔，如 "api.openai.com,api.baimeow.icu"），只放行这些上游主机，防止被当公共代理滥用。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upstream, Accept',
  'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
  const { request, env } = context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  // 上游地址两种来源（并存）：① 头式 X-Upstream（兼容 NAI / fanren 的 applyProxy，真实地址放头里，同源零配置）② 路径式 /proxy/<上游>
  const xUpstream = (request.headers.get('X-Upstream') || '').trim();
  let target, upstreamHost;
  if (xUpstream) {
    const up = xUpstream.replace(/^https?:\/+/i, '');                 // 容忍带不带 http(s)://
    if (!up) return json({ error: 'proxy: X-Upstream 为空' }, 400);
    upstreamHost = up.split('/')[0].split('?')[0];
    target = 'https://' + up;                                         // 头里已是完整地址，不再拼 url.search
  } else {
    // 取 /proxy/ 之后的整段作为上游地址；容忍写了 http(s):// 前缀、或被规范化成 https:/ 的情况
    const rest = url.pathname.replace(/^\/proxy\/?/, '').replace(/^https?:\/+/i, '');
    if (!rest) {
      return json({ error: 'proxy: 缺少上游地址，应形如 /proxy/api.openai.com/v1/... 或用 X-Upstream 头' }, 400);
    }
    upstreamHost = rest.split('/')[0].split('?')[0];
    target = 'https://' + rest + url.search;
  }

  // 上游主机白名单（可选）
  const allow = String((env && env.ALLOWED_HOSTS) || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(upstreamHost)) {
    return json({ error: `proxy: 上游主机 ${upstreamHost} 不在白名单(ALLOWED_HOSTS)` }, 403);
  }

  // 透传请求头，去掉 host / Cloudflare 专有头，避免上游拒绝
  const headers = new Headers(request.headers);
  ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
   'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-upstream'].forEach((h) => headers.delete(h));

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      // 请求体不大，缓冲后转发，避免不同运行时对流式请求体(duplex)的差异；响应仍保持流式
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.arrayBuffer(),
    });
  } catch (e) {
    return json({ error: 'proxy: 转发到上游失败', target, detail: String(e) }, 502);
  }

  // 原样回传上游响应（含 SSE 流），叠加 CORS 头
  const respHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS)) respHeaders.set(k, v);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
