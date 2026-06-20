import type { ApiConfig } from '../store/settingsStore';
import { useSettings } from '../store/settingsStore';
import { acquireApiSlot } from './apiThrottle';

// 默认云端网关；可被「本地网关地址」覆盖（localStorage drpg-gateway-url），用于走你本地 worker（你家 IP，仿 SillyTavern 本地后端）
const GW_DEPLOYED = 'https://zhushen-multiplayer.1102052563.workers.dev/api/gw/proxy';
/** 当前生效的网关代理地址：填了「本地网关地址」就用本地 worker（你家 IP），否则用云端 */
export function gwProxyBase(): string {
  try {
    const u = (typeof localStorage !== 'undefined' ? localStorage.getItem('drpg-gateway-url') : '') || '';
    const t = u.trim().replace(/\/+$/, '');
    if (t) return /\/api\/gw\/proxy$/.test(t) ? t : t + '/api/gw/proxy';
  } catch { /* ignore */ }
  return GW_DEPLOYED;
}
/** 先直连中转；若因 SSL / CORS / 混合内容失败（fetch throw），自动改走网关代理服务端转发再试一次。
 *  傻瓜化：用户只管粘地址；http/裸IP/无CORS 的公网中转会被自动救活。
 *  注:IP 锁定的中转(本地能用线上不能)需把「本地网关地址」设为你本地 worker，才会用你家 IP 转发。 */
export async function fetchWithProxy(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    // 仅代理「绝对 http/https 的公网地址」；空/相对路径、已是网关 → 不重试（避免 ?url=/models 这种垃圾请求）
    if (!/^https?:\/\//i.test(url) || url.includes('/api/gw/')) throw e;
    return await fetch(`${gwProxyBase()}?url=${encodeURIComponent(url)}`, init);
  }
}

/* 多接口轮流调用 + 失败 fallback 的 chat completion（供收尾/吐槽/NPC/物品演化/骰子 等非正文功能用）。
   ⚠ 统一带 stream:true——很多中转站/「假流式」模型对**非流式**请求直接回 204 空体；与正文生成 callApi 的逻辑保持一致。
   响应：流式 SSE（data:{delta}）逐块读取、累积成整段返回（背景调用要完整内容，不做增量展示）；
        接口若忽略 stream 直接回一次性 JSON 也兼容。
   chain：按优先级排好的接口列表（上=先调用），逐个尝试，失败/超时自动切下一条；全部失败抛最后一个错误。 */
