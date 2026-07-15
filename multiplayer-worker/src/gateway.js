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

// 给「刷新模型」当清单用（AI Studio 有 key 时会被动态全量覆盖；Vertex 用这个静态清单）。
// 注意：Vertex 的 gemini-3 系是带 -preview 的 ID，写错会 404 模型不存在。
const MODELS = [
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite',
  'gemini-3-flash-preview', 'gemini-3-pro-preview',
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
  // 通用后端代理（仿 SillyTavern 后端转发）：目标在 ?url=，server-side 转发任意中转，绕过浏览器 SSL/混合内容/CORS
  if (p.endsWith('/api/gw/proxy')) {
    return await proxyGeneric(request, cors);
  }
  // Edge-TTS：免 key 的微软 Edge 神经语音（浏览器直连被 CORS/GEC 挡 → 服务端 websocket 合成，返回 MP3）
  if (p.endsWith('/api/gw/edgetts/speech')) {
    return await edgeTtsSpeech(request, cors);
  }
  // 统一云 TTS：前端只发一种格式，网关按 provider 翻译成 edge/openai/azure/google，一律回 audio/mpeg
  if (p.endsWith('/api/gw/tts/speech')) {
    return await unifiedTts(request, cors);
  }
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

/* ─────────────── 通用后端代理：把浏览器够不着的中转（http 裸 IP / 无 CORS / 无 HTTPS）server-side 转发 ───────────────
   接口地址填：https://<worker>/api/gw/proxy?url=<你中转的 base，如 http://1.2.3.4:8050/v1>
   前端会自动把 /chat/completions、/models 接在后面，一并进 ?url=，原样转发；Authorization(中转的 key) 照传。
   ⚠ 这是「开放转发」：拿到本 URL 的人也能借你 worker 转发（需自带目标 key）；只转 http/https，CF Worker 无内网，风险有限。*/
async function proxyGeneric(request, cors) {
  const target = new URL(request.url).searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) {
    return json({ error: { message: '通用代理：接口地址应为 https://<worker>/api/gw/proxy?url=http://你的中转/v1' } }, { status: 400 }, cors);
  }
  const fwd = new Headers();
  const auth = request.headers.get('Authorization'); if (auth) fwd.set('Authorization', auth);
  fwd.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  // 透传调用方真实 IP（标准反代行为）：让中转的「IP 限制」看到你的浏览器 IP，而不是 Cloudflare 的，
  // 这样"本地能用、线上 403"（中转按 IP 判）就有机会解决——前提是中转按 X-Forwarded-For/X-Real-IP 判 IP。
  const clientIp = request.headers.get('CF-Connecting-IP') || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  if (clientIp) { fwd.set('X-Forwarded-For', clientIp); fwd.set('X-Real-IP', clientIp); }
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: fwd,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.text(),
    });
  } catch (e) {
    return json({ error: { message: '代理转发失败（目标连不上）：' + String((e && e.message) || e) } }, { status: 502 }, cors);
  }
  const h = new Headers(cors);
  h.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  h.set('Cache-Control', 'no-cache');
  return new Response(upstream.body, { status: upstream.status, headers: h });
}

