/* Agent 正文模式 · 循环运行时（行为规范照抄 TauriTavern，见 docs/AGENT_MODE_PLAN.md §4）
   - 非流式语义：每轮一次模型调用（传输层仍 stream:true 防「假流式」中转 204，SSE 累积后整轮处理）
   - round 1..=maxRounds；drift 纠偏共享轮数预算（无独立重试预算）
   - 软/硬错误分界：仅「未知工具」「finish 后还有调用」致命；其余一律 is_error 回喂
   - 前台 commit 闸门：无 commit 的 finish 降级为软错误
   - 任何致命错误时 commit 台账非空 → partial（保留成稿）；为空 → failed
   - 协议 auto：原生 FC 报错像「不支持 tools」→ 本 run 切文本协议重试当轮 */
import { fetchWithProxy } from '../apiChat';
import { apiDebugLog } from '../apiDebugLog';
import { resolveApiChain } from '../../store/settingsStore';
import type { ApiConfig } from '../../store/settingsStore';
import { useAgentRun } from '../../store/agentRunStore';
import { useAgentSkills, type SubAgentDef } from '../../store/agentSkillStore';
import { AgentWorkspace, DIRECT_OUTPUT_PATH } from './agentWorkspace';
import { buildAgentTools, listCallableSubagents } from './agentTools';
import {
  buildAgentSystemPrompt, buildDriftNudge, buildGuidanceMessage, budgetExhaustedMsg, perToolCapMsg,
  buildSubAgentSystemPrompt, buildSubAgentDriftNudge, renderTaskBrief,
} from './agentPrompt';
import {
  decodeNativeCalls, decodeTextProtocol, encodeAssistantTurn, encodeToolDefs, encodeToolResults,
  extractNarrativePreview, looksLikeToolsUnsupported, mergeToolCallDelta, rawCallsFromMessage, stripThinkBlocks,
} from './agentProtocol';
import { getPrompt } from '../../store/promptOverrideStore';
import { AGENT_REVIEWER_RULE } from '../../promptRules';
import type { AgentProtocol } from './agentProtocol';
import type {
  AgentModelTurn, AgentMsg, AgentNarrativeSettings, AgentRunInputs, AgentRunResult,
  AgentToolCall, AgentToolResult, RawToolCallOut,
} from './agentTypes';

/** 传输：onProgress（P2·可选）在 SSE 每个分片后回调「已累积的 content + tool_calls 参数流」，供末轮流式预览 */
export type AgentTransport = (
  body: Record<string, unknown>, api: ApiConfig, signal: AbortSignal,
  onProgress?: (st: { content: string; calls: RawToolCallOut[] }) => void,
) => Promise<AgentModelTurn>;

export interface RunAgentParams {
  baseMessages: AgentMsg[];
  chain: ApiConfig[];
  signal: AbortSignal;
  inputs: AgentRunInputs;
  settings: AgentNarrativeSettings;
  /** 每次成功 commit：rawCommitted=当前累计成稿原文（宿主据此建/改楼层） */
  onCommit?: (rawCommitted: string, seq: number) => void;
  /** P2·末轮流式预览：模型正在写 output/main.md 时渐进回调草稿（display 专用；commit 后宿主应忽略） */
  onPreview?: (draft: string) => void;
  /** P2·评稿子代理接口链（reviewerEnabled 时传入；finish 拦截时用它调评稿人） */
  reviewChain?: ApiConfig[];
  /** 预设采样参数（Agent 预设/正文预设的 temperature 等；preset 优先、接口配置兜底——与 legacy reqBody 同口径） */
  sampling?: { temperature?: number; top_p?: number; max_tokens?: number; frequency_penalty?: number; presence_penalty?: number; seed?: number };
  /** 本回合实际生效的预设名（宿主传入：Agent 专属预设名，或「跟随」时的当前正文预设名）——
      技能包/子代理/作者指令的**作用域锚点**。缺省回退 settings.presetName（仅显式选择时非空，
      「跟随正文预设」会漏配 → 修 Discord 反馈「预设专属 skill 没生效」）。 */
  presetName?: string;
  /** 测试注入：替代真实 HTTP */
  transport?: AgentTransport;
}

const IDLE_MS = 120000;      // 单轮空闲超时（流没动静）
const HARD_MS = 420000;      // 单轮绝对上限

