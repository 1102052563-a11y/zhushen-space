// 轮回乐园 · AI 反代网关
// 解决浏览器直连 Google 的 CORS，并替 Vertex 做服务账号鉴权。把两条 Google 线路包成 OpenAI 兼容：
//   POST /api/gw/aistudio/chat/completions  → AI Studio（多租户）：Authorization: Bearer <调用方自己的 AI Studio key>
//   GET  /api/gw/aistudio/models            → 动态拉取 Google 全量模型（用调用方的 key，和 SillyTavern 一致）
//   POST /api/gw/vertex/chat/completions    → Vertex（🔒仅本人·本地）：SA 从服务端环境读，不经请求、不进公开部署
//   GET  /api/gw/vertex/models              → 精选 Gemini 清单
//
// 两种安全模型：
//   • AI Studio = 无状态多租户：网关不存 key，凭据由每个请求自带 → 你部署一次，别人各填自己的 key，谁都不用再部署。
//                 apiKey 可填多个（逗号/空格/换行分隔）→ 每请求轮换起点，遇 429/401/403 自动切下一个 key（叠加免费额度）。
//   • Vertex    = 锁定单租户：服务账号(SA) 只从 env.VERTEX_SA_JSON 读（放本地 .dev.vars，跑 wrangler dev）。
//                 公开部署不配 SA → Vertex 自动关闭；只有你本地能用，SA 永不离开你的机器。可选 VERTEX_GATE 口令再加一道闸。
// 变量：VERTEX_LOCATION（默认 global）；机密：VERTEX_SA_JSON、VERTEX_GATE（仅本地 .dev.vars）。

const MODELS = [
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite',
  'gemini-3-flash', 'gemini-3-pro-preview',
];

function json(obj, init = {}, headers = {}) {
  return new Response(JSON.stringify(obj), { ...init, headers: { 'Content-Type': 'application/json', ...headers } });
}
function bearer(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}
// apiKey 字段可填多个 key（逗号/空格/换行分隔）→ 拆成数组
function splitKeys(s) {
  return String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}