/* ─────────────── AI Studio：透传到官方 OpenAI 兼容端点（用调用方自带的 key）─────────────── */
async function proxyAiStudio(request, env, cors) {
  const keys = splitKeys(bearer(request));
  if (!keys.length) return json({ error: { message: '请在该接口的 apiKey 填入你自己的 AI Studio key（多个用逗号/空格分隔，自动轮换）' } }, { status: 401 }, cors);
  // gemini 思考模型默认「轻思考」：否则容易把 token/时间全耗在思维链上 → content 空、结构化输出拿不到。
  // 请求自带 reasoning_effort 时尊重之；可用 env.GEMINI_REASONING_EFFORT 调（默认 low；设 'auto' 则不注入、交给 gemini 自定）。
  let bodyObj = {};
  try { bodyObj = JSON.parse(await request.text()); } catch { /* 非 JSON 不应发生 */ }
  const effort = env.GEMINI_REASONING_EFFORT || 'low';
  if (bodyObj && typeof bodyObj === 'object' && bodyObj.reasoning_effort == null && effort !== 'auto') {
    bodyObj.reasoning_effort = effort;
  }
  const body = JSON.stringify(bodyObj); // 读成字符串以便对多个 key 重试
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
  // 仿 SillyTavern「后端常驻持有 SA」。两种部署：
  //   • 线上（推荐·免本地）：SA 放 `wrangler secret put VERTEX_SA_JSON` + `wrangler secret put VERTEX_GATE`(口令)；
  //     前端该接口 apiKey 填口令。SA 不进浏览器、不进仓库；口令校验防别人盗用你的赠金。
  //   • 本地：SA 来自 .dev.vars(env) 或请求自带(前端「📁 导入 JSON」)，localhost 免口令。
  const isLocal = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  if (!isLocal) {
    if (!env.VERTEX_SA_JSON) {
      return json({ error: { message: 'Vertex 线上未启用：worker 跑 `wrangler secret put VERTEX_SA_JSON` 和 `wrangler secret put VERTEX_GATE`，再 `wrangler deploy`' } }, { status: 503 }, cors);
    }
    if (!env.VERTEX_GATE || bearer(request) !== env.VERTEX_GATE) {
      return json({ error: { message: 'Vertex 线上需口令：该接口 apiKey 填你设的 VERTEX_GATE 口令（别填服务账号）' } }, { status: 401 }, cors);
    }
  }
  const saRaw = env.VERTEX_SA_JSON || (isLocal ? bearer(request) : '');
  if (!saRaw) {
    return json({ error: { message: 'Vertex 未配置：本地用该接口「📁 导入 JSON」或 .dev.vars；线上用 wrangler secret' } }, { status: 503 }, cors);
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
  raw = String(raw || '').trim();   // 去掉管道/粘贴可能带的首尾换行空格，免得 atob 失败
  if (!raw) return null;
  try { const j = JSON.parse(raw); if (j && j.private_key) return j; } catch { /* 试 base64 */ }
  try { const j = JSON.parse(atob(raw.replace(/\s+/g, ''))); if (j && j.private_key) return j; } catch { /* 都不是 */ }
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

  // 结构化输出：把 OpenAI `response_format` 翻成 Gemini 原生 responseSchema（token 级硬约束——解码层保证 JSON 合法 + enum 不越界）。
  // 客户端 apiObject.ts 发的 { type:'json_schema', json_schema:{ schema } } 到这里被转成 Gemini Schema 方言。
  const rf = body.response_format;
  if (rf && (rf.type === 'json_schema' || rf.type === 'json_object')) {
    generationConfig.responseMimeType = 'application/json';
    const sch = rf.type === 'json_schema' ? (rf.json_schema && rf.json_schema.schema) : null;
    if (sch) { const g = jsonSchemaToGemini(sch); if (g) generationConfig.responseSchema = g; }
  }

  const out = { contents, generationConfig };
  if (sysText) out.systemInstruction = { role: 'user', parts: [{ text: sysText }] };
  // 联网检索（grounding）：客户端经 extra 通道发 tools:[{ google_search:{} }]（登场判断/技能树/混沌世界卡等）。
  // AI Studio 直通 / 通用代理会原样透传，但本 Vertex 转换器过去漏掉了 tools → grounding 静默失效。这里补上映射。
  if (Array.isArray(body.tools) && body.tools.some((t) => t && (t.google_search || t.googleSearch))) {
    out.tools = [{ google_search: {} }];
  }
  // RPG 含成人/暴力叙事 → 关掉安全拦截，避免正文被 Vertex 拦空
  out.safetySettings = [
    'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map((category) => ({ category, threshold: 'BLOCK_NONE' }));
  return out;
}

/** JSON Schema（客户端 apiObject.ts 的子集）→ Gemini Schema 方言（大写类型 + propertyOrdering，剥 Gemini 不吃的 additionalProperties/$schema/strict）。
 *  const → 单值 enum；对象保留字段顺序做 propertyOrdering（Gemini 输出更稳定）。递归。 */
export function jsonSchemaToGemini(s) {
  if (!s || typeof s !== 'object') return null;
  const t = String(s.type || '').toLowerCase();
  const TYPE = { string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY', object: 'OBJECT' };
  const out = {};
  if (TYPE[t]) out.type = TYPE[t];
  if (s.description) out.description = String(s.description);
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String);
  if (s.const != null) out.enum = [String(s.const)];                        // Gemini 无 const → 单值 enum
  if (t === 'string' && s.format) out.format = s.format;
  if ((t === 'number' || t === 'integer')) { if (s.minimum != null) out.minimum = s.minimum; if (s.maximum != null) out.maximum = s.maximum; }
  if (t === 'array') {
    out.items = jsonSchemaToGemini(s.items) || { type: 'STRING' };
    if (s.minItems != null) out.minItems = s.minItems;
    if (s.maxItems != null) out.maxItems = s.maxItems;
  }
  if (t === 'object' && s.properties && typeof s.properties === 'object') {
    out.properties = {};
    const keys = Object.keys(s.properties);
    for (const k of keys) { const c = jsonSchemaToGemini(s.properties[k]); if (c) out.properties[k] = c; }
    const req = Array.isArray(s.required) ? s.required.filter((k) => k in out.properties) : [];
    if (req.length) out.required = req;
    if (keys.length) out.propertyOrdering = keys;                           // 决定 Gemini 输出字段顺序
  }
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

/* ─────────────── Edge-TTS：微软 Edge 免 key 神经语音（服务端 websocket 合成 → MP3）───────────────
   协议移植自 DIYgod/cloudflare-edge-tts（MIT）：GEC 安全令牌 + wss 握手 + SSML + 二进制帧拼接。
   前端 EdgeTtsEngine POST {text, voice, rate} 到这里，拿回 audio/mpeg 流。免 key、20+ 中文神经音色。 */
const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const EDGE_SYNTH_URL = `https://${EDGE_BASE}/edge/v1`;
const EDGE_CHROMIUM = '143.0.3650.75';
const EDGE_GEC_VER = `1-${EDGE_CHROMIUM}`;
const EDGE_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_CHROMIUM.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE_CHROMIUM.split('.')[0]}.0.0.0`;

export async function edgeSecMsGec() {
  let ticks = Date.now() / 1000 + 11644473600;   // Windows 纪元
  ticks -= ticks % 300;                            // 5 分钟窗口
  ticks *= 1e9 / 100;                              // → 100ns 单位
  const payload = `${ticks.toFixed(0)}${EDGE_TOKEN}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function edgeConnId() { return crypto.randomUUID().replace(/-/g, ''); }
function edgeMuid() { const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function edgeTimestamp() { return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1); }
function edgeEscapeXml(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function edgeStripBadXml(t) { return t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' '); }
// 短名 zh-CN-XiaoxiaoNeural → 微软长名；已是长名/异常则原样
export function edgeNormalizeVoice(voice) {
  const m = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec((voice || '').trim());
  if (!m) return (voice || '').trim();
  let [, lang, region, name] = m;
  if (name.includes('-')) { const [suf, ...rest] = name.split('-'); region += `-${suf}`; name = rest.join('-'); }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}
function edgeConfigMsg() {
  return `X-Timestamp:${edgeTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
}
function edgeSsmlMsg(requestId, voice, text, rate) {
  const pct = Math.round(((rate ?? 1) - 1) * 100);
  const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>${edgeEscapeXml(edgeStripBadXml(text))}</prosody></voice></speak>`;
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${edgeTimestamp()}Z\r\nPath:ssml\r\n\r\n` + ssml;
}
function edgeParseTextHeaders(msg) {
  const sep = msg.indexOf('\r\n\r\n');
  const head = sep >= 0 ? msg.slice(0, sep) : msg;
  const h = {};
  for (const line of head.split('\r\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i)] = line.slice(i + 1).trim(); }
  return h;
}
function edgeParseBinaryFrame(data) {
  if (data.length < 2) throw new Error('binary frame missing header length');
  const headerLen = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLen) throw new Error('binary frame truncated');
  const headText = new TextDecoder().decode(data.slice(2, 2 + headerLen));
  const h = {};
  for (const line of headText.split('\r\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i)] = line.slice(i + 1).trim(); }
  return { headers: h, body: data.slice(2 + headerLen) };
}
async function edgeToU8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return null;
}
function edgeAudioStream(socket, text, voice, requestId, rate) {
  let ctrl = null, got = false, settled = false;
  const cleanup = () => { socket.removeEventListener('message', onMsg); socket.removeEventListener('close', onClose); socket.removeEventListener('error', onErr); };
  const fail = (e) => { if (settled) return; settled = true; cleanup(); ctrl && ctrl.error(e instanceof Error ? e : new Error(String(e))); };
  const done = () => { if (settled) return; settled = true; cleanup(); ctrl && ctrl.close(); };
  const onMsg = async (event) => {
    if (settled) return;
    const data = event.data;
    if (typeof data === 'string') {
      const path = edgeParseTextHeaders(data).Path;
      if (path === 'turn.end') { try { socket.close(); } catch { done(); } return; }
      return;   // response / turn.start / audio.metadata 忽略
    }
    const u8 = await edgeToU8(data);
    if (!u8) return fail(new Error('unsupported ws message type'));
    try {
      const { headers, body } = edgeParseBinaryFrame(u8);
      if (headers.Path !== 'audio') return;
      if (headers['Content-Type'] !== 'audio/mpeg') { if (body.length === 0) return; return; }
      got = true; ctrl && ctrl.enqueue(body);
    } catch (e) { fail(e); }
  };
  const onClose = () => { if (!got) fail(new Error('no audio received')); else done(); };
  const onErr = (e) => fail(e);
  return new ReadableStream({
    start(controller) {
      ctrl = controller;
      socket.addEventListener('message', onMsg);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onErr);
      socket.accept();
      socket.send(edgeConfigMsg());
      socket.send(edgeSsmlMsg(requestId, voice, text, rate));
    },
    cancel() { cleanup(); settled = true; try { socket.close(1000, 'cancelled'); } catch { /* ignore */ } },
  });
}
async function edgeCreateAudioStream(text, voice, rate) {
  const gec = await edgeSecMsGec();
  const connId = edgeConnId();
  const url = new URL(EDGE_SYNTH_URL);
  url.searchParams.set('TrustedClientToken', EDGE_TOKEN);
  url.searchParams.set('Sec-MS-GEC', gec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_GEC_VER);
  url.searchParams.set('ConnectionId', connId);
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': EDGE_UA, 'Accept-Language': 'en-US,en;q=0.9', Pragma: 'no-cache', 'Cache-Control': 'no-cache', 'Sec-WebSocket-Version': '13', Upgrade: 'websocket', Cookie: `muid=${edgeMuid()};` },
  });
  if (res.status !== 101 || !res.webSocket) throw new Error(`ws upgrade failed status ${res.status}`);
  return edgeAudioStream(res.webSocket, text, edgeNormalizeVoice(voice), edgeConnId(), rate);
}
async function edgeTtsSpeech(request, cors) {
  if (request.method !== 'POST') return json({ error: { message: 'POST only' } }, { status: 405 }, cors);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: { message: 'invalid json' } }, { status: 400 }, cors); }
  const text = String(body.text || '').trim();
  if (!text) return json({ error: { message: 'text is required' } }, { status: 400 }, cors);
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'zh-CN-XiaoxiaoNeural';
  const rate = typeof body.rate === 'number' ? body.rate : 1;
  try {
    const stream = await edgeCreateAudioStream(text, voice, rate);
    return new Response(stream, { status: 200, headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return json({ error: { message: 'edge-tts 合成失败：' + String((e && e.message) || e) } }, { status: 502 }, cors);
  }
}

/* ─────────────── 统一云 TTS 路由：一种入口 → 按 provider 翻译成各家格式，一律回 audio/mpeg ───────────────
   前端 POST { provider, input, voice, rate, baseUrl?, apiKey?, region?, model? }。
   provider: edge(免key·复用上面) / openai(任意 /v1/audio/speech) / azure(官方·key) / google(Cloud TTS·key)。 */
async function unifiedTts(request, cors) {
  if (request.method !== 'POST') return json({ error: { message: 'POST only' } }, { status: 405 }, cors);
  let b = {};
  try { b = await request.json(); } catch { return json({ error: { message: 'invalid json' } }, { status: 400 }, cors); }
  const provider = String(b.provider || 'edge');
  const text = String(b.input || b.text || '').trim();
  if (!text) return json({ error: { message: 'input 必填' } }, { status: 400 }, cors);
  const voice = String(b.voice || '');
  const rate = typeof b.rate === 'number' ? b.rate : 1;
  const audioHeaders = { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' };
  try {
    if (provider === 'edge') {
      const stream = await edgeCreateAudioStream(text, voice || 'zh-CN-XiaoxiaoNeural', rate);
      return new Response(stream, { status: 200, headers: audioHeaders });
    }
    if (provider === 'openai') {
      const base = String(b.baseUrl || '').replace(/\/+$/, '');
      if (!base) return json({ error: { message: 'openai: baseUrl 必填（如 https://api.openai.com/v1）' } }, { status: 400 }, cors);
      const url = /\/audio\/speech$/.test(base) ? base : base + '/audio/speech';
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.apiKey || ''}` },
        body: JSON.stringify({ model: b.model || 'tts-1', input: text, voice: voice || 'alloy', speed: Math.max(0.25, Math.min(4, rate)), response_format: 'mp3' }),
      });
      if (!r.ok) return json({ error: { message: `openai TTS HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}` } }, { status: r.status }, cors);
      return new Response(r.body, { status: 200, headers: { ...audioHeaders, 'Content-Type': r.headers.get('content-type') || 'audio/mpeg' } });
    }
    if (provider === 'azure') {
      const region = String(b.region || '').trim(), key = String(b.apiKey || '').trim();
      if (!region || !key) return json({ error: { message: 'azure: region + apiKey 必填' } }, { status: 400 }, cors);
      const pct = Math.round((rate - 1) * 100), rateStr = (pct >= 0 ? '+' : '') + pct + '%';
      const v = voice || 'zh-CN-XiaoxiaoNeural';
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${v}'><prosody rate='${rateStr}'>${edgeEscapeXml(edgeStripBadXml(text))}</prosody></voice></speak>`;
      const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'zhushen-tts' },
        body: ssml,
      });
      if (!r.ok) return json({ error: { message: `azure TTS HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}` } }, { status: r.status }, cors);
      return new Response(r.body, { status: 200, headers: audioHeaders });
    }
    if (provider === 'google') {
      const key = String(b.apiKey || '').trim();
      if (!key) return json({ error: { message: 'google: apiKey 必填' } }, { status: 400 }, cors);
      const name = voice || 'cmn-CN-Wavenet-A';
      const langCode = name.split('-').slice(0, 2).join('-');
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: langCode, name }, audioConfig: { audioEncoding: 'MP3', speakingRate: Math.max(0.25, Math.min(4, rate)) } }),
      });
      if (!r.ok) return json({ error: { message: `google TTS HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}` } }, { status: r.status }, cors);
      const data = await r.json();
      if (!data.audioContent) return json({ error: { message: 'google TTS 无 audioContent' } }, { status: 502 }, cors);
      const bin = atob(data.audioContent);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes, { status: 200, headers: audioHeaders });
    }
    return json({ error: { message: 'unknown provider: ' + provider } }, { status: 400 }, cors);
  } catch (e) {
    return json({ error: { message: `${provider} TTS 失败：${String((e && e.message) || e)}` } }, { status: 502 }, cors);
  }
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
