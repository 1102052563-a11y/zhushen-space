import { describe, it, expect, beforeEach } from 'vitest';
import { runAgentNarrative, type AgentTransport } from './agentRuntime';
import type { AgentModelTurn, AgentNarrativeSettings, AgentRunInputs } from './agentTypes';
import { useAgentRun } from '../../store/agentRunStore';

/* 脚本化 transport：按轮出队；记录每轮请求体供断言 */
function scriptedTransport(turns: AgentModelTurn[], seen: Array<Record<string, unknown>> = []): AgentTransport {
  let i = 0;
  return async (body) => {
    seen.push(body);
    if (i >= turns.length) throw new Error('transport script exhausted');
    return turns[i++];
  };
}
const call = (name: string, args: Record<string, unknown> = {}, id?: string) =>
  ({ id: id ?? `c_${name}_${Math.floor(Math.random() * 1e6)}`, name, argsRaw: JSON.stringify(args) });
const turn = (toolCalls: ReturnType<typeof call>[], content = ''): AgentModelTurn => ({ content, toolCallsRaw: toolCalls });

const SETTINGS = (patch: Partial<AgentNarrativeSettings> = {}): AgentNarrativeSettings =>
  ({ enabled: true, protocol: 'native', maxRounds: 8, maxToolCalls: 40, toolToggles: {}, useTextApi: false, ...patch });
const INPUTS: AgentRunInputs = {
  userText: '行动',
  history: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '旧正文，提到了黑铁短剑' }],
  wbHits: [{ name: '设定A', content: '世界观内容' }],
};
const CHAIN = [{ baseUrl: 'http://mock', apiKey: 'k', modelId: 'm', temperature: 0.7, maxTokens: 4096, topP: 0.9 }];
const BASE = [{ role: 'system' as const, content: 'SYS' }, { role: 'user' as const, content: '行动' }];

function run(transport: AgentTransport, patch: Partial<AgentNarrativeSettings> = {}, opts: { signal?: AbortSignal; onCommit?: (raw: string, seq: number) => void; onPreview?: (draft: string) => void; reviewChain?: typeof CHAIN } = {}) {
  return runAgentNarrative({
    baseMessages: BASE, chain: CHAIN, signal: opts.signal ?? new AbortController().signal,
    inputs: INPUTS, settings: SETTINGS(patch), transport, onCommit: opts.onCommit, onPreview: opts.onPreview, reviewChain: opts.reviewChain,
  });
}

describe('agentRuntime · 终态', () => {
  it('写→commit→finish 一轮完成；onCommit 收到成稿', async () => {
    const commits: string[] = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '正文<state>hp.B1 = 10</state>' }), call('workspace_commit'), call('workspace_finish')]),
    ]), {}, { onCommit: (raw) => commits.push(raw) });
    expect(r.status).toBe('completed');
    expect(r.narrative).toContain('正文<state>');
    expect(r.commits).toBe(1);
    expect(commits).toHaveLength(1);
  });
  it('drift（纯文本）→ 合成纠偏提醒 → 下轮恢复完成', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([], '这是我直接输出的正文'),
      turn([call('workspace_commit', { path: 'output/direct_output.md' }), call('workspace_finish')]),
    ], seen));
    expect(r.status).toBe('completed');
    expect(r.rounds).toBe(2);
    expect(r.narrative).toBe('这是我直接输出的正文');   // 直出文本被捕获、按提醒 commit 回收
    const msgs2 = seen[1].messages as Array<{ role: string; content: unknown }>;
    expect(String(msgs2[msgs2.length - 1].content)).toContain('纠偏');
  });
  it('finish 无 commit → 降级软错误继续跑，补 commit 后才能收尾', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_finish')]),
      turn([call('workspace_commit'), call('workspace_finish')]),
    ], seen));
    expect(r.status).toBe('completed');
    const msgs2 = seen[1].messages as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(msgs2)).toContain('foreground_commit_required');
  });
  it('超轮数：有 commit → partial（保留成稿）；无 commit → failed', async () => {
    const p = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '成稿' }), call('workspace_commit')]),
    ]), { maxRounds: 1 });
    expect(p.status).toBe('partial');
    expect(p.errorCode).toBe('agent.max_tool_rounds_exceeded');
    expect(p.narrative).toBe('成稿');
    const f = await run(scriptedTransport([turn([call('chat_search', { query: '短剑' })])]), { maxRounds: 1 });
    expect(f.status).toBe('failed');
    expect(f.errorCode).toBe('agent.max_tool_rounds_exceeded');
  });
  it('最后一轮仍 drift → model.tool_call_required（failed）', async () => {
    const r = await run(scriptedTransport([turn([], '还是纯文本')]), { maxRounds: 1 });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('model.tool_call_required');
  });
  it('未知工具 → 致命 model.unknown_tool_call', async () => {
    const r = await run(scriptedTransport([turn([call('bogus_tool')])]));
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('model.unknown_tool_call');
  });
  it('finish 之后还有调用 → agent.tool_after_finish；已 commit 则归 partial', async () => {
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_commit'), call('workspace_finish'), call('chat_search', { query: 'q' })]),
    ]));
    expect(r.status).toBe('partial');
    expect(r.errorCode).toBe('agent.tool_after_finish');
  });
  it('取消：signal 中止 → cancelled', async () => {
    const ac = new AbortController();
    const transport: AgentTransport = async () => { ac.abort(); return turn([], '文本'); };
    const r = await run(transport, {}, { signal: ac.signal });
    expect(r.status).toBe('cancelled');
  });
});

