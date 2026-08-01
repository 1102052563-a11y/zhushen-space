/* Agent 正文模式 · 工具调用协议编解码（双轨）
   - native：OpenAI function calling（照抄 TauriTavern 编码规范：tools=[{type:'function',...}]、
     tool_choice:'auto'、assistant.tool_calls[].function.arguments 为字符串化 JSON、
     role:'tool' 的 content 为 {ok,content,structured,errorCode,resourceRefs} 五字段 JSON 串）。
   - text：无 FC 端点的降级 —— 模型输出 <tool_call>{"name":…,"arguments":{…}}</tool_call> 标签，
     lenientJsonParse 宽容解析；工具结果以 role:'user' 的 <tool_result> 块回喂（无 FC 即无 role:tool）。
   纯函数（除 id 计数闭包），可单测。 */
import { lenientJsonParse } from '../stateParser';
import type { AgentMsg, AgentToolCall, AgentToolResult, AgentToolSpec, RawToolCallOut } from './agentTypes';

export type AgentProtocol = 'native' | 'text';

/* ── 请求编码 ── */

/** tools 数组（native 请求体用） */
export function encodeToolDefs(tools: AgentToolSpec[]): unknown[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.modelName, description: t.description, parameters: t.parameters } }));
}

/* ── SSE tool_calls 增量合并（native 流式）── */

/** OpenAI 流式 delta.tool_calls：[{index,id?,function:{name?,arguments?}}] 按 index 合并累积 */
export function mergeToolCallDelta(acc: Map<number, RawToolCallOut>, deltaToolCalls: unknown): void {
  if (!Array.isArray(deltaToolCalls)) return;
  for (const d of deltaToolCalls as Array<Record<string, any>>) {
    if (!d || typeof d !== 'object') continue;
    const idx = Number(d.index ?? acc.size);
    const cur = acc.get(idx) ?? { id: '', name: '', argsRaw: '' };
    if (typeof d.id === 'string' && d.id) cur.id = d.id;
    const fn = d.function;
    if (fn && typeof fn === 'object') {
      if (typeof fn.name === 'string' && fn.name) cur.name = fn.name;
      const a = fn.arguments ?? fn.args;
      if (typeof a === 'string') cur.argsRaw += a;
      else if (a && typeof a === 'object' && !cur.argsRaw) cur.argsRaw = JSON.stringify(a);
    }
    acc.set(idx, cur);
  }
}

/** 一次性 JSON 响应里的 message.tool_calls → RawToolCallOut[] */
export function rawCallsFromMessage(msg: Record<string, any> | undefined | null): RawToolCallOut[] {
  const tc = msg?.tool_calls;
  if (!Array.isArray(tc)) return [];
  return tc.map((c: Record<string, any>, i: number) => {
    const fn = c?.function ?? {};
    const a = fn.arguments ?? fn.args;
    return { id: String(c?.id || `call_${i}`), name: String(fn.name || ''), argsRaw: typeof a === 'string' ? a : a ? JSON.stringify(a) : '{}' };
  }).filter((c: RawToolCallOut) => c.name);
}

/* ── 解码：本轮响应 → AgentToolCall[] + narration ── */

let _autoId = 0;
/** 测试用：重置自动 id 计数 */
export function resetAutoCallId(): void { _autoId = 0; }

/** 剥 <think>…</think>（含未闭合的开头 think）——思考不参与工具解析/drift 判定 */
export function stripThinkBlocks(s: string): string {
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/^\s*<think>[\s\S]*$/gi, (m) => (m.includes('</think>') ? m : ''));   // 只有开标签没闭合：整段视为思考
  const idx = out.indexOf('</think>');
  if (idx >= 0 && !/<think>/i.test(out.slice(0, idx))) out = out.slice(idx + 8);          // 预填 <think> 被回显成孤儿闭标签
  return out;
}

/** native：RawToolCallOut[] → AgentToolCall[]（canonical 回写；参数 lenient 解析；容错缺 id） */
export function decodeNativeCalls(raw: RawToolCallOut[], tools: AgentToolSpec[]): AgentToolCall[] {
  return raw.map((c) => {
    const spec = tools.find((t) => t.modelName === c.name || t.name === c.name);
    let args: Record<string, unknown> = {};
    if (c.argsRaw && c.argsRaw.trim()) {
      try { const p = lenientJsonParse(c.argsRaw); if (p && typeof p === 'object') args = p as Record<string, unknown>; } catch { /* 保底空参 */ }
    }
    return {
      id: c.id || `call_auto_${++_autoId}`,
      name: spec?.name ?? c.name,
      modelName: spec?.modelName ?? c.name,
      args,
      unknown: !spec,
    };
  });
}

