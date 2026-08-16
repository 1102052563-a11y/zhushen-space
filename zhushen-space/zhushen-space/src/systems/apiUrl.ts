/* API 地址归一化 + 请求参数排除（借鉴 SillyTavern-ApiHub 思想，已获授权参考其实现）。
   铁则：**缺 /v1 绝不静默补**（存量接口地址都是自带版本段跑通的，静默改写=今天能跑明天 404）；
   只做三件保守事：剥尾斜杠、剥用户误粘的完整 chat 端点后缀、`#` 字面量转义。
   /api/gw/ 网关地址（proxy?url=… / aistudio / vertex）一律不动，保持与旧行为逐字节一致。 */

/** 归一化接口基址。返回 { base, literal }：
 *  - 结尾 `#` ＝字面量模式：剥掉 # 与尾斜杠后**完全按原样使用**（chatCompletionsUrl 不再拼 /chat/completions），
 *    给 Azure 式 deployments 路径、带 query 的奇葩网关留后门；
 *  - 含 /api/gw/ ＝内部网关地址：仅剥尾斜杠（升级即回归，别碰）；
 *  - 其余：剥尾斜杠 + 剥误粘的 `/chat/completions` 后缀（用户整段复制文档 URL 的头号错法）。 */
export function normalizeApiBase(raw: string): { base: string; literal: boolean } {
  let s = (raw || '').trim();
  if (s.endsWith('#')) {
    return { base: s.slice(0, -1).replace(/\/+$/, ''), literal: true };
  }
  s = s.replace(/\/+$/, '');
  if (s.includes('/api/gw/')) return { base: s, literal: false };
  s = s.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  return { base: s, literal: false };
}

/** chat 端点完整地址：字面量模式原样返回（用户给的就是最终地址），否则基址 + /chat/completions */
export function chatCompletionsUrl(raw: string): string {
  const { base, literal } = normalizeApiBase(raw);
  return literal ? base : base + '/chat/completions';
}

/** 模型列表端点：与 chatCompletionsUrl 同一套归一化口径（散点 store 全走这里，防 chat/models 口径分裂）。
 *  字面量模式尽力而为：结尾是完整 chat 端点就同级换成 /models，否则直接拼。 */
