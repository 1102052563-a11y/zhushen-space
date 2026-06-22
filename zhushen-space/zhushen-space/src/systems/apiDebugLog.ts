import { create } from 'zustand';

/* ── 全局 API 调试日志 ───────────────────────────────────────────────
   每次走 apiChatFallback 的调用（正文 + 所有演化阶段 + 各功能）都登记一条：
   发送的 messages（含 system/历史/各注入）+ 返回 content + 耗时 + 成败。
   开发者面板按 label 分选项卡浏览每一条的输入/返回。环形缓冲，只留最近 CAP 条。 */

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
}

interface ApiDebugState {
  calls: ApiCallLog[];
  capturing: boolean;                              // 总开关（默认开；可在面板里关）
  setCapturing: (v: boolean) => void;
  push: (label: string, messages: { role: string; content: string }[], parts?: { label: string; role: string; content: string }[]) => number;
  finish: (id: number, response: string, ok: boolean, error?: string) => void;
  clear: () => void;
}

let _seq = 1;
const CAP = 30;

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
    };
    set((s) => ({ calls: [call, ...s.calls].slice(0, CAP) }));
    return id;
  },
  finish: (id, response, ok, error) => {
    if (id < 0) return;
    set((s) => ({
      calls: s.calls.map((c) => c.id === id
        ? { ...c, response, ok, error, pending: false, ms: Date.now() - c.ts }
        : c),
    }));
  },
  clear: () => set({ calls: [] }),
}));

/** 非 hook 访问（apiChatFallback 等在非组件环境调用） */
export const apiDebugLog = {
  push: (label: string, messages: { role: string; content: string }[], parts?: { label: string; role: string; content: string }[]) => useApiDebugLog.getState().push(label, messages, parts),
  finish: (id: number, response: string, ok: boolean, error?: string) => useApiDebugLog.getState().finish(id, response, ok, error),
};

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
