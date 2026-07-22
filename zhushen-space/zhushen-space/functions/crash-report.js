// Cloudflare Pages Function：崩溃上报收集端（作者黑匣子）。
// POST /crash-report          ：前端崩溃时自动上报（src/systems/crashReport.ts），写入 R2 桶
//   （复用 enhance-bosses 等已绑定的 R2_BUCKET，key 前缀 crash-reports/ 隔离，零新增配置，随 git push 自动部署）。
// GET  /crash-report?limit=50 ：查看最近 7 天崩溃记录（新→旧合并成 JSON 返回）。参数：limit(1-200)、days(1-30)。
//   可选上锁：Pages 环境变量设 CRASH_TOKEN 后，GET 须带 ?token=<值>（POST 上报不受影响）。
// 隐私：只收错误消息/堆栈/UA/版本号（前端已白名单+截断+去重限频），不含存档内容；服务端再按白名单收一次。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.R2_BUCKET) return json({ error: 'R2 binding R2_BUCKET 未配置' }, 503);

  if (request.method === 'POST') {
    let text = '';
    try { text = await request.text(); } catch { return json({ error: 'bad body' }, 400); }
    if (!text || text.length > 64 * 1024) return json({ error: 'body too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    const pick = (k, cap) => String((body && body[k]) || '').slice(0, cap);
    const rec = {
      ts: new Date().toISOString(),
      kind: pick('kind', 60),
      msg: pick('msg', 600),
      stack: pick('stack', 5000),
      componentStack: pick('componentStack', 4000),
      path: pick('path', 300),
      ua: pick('ua', 220),
      version: pick('version', 40),
      lang: pick('lang', 20),
      country: (request.cf && request.cf.country) || '',
    };
    if (!rec.msg) return json({ error: 'empty msg' }, 400);
    const key = `crash-reports/${rec.ts.slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await env.R2_BUCKET.put(key, JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' } });
    return json({ ok: true });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    if (env.CRASH_TOKEN && url.searchParams.get('token') !== env.CRASH_TOKEN) {
      return json({ error: 'token 不对（见 Pages 环境变量 CRASH_TOKEN）' }, 403);
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 30);
    // R2 list 只能按 key 升序；key 带日期前缀，按天倒着收集、够数即停
    const keys = [];
    for (let i = 0; i < days && keys.length < limit * 2; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const list = await env.R2_BUCKET.list({ prefix: `crash-reports/${d}/`, limit: 500 });
      for (const o of list.objects || []) keys.push(o.key);
    }
    keys.sort().reverse();
    const out = [];
    for (const k of keys.slice(0, limit)) {
      try {
        const o = await env.R2_BUCKET.get(k);
        if (o) out.push(JSON.parse(await o.text()));
      } catch { /* 单条损坏跳过 */ }
    }
    return json({ count: out.length, reports: out });
  }

  return json({ error: 'method not allowed' }, 405);
}