export async function apiChatFallback(
  chain: ApiConfig[],
  messages: { role: string; content: string }[],
  opts?: { timeoutMs?: number; extra?: Record<string, unknown>; onDelta?: (accumulated: string) => void },
): Promise<{ content: string; api: ApiConfig }> {
  const usable = (chain ?? []).filter((a) => a && a.baseUrl && a.apiKey);
  if (usable.length === 0) throw new Error('无可用 API 接口（请在功能 API 设置选择接口库接口，或填写单独配置）');
  // 全局节流：限制并发 + 最小间隔，缓解中转站 429（整条逻辑调用占一个名额，含 fallback 重试）
  const th = useSettings.getState().apiThrottle;
  const release = await acquireApiSlot(th?.maxConcurrent ?? 3, th?.minGapMs ?? 0);
  try {
    let lastErr: unknown;
    for (let i = 0; i < usable.length; i++) {
      const api = usable[i];
      const body: Record<string, unknown> = { model: api.modelId, messages, stream: true, ...(opts?.extra ?? {}) };
      // 接口自带 temperature/max_tokens；若 extra 已指定（如收尾的 max_tokens）则尊重 extra，不覆盖
      if (body.temperature === undefined && api.temperature != null && isFinite(api.temperature) && api.temperature > 0) body.temperature = api.temperature;
      if (body.max_tokens === undefined && api.maxTokens != null && api.maxTokens > 0) body.max_tokens = api.maxTokens;
      const ctrl = new AbortController();
      // timeoutMs 当「空闲超时」用：只要流还在持续吐数据就不中止（推理模型/慢中转的流式总时长常超过它，
      // 按总时长掐断反而拿不到任何内容）；另设绝对上限防止真卡死无限挂起。
      const idleMs = opts?.timeoutMs ?? 0;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const bump = () => { if (!idleMs) return; if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => ctrl.abort(), idleMs); };
      const hardTimer = idleMs ? setTimeout(() => ctrl.abort(), Math.max(idleMs * 4, 240000)) : null;
      const cleanup = () => { if (idleTimer) clearTimeout(idleTimer); if (hardTimer) clearTimeout(hardTimer); };
      bump();   // 起始：覆盖连接 + 首字延迟
      try {
        const res = await fetchWithProxy(api.baseUrl.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // 带响应体（中转站/模型的真实报错：model not found / content blocked / invalid api key 等），方便定位
          const errBody = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${errBody ? ' · ' + errBody.replace(/\s+/g, ' ').slice(0, 200) : ''}`);
        }
        bump();   // 已收到响应头 = 有进展，给正文读取一个新的空闲窗口
        const content = await readChatContent(res, api, bump, opts?.onDelta);   // 每收到一块流数据就 bump() + 回调增量内容（供流式展示）
        cleanup();
        return { content, api };
      } catch (e) {
        cleanup();
        lastErr = e;
        const more = i < usable.length - 1;
        console.warn(`[API] 接口失败${more ? '，回退下一条' : ''}：${api.modelId} @ ${api.baseUrl}`, e);
      }
    }
    throw lastErr ?? new Error('全部接口调用失败');
  } finally {
    release();
  }
}

/* 读取 chat 响应内容：背景调用需要整段，故流式也累积完再返回。
   - 流式 SSE：getReader 逐块读，取每个 data: 行的 choices[0].delta.content 累积（与正文 callApi 一致）；
   - 一次性 JSON：取 choices[0].message.content；
   两种都兼容；空内容/204 给清晰报错。 */
async function readChatContent(res: Response, api: ApiConfig, onProgress?: () => void, onDelta?: (acc: string) => void): Promise<string> {
  const ctype = (res.headers.get('content-type') || '').toLowerCase();

  // 明确是一次性 JSON（接口忽略了 stream）
  if (ctype.includes('application/json')) {
    return parseOnceOrSse(await res.text(), res.status, api);
  }
  // 无 body（如 204）→ 退回 text() 走统一报错/兜底
  if (!res.body) {
    return parseOnceOrSse(await res.text().catch(() => ''), res.status, api);
  }

  // 流式 SSE：逐块读，累积 delta.content；同时累积 reasoning_content 作兜底（思考模型可能把答案放思维链里、content 为空）
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', acc = '', accR = '', rawAll = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onProgress?.();   // 有数据在流动 → 重置空闲超时（慢推理模型只要还在吐字就不掐断）
    const chunk = decoder.decode(value, { stream: true });
    rawAll += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';        // 末行可能不完整，留到下次
    for (const line of lines) { acc += sseLineDelta(line); accR += sseLineReasoning(line); }
    if (acc) onDelta?.(acc);   // 增量回调：供调用方做流式展示（背景调用不传 onDelta 则无开销）
  }
  acc += sseLineDelta(buffer); accR += sseLineReasoning(buffer);   // flush 末尾残留
  if (acc.trim()) return acc;
  if (accR.trim()) { console.warn('[API] content 为空，回退使用 reasoning_content（思考模型把答案写进了思维链）', { model: api.modelId, reasoningLen: accR.length }); return accR; }
  // 流式分支没解析出内容 → 可能其实回的是一次性 JSON（content-type 没写对）；用累计的原始体再兜一次
  return parseOnceOrSse(rawAll, res.status, api);
}

/* 取一行 SSE 的 content 增量（不是 data: 行 / [DONE] / 解析失败 → 返回 ''） */
function sseLineDelta(line: string): string {
  const t = line.trim();
  if (!t.startsWith('data:')) return '';
  const d = t.replace(/^data:\s*/, '').trim();
  if (!d || d === '[DONE]') return '';
  try { const j = JSON.parse(d); return j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''; } catch { return ''; }
}
/* 取一行 SSE 的 reasoning_content 增量（思考模型的思维链；content 为空时兜底用） */
function sseLineReasoning(line: string): string {
  const t = line.trim();
  if (!t.startsWith('data:')) return '';
  const d = t.replace(/^data:\s*/, '').trim();
  if (!d || d === '[DONE]') return '';
  try { const ch = JSON.parse(d).choices?.[0] ?? {}; return ch.delta?.reasoning_content ?? ch.delta?.reasoning ?? ch.message?.reasoning_content ?? ''; } catch { return ''; }
}

/* 从响应（一次性 JSON 或 SSE 文本）里抠出上游错误（429 限流 / 5xx 等）——很多中转把错误塞进 200 的 body，
   content 抠不到时用它给「清晰报错」而不是含糊的「无法解析」 */
function extractUpstreamError(raw: string): { code?: number; message: string } | null {
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const d = t.startsWith('data:') ? t.replace(/^data:\s*/, '').trim() : t;
    if (!d || d === '[DONE]') continue;
    try {
      const j = JSON.parse(d);
      const err = j?.error ?? ((j?.code && j?.message) ? j : null);
      if (err && (err.message || err.code)) return { code: err.code, message: String(err.message || err.type || '') };
    } catch { /* 跳过非 JSON 行 */ }
  }
  return null;
}
function throwUpstream(err: { code?: number; message?: string; type?: string }, status: number): never {
  const code = err.code ?? status;
  const msg = String(err.message || err.type || '未知错误').replace(/\s+/g, ' ').slice(0, 180);
  const tag = code === 429 ? '上游限流 429（配额/频率超限，换接口或多 key 轮换）' : `上游错误 ${code}`;
  throw new Error(`${tag}：${msg}`);
}

/* 一次性 JSON 优先；非 JSON 当 SSE 文本兜底；都拿不到 → 先看是不是上游错误，再清晰报错 */
function parseOnceOrSse(raw: string, status: number, api: ApiConfig): string {
  if (!raw || !raw.trim()) {
    console.warn('[API] 接口返回空响应体', { status, model: api.modelId });
    throw new Error(`HTTP ${status} 无响应体——接口既没回流式内容、也没回 JSON，请换接口或模型`);
  }
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* 非 JSON，下面按 SSE 文本兜底 */ }
  if (data) {
    const ch = data.choices?.[0] ?? {};
    const content: string = ch.message?.content ?? ch.text ?? '';
    if (content && String(content).trim()) return content;
    const reasoning: string = ch.message?.reasoning_content ?? ch.delta?.reasoning_content ?? '';   // content 空 → 用思维链兜底
    if (reasoning && String(reasoning).trim()) { console.warn('[API] content 空，回退使用 reasoning_content', { status, model: api.modelId, reasoningLen: String(reasoning).length }); return reasoning; }
    if (data.error) throwUpstream(data.error, status);   // 一次性 JSON 里塞了 error（限流/配额等）→ 清晰报错
    console.warn('[API] 返回内容为空', { status, model: api.modelId, finish_reason: ch.finish_reason, messageKeys: Object.keys(ch.message ?? {}) });
    return content;
  }
  const acc = raw.split('\n').reduce((a, l) => a + sseLineDelta(l), '');
  if (acc.trim()) return acc;
  const accR = raw.split('\n').reduce((a, l) => a + sseLineReasoning(l), '');   // SSE 也兜底思维链
  if (accR.trim()) { console.warn('[API] SSE content 空，回退使用 reasoning_content', { status, model: api.modelId, reasoningLen: accR.length }); return accR; }
  const up = extractUpstreamError(raw);   // SSE/文本里塞了 error 事件（如 200 里夹 429）→ 清晰报错而非「无法解析」
  if (up) throwUpstream(up, status);
  console.warn('[API] 响应无法解析（非 JSON 非 SSE）', { status, model: api.modelId, snippet: raw.slice(0, 200) });
  throw new Error(`接口响应无法解析（HTTP ${status}，${raw.replace(/\s+/g, ' ').slice(0, 140)}）`);
}