export function modelsListUrl(raw: string): string {
  const { base, literal } = normalizeApiBase(raw);
  if (literal && /\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/models');
  return base + '/models';
}

/** 地址是否已带版本段（/v1、/v1beta、/v2…结尾）。true=别提示。
 *  字面量模式 / 网关地址 / 空地址一律 true（这些场景提示没有意义）。仅供 UI「补 /v1」chip 判断，不参与请求。 */
export function endsWithVersionSegment(raw: string): boolean {
  const { base, literal } = normalizeApiBase(raw);
  if (literal || !base || base.includes('/api/gw/')) return true;
  const seg = base.match(/\/([^/?#]+)$/)?.[1]?.toLowerCase() ?? '';
  return /^v\d+[a-z0-9]*$/.test(seg);
}

/** 展示用打码：前 8 后 4 明文，中间 ****；短 Key（≤12）整个打码 */
export function maskApiKey(key: string): string {
  const k = (key || '').trim();
  if (!k) return '';
  if (k.length <= 12) return '****';
  return `${k.slice(0, 8)}****${k.slice(-4)}`;
}

/** 可被端点勾选排除的请求参数白名单——只有采样类参数可排。
 *  stream / model / messages / response_format 永不在列：stream:false 会招 204（Agent 铁律）、
 *  response_format 归约束生成的 aliasGuard 管。 */
export const OMITTABLE_PARAMS = ['temperature', 'top_p', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'seed'] as const;

/** 按端点的 omitParams 从请求 body 里剔除参数（仅白名单内的键生效）。
 *  非破坏式：有剔除时返回浅拷贝，没有则原样返回——body 可能被调用方跨接口重试复用，就地 delete 会把删键漏给下一条接口。 */
export function applyOmitParams<T extends Record<string, unknown>>(body: T, omit?: string[]): T {
  const keys = (omit ?? []).filter((k) => (OMITTABLE_PARAMS as readonly string[]).includes(k));
  if (keys.length === 0) return body;
  const out = { ...body };
  for (const k of keys) delete out[k];
  return out;
}

/* ── P1 协议层：OpenAI 兼容 / Anthropic 原生 / Gemini 原生 ＋ 多 Key 拆分 ─────────────
   Agent 正文模式不接原生协议（tool_calls 协议差异大，httpTransport 仍 OpenAI 兼容 only）。 */

export type ApiProtocol = 'openai' | 'anthropic' | 'gemini';
export interface ProtocolApi { baseUrl: string; apiKey?: string; modelId?: string; maxTokens?: number; protocol?: string }

export function protocolOf(api: { protocol?: string } | null | undefined): ApiProtocol {
  const p = api?.protocol;
  return p === 'anthropic' || p === 'gemini' ? p : 'openai';
}

/** 多 Key 拆分（与 ApiKeyEditor 的逗号连接约定一致，兼容换行/空白；去重保序）。
 *  ⚠ /api/gw/ 网关地址整串不拆——aistudio 网关拿整串在服务端自己轮换，拆了它就失去 Key 池。 */
export function keysOf(api: { baseUrl?: string; apiKey?: string }): string[] {
  const raw = (api.apiKey || '').trim();
  if (!raw) return [];
  if ((api.baseUrl || '').includes('/api/gw/')) return [raw];
  return Array.from(new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)));
}

/** 基址补协议默认版本段：字面量/网关/已带版本段 → 原样；否则拼 defVer。
 *  注：这不违反 openai 的「缺 /v1 绝不静默补」——anthropic/gemini 的原生路径版本段是协议规格的一部分，由构造器整体负责。 */
function versionedBase(raw: string, defVer: string): string {
  const { base, literal } = normalizeApiBase(raw);
  if (literal || base.includes('/api/gw/')) return base;
  const seg = base.match(/\/([^/?#]+)$/)?.[1]?.toLowerCase() ?? '';
  return /^v\d+[a-z0-9]*$/.test(seg) ? base : base + '/' + defVer;
}

/** gemini 拉模型列表回来的 name 形如 models/gemini-2.5-pro，拼 URL 前剥前缀 */
function cleanModelId(m: string | undefined): string { return (m || '').replace(/^models\//, ''); }

/** 各协议的 chat 端点（UI 预览同用；gemini 的 key 走 x-goog-api-key 头，绝不进 URL） */
export function chatUrlFor(api: ProtocolApi): string {
  const proto = protocolOf(api);
  if (proto === 'anthropic') return versionedBase(api.baseUrl, 'v1') + '/messages';
  if (proto === 'gemini') return `${versionedBase(api.baseUrl, 'v1beta')}/models/${cleanModelId(api.modelId) || '<model>'}:streamGenerateContent?alt=sse`;
  return chatCompletionsUrl(api.baseUrl);
}

type OaiMsg = { role: string; content: unknown };
/** 抠消息文本：string 原样；OpenAI 视觉数组取 text 部件拼接 */
function partText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p: any) => p && p.type === 'text').map((p: any) => String(p.text ?? '')).join('\n');
  return content == null ? '' : String(content);
}
/** 抠消息里的 data: URL 图片（输入贴图走 OpenAI image_url 格式）；http 外链图跳过（不在前端拉流量） */
function partImages(content: unknown): { mime: string; data: string }[] {
  if (!Array.isArray(content)) return [];
  const out: { mime: string; data: string }[] = [];
  for (const p of content as any[]) {
    const url = p?.type === 'image_url' ? String(p.image_url?.url ?? '') : '';
    const m = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (m) out.push({ mime: m[1], data: m[2] });
  }
  return out;
}

/** OpenAI 消息 → Anthropic /v1/messages body。system 提级顶层；user/assistant 必须严格交替 → 连续同角色合并；
 *  首条必须 user → 缺则补占位；max_tokens 必填 → 即使被 omitParams 排除也强制回填；温度夹到 ≤1；
 *  其余 OpenAI 参数（frequency/presence/seed/response_format/n）Anthropic 见到未知键会 400 → 一律丢弃。 */
function anthropicBody(oaiBody: Record<string, unknown>, api: ProtocolApi): Record<string, unknown> {
  const msgs = (oaiBody.messages as OaiMsg[] | undefined) ?? [];
  const sys: string[] = [];
  const turns: { role: 'user' | 'assistant'; content: any[] }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') { const t = partText(m.content); if (t) sys.push(t); continue; }
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
    const blocks: any[] = [];
    const t = partText(m.content);
    if (t) blocks.push({ type: 'text', text: t });
    for (const img of partImages(m.content)) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
    if (!blocks.length) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  }
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: [{ type: 'text', text: '（继续）' }] });
  const maxT = Number(oaiBody.max_tokens);
  const body: Record<string, unknown> = {
    model: oaiBody.model,
    messages: turns,
    max_tokens: Number.isFinite(maxT) && maxT > 0 ? maxT : ((api.maxTokens ?? 0) > 0 ? api.maxTokens : 8192),
    stream: oaiBody.stream !== false,
  };
  if (sys.length) body.system = sys.join('\n\n');
  if (oaiBody.temperature != null && Number.isFinite(Number(oaiBody.temperature))) body.temperature = Math.min(1, Math.max(0, Number(oaiBody.temperature)));
  if (oaiBody.top_p != null && Number.isFinite(Number(oaiBody.top_p))) body.top_p = Number(oaiBody.top_p);
  return body;
}

/** OpenAI 消息 → Gemini generateContent body。assistant→model；system→systemInstruction；连续同角色合并、首条补 user；
 *  采样参数进 generationConfig（驼峰）；model 在 URL 里不进 body；tools 原样透传（联网检索 {google_search:{}} REST 同名）。 */
function geminiBody(oaiBody: Record<string, unknown>): Record<string, unknown> {
  const msgs = (oaiBody.messages as OaiMsg[] | undefined) ?? [];
  const sys: string[] = [];
  const contents: { role: 'user' | 'model'; parts: any[] }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') { const t = partText(m.content); if (t) sys.push(t); continue; }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    const parts: any[] = [];
    const t = partText(m.content);
    if (t) parts.push({ text: t });
    for (const img of partImages(m.content)) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
    if (!parts.length) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '（继续）' }] });
  const gen: Record<string, unknown> = {};
  if (oaiBody.temperature != null && Number.isFinite(Number(oaiBody.temperature))) gen.temperature = Number(oaiBody.temperature);
  if (oaiBody.top_p != null && Number.isFinite(Number(oaiBody.top_p))) gen.topP = Number(oaiBody.top_p);
  const maxT = Number(oaiBody.max_tokens);
  if (Number.isFinite(maxT) && maxT > 0) gen.maxOutputTokens = maxT;
  if (oaiBody.seed != null && Number.isFinite(Number(oaiBody.seed))) gen.seed = Number(oaiBody.seed);
  if (oaiBody.frequency_penalty != null && Number.isFinite(Number(oaiBody.frequency_penalty))) gen.frequencyPenalty = Number(oaiBody.frequency_penalty);
  if (oaiBody.presence_penalty != null && Number.isFinite(Number(oaiBody.presence_penalty))) gen.presencePenalty = Number(oaiBody.presence_penalty);
  const body: Record<string, unknown> = { contents };
  if (sys.length) body.systemInstruction = { parts: [{ text: sys.join('\n\n') }] };
  if (Object.keys(gen).length) body.generationConfig = gen;
  if (oaiBody.tools) body.tools = oaiBody.tools;
  return body;
}