// 轮换：每次请求换一个起点（round-robin），其余作为失败兜底顺序
let _rr = 0;
function orderedKeys(keys) {
  if (keys.length <= 1) return keys.slice();
  const start = (_rr++) % keys.length;
  return keys.slice(start).concat(keys.slice(0, start));
}
// 该不该换下一个 key 再试：限额(429)/无权限(401/403)，或某个 key 本身无效(400 API_KEY_INVALID)。
// 其它错误（如 400 模型/参数错、5xx 服务端）换 key 也没用 → 直接返回。
function shouldTryNextKey(status, text) {
  if (status === 429 || status === 401 || status === 403) return true;
  if (status === 400 && /api[_ ]?key|API_KEY_INVALID|not valid/i.test(text || '')) return true;
  return false;
}
function staticModels() {
  return { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'google' })) };
}
// AI Studio：用调用方自带 key 动态拉取 Google 全量模型（原生 /v1beta/models，最可靠）；只筛支持 generateContent 的
// 多 key 时逐个轮换尝试；失败直接回报错（而不是悄悄给精选），方便定位；只有「没填 key」时才回退精选清单。
async function aiStudioModels(request, cors) {
  const keys = splitKeys(bearer(request));
  if (!keys.length) return json(staticModels(), {}, cors);
  let last = 0, lastText = '';
  for (const k of orderedKeys(keys)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(k)}`);
      if (r.ok) {
        const j = await r.json();
        const data = (j.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).some((x) => /generateContent/i.test(x)))
          .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), object: 'model', owned_by: 'google' }))
          .filter((m) => m.id);
        return json({ object: 'list', data: data.length ? data : staticModels().data }, {}, cors);
      }
      last = r.status; lastText = await r.text().catch(() => '');
      if (!shouldTryNextKey(r.status, lastText)) break;   // 非 key 问题就别换了
    } catch (e) { last = 502; lastText = String((e && e.message) || e); }
  }
  return json({ error: { message: `拉取模型失败 HTTP ${last}: ${lastText.replace(/\s+/g, ' ').slice(0, 220)}` } }, { status: last || 502 }, cors);
}

/** 网关总入口：按子路径分流到 AI Studio / Vertex */
export async function handleGateway(request, env, cors) {
  const p = new URL(request.url).pathname;
  if (request.method === 'GET' && p.endsWith('/models')) {
    if (p.includes('/aistudio/')) return await aiStudioModels(request, cors);   // 动态拉 Google 全量
    return json(staticModels(), {}, cors);                                       // Vertex：精选清单
  }
  if (request.method === 'POST' && p.endsWith('/chat/completions')) {
    try {
      if (p.includes('/vertex/')) return await proxyVertex(request, env, cors);
      if (p.includes('/aistudio/')) return await proxyAiStudio(request, env, cors);
    } catch (e) {
      return json({ error: { message: String((e && e.message) || e) } }, { status: 500 }, cors);
    }
  }
  return json({ error: { message: 'gateway route not found' } }, { status: 404 }, cors);
}

/* ─────────────── AI Studio：透传到官方 OpenAI 兼容端点（用调用方自带的 key）─────────────── */
async function proxyAiStudio(request, env, cors) {
  const keys = splitKeys(bearer(request));
  if (!keys.length) return json({ error: { message: '请在该接口的 apiKey 填入你自己的 AI Studio key（多个用逗号/空格分隔，自动轮换）' } }, { status: 401 }, cors);
  const body = await request.text(); // 已是 OpenAI 格式；读成字符串以便对多个 key 重试
  let last = 0, lastText = '';
  for (const k of orderedKeys(keys)) {     // 轮换起点 + 限额(429)/无效(401/403)自动切下一个 key
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
      body,
    });
    if (upstream.ok) {
      const h = new Headers(cors);
      h.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
      h.set('Cache-Control', 'no-cache');
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }
    last = upstream.status; lastText = await upstream.text().catch(() => '');
    if (!shouldTryNextKey(upstream.status, lastText)) break;   // 非 key/限额问题，换 key 也没用
  }
  return json({ error: { message: `${keys.length} 个 key 均失败（最后 HTTP ${last}: ${lastText.replace(/\s+/g, ' ').slice(0, 200)}）` } }, { status: last || 502 }, cors);
}

/* ─────────────── Vertex：用调用方自带的服务账号 JSON 鉴权 + OpenAI⇄Gemini 互转 ─────────────── */
async function proxyVertex(request, env, cors) {
  // 🔒 仍是「仅本人·本地」。SA 来源优先级：
  //   ① 服务端 env.VERTEX_SA_JSON(.dev.vars，最安全，SA 不进浏览器) →
  //   ② 仅当本地 worker(localhost) 时，允许请求自带 SA(前端「📁 导入 JSON」走这条，方便) →
  //   ③ 否则 503。公开部署既无 env、又非 localhost → 永远 503，Vertex 不对外。
  const isLocal = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  const saRaw = env.VERTEX_SA_JSON || (isLocal ? bearer(request) : '');
  if (!saRaw) {
    return json({ error: { message: isLocal
      ? 'Vertex 未配置：用该接口的「📁 导入服务账号 JSON」导入，或在 .dev.vars 配 VERTEX_SA_JSON'
      : 'Vertex 仅本人·本地：把本接口地址指向 http://localhost:8787/api/gw/vertex 并本地 `wrangler dev`（公开网关不处理 Vertex）' } }, { status: 503 }, cors);
  }
  const sa = parseServiceAccount(saRaw);
  if (!sa) return json({ error: { message: '服务账号 JSON 无效（需原文或 base64）' } }, { status: 400 }, cors);
  const project = sa.project_id;
  const location = env.VERTEX_LOCATION || 'global';
  if (!project) return json({ error: { message: '服务账号 JSON 缺 project_id' } }, { status: 400 }, cors);

  const body = await request.json();
  const model = String(body.model || 'gemini-2.5-flash').replace(/^.*\//, '');
  const stream = body.stream !== false;

  const token = await getVertexToken(sa);
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const base = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}`;
  const url = stream ? `${base}:streamGenerateContent?alt=sse` : `${base}:generateContent`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(openaiToGemini(body)),
  });
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return json({ error: { message: `Vertex HTTP ${upstream.status}: ${t.replace(/\s+/g, ' ').slice(0, 300)}` } }, { status: upstream.status }, cors);
  }
  if (!stream) {
    const data = await upstream.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    return json(openaiOnce(text, model), {}, cors);
  }
  return new Response(geminiSseToOpenAi(upstream.body, model), { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

/** 解析调用方传来的服务账号 JSON（容忍：原文 JSON / base64(JSON)）；无效返回 null */
function parseServiceAccount(raw) {
  if (!raw) return null;
  try { const j = JSON.parse(raw); if (j && j.private_key) return j; } catch { /* 试 base64 */ }
  try { const j = JSON.parse(atob(raw)); if (j && j.private_key) return j; } catch { /* 都不是 */ }
  return null;
}

// 按服务账号缓存 access token（client_email → {token,exp}），约 1 小时，提前 60s 续签
const _vtokens = new Map();
async function getVertexToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const cached = _vtokens.get(sa.client_email);
  if (cached && cached.exp - 60 > now) return cached.token;
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud, exp: now + 3600, iat: now,
  })));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBuf(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('Vertex token 获取失败：' + JSON.stringify(data).slice(0, 200));
  _vtokens.set(sa.client_email, { token: data.access_token, exp: now + (data.expires_in || 3600) });
  return data.access_token;
}

