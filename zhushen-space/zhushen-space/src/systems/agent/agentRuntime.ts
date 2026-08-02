/* Agent 正文模式 · 循环运行时（行为规范照抄 TauriTavern，见 docs/AGENT_MODE_PLAN.md §4）
   - 非流式语义：每轮一次模型调用（传输层仍 stream:true 防「假流式」中转 204，SSE 累积后整轮处理）
   - round 1..=maxRounds；drift 纠偏共享轮数预算（无独立重试预算）
   - 软/硬错误分界：仅「未知工具」「finish 后还有调用」致命；其余一律 is_error 回喂
   - 前台 commit 闸门：无 commit 的 finish 降级为软错误
   - 任何致命错误时 commit 台账非空 → partial（保留成稿）；为空 → failed
   - 协议 auto：原生 FC 报错像「不支持 tools」→ 本 run 切文本协议重试当轮 */
import { fetchWithProxy } from '../apiChat';
import { apiDebugLog } from '../apiDebugLog';
import type { ApiConfig } from '../../store/settingsStore';
import { useAgentRun } from '../../store/agentRunStore';
import { AgentWorkspace, DIRECT_OUTPUT_PATH } from './agentWorkspace';
import { buildAgentTools } from './agentTools';
import { buildAgentSystemPrompt, buildDriftNudge, buildGuidanceMessage, budgetExhaustedMsg, perToolCapMsg } from './agentPrompt';
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
  const tools = buildAgentTools({ ws, inputs }, settings.toolToggles ?? {});
  let protocol: AgentProtocol = settings.protocol === 'text' ? 'text' : 'native';

  // Agent 系统提示词：注入在「最后一条 user（本回合输入）」之前 = 最深处（协议切换时原地换内容）
  const sysMsg: AgentMsg = { role: 'system', content: buildAgentSystemPrompt(tools, protocol) };
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
            apiDebugLog.finish(logId, `${turn.content || ''}${turn.toolCallsRaw.length ? `\n[tool_calls] ${JSON.stringify(turn.toolCallsRaw)}` : ''}`, true);
            break;
          } catch (e) {
            lastErr = e;
            apiDebugLog.finish(logId, String((e as Error)?.message ?? e), false, String((e as Error)?.message ?? e));
            if (signal.aborted) return end('cancelled');
            const msg = String((e as Error)?.message ?? '');
            if (attempt === 0 && protocol === 'native' && settings.protocol === 'auto' && looksLikeToolsUnsupported(msg)) {
              protocol = 'text';
              sysMsg.content = buildAgentSystemPrompt(tools, protocol);
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
        narration ? narration.replace(/\s+/g, ' ').slice(0, 80) : undefined);

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
          try { result = await tools.find((t) => t.name === call.name)!.run(call.args); }
          catch (e) { result = softError('tool.execution_error', `工具执行异常：${String((e as Error)?.message ?? e)}`); }
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