/* ── 默认传输：POST /chat/completions（stream:true），SSE/一次性 JSON 双兼容，收集 content + tool_calls 增量 + reasoning ── */
const httpTransport: AgentTransport = async (body, api, signal, onProgress) => {
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  if (signal.aborted) ctrl.abort();
  signal.addEventListener('abort', onOuter);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const bump = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => ctrl.abort(), IDLE_MS); };
  const hardTimer = setTimeout(() => ctrl.abort(), HARD_MS);
  const cleanup = () => { if (idleTimer) clearTimeout(idleTimer); clearTimeout(hardTimer); signal.removeEventListener('abort', onOuter); };
  bump();
  try {
    const res = await fetchWithProxy(api.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${errBody ? ' · ' + errBody.replace(/\s+/g, ' ').slice(0, 300) : ''}`);
    }
    bump();
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const finish = (content: string, reasoning: string, raw: RawToolCallOut[]): AgentModelTurn =>
      ({ content, reasoning: reasoning || undefined, toolCallsRaw: raw.filter((c) => c.name) });

    if (ctype.includes('application/json')) {
      const data = JSON.parse(await res.text());
      const msg = data?.choices?.[0]?.message ?? {};
      return finish(String(msg.content ?? ''), String(msg.reasoning_content ?? msg.reasoning ?? ''), rawCallsFromMessage(msg));
    }
    // SSE（或忽略 content-type 的流）：逐行累积
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let content = ''; let reasoning = '';
    const callAcc = new Map<number, RawToolCallOut>();
    let sawData = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          sawData = true;
          const choice = json.choices?.[0] ?? {};
          const delta = choice.delta ?? choice.message ?? {};
          if (typeof delta.content === 'string') content += delta.content;
          if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
          else if (typeof delta.reasoning === 'string') reasoning += delta.reasoning;
          if (delta.tool_calls) mergeToolCallDelta(callAcc, delta.tool_calls);
          else if (choice.message?.tool_calls) for (const c of rawCallsFromMessage(choice.message)) callAcc.set(callAcc.size, c);
        } catch { /* 忽略坏行 */ }
      }
      try { onProgress?.({ content, calls: [...callAcc.values()] }); } catch { /* 预览回调失败不影响读流 */ }
    }
    // 整包其实是一次性 JSON（没有 data: 行）
    if (!sawData && buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        const msg = data?.choices?.[0]?.message ?? {};
        return finish(String(msg.content ?? ''), String(msg.reasoning_content ?? msg.reasoning ?? ''), rawCallsFromMessage(msg));
      } catch { /* 落到空返回校验 */ }
    }
    return finish(content, reasoning, [...callAcc.values()]);
  } finally { cleanup(); }
};

function softError(code: string, message: string): AgentToolResult {
  return { ok: false, content: message, structured: { error: { code, message } }, errorCode: code };
}

/* ── P3·子代理委派（同步）：把自包含小任务交给独立的子 Agent 循环——
   自己的系统提示词（作者人设+子代理铁则）+ 任务书，自己的接口链（agentSub-<id> 路由→回退主链），
   共享父运行的虚拟工作区（可读 output/main.md、写 scratch/ 笔记），以 task_return 收尾。
   宽容小模型：未知工具软回喂；第 2 次直出纯文本降级把文本当 summary 收下（TT 是 fatal，我们保结果）。 */
function formatSubReturn(def: { name: string }, ret: Record<string, unknown>, degraded: boolean): AgentToolResult {
  const li = (k: string, label: string) => Array.isArray(ret[k]) && (ret[k] as unknown[]).length
    ? `\n【${label}】\n${(ret[k] as unknown[]).map((x) => `- ${String(x)}`).join('\n')}` : '';
  let content = `### 子Agent「${def.name}」返回（${ret.status === 'failed' ? 'failed' : 'completed'}${ret.confidence ? `·置信 ${String(ret.confidence)}` : ''}${degraded ? '·降级收取' : ''}）\n${String(ret.summary ?? '').trim()}`
    + li('findings', '发现') + li('warnings', '警告') + li('suggestedNextActions', '建议下一步') + li('questionsForCaller', '反问');
  if (content.length > 4000) content = content.slice(0, 4000) + '\n…(截断)';
  return { ok: true, content, structured: ret };
}

async function runDelegatedSubagent(o: {
  def: SubAgentDef; task: Record<string, unknown>;
  ws: AgentWorkspace; inputs: AgentRunInputs; presetName: string;
  chain: ApiConfig[]; transport: AgentTransport; signal: AbortSignal; protocol: AgentProtocol;
}): Promise<AgentToolResult> {
  const childTools = buildAgentTools(
    { ws: o.ws, inputs: o.inputs, presetName: o.presetName, skillFilter: { visible: o.def.skillsVisible, deny: o.def.skillsDeny }, skillBudget: { used: 0 }, forSubagent: true },
    {},
  );
  const messages: AgentMsg[] = [
    { role: 'system', content: buildSubAgentSystemPrompt(o.def, childTools, o.protocol) },
    { role: 'user', content: renderTaskBrief(o.task) },
  ];
  const maxRounds = Math.max(1, Math.min(12, o.def.maxRounds ?? 8));
  let drift = 0;
  for (let round = 1; round <= maxRounds; round++) {
    if (o.signal.aborted) return softError('agent.delegate_cancelled', '运行已被取消');
    let turn: AgentModelTurn | null = null;
    let lastErr: unknown;
    for (const api of o.chain) {
      if (!api?.baseUrl || !api?.apiKey) continue;
      const body: Record<string, unknown> = { model: api.modelId, messages, stream: true };
      if (api.temperature != null && isFinite(api.temperature) && api.temperature > 0) body.temperature = api.temperature;
      if (api.maxTokens != null && api.maxTokens > 0) body.max_tokens = api.maxTokens;
      if (o.protocol === 'native') { body.tools = encodeToolDefs(childTools); body.tool_choice = 'auto'; }
      const logId = apiDebugLog.push(`🧩子Agent·${o.def.name}·R${round}`, messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '[multimodal]' })));
      try {
        turn = await o.transport(body, api, o.signal);
        apiDebugLog.finish(logId, `${turn.content || ''}${turn.toolCallsRaw.length ? `\n[tool_calls] ${JSON.stringify(turn.toolCallsRaw)}` : ''}`, true);
        break;
      } catch (e) {
        lastErr = e;
        apiDebugLog.finish(logId, String((e as Error)?.message ?? e), false, String((e as Error)?.message ?? e));
        if (o.signal.aborted) return softError('agent.delegate_cancelled', '运行已被取消');
      }
    }
    if (!turn) return softError('agent.delegate_failed', `子Agent「${o.def.name}」模型调用失败：${String((lastErr as Error)?.message ?? lastErr ?? '全部接口失败')}`);
    let calls: AgentToolCall[];
    let narration: string;
    let roundMode: AgentProtocol = o.protocol;
    if (o.protocol === 'native' && turn.toolCallsRaw.length > 0) {
      calls = decodeNativeCalls(turn.toolCallsRaw, childTools);
      narration = stripThinkBlocks(turn.content || '').trim();
    } else {
      const parsed = decodeTextProtocol(turn.content || '', childTools);
      calls = parsed.calls; narration = parsed.narration;
      if (o.protocol === 'native' && calls.length > 0) roundMode = 'text';
    }
    if (calls.length === 0) {
      drift++;
      if (drift >= 2 || round >= maxRounds) {
        return formatSubReturn(o.def, { summary: narration.trim() || '（子Agent 未给出内容）', status: narration.trim() ? 'completed' : 'failed' }, true);
      }
      messages.push(encodeAssistantTurn(roundMode, stripThinkBlocks(turn.content || ''), []));
      messages.push({ role: 'user', content: buildSubAgentDriftNudge() });
      continue;
    }
    const pairs: { call: AgentToolCall; result: AgentToolResult }[] = [];
    for (const call of calls) {
      if (o.signal.aborted) return softError('agent.delegate_cancelled', '运行已被取消');
      let result: AgentToolResult;
      if (call.unknown) result = softError('agent.tool_policy_denied', `子Agent 没有工具「${call.modelName}」——可用工具见系统提示`);
      else {
        try { result = await childTools.find((t) => t.name === call.name)!.run(call.args); }
        catch (e) { result = softError('tool.execution_error', `工具执行异常：${String((e as Error)?.message ?? e)}`); }
      }
      if (result.ok && result.effect === 'finish') return formatSubReturn(o.def, (result.structured ?? {}) as Record<string, unknown>, false);
      pairs.push({ call, result });
    }
    messages.push(encodeAssistantTurn(roundMode, roundMode === 'text' ? (turn.content || '') : narration, calls));
    messages.push(...encodeToolResults(roundMode, pairs));
  }
  return formatSubReturn(o.def, { summary: '子Agent 超出轮次预算未正式返回', status: 'failed' }, true);
}