describe('agentRuntime · 软错误回喂', () => {
  it('工具预算耗尽 → 软错误回喂（不终止本轮），未收尾最终按轮数结算', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('chat_search', { query: '短剑' }), call('chat_search', { query: '你好' }), call('chat_search', { query: '第三次' })]),
      turn([], ''),
    ], seen), { maxRounds: 2, maxToolCalls: 2 });
    expect(r.status).toBe('failed');   // 无 commit
    const fed = JSON.stringify(seen[1].messages);
    expect(fed).toContain('tool_budget_exhausted');
    expect(r.toolCalls).toBe(2);   // 第三次没执行
  });
  it('工具参数错误回喂 is_error，不致命', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_read_file', { path: 'output/nope.md' })]),
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'ok' }), call('workspace_commit'), call('workspace_finish')]),
    ], seen));
    expect(r.status).toBe('completed');
    expect(JSON.stringify(seen[1].messages)).toContain('file_not_found');
  });
  it('单工具上限 maxCallsPerTool → 软错误回喂且不执行（P1）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('chat_search', { query: '短剑' }), call('chat_search', { query: '再来' })]),
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_commit'), call('workspace_finish')]),
    ], seen), { maxCallsPerTool: { chat_search: 1 } });
    expect(r.status).toBe('completed');
    expect(JSON.stringify(seen[1].messages)).toContain('单工具上限');
    expect(r.toolCalls).toBe(4);   // 第二次 chat_search 未执行不计数（1 + 写/commit/finish 3 次）
  });
  it('chat_search 工具真实可用（读 inputs.history）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await run(scriptedTransport([
      turn([call('chat_search', { query: '黑铁短剑' })]),
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_commit'), call('workspace_finish')]),
    ], seen));
    const fed = JSON.stringify(seen[1].messages);
    expect(fed).toContain('#1');   // 命中 assistant 楼层（index 1）
  });
});

describe('agentRuntime · P1（persist 跨回合记忆 / 中途指引）', () => {
  beforeEach(() => useAgentRun.setState({ runs: [], active: null, persistFiles: {}, pendingGuidance: [] }));

  it('persist/ 种入：上次留的备忘本次可直接读到', async () => {
    useAgentRun.setState({ persistFiles: { 'persist/notes.md': '旧备忘：欠铁匠 300 乐园币' } });
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_read_file', { path: 'persist/notes.md' })]),
      turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_commit'), call('workspace_finish')]),
    ], seen));
    expect(r.status).toBe('completed');
    expect(JSON.stringify(seen[1].messages)).toContain('欠铁匠 300 乐园币');
  });
  it('persist/ 晋升：completed 后改动回写 store；append 模式免预读', async () => {
    useAgentRun.setState({ persistFiles: { 'persist/notes.md': '第一行' } });
    const r = await run(scriptedTransport([
      turn([
        call('workspace_write_file', { path: 'persist/notes.md', content: '\n第二行：新伏笔', mode: 'append' }),
        call('workspace_write_file', { path: 'output/main.md', content: '正文' }),
        call('workspace_commit'), call('workspace_finish'),
      ]),
    ]));
    expect(r.status).toBe('completed');
    const pf = useAgentRun.getState().persistFiles;
    expect(pf['persist/notes.md']).toBe('第一行\n第二行：新伏笔');
  });
  it('persist/ 不晋升：partial（未 finish）不保存改动', async () => {
    useAgentRun.setState({ persistFiles: { 'persist/notes.md': '原样' } });
    const r = await run(scriptedTransport([
      turn([
        call('workspace_write_file', { path: 'persist/notes.md', content: '被篡改', mode: 'append' }),
        call('workspace_write_file', { path: 'output/main.md', content: '正文' }),
        call('workspace_commit'),
      ]),
    ]), { maxRounds: 1 });
    expect(r.status).toBe('partial');
    expect(useAgentRun.getState().persistFiles['persist/notes.md']).toBe('原样');
  });
  it('中途指引：运行中 submitGuidance → 下一轮开头以 <user_guidance> 注入', async () => {
    const seen: Array<Record<string, unknown>> = [];
    let i = 0;
    const transport: AgentTransport = async (body) => {
      seen.push(body);
      i++;
      if (i === 1) {
        expect(useAgentRun.getState().submitGuidance('改成雨夜氛围，别写打斗').ok).toBe(true);
        return turn([call('chat_search', { query: '短剑' })]);
      }
      return turn([call('workspace_write_file', { path: 'output/main.md', content: 'x' }), call('workspace_commit'), call('workspace_finish')]);
    };
    const r = await run(transport);
    expect(r.status).toBe('completed');
    const fed = JSON.stringify(seen[1].messages);
    expect(fed).toContain('<user_guidance>');
    expect(fed).toContain('改成雨夜氛围');
    expect(useAgentRun.getState().pendingGuidance).toHaveLength(0);   // 已被 drain
  });
  it('指引限额：未运行时拒收；超 8 条拒收', () => {
    expect(useAgentRun.getState().submitGuidance('x').ok).toBe(false);   // 无 active run
    useAgentRun.setState({ active: { id: 'r', startedAt: Date.now(), status: 'running', events: [], rounds: 0, toolCalls: 0, commits: 0 } });
    for (let k = 0; k < 8; k++) expect(useAgentRun.getState().submitGuidance(`g${k}`).ok).toBe(true);
    expect(useAgentRun.getState().submitGuidance('第九条').ok).toBe(false);
    useAgentRun.setState({ active: null, pendingGuidance: [] });
  });
});