/** 按协议出最终请求（url/headers/body）。oaiBody 传入前应已过 applyOmitParams；key 由调用方从 keysOf 轮换选出。 */
export function buildProtocolRequest(api: ProtocolApi, key: string, oaiBody: Record<string, unknown>): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const proto = protocolOf(api);
  if (proto === 'anthropic') {
    return {
      url: chatUrlFor(api),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',   // 官方浏览器直连 CORS 开关
      },
      body: anthropicBody(oaiBody, api),
    };
  }
  if (proto === 'gemini') {
    const model = cleanModelId(String(oaiBody.model ?? api.modelId ?? '')) || '<model>';
    return {
      url: `${versionedBase(api.baseUrl, 'v1beta')}/models/${model}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },   // key 走头不进 URL（防代理日志/历史记录泄漏）
      body: geminiBody(oaiBody),
    };
  }
  return {
    url: chatCompletionsUrl(api.baseUrl),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: oaiBody,
  };
}

function geminiParts(j: any): any[] { return j?.candidates?.[0]?.content?.parts ?? []; }

/** 流式分片 JSON → 正文增量（anthropic=content_block_delta.text；gemini=parts 非 thought；openai=choices delta） */
export function extractStreamDelta(proto: ApiProtocol, j: any): string {
  if (proto === 'anthropic') return j?.type === 'content_block_delta' ? String(j.delta?.text ?? '') : '';
  if (proto === 'gemini') return geminiParts(j).filter((p: any) => !p?.thought).map((p: any) => String(p.text ?? '')).join('');
  return j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? '';
}
/** 流式分片 JSON → 思维链增量（content 为空时的兜底源；anthropic=thinking_delta；gemini=thought 部件） */
export function extractStreamReasoning(proto: ApiProtocol, j: any): string {
  if (proto === 'anthropic') return j?.type === 'content_block_delta' ? String(j.delta?.thinking ?? '') : '';
  if (proto === 'gemini') return geminiParts(j).filter((p: any) => p?.thought).map((p: any) => String(p.text ?? '')).join('');
  const ch = j?.choices?.[0] ?? {};
  return ch.delta?.reasoning_content ?? ch.delta?.reasoning ?? ch.message?.reasoning_content ?? '';
}
/** 一次性 JSON（接口忽略 stream）→ 完整正文 */
export function extractOnceContent(proto: ApiProtocol, j: any): string {
  if (proto === 'anthropic') return Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('') : '';
  if (proto === 'gemini') return geminiParts(j).filter((p: any) => !p?.thought).map((p: any) => String(p.text ?? '')).join('');
  const ch = j?.choices?.[0] ?? {};
  return ch.message?.content ?? ch.delta?.content ?? ch.text ?? '';
}

/** 拉模型列表的 fetch 参数（url+headers 按协议；多 Key 取第一个——⚠多行 Key 整串塞 Bearer 头会 401 甚至 fetch 直接抛）。
 *  用法：fetch(...modelsFetchArgs(api)) / fetchWithProxy(...modelsFetchArgs(api, ctrl.signal)) */
export function modelsFetchArgs(api: ProtocolApi, signal?: AbortSignal): [string, RequestInit] {
  const proto = protocolOf(api);
  const key = keysOf(api)[0] ?? '';
  if (proto === 'anthropic') {
    return [versionedBase(api.baseUrl, 'v1') + '/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, ...(signal ? { signal } : {}) }];
  }
  if (proto === 'gemini') {
    return [versionedBase(api.baseUrl, 'v1beta') + '/models', { headers: { 'x-goog-api-key': key }, ...(signal ? { signal } : {}) }];
  }
  return [modelsListUrl(api.baseUrl), { headers: { Authorization: `Bearer ${key}` }, ...(signal ? { signal } : {}) }];
}