/* ── P2·评稿子代理：对成稿做一次独立审阅（一次性调用·沿链 fallback）。
   返回评语文本；全链失败/中止返回 null（调用方按 best-effort 跳过）。 */
async function runReviewerOnce(chain: ApiConfig[], transport: AgentTransport, signal: AbortSignal, draft: string, userText: string): Promise<string | null> {
  const messages = [
    { role: 'system', content: getPrompt('AGENT_REVIEWER_RULE', AGENT_REVIEWER_RULE) },
    { role: 'user', content: `【玩家本回合输入】\n${userText.slice(0, 4000)}\n\n【待评成稿（全文）】\n${draft.slice(0, 60000)}` },
  ];
  for (const api of chain) {
    if (!api?.baseUrl || !api?.apiKey) continue;
    const body: Record<string, unknown> = { model: api.modelId, messages, stream: true };
    if (api.temperature != null && isFinite(api.temperature) && api.temperature > 0) body.temperature = api.temperature;
    if (api.maxTokens != null && api.maxTokens > 0) body.max_tokens = api.maxTokens;
    const logId = apiDebugLog.push('🧐Agent·评稿', messages);
    try {
      const t = await transport(body, api, signal);
      const txt = stripThinkBlocks(t.content || '').trim();
      apiDebugLog.finish(logId, txt || '（空响应）', !!txt);
      if (txt) return txt;
    } catch (e) {
      apiDebugLog.finish(logId, String((e as Error)?.message ?? e), false, String((e as Error)?.message ?? e));
      if (signal.aborted) return null;
    }
  }
  return null;
}

