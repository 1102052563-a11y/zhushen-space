/* Agent 正文模式 · 共享类型（仿 TauriTavern Agent Mode 行为规范·纯前端移植）
   设计文档：docs/AGENT_MODE_PLAN.md。独立于 legacy 正文生成的旁路：模型带工具循环产稿，
   commit 成楼层、finish 收尾，终态后回到 callApi 既有结算管线。 */

/** 发给模型的消息（宽松：content 允许多模态数组原样透传） */
export interface AgentMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

/** 解析后的一次工具调用 */
export interface AgentToolCall {
  id: string;
  /** canonical 名（点号，如 workspace.write_file）；未知工具时为模型原文 */
  name: string;
  /** 模型侧名（下划线） */
  modelName: string;
  args: Record<string, unknown>;
  /** 注册表里没有这个工具（致命错误 model.unknown_tool_call） */
  unknown?: boolean;
}

/** 工具执行结果（编码回模型时转为 {ok,content,structured,errorCode,resourceRefs} 五字段 JSON 串） */
export interface AgentToolResult {
  ok: boolean;
  content: string;
  structured?: unknown;
  errorCode?: string;
  /** 控制类副作用：commit=已提交楼层；finish=请求收尾（运行时做 commit 闸门校验） */
  effect?: 'commit' | 'finish';
  /** effect==='commit' 时：提交的原始全文与模式（运行时据此维护 rawCommitted + 通知宿主） */
  commit?: { path: string; mode: 'replace' | 'append'; text: string };
}

/** 工具定义（schema 发给模型；run 在本地执行） */
export interface AgentToolSpec {
  name: string;        // canonical：workspace.write_file
  modelName: string;   // 模型侧：workspace_write_file
  description: string;
  /** JSON Schema（{"type":"object","additionalProperties":false,...}） */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<AgentToolResult> | AgentToolResult;
}

export type AgentRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

/** 事件（驱动 Timeline UI + 归档 journal） */
export interface AgentRunEvent {
  id: number;
  t: number;              // Date.now()
  round: number;
  type: string;           // model_completed / tool_call / tool_failed / commit / drift / finish / terminal …
  label: string;          // 展示行主文案
  detail?: string;        // 次要说明（灰字）
  tone: 'info' | 'active' | 'success' | 'warn' | 'error';
}

export interface AgentRunResult {
  status: Exclude<AgentRunStatus, 'running'>;
  /** completed/partial：最终成稿原文（含 <state> 等指令块）；failed/cancelled 为已提交部分（可为空） */
  narrative: string;
  errorCode?: string;
  errorMessage?: string;
  rounds: number;
  toolCalls: number;
  commits: number;
  protocolUsed: 'native' | 'text';
}

/** 运行输入快照（游戏侧只读数据，callApi 组装时传入） */
export interface AgentRunInputs {
  userText: string;
  /** 全量历史楼层（prompt 视图），index 即楼层号（0 起） */
  history: { role: string; content: string }[];
  /** 本回合命中的世界书条目（含常驻） */
  wbHits: { name: string; content: string; constant?: boolean }[];
}

/** 设置（settingsStore.agentNarrative） */
export interface AgentNarrativeSettings {
  enabled: boolean;
  protocol: 'auto' | 'native' | 'text';
  maxRounds: number;
  maxToolCalls: number;
  /** modelName → 是否启用；缺省 true（dice_roll 默认 false，对齐原作默认关） */
  toolToggles: Record<string, boolean>;
  /** true=复用正文 API；false=独立配置（agentApi / 'agent' 路由） */
  useTextApi: boolean;
  /** P1·单工具调用上限（modelName → 次数；缺省不限，总预算 maxToolCalls 仍生效）。暂无 UI，走配置导入/控制台 */
  maxCallsPerTool?: Record<string, number>;
  /** P2·评稿子代理：模型 finish 前先由评稿人审一遍，REVISE 则回喂意见逼修订（每次 finish 拦截 +1 次调用） */
  reviewerEnabled?: boolean;
  /** P2·最多评几轮（1~3；达到次数后 finish 直接放行），默认 1 */
  reviewerPasses?: number;
}

/** P2·配置档案（命名快照）：抓取当前 Agent 配置 + 独立 API + 路由，一键应用切换。
    提示词不入档（仍走全局预设中心）；enabled 不入档（应用档案不改变开关状态）。 */
export interface AgentProfileSnapshot {
  id: string;
  name: string;
  cfg: Omit<AgentNarrativeSettings, 'enabled'>;
  api?: { baseUrl: string; apiKey: string; modelId: string; temperature?: number; maxTokens?: number; topP?: number };
  routeIds?: string[];         // apiRoutes['agent'] 快照
  reviewRouteIds?: string[];   // apiRoutes['agentReview'] 快照
}

export const AGENT_DEFAULTS: AgentNarrativeSettings = {
  enabled: false,
  protocol: 'auto',
  maxRounds: 16,
  maxToolCalls: 40,
  toolToggles: { dice_roll: false },
  useTextApi: false,
};

/** 模型一轮响应（transport 解析后） */
export interface AgentModelTurn {
  content: string;                 // 文本部分（可空）
  reasoning?: string;              // reasoning_content（只记 journal，不回喂）
  toolCallsRaw: RawToolCallOut[];  // 原生 FC 解析出的调用（text 协议为空，由文本再解析）
}

/** 原生 FC 的 tool_call 输出（SSE 增量合并后 / 一次性 JSON） */
export interface RawToolCallOut {
  id: string;
  name: string;        // 模型侧名
  argsRaw: string;     // arguments 原始字符串（或已是对象时 stringify）
}

/** 违约类错误码（userRetryable：UI 提示可用 ⟳ 重新生成） */
export const AGENT_RETRYABLE_CODES = ['model.tool_call_required', 'agent.tool_after_finish', 'agent.max_tool_rounds_exceeded'] as const;

/** 错误码 → 中文文案（Timeline/genError 用；未命中回退原始 message） */
export const AGENT_ERROR_TEXT: Record<string, string> = {
  'model.tool_call_required': '模型未按工具流程工作、始终直出纯文本，未产生正文。可点 ⟳ 重试；反复出现请换支持函数调用的模型，或在设置把协议切为「文本协议」。',
  'agent.max_tool_rounds_exceeded': '工具轮次预算耗尽仍未收尾。可在 设置→Agent 模式 调高轮数上限，或收紧提示词让模型尽快 commit。',
  'agent.tool_after_finish': '模型在 finish 收尾后仍试图调用工具（违约）。建议降低温度或更换更听话的模型后 ⟳ 重试。',
  'agent.no_api': 'Agent 正文模式未配置 API：请在 设置→正文生成→Agent 模式 里配置独立接口，或开启「复用正文 API」。',
  'agent.model_error': '模型请求失败（所有接口均不可用）。',
};
