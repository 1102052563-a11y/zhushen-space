import { describe, it, expect, beforeEach } from 'vitest';
import {
  decodeNativeCalls, decodeTextProtocol, encodeAssistantTurn, encodeToolDefs, encodeToolResults,
  extractJsonStringField, extractNarrativePreview,
  looksLikeToolsUnsupported, mergeToolCallDelta, rawCallsFromMessage, resetAutoCallId, stripThinkBlocks,
} from './agentProtocol';
import type { AgentToolSpec, RawToolCallOut } from './agentTypes';

const T = (name: string, modelName: string): AgentToolSpec =>
  ({ name, modelName, description: '', parameters: { type: 'object' }, run: () => ({ ok: true, content: '' }) });
const TOOLS = [T('workspace.write_file', 'workspace_write_file'), T('workspace.commit', 'workspace_commit')];

beforeEach(() => resetAutoCallId());

describe('agentProtocol · native 解码', () => {
  it('canonical 回写 + lenient 参数 + 缺 id 自动补', () => {
    const calls = decodeNativeCalls([
      { id: 'c1', name: 'workspace_write_file', argsRaw: "{path:'output/main.md', content:'x',}" },   // 裸键/单引号/尾逗号
      { id: '', name: 'workspace_commit', argsRaw: '' },
      { id: 'c3', name: 'bogus_tool', argsRaw: '{}' },
    ], TOOLS);
    expect(calls[0].name).toBe('workspace.write_file');
    expect(calls[0].args).toEqual({ path: 'output/main.md', content: 'x' });
    expect(calls[1].id).toMatch(/^call_auto_/);
    expect(calls[1].name).toBe('workspace.commit');
    expect(calls[2].unknown).toBe(true);
  });
  it('SSE 增量合并：arguments 分片拼接、按 index 归组', () => {
    const acc = new Map<number, RawToolCallOut>();
    mergeToolCallDelta(acc, [{ index: 0, id: 'a', function: { name: 'workspace_commit' } }]);
    mergeToolCallDelta(acc, [{ index: 0, function: { arguments: '{"mo' } }]);
    mergeToolCallDelta(acc, [{ index: 0, function: { arguments: 'de":"append"}' } }]);
    mergeToolCallDelta(acc, [{ index: 1, id: 'b', function: { name: 'workspace_write_file', arguments: { path: 'x' } } }]);
    expect([...acc.values()]).toEqual([
      { id: 'a', name: 'workspace_commit', argsRaw: '{"mode":"append"}' },
      { id: 'b', name: 'workspace_write_file', argsRaw: '{"path":"x"}' },
    ]);
  });
  it('一次性 JSON message.tool_calls 解析', () => {
    const raw = rawCallsFromMessage({ tool_calls: [{ id: 'x', function: { name: 'workspace_commit', arguments: '{}' } }, { function: { arguments: '{}' } }] });
    expect(raw).toEqual([{ id: 'x', name: 'workspace_commit', argsRaw: '{}' }]);   // 无 name 的丢弃
  });
});

describe('agentProtocol · text 协议', () => {
  it('多块按序解析 + 块外文本为 narration + think 剥除', () => {
    const src = `<think>内心盘算</think>我先写正文。
<tool_call>{"name":"workspace_write_file","arguments":{"path":"output/main.md","content":"正文"}}</tool_call>
然后提交。
<tool_call>{name:'workspace_commit', arguments:{}}</tool_call>`;
    const { calls, narration } = decodeTextProtocol(src, TOOLS);
    expect(calls.map((c) => c.name)).toEqual(['workspace.write_file', 'workspace.commit']);
    expect(narration).toContain('我先写正文');
    expect(narration).toContain('然后提交');
    expect(narration).not.toContain('内心盘算');
  });
  it('无标签 = 零调用（drift 由运行时判定）；坏 JSON 块忽略不炸', () => {
    expect(decodeTextProtocol('就是一段正文', TOOLS).calls).toHaveLength(0);
    const { calls } = decodeTextProtocol('<tool_call>不是JSON</tool_call><tool_call>{"name":"workspace_commit"}</tool_call>', TOOLS);
    expect(calls).toHaveLength(1);
  });
  it('stripThinkBlocks：孤儿闭标签（预填 <think> 被回显）也剥净', () => {
    expect(stripThinkBlocks('思考…</think>正文')).toBe('正文');
    expect(stripThinkBlocks('<think>只有开标签没闭合')).toBe('');
  });
});

