import type { ApiConfig } from '../store/settingsStore';
import { useSettings } from '../store/settingsStore';
import { acquireApiSlot } from './apiThrottle';

/* 多接口轮流调用 + 失败 fallback 的非流式 chat completion。
   chain：按优先级排好的接口列表（上=先调用）。逐个尝试，失败/超时自动切下一个；
   每个接口用各自的 model/temperature/maxTokens。全部失败则抛最后一个错误。 */
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
    const body: Record<string, unknown> = { model: api.modelId, messages, ...(opts?.extra ?? {}) };
    // 接口自带 temperature/max_tokens；若 extra 已指定（如预设覆盖）则尊重 extra，不覆盖
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
      if (to) clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content: string = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
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