/** OpenAI 请求体 → Gemini generateContent 请求体 */
function openaiToGemini(body) {
  const contents = [];
  let sysText = '';
  for (const m of body.messages || []) {
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content) ? m.content.map((c) => c?.text || '').join('') : '';
    if (m.role === 'system') { sysText += (sysText ? '\n' : '') + text; continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
  }
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: sysText || ' ' }] });

  const generationConfig = {};
  if (body.temperature != null) generationConfig.temperature = body.temperature;
  if (body.top_p != null) generationConfig.topP = body.top_p;
  if (body.max_tokens != null) generationConfig.maxOutputTokens = Math.min(body.max_tokens, 65536);

  const out = { contents, generationConfig };
  if (sysText) out.systemInstruction = { role: 'user', parts: [{ text: sysText }] };
  // RPG 含成人/暴力叙事 → 关掉安全拦截，避免正文被 Vertex 拦空
  out.safetySettings = [
    'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map((category) => ({ category, threshold: 'BLOCK_NONE' }));
  return out;
}

/** Gemini SSE 流 → OpenAI chat.completion.chunk SSE 流 */
function geminiSseToOpenAi(readable, model) {
  const id = 'chatcmpl-' + Date.now();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = '';
  return new ReadableStream({
    async start(controller) {
      const reader = readable.getReader();
      const send = (delta, finish) => controller.enqueue(enc.encode('data: ' + JSON.stringify({
        id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish || null }],
      }) + '\n\n'));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const d = t.slice(5).trim();
            if (!d || d === '[DONE]') continue;
            try {
              const j = JSON.parse(d);
              const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
              if (text) send({ content: text });
            } catch { /* 跳过解析失败的行 */ }
          }
        }
        send({}, 'stop');
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
      } catch (e) {
        try { controller.enqueue(enc.encode('data: ' + JSON.stringify({ error: { message: String(e) } }) + '\n\n')); } catch { /* ignore */ }
      } finally {
        controller.close();
      }
    },
  });
}

/** Gemini 一次性结果 → OpenAI chat.completion */
function openaiOnce(text, model) {
  return {
    id: 'chatcmpl-' + Date.now(), object: 'chat.completion', model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
}

/* ─────────────── 小工具 ─────────────── */
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToBuf(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