describe('agentProtocol · 回喂编码', () => {
  it('native：assistant.tool_calls.arguments 为字符串化 JSON；tool 结果为五字段 JSON 串', () => {
    const call = { id: 'c1', name: 'workspace.commit', modelName: 'workspace_commit', args: { mode: 'append' } };
    const turn = encodeAssistantTurn('native', '旁白', [call]);
    expect((turn.tool_calls as Array<{ function: { arguments: string } }>)[0].function.arguments).toBe('{"mode":"append"}');
    const [msg] = encodeToolResults('native', [{ call, result: { ok: true, content: 'done', structured: { a: 1 } } }]);
    expect(msg.role).toBe('tool');
    expect(msg.tool_call_id).toBe('c1');
    const body = JSON.parse(msg.content as string);
    expect(body).toEqual({ ok: true, content: 'done', structured: { a: 1 }, errorCode: null, resourceRefs: [] });
  });
  it('text：结果合并为一条 role:user 的 <tool_result> 块', () => {
    const call = { id: 'c1', name: 'workspace.commit', modelName: 'workspace_commit', args: {} };
    const msgs = encodeToolResults('text', [{ call, result: { ok: false, content: 'no', errorCode: 'x.y' } }]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('<tool_result name="workspace_commit" ok="false">');
  });
  it('P2·extractJsonStringField：渐进反转义 + 未闭合/悬空转义/不完整 unicode 容忍', () => {
    expect(extractJsonStringField('{"path":"output/main.md","content":"第一行\\n引号\\"x', 'content')).toBe('第一行\n引号"x');
    expect(extractJsonStringField('{"content":"abc"}', 'content')).toBe('abc');
    expect(extractJsonStringField('{"content":"悬空\\', 'content')).toBe('悬空');
    expect(extractJsonStringField('{"content":"\\u4f60好', 'content')).toBe('你好');
    expect(extractJsonStringField('{"content":"\\u4f6', 'content')).toBeNull();   // unicode 只到一半且无其它内容 → 等下一分片
    expect(extractJsonStringField('{"nope":1}', 'content')).toBeNull();
  });
  it('P2·extractNarrativePreview：native 参数流 / 文本协议都能抽，非 main.md 不抽', () => {
    expect(extractNarrativePreview('', [{ id: '1', name: 'workspace_write_file', argsRaw: '{"path":"output/main.md","content":"雨夜' }])).toBe('雨夜');
    expect(extractNarrativePreview('<tool_call>{"name":"workspace_write_file","arguments":{"path":"output/main.md","content":"开篇', [])).toBe('开篇');
    expect(extractNarrativePreview('', [{ id: '1', name: 'workspace_write_file', argsRaw: '{"path":"scratch/x.md","content":"草稿' }])).toBeNull();
    expect(extractNarrativePreview('随便聊两句没有工具', [])).toBeNull();
  });
  it('encodeToolDefs 形状 + looksLikeToolsUnsupported 判据', () => {
    const defs = encodeToolDefs(TOOLS) as Array<{ type: string; function: { name: string } }>;
    expect(defs[0]).toMatchObject({ type: 'function', function: { name: 'workspace_write_file' } });
    expect(looksLikeToolsUnsupported('HTTP 400 · {"error":"tools is not supported"}')).toBe(true);
    expect(looksLikeToolsUnsupported('HTTP 400 · invalid tool_choice')).toBe(true);
    expect(looksLikeToolsUnsupported('HTTP 429 · rate limit')).toBe(false);
    expect(looksLikeToolsUnsupported('HTTP 500 · internal')).toBe(false);
  });
});