describe('agentRuntime · P2（流式预览 / 评稿子代理）', () => {
  beforeEach(() => useAgentRun.setState({ runs: [], active: null, persistFiles: {}, pendingGuidance: [] }));

  it('末轮流式预览：写 output/main.md 时 onPreview 渐进收到草稿', async () => {
    const previews: string[] = [];
    const transport: AgentTransport = async (_b, _a, _s, onProgress) => {
      onProgress?.({ content: '', calls: [{ id: 'w', name: 'workspace_write_file', argsRaw: '{"path":"output/main.md","content":"夜色' }] });
      await new Promise((r) => setTimeout(r, 150));   // 跳出 120ms 节流窗
      onProgress?.({ content: '', calls: [{ id: 'w', name: 'workspace_write_file', argsRaw: '{"path":"output/main.md","content":"夜色渐深' }] });
      return turn([call('workspace_write_file', { path: 'output/main.md', content: '夜色渐深，全文。' }), call('workspace_commit'), call('workspace_finish')]);
    };
    const r = await run(transport, {}, { onPreview: (t) => previews.push(t) });
    expect(r.status).toBe('completed');
    expect(previews.length).toBeGreaterThanOrEqual(1);
    expect(previews[previews.length - 1]).toContain('夜色');
  });
  it('评稿 PASS：finish 拦截 → 评稿人放行 → completed（评稿调用不带 tools）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '成稿' }), call('workspace_commit'), call('workspace_finish')]),
      turn([], 'PASS 结构完整，节奏可以。'),
    ], seen), { reviewerEnabled: true, reviewerPasses: 1 }, { reviewChain: CHAIN });
    expect(r.status).toBe('completed');
    expect(r.commits).toBe(1);
    expect(seen[1].tools).toBeUndefined();   // 评稿是普通一次性调用
    expect(useAgentRun.getState().runs[0].events.some((e) => e.type === 'review_pass')).toBe(true);
  });
  it('评稿 REVISE：意见回喂 → 模型修订再 commit → 第二次 finish 免评放行', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '初稿' }), call('workspace_commit'), call('workspace_finish')]),
      turn([], 'REVISE\n- 状态栏缺失，请在文末补全'),
      turn([call('workspace_write_file', { path: 'output/main.md', content: '\n【状态栏】…', mode: 'append' }), call('workspace_commit'), call('workspace_finish')]),
    ], seen), { reviewerEnabled: true, reviewerPasses: 1 }, { reviewChain: CHAIN });
    expect(r.status).toBe('completed');
    expect(r.commits).toBe(2);
    expect(JSON.stringify(seen[2].messages)).toContain('评稿人意见');
    const evs = useAgentRun.getState().runs[0].events;
    expect(evs.some((e) => e.type === 'review_revise')).toBe(true);
  });
  it('评稿调用失败 → best-effort 跳过直接收尾', async () => {
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '成稿' }), call('workspace_commit'), call('workspace_finish')]),
    ]), { reviewerEnabled: true, reviewerPasses: 1 }, { reviewChain: CHAIN });   // 评稿调用时脚本已耗尽 → throw → 跳过
    expect(r.status).toBe('completed');
    expect(useAgentRun.getState().runs[0].events.some((e) => e.type === 'review_skip')).toBe(true);
  });
  it('reviewerEnabled 但未传 reviewChain → 不拦截（向后兼容）', async () => {
    const r = await run(scriptedTransport([
      turn([call('workspace_write_file', { path: 'output/main.md', content: '成稿' }), call('workspace_commit'), call('workspace_finish')]),
    ]), { reviewerEnabled: true });
    expect(r.status).toBe('completed');
  });
});
