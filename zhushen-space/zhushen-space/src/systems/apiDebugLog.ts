import { create } from 'zustand';

/* ── 全局 API 调试日志 ───────────────────────────────────────────────
   每次走 apiChatFallback 的调用（正文 + 所有演化阶段 + 各功能）都登记一条：
   发送的 messages（含 system/历史/各注入）+ 返回 content + 耗时 + 成败，
   以及消耗观测（借鉴 SoulLink 思想）：输入/输出字符量、上游真实 usage（有则记）、
   命中接口（模型/host/第几条 fallback 成功）。开发者面板按 label 分选项卡浏览 + 按 label 聚合消耗排行。
   环形缓冲，只留最近 CAP 条。 */

export interface ApiUsage { prompt?: number; completion?: number; total?: number }

export interface ApiCallLog {
  id: number;
  label: string;                                  // 调用来源（正文 / 物品演化 / …）
  messages: { role: string; content: string }[];  // 实际发送的消息数组
  parts?: { label: string; role: string; content: string }[];  // 结构化分段（仅正文：预设块/后历史/深度注入…），有则面板优先展示
  response: string;                                // 返回正文（流式累计后的最终）
  error?: string;
  pending: boolean;
  ok: boolean;
  ts: number;                                      // 开始时间
  ms?: number;                                     // 耗时
  charsIn: number;                                 // 输入字符总量（宏求值后实发口径）
  charsOut?: number;                               // 返回字符量（成功时）
  model?: string;                                  // 命中接口的模型 id
  host?: string;                                   // 命中接口的 host
  attempt?: number;                                // 第几条接口成功（1=首选；>1=前面的都失败回退到它）
  usage?: ApiUsage;                                // 上游返回的真实 token 用量（流式末块/一次性 JSON 里带 usage 才有）
}

/** finish 附带的命中信息（成功时才给；失败调用没有） */
export interface ApiCallMeta { model?: string; host?: string; attempt?: number; usage?: ApiUsage }

interface ApiDebugState {
  calls: ApiCallLog[];
  capturing: boolean;                              // 总开关（默认开；可在面板里关）
  setCapturing: (v: boolean) => void;
  push: (label: string, messages: { role: string; content: string }[], parts?: { label: string; role: string; content: string }[]) => number;
  finish: (id: number, response: string, ok: boolean, error?: string, meta?: ApiCallMeta) => void;
  clear: () => void;
}

let _seq = 1;
const CAP = 60;

export const useApiDebugLog = create<ApiDebugState>((set, get) => ({
  calls: [],
  capturing: true,
  setCapturing: (v) => set({ capturing: v }),
  push: (label, messages, parts) => {
    if (!get().capturing) return -1;
    const id = _seq++;
    const call: ApiCallLog = {
      id, label,
      // 深拷贝消息（避免后续被改），并对超长内容留全量（调试需要）
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      parts,
      response: '', pending: true, ok: false, ts: Date.now(),
      charsIn: messages.reduce((a, m) => a + (m.content?.length || 0), 0),
    };
    set((s) => ({ calls: [call, ...s.calls].slice(0, CAP) }));
    return id;
  },
  finish: (id, response, ok, error, meta) => {
    if (id < 0) return;
    set((s) => ({
      calls: s.calls.map((c) => c.id === id
        ? { ...c, response, ok, error, pending: false, ms: Date.now() - c.ts, ...(ok ? { charsOut: (response || '').length } : {}), ...(meta ?? {}) }
        : c),
    }));
  },
  clear: () => set({ calls: [] }),
}));

/** 非 hook 访问（apiChatFallback 等在非组件环境调用） */
export const apiDebugLog = {
  push: (label: string, messages: { role: string; content: string }[], parts?: { label: string; role: string; content: string }[]) => useApiDebugLog.getState().push(label, messages, parts),
  finish: (id: number, response: string, ok: boolean, error?: string, meta?: ApiCallMeta) => useApiDebugLog.getState().finish(id, response, ok, error, meta),
};

/** 归一化上游 usage（字段名各家不一，只认数字）。返回 undefined=没有任何可用字段。 */
export function normApiUsage(u: any): ApiUsage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const n = (x: unknown) => (typeof x === 'number' && isFinite(x) && x >= 0 ? x : undefined);
  const out: ApiUsage = {
    prompt: n(u.prompt_tokens ?? u.input_tokens),
    completion: n(u.completion_tokens ?? u.output_tokens),
    total: n(u.total_tokens),
  };
  if (out.total === undefined && out.prompt !== undefined && out.completion !== undefined) out.total = out.prompt + out.completion;
  return out.prompt !== undefined || out.completion !== undefined || out.total !== undefined ? out : undefined;
}

/** 调用方没给 label 时，从消息里自动推断一个短标签（取首条 system 的首个非空行前若干字），
 *  让各演化阶段/功能调用在面板里也能认出来。 */
export function autoApiLabel(messages: { role: string; content: string }[]): string {
  const sys = messages.find((m) => m.role === 'system') ?? messages[0];
  const line = (sys?.content || '').split('\n').map((l) => l.trim()).find(Boolean) || '调用';
  // 优先取首个【…】/[…] 里的名字（各阶段规则多以「【XX铁则】」开头），更干净
  const m = line.match(/[【\[]([^】\]]{2,16})[】\]]/);
  if (m) return m[1].trim();
  return line.replace(/^[#＃（(*\-—·•\s]+/, '').slice(0, 16) || '调用';
}