/** text：从文本抽取 <tool_call> 块 → 调用列表 + 块外文本（narration） */
export function decodeTextProtocol(content: string, tools: AgentToolSpec[]): { calls: AgentToolCall[]; narration: string } {
  const src = stripThinkBlocks(content || '');
  const calls: AgentToolCall[] = [];
  const re = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let narration = '';
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    narration += src.slice(last, m.index);
    last = m.index + m[0].length;
    try {
      const p = lenientJsonParse(m[1].trim());
      if (p && typeof p === 'object' && typeof (p as any).name === 'string') {
        const name = String((p as any).name).trim();
        const spec = tools.find((t) => t.modelName === name || t.name === name);
        const rawArgs = (p as any).arguments ?? (p as any).args ?? (p as any).params ?? {};
        calls.push({
          id: `call_auto_${++_autoId}`,
          name: spec?.name ?? name,
          modelName: spec?.modelName ?? name,
          args: rawArgs && typeof rawArgs === 'object' ? rawArgs as Record<string, unknown> : {},
          unknown: !spec,
        });
      }
    } catch { /* 解析失败的块当 narration 忽略（不致命，模型下轮还有机会） */ }
  }
  narration += src.slice(last);
  return { calls, narration: narration.trim() };
}

/* ── 回喂编码 ── */

/** assistant 回合（含调用）：native 带 tool_calls 数组；text 原样回放模型文本 */
export function encodeAssistantTurn(protocol: AgentProtocol, content: string, calls: AgentToolCall[]): AgentMsg {
  if (protocol === 'native') {
    return {
      role: 'assistant',
      content: content || '',
      ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.modelName, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
    };
  }
  return { role: 'assistant', content: content || '' };
}

/** 工具结果回喂：native → 每个结果一条 role:tool（五字段 JSON 串）；text → 合并为一条 role:user 的 <tool_result> 块 */
export function encodeToolResults(protocol: AgentProtocol, pairs: { call: AgentToolCall; result: AgentToolResult }[]): AgentMsg[] {
  if (protocol === 'native') {
    return pairs.map(({ call, result }) => ({
      role: 'tool',
      tool_call_id: call.id,
      name: call.modelName,
      content: JSON.stringify({ ok: result.ok, content: result.content, structured: result.structured ?? {}, errorCode: result.errorCode ?? null, resourceRefs: [] }),
    }));
  }
  const blocks = pairs.map(({ call, result }) =>
    `<tool_result name="${call.modelName}" ok="${result.ok}">\n${result.content}\n</tool_result>`);
  return [{ role: 'user', content: `${blocks.join('\n')}\n（以上是工具执行结果，属于你的工作上下文。请继续通过 <tool_call> 标签调用工具推进；不要把结果原文当成聊天内容复述。）` }];
}

/* ── P2 · 末轮流式预览：从「未完成的 JSON 参数流」里渐进抽取字符串字段 ──
   模型经 workspace_write_file 写正文时，arguments 以 SSE 分片到达——本函数容忍未闭合引号/
   悬空转义/不完整 \uXXXX（等下一分片），把已到达的 content 渐进反转义出来做显示专用预览。 */
export function extractJsonStringField(src: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(src);
  if (!m) return null;
  let out = '';
  let i = m.index + m[0].length;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const n = src[i + 1];
      if (n === undefined) break;                    // 悬空转义：等下一分片
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') { /* 丢弃 \r */ }
      else if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else if (n === '/') out += '/';
      else if (n === 'u') {
        const hex = src.slice(i + 2, i + 6);
        if (hex.length < 4) break;                   // 不完整 unicode：等下一分片
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
        i += 4;
      } else out += n;
      i += 2;
    } else if (ch === '"') break;                    // 字段闭合
    else { out += ch; i++; }
  }
  return out || null;
}

/** P2·从本轮进行中的响应（native 参数流 / 文本协议原文）抽「正文草稿预览」——只认写 output/main.md 的 write_file */
export function extractNarrativePreview(content: string, calls: RawToolCallOut[]): string | null {
  for (const c of calls) {
    if ((c.name === 'workspace_write_file' || !c.name) && c.argsRaw.includes('output/main.md')) {
      const t = extractJsonStringField(c.argsRaw, 'content');
      if (t) return t;
    }
  }
  if (content && content.includes('workspace_write_file') && content.includes('output/main.md')) {
    const start = content.lastIndexOf('workspace_write_file');
    const t = extractJsonStringField(content.slice(Math.max(0, start)), 'content');
    if (t) return t;
  }
  return null;
}

/** HTTP 错误是否像「端点不支持 tools」（auto 协议降级判据） */
export function looksLikeToolsUnsupported(errText: string): boolean {
  const t = (errText || '').toLowerCase();
  if (!/(tool|function)/.test(t)) return false;
  return /(unsupport|not support|invalid|unknown|unrecognized|无效|不支持|unexpected|no such|cannot|denied|400|422)/.test(t) || /tool_choice/.test(t);
}