/** 运行一次 Agent 正文生成。resolve 四种终态，不 reject（内部错误也归为 failed）。 */
export async function runAgentNarrative(p: RunAgentParams): Promise<AgentRunResult> {
  const { settings, inputs, signal } = p;
  const transport = p.transport ?? httpTransport;
  const ws = new AgentWorkspace();
  // persist/ 跨回合记忆（P1）：把上次 run promote 的文件种进本次工作区（模型可读改；completed 后再 promote 回去）
  try {
    for (const [path, txt] of Object.entries(useAgentRun.getState().persistFiles ?? {})) {
      if (path.startsWith('persist/') && typeof txt === 'string') ws.files.set(path, txt);
    }
  } catch { /* 种子失败不阻断运行 */ }
  const presetName = (p.presetName ?? settings.presetName ?? '').trim();   // 实际生效预设名优先（跟随正文预设时也能命中预设专属资产）
  const tools = buildAgentTools({ ws, inputs, presetName, skillBudget: { used: 0 } }, settings.toolToggles ?? {});
  let protocol: AgentProtocol = settings.protocol === 'text' ? 'text' : 'native';
  // 预设作者的工作流指引（TT 内嵌主档案 instructions·P3）：仅选中该 Agent 预设时追加
  let writerNotes: string | undefined;
  try { writerNotes = presetName ? useAgentSkills.getState().writerNotes[presetName] : undefined; } catch { /* */ }

  // Agent 系统提示词：注入在「最后一条 user（本回合输入）」之前 = 最深处（协议切换时原地换内容）
  const trimN = settings.initialHistoryMsgs != null && settings.initialHistoryMsgs >= 0 ? Math.floor(settings.initialHistoryMsgs) : undefined;   // 初始历史被裁 → 提示词注明（让模型主动 chat_search 补课）
  const sysMsg: AgentMsg = { role: 'system', content: buildAgentSystemPrompt(tools, protocol, writerNotes, trimN) };
  const messages: AgentMsg[] = [...p.baseMessages];
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break; }
  messages.splice(lastUser >= 0 ? lastUser : messages.length, 0, sysMsg);

  const J = useAgentRun.getState();
  try { J.startRun(); } catch { /* journal 失败不阻断运行 */ }
  let evId = 0;
  const emit = (round: number, type: string, label: string, tone: 'info' | 'active' | 'success' | 'warn' | 'error', detail?: string) => {
    try { useAgentRun.getState().pushEvent({ id: ++evId, t: Date.now(), round, type, label, tone, detail }); } catch { /* */ }
  };

  let rawCommitted = '';
  let commits = 0;
  let toolCallsUsed = 0;
  let driftAttempts = 0;
  let reviewsDone = 0;        // P2·评稿轮数（达到 reviewerPasses 后 finish 直接放行）
  let delegationsUsed = 0;    // P3·子代理委派计数（run 级预算）
  const perSubUsed: Record<string, number> = {};
  const MAX_DELEGATIONS_PER_RUN = 4;
  let previewLen = 0;         // P2·流式预览：每轮内只增不减（防参数流抖动回退闪屏）
  let lastPreviewAt = 0;
  const perToolUsed: Record<string, number> = {};   // P1·单工具计数（maxCallsPerTool）
  const maxRounds = Math.max(1, Math.min(80, Math.floor(settings.maxRounds) || 16));
  const maxCalls = Math.max(1, Math.floor(settings.maxToolCalls) || 40);

  /* persist/ promote（P1·仅 completed）：把本次 run 工作区里的 persist/* 整体回写 store（带体量上限防爆 localStorage） */
  const PERSIST_FILE_CAP = 24000, PERSIST_TOTAL_CAP = 96000;
  const promotePersist = () => {
    try {
      const files: Record<string, string> = {};
      let total = 0; let skipped = 0;
      for (const [path, txt] of ws.files) {
        if (!path.startsWith('persist/')) continue;
        const t = txt.slice(0, PERSIST_FILE_CAP);
        if (total + t.length > PERSIST_TOTAL_CAP) { skipped++; continue; }
        files[path] = t; total += t.length;
      }
      const prev = useAgentRun.getState().persistFiles ?? {};
      if (JSON.stringify(prev) !== JSON.stringify(files)) {
        useAgentRun.getState().setPersistFiles(files);
        emit(roundNow, 'persist', `💾 已持久化跨回合记忆（persist/ ${Object.keys(files).length} 个文件${skipped ? `·${skipped} 个超预算被跳过` : ''}）`, 'success');
      }
    } catch (e) { console.warn('[Agent] persist promote 失败', e); }
  };

  const end = (status: AgentRunResult['status'], errorCode?: string, errorMessage?: string): AgentRunResult => {
    try { useAgentRun.getState().endRun(status, errorCode); } catch { /* */ }
    return { status, narrative: rawCommitted, errorCode, errorMessage, rounds: Math.min(roundNow, maxRounds), toolCalls: toolCallsUsed, commits, protocolUsed: protocol };
  };
  /** 致命错误：有 commit → partial（保留成稿·照抄 TauriTavern commit-ledger 判据）；无 → failed */
  const fatal = (code: string, message: string): AgentRunResult => {
    emit(roundNow, 'fatal', commits > 0 ? '已保留成稿（运行未干净结束）' : '运行失败', commits > 0 ? 'warn' : 'error', `${code}: ${message}`);
    return commits > 0 ? end('partial', code, message) : end('failed', code, message);
  };

  let roundNow = 0;
  try {
    for (let round = 1; round <= maxRounds; round++) {
      roundNow = round;
      if (signal.aborted) return end('cancelled');

      /* ── P1·运行中「用户指引」：每轮开头 drain 待注入队列 → 单条 user 消息（照抄 TauriTavern 时机）── */
      try {
        const guidance = useAgentRun.getState().drainGuidance();
        if (guidance.length) {
          messages.push({ role: 'user', content: buildGuidanceMessage(guidance) });
          emit(round, 'guidance', `📨 已注入玩家中途指引（${guidance.length} 条）`, 'active', guidance[0].replace(/\s+/g, ' ').slice(0, 60));
        }
      } catch { /* 指引失败不阻断 */ }

      /* ── 模型调用（沿 chain fallback；auto 协议遇「不支持 tools」切文本重试同端点）── */
      let turn: AgentModelTurn | null = null;
      let lastErr: unknown;
      let apiUsed: ApiConfig | null = null;   // 本轮实际成功的接口（时间线展示 modelId——治「正文到底哪个接口生成的」困惑）
      emit(round, 'model_request', `第 ${round} 轮 · 调用模型…`, 'active', protocol === 'text' ? '文本协议' : undefined);
      /* P2·末轮流式预览：模型开写 output/main.md 时渐进抽 content 字段回调宿主（120ms 节流·display 专用） */
      previewLen = 0;
      let streamNotified = false;
      const onProg = p.onPreview ? (st: { content: string; calls: RawToolCallOut[] }) => {
        const now = Date.now();
        if (now - lastPreviewAt < 120) return;
        const draft = extractNarrativePreview(st.content, st.calls);
        if (!draft || draft.length <= previewLen) return;
        lastPreviewAt = now; previewLen = draft.length;
        if (!streamNotified) { streamNotified = true; emit(round, 'stream', '✍️ 正文起笔（草稿流式预览）…', 'active'); }
        try { p.onPreview!(draft); } catch { /* 预览失败不影响运行 */ }
      } : undefined;
      for (const api of p.chain) {
        if (!api?.baseUrl || !api?.apiKey) continue;
        for (let attempt = 0; attempt < 2; attempt++) {   // 第 2 次仅用于协议降级重试
          const body: Record<string, unknown> = { model: api.modelId, messages, stream: true };
          const sp = p.sampling ?? {};
          const _t = sp.temperature ?? ((api.temperature != null && isFinite(api.temperature) && api.temperature > 0) ? api.temperature : undefined);
          if (_t != null) body.temperature = _t;
          const _mt = sp.max_tokens ?? ((api.maxTokens != null && api.maxTokens > 0) ? api.maxTokens : undefined);
          if (_mt != null) body.max_tokens = _mt;
          if (sp.top_p != null) body.top_p = sp.top_p;
          if (sp.frequency_penalty) body.frequency_penalty = sp.frequency_penalty;
          if (sp.presence_penalty) body.presence_penalty = sp.presence_penalty;
          if (sp.seed != null && sp.seed !== -1) body.seed = sp.seed;
          if (protocol === 'native') { body.tools = encodeToolDefs(tools); body.tool_choice = 'auto'; }
          const logId = apiDebugLog.push(`🤖Agent·第${round}轮`, messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '[multimodal]' })));
          try {
            turn = await transport(body, api, signal, onProg);
            apiUsed = api;
            apiDebugLog.finish(logId, `${turn.content || ''}${turn.toolCallsRaw.length ? `\n[tool_calls] ${JSON.stringify(turn.toolCallsRaw)}` : ''}`, true);
            break;
          } catch (e) {
            lastErr = e;
            apiDebugLog.finish(logId, String((e as Error)?.message ?? e), false, String((e as Error)?.message ?? e));
            if (signal.aborted) return end('cancelled');
            const msg = String((e as Error)?.message ?? '');
            if (attempt === 0 && protocol === 'native' && settings.protocol === 'auto' && looksLikeToolsUnsupported(msg)) {
              protocol = 'text';
              sysMsg.content = buildAgentSystemPrompt(tools, protocol, writerNotes, trimN);
              emit(round, 'protocol_switch', '端点疑似不支持函数调用 → 切换文本协议', 'warn', msg.slice(0, 120));
              continue;   // 同端点用文本协议再试一次
            }
            break;   // 换下一条接口
          }
        }
        if (turn) break;
      }
      if (!turn) return fatal('agent.model_error', String((lastErr as Error)?.message ?? lastErr ?? '全部接口调用失败'));
      if (signal.aborted) return end('cancelled');

      /* ── 解析本轮调用 ── */
      let calls: AgentToolCall[];
      let narration: string;
      let roundMode: AgentProtocol = protocol;
      if (protocol === 'native' && turn.toolCallsRaw.length > 0) {
        calls = decodeNativeCalls(turn.toolCallsRaw, tools);
        narration = stripThinkBlocks(turn.content || '').trim();
      } else {
        const parsed = decodeTextProtocol(turn.content || '', tools);   // native 下模型仍可能吐标签 → 兜底也解析
        calls = parsed.calls;
        narration = parsed.narration;
        if (protocol === 'native' && calls.length > 0) roundMode = 'text';   // 本轮按文本协议回喂（无 tool_call_id 可配）
      }
      emit(round, 'model_completed', `第 ${round} 轮 · ${calls.length ? `${calls.length} 个工具调用` : '无工具调用'}`, calls.length ? 'info' : 'warn',
        `${apiUsed?.modelId ? `[${apiUsed.modelId}] ` : ''}${narration ? narration.replace(/\s+/g, ' ').slice(0, 80) : ''}`.trim() || undefined);

      /* ── drift：整轮没有任何工具调用 ── */
      if (calls.length === 0) {
        if (narration.trim()) {
          ws.files.set(DIRECT_OUTPUT_PATH, narration.trim());
          emit(round, 'drift_capture', `已把直出文本存为 ${DIRECT_OUTPUT_PATH}`, 'warn', `${narration.length} 字`);
        }
        if (round >= maxRounds) return fatal('model.tool_call_required', 'model must use Agent tools and complete through workspace_finish');
        driftAttempts++;
        emit(round, 'drift', `纠偏（第 ${driftAttempts} 次）：模型直出纯文本，已提醒改走工具流程`, 'warn');
        messages.push(encodeAssistantTurn(roundMode, stripThinkBlocks(turn.content || ''), []));
        messages.push({ role: 'user', content: buildDriftNudge(driftAttempts, commits, !!narration.trim(), protocol) });
        continue;
      }

      /* ── 顺序执行工具调用 ── */
      const pairs: { call: AgentToolCall; result: AgentToolResult }[] = [];
      let finished = false;
      for (const call of calls) {
        if (finished) return fatal('agent.tool_after_finish', `model requested additional tools after workspace_finish (${call.modelName})`);
        if (call.unknown) return fatal('model.unknown_tool_call', `model requested unknown Agent tool \`${call.modelName}\``);
        if (signal.aborted) return end('cancelled');
        let result: AgentToolResult;
        const perToolCap = settings.maxCallsPerTool?.[call.modelName];
        if (toolCallsUsed >= maxCalls) {
          result = softError('agent.tool_budget_exhausted', budgetExhaustedMsg(maxCalls));
        } else if (perToolCap != null && perToolCap > 0 && (perToolUsed[call.modelName] ?? 0) >= perToolCap) {
          result = softError('agent.tool_budget_exhausted', perToolCapMsg(call.modelName, perToolCap));   // P1·单工具上限（软错误，不执行不计数）
        } else {
          toolCallsUsed++;
          perToolUsed[call.modelName] = (perToolUsed[call.modelName] ?? 0) + 1;
          if (call.name === 'agent.delegate') {
            /* P3·委派由运行时接管（需要模型调用能力，工具层只挂 spec）：同步跑子代理循环、结果直接作为本工具结果 */
            const dArgs = call.args ?? {};
            const id = String((dArgs as Record<string, unknown>).agentId ?? '').trim();
            const task = (dArgs as Record<string, unknown>).task;
            const taskObj = task && typeof task === 'object' ? task as Record<string, unknown> : {};
            const subs = listCallableSubagents(presetName);
            const def = subs.find((d) => d.id === id) ?? subs.find((d) => d.name === id);
            if (!def) result = softError('agent.delegate_target_not_found', `没有可委派的子 Agent「${id}」（用 agent_list 查看清单）`);
            else if (!String(taskObj.objective ?? '').trim()) result = softError('tool.invalid_arguments', 'task.objective 必填：说清要完成什么');
            else if (delegationsUsed >= MAX_DELEGATIONS_PER_RUN) result = softError('agent.delegation_budget_exhausted', `本次运行的委派预算（${MAX_DELEGATIONS_PER_RUN} 次）已用尽，请用已有结果完成正文`);
            else if ((perSubUsed[def.id] ?? 0) >= Math.max(1, def.maxInvocationsPerRun ?? 2)) result = softError('agent.delegation_budget_exhausted', `对「${def.name}」的委派已达上限（${Math.max(1, def.maxInvocationsPerRun ?? 2)} 次/运行）`);
            else {
              delegationsUsed++;
              perSubUsed[def.id] = (perSubUsed[def.id] ?? 0) + 1;
              emit(round, 'delegate', `🧩 委派子Agent「${def.name}」…`, 'active', String(taskObj.objective ?? '').replace(/\s+/g, ' ').slice(0, 60));
              const t0 = Date.now();
              const subChain = resolveApiChain(`agentSub-${def.id}`, p.chain[0]);   // 子代理独立路由（未配则回退 Agent 主接口第一条）
              result = await runDelegatedSubagent({ def, task: taskObj, ws, inputs, presetName, chain: subChain, transport, signal, protocol });
              emit(round, result.ok ? 'delegate_done' : 'delegate_fail',
                `${result.ok ? '🧩✓ 子Agent「' + def.name + '」返回' : '🧩⚠ 子Agent「' + def.name + '」失败'}（${Math.round((Date.now() - t0) / 1000)}s）`,
                result.ok ? 'success' : 'warn', result.content.replace(/\s+/g, ' ').slice(0, 90));
            }
          } else {
            try { result = await tools.find((t) => t.name === call.name)!.run(call.args); }
            catch (e) { result = softError('tool.execution_error', `工具执行异常：${String((e as Error)?.message ?? e)}`); }
          }
        }
        /* commit / finish 副作用 */
        if (result.ok && result.effect === 'commit' && result.commit) {
          const { mode, text } = result.commit;
          rawCommitted = mode === 'append' && rawCommitted ? `${rawCommitted.replace(/\s+$/, '')}\n\n${text}` : text;
          commits++;
          try { p.onCommit?.(rawCommitted, commits); } catch (e) { console.warn('[Agent] onCommit 落楼层失败', e); }
          emit(round, 'commit', `📤 已提交楼层（第 ${commits} 次${mode === 'append' ? '·追加' : ''}）`, 'success', `${result.commit.path} · ${text.length} 字`);
        } else if (result.ok && result.effect === 'finish') {
          if (commits === 0) {
            result = softError('agent.foreground_commit_required', 'Foreground Agent runs must call workspace_commit successfully before workspace_finish.（必须先成功 workspace_commit 一次，玩家才能看到正文）');
          } else if (settings.reviewerEnabled && (p.reviewChain?.length ?? 0) > 0 && reviewsDone < Math.max(1, Math.min(3, Math.floor(settings.reviewerPasses ?? 1) || 1))) {
            /* P2·评稿子代理：finish 拦截 → 独立评稿人审成稿。PASS 放行；REVISE 把意见作软错误回喂逼修订；评稿失败 best-effort 放行 */
            emit(round, 'review', '🧐 评稿人审阅成稿中…', 'active');
            const fb = await runReviewerOnce(p.reviewChain!, transport, signal, rawCommitted, inputs.userText);
            if (signal.aborted) return end('cancelled');
            if (fb == null) {
              emit(round, 'review_skip', '⚠ 评稿调用失败，跳过审阅直接收尾', 'warn');
              finished = true;
            } else if (/^\s*(PASS|通过)/i.test(fb)) {
              emit(round, 'review_pass', '✅ 评稿通过', 'success', fb.replace(/^\s*(PASS|通过)[:：]?\s*/i, '').replace(/\s+/g, ' ').slice(0, 80));
              finished = true;
            } else {
              reviewsDone++;
              const tips = fb.replace(/^\s*(REVISE|修订)[:：]?\s*/i, '').trim();
              emit(round, 'review_revise', `📝 评稿要求修订（第 ${reviewsDone} 轮）`, 'warn', tips.replace(/\s+/g, ' ').slice(0, 90));
              result = softError('agent.review_revision_requested',
                `评稿人意见（第 ${reviewsDone} 轮·请据此修订成稿）：\n${tips}\n\n请修改 output/main.md（workspace_apply_patch 精确改，或 workspace_read_file 后整写），然后再次 workspace_commit 发布修订版，最后 workspace_finish 收尾。`);
            }
          } else finished = true;
        } else {
          const tone = result.ok ? 'success' : 'warn';
          emit(round, result.ok ? 'tool_ok' : 'tool_err', `${result.ok ? '✓' : '⚠'} ${call.modelName}`, tone,
            (result.ok ? result.content : `${result.errorCode ?? 'error'} · ${result.content}`).replace(/\s+/g, ' ').slice(0, 90));
        }
        try { useAgentRun.getState().patchActive({ toolCalls: toolCallsUsed, commits }); } catch { /* */ }
        pairs.push({ call, result });
      }
      if (finished) {
        promotePersist();   // P1·仅干净收尾才保存 persist/ 改动（对齐 TauriTavern commit=OnRunCompleted）
        emit(round, 'finish', '✅ 运行完成', 'success', `${commits} 次提交 · ${toolCallsUsed} 次工具调用`);
        return end('completed');
      }
      messages.push(encodeAssistantTurn(roundMode, roundMode === 'text' ? (turn.content || '') : narration, calls));
      messages.push(...encodeToolResults(roundMode, pairs));
    }
    /* 跑满轮数未 finish */
    return fatal('agent.max_tool_rounds_exceeded', `workspace_finish was not called within ${maxRounds} rounds`);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || signal.aborted) return end('cancelled');
    return fatal('agent.internal_error', String((e as Error)?.message ?? e));
  }
}
