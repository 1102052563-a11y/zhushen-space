import type { ApiConfig } from '../store/settingsStore';
import { useSettings } from '../store/settingsStore';
import { acquireApiSlot } from './apiThrottle';

/* 多接口轮流调用 + 失败 fallback 的 chat completion（供收尾/吐槽/NPC/物品演化/骰子 等非正文功能用）。
   ⚠ 统一带 stream:true——很多中转站/「假流式」模型对**非流式**请求直接回 204 空体；与正文生成 callApi 的逻辑保持一致。
   响应：流式 SSE（data:{delta}）逐块读取、累积成整段返回（背景调用要完整内容，不做增量展示）；
        接口若忽略 stream 直接回一次性 JSON 也兼容。
   chain：按优先级排好的接口列表（上=先调用），逐个尝试，失败/超时自动切下一条；全部失败抛最后一个错误。 */
export async function apiChatFallback(
  chain: ApiConfig[],
  messages: { role: string; content: string }[],
  opts?: { timeoutMs?: number; extra?: Record<string, unknown> },
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
      const to = opts?.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
      try {
        const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/chat/completions', {
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
        const content = await readChatContent(res, api);   // 超时仍生效：挂起的流会被 ctrl.abort 打断
        if (to) clearTimeout(to);
        return { content, api };
      } catch (e) {
        if (to) clearTimeout(to);
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
async function readChatContent(res: Response, api: ApiConfig): Promise<string> {
  const ctype = (res.headers.get('content-type') || '').toLowerCase();

  // 明确是一次性 JSON（接口忽略了 stream）
  if (ctype.includes('application/json')) {
    return parseOnceOrSse(await res.text(), res.status, api);
  }
  // 无 body（如 204）→ 退回 text() 走统一报错/兜底
  if (!res.body) {
    return parseOnceOrSse(await res.text().catch(() => ''), res.status, api);
  }

  // 流式 SSE：逐块读，累积 delta
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', acc = '', rawAll = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    rawAll += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';        // 末行可能不完整，留到下次
    for (const line of lines) acc += sseLineDelta(line);
  }
  acc += sseLineDelta(buffer);          // flush 末尾残留
  if (acc.trim()) return acc;
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

/* 一次性 JSON 优先；非 JSON 当 SSE 文本兜底；都拿不到 → 清晰报错 */
function parseOnceOrSse(raw: string, status: number, api: ApiConfig): string {
  if (!raw || !raw.trim()) {
    console.warn('[API] 接口返回空响应体', { status, model: api.modelId });
    throw new Error(`HTTP ${status} 无响应体——接口既没回流式内容、也没回 JSON，请换接口或模型`);
  }
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* 非 JSON，下面按 SSE 文本兜底 */ }
  if (data) {
    const content: string = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
    if (!content || !String(content).trim()) {
      const ch = data.choices?.[0] ?? {};
      console.warn('[API] 返回内容为空', { status, model: api.modelId, finish_reason: ch.finish_reason, messageKeys: Object.keys(ch.message ?? {}), reasoningLen: String(ch.message?.reasoning_content ?? '').length });
    }
    return content;
  }
  const acc = raw.split('\n').reduce((a, l) => a + sseLineDelta(l), '');
  if (acc.trim()) return acc;
  console.warn('[API] 响应无法解析（非 JSON 非 SSE）', { status, model: api.modelId, snippet: raw.slice(0, 200) });
  throw new Error(`接口响应无法解析（HTTP ${status}，${raw.replace(/\s+/g, ' ').slice(0, 140)}）`);
}
