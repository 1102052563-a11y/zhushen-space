import { describe, it, expect } from 'vitest';
import { normalizeApiBase, chatCompletionsUrl, modelsListUrl, endsWithVersionSegment, maskApiKey, applyOmitParams, OMITTABLE_PARAMS, protocolOf, keysOf, chatUrlFor, buildProtocolRequest, extractStreamDelta, extractStreamReasoning, extractOnceContent, modelsFetchArgs } from './apiUrl';

describe('normalizeApiBase', () => {
  it('剥尾斜杠（含多重）', () => {
    expect(normalizeApiBase('https://api.x.com/v1/').base).toBe('https://api.x.com/v1');
    expect(normalizeApiBase('https://api.x.com/v1///').base).toBe('https://api.x.com/v1');
    expect(normalizeApiBase('  https://api.x.com/v1  ').base).toBe('https://api.x.com/v1');
  });
  it('剥误粘的 /chat/completions 后缀（含大小写与尾斜杠）', () => {
    expect(normalizeApiBase('https://api.x.com/v1/chat/completions').base).toBe('https://api.x.com/v1');
    expect(normalizeApiBase('https://api.x.com/v1/Chat/Completions/').base).toBe('https://api.x.com/v1');
    expect(normalizeApiBase('https://api.x.com/hf/v1/chat/completions').base).toBe('https://api.x.com/hf/v1');
  });
  it('# 字面量：剥 # 与尾斜杠后原样保留（chat 后缀不剥）', () => {
    const r = normalizeApiBase('https://gw.x.com/openai/deployments/gpt/chat/completions#');
    expect(r.literal).toBe(true);
    expect(r.base).toBe('https://gw.x.com/openai/deployments/gpt/chat/completions');
  });
  it('/api/gw/ 网关地址只剥尾斜杠，其余不动（与旧行为一致）', () => {
    const gw = 'https://zhushen-space.pages.dev/api/gw/proxy?url=https%3A%2F%2Fapi.x.com%2Fv1';
    expect(normalizeApiBase(gw).base).toBe(gw);
    expect(normalizeApiBase(gw + '/').base).toBe(gw);
  });
  it('不静默补版本段：裸域名保持裸域名', () => {
    expect(normalizeApiBase('https://api.openai.com').base).toBe('https://api.openai.com');
  });
});

describe('chatCompletionsUrl / modelsListUrl', () => {
  it('普通地址：基址 + 端点，chat 与 models 同口径', () => {
    expect(chatCompletionsUrl('https://api.x.com/v1/')).toBe('https://api.x.com/v1/chat/completions');
    expect(modelsListUrl('https://api.x.com/v1/')).toBe('https://api.x.com/v1/models');
  });
  it('误粘完整 chat 端点：两者都从剥后的基址出发', () => {
    expect(chatCompletionsUrl('https://api.x.com/v1/chat/completions')).toBe('https://api.x.com/v1/chat/completions');
    expect(modelsListUrl('https://api.x.com/v1/chat/completions')).toBe('https://api.x.com/v1/models');
  });
  it('字面量模式：chat 原样用；models 尽力同级替换', () => {
    expect(chatCompletionsUrl('https://gw.x.com/weird/path#')).toBe('https://gw.x.com/weird/path');
    expect(modelsListUrl('https://gw.x.com/weird/chat/completions#')).toBe('https://gw.x.com/weird/models');
    expect(modelsListUrl('https://gw.x.com/weird/path#')).toBe('https://gw.x.com/weird/path/models');
  });
  it('网关代理地址：保持旧式直接拼接（追加进 query 值，由网关解码）', () => {
    const gw = 'https://x.pages.dev/api/gw/proxy?url=https%3A%2F%2Fapi.x.com%2Fv1';
    expect(chatCompletionsUrl(gw)).toBe(gw + '/chat/completions');
    expect(modelsListUrl(gw)).toBe(gw + '/models');
  });
});

describe('endsWithVersionSegment', () => {
  it('带版本段 → true（不提示）', () => {
    expect(endsWithVersionSegment('https://api.x.com/v1')).toBe(true);
    expect(endsWithVersionSegment('https://api.x.com/v1beta')).toBe(true);
    expect(endsWithVersionSegment('https://api.x.com/hf/v2/')).toBe(true);
    expect(endsWithVersionSegment('https://open.bigmodel.cn/api/paas/v4')).toBe(true);
  });
  it('缺版本段 → false（UI 出提示 chip）', () => {
    expect(endsWithVersionSegment('https://api.openai.com')).toBe(false);
    expect(endsWithVersionSegment('https://api.x.com/api')).toBe(false);
  });
  it('误粘 chat 端点先剥再判：/v1/chat/completions → true', () => {
    expect(endsWithVersionSegment('https://api.x.com/v1/chat/completions')).toBe(true);
  });
  it('字面量 / 网关 / 空 → true（这些场景不提示）', () => {
    expect(endsWithVersionSegment('https://gw.x.com/weird#')).toBe(true);
    expect(endsWithVersionSegment('https://x.pages.dev/api/gw/proxy?url=abc')).toBe(true);
    expect(endsWithVersionSegment('')).toBe(true);
  });
});

describe('maskApiKey', () => {
  it('长 Key 前8后4，短 Key 整体打码，空返回空', () => {
    expect(maskApiKey('sk-abcdefghijklmnopqrst')).toBe('sk-abcde****qrst');
    expect(maskApiKey('shortkey')).toBe('****');
    expect(maskApiKey('')).toBe('');
  });
});

describe('applyOmitParams', () => {
  const body = { model: 'm', messages: [], stream: true, temperature: 0.7, top_p: 0.9, max_tokens: 1000, response_format: { type: 'json_object' } };
  it('白名单内的键被剔除', () => {
    const out = applyOmitParams(body, ['temperature', 'max_tokens']);
    expect(out.temperature).toBeUndefined();
    expect(out.max_tokens).toBeUndefined();
    expect(out.top_p).toBe(0.9);
  });
  it('stream / model / messages / response_format 即使被列入也绝不剔除', () => {
    const out = applyOmitParams(body, ['stream', 'model', 'messages', 'response_format', 'temperature'] as string[]);
    expect(out.stream).toBe(true);
    expect(out.model).toBe('m');
    expect(out.messages).toEqual([]);
    expect(out.response_format).toEqual({ type: 'json_object' });
    expect(out.temperature).toBeUndefined();
  });
  it('非破坏式：原 body 不被改动；无排除项时原样返回同一对象', () => {
    const out = applyOmitParams(body, ['temperature']);
    expect(body.temperature).toBe(0.7);
    expect(out).not.toBe(body);
    expect(applyOmitParams(body, [])).toBe(body);
    expect(applyOmitParams(body, undefined)).toBe(body);
  });
  it('白名单与 UI 勾选集一致（6 项采样参数）', () => {
    expect(OMITTABLE_PARAMS).toEqual(['temperature', 'top_p', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'seed']);
  });
});

describe('protocolOf / keysOf', () => {
  it('protocol 缺省/未知 → openai', () => {
    expect(protocolOf({})).toBe('openai');
    expect(protocolOf({ protocol: 'anthropic' })).toBe('anthropic');
    expect(protocolOf({ protocol: 'gemini' })).toBe('gemini');
    expect(protocolOf({ protocol: 'weird' })).toBe('openai');
    expect(protocolOf(null)).toBe('openai');
  });
  it('多 Key 按逗号/换行/空白拆分并去重保序', () => {
    expect(keysOf({ baseUrl: 'https://x.com/v1', apiKey: 'k1,k2\nk3 k1' })).toEqual(['k1', 'k2', 'k3']);
    expect(keysOf({ baseUrl: 'https://x.com/v1', apiKey: '  ' })).toEqual([]);
    expect(keysOf({ baseUrl: 'https://x.com/v1', apiKey: 'single' })).toEqual(['single']);
  });
  it('⚠ /api/gw/ 网关地址整串不拆（服务端自己轮换）', () => {
    expect(keysOf({ baseUrl: 'https://x.pages.dev/api/gw/aistudio', apiKey: 'k1,k2,k3' })).toEqual(['k1,k2,k3']);
  });
});

describe('chatUrlFor（协议端点）', () => {
  it('anthropic：裸域补 /v1，已带版本段不重复', () => {
    expect(chatUrlFor({ baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' })).toBe('https://api.anthropic.com/v1/messages');
    expect(chatUrlFor({ baseUrl: 'https://proxy.x.com/v1', protocol: 'anthropic' })).toBe('https://proxy.x.com/v1/messages');
  });
  it('gemini：裸域补 /v1beta，model 进 URL 且剥 models/ 前缀，key 不进 URL', () => {
    const u = chatUrlFor({ baseUrl: 'https://generativelanguage.googleapis.com', protocol: 'gemini', modelId: 'models/gemini-2.5-pro' });
    expect(u).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(u).not.toContain('key=');
  });
  it('openai：与 chatCompletionsUrl 同口径', () => {
    expect(chatUrlFor({ baseUrl: 'https://api.x.com/v1' })).toBe('https://api.x.com/v1/chat/completions');
  });
});

describe('buildProtocolRequest · anthropic', () => {
  const msgs = [
    { role: 'system', content: '规则A' },
    { role: 'system', content: '规则B' },
    { role: 'user', content: '你好' },
    { role: 'user', content: '在吗' },
    { role: 'assistant', content: '在的' },
  ];
  it('system 提级顶层、连续同角色合并、headers 带直连开关', () => {
    const r = buildProtocolRequest({ baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' }, 'sk-ant-x', { model: 'claude-x', messages: msgs, stream: true, max_tokens: 1000 });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['x-api-key']).toBe('sk-ant-x');
    expect(r.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(r.body.system).toBe('规则A\n\n规则B');
    const turns = r.body.messages as any[];
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);   // 两条 user 合并成一条
    expect(turns[0].content.length).toBe(2);
  });
  it('max_tokens 必填：被 omitParams 排掉也强制回填；温度夹到 ≤1；不认识的参数丢弃', () => {
    const r = buildProtocolRequest({ baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', maxTokens: 4096 }, 'k', { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true, temperature: 1.7, frequency_penalty: 0.5, seed: 42 });
    expect(r.body.max_tokens).toBe(4096);
    expect(r.body.temperature).toBe(1);
    expect(r.body).not.toHaveProperty('frequency_penalty');
    expect(r.body).not.toHaveProperty('seed');
  });
  it('首条必须 user：以 assistant 开头时补占位', () => {
    const r = buildProtocolRequest({ baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' }, 'k', { model: 'm', messages: [{ role: 'assistant', content: '预填' }], stream: true });
    const turns = r.body.messages as any[];
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
  });
});

describe('buildProtocolRequest · gemini', () => {
  it('assistant→model、system→systemInstruction、采样参数进 generationConfig、model 在 URL 不在 body', () => {
    const r = buildProtocolRequest({ baseUrl: 'https://generativelanguage.googleapis.com', protocol: 'gemini' }, 'AIza-x', {
      model: 'gemini-2.5-pro', stream: true, temperature: 0.9, top_p: 0.95, max_tokens: 2048,
      messages: [{ role: 'system', content: '你是DM' }, { role: 'user', content: '开始' }, { role: 'assistant', content: '好' }],
    });
    expect(r.url).toContain('/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(r.headers['x-goog-api-key']).toBe('AIza-x');
    expect(r.body).not.toHaveProperty('model');
    expect((r.body.systemInstruction as any).parts[0].text).toBe('你是DM');
    const contents = r.body.contents as any[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(r.body.generationConfig).toEqual({ temperature: 0.9, topP: 0.95, maxOutputTokens: 2048 });
  });
  it('data:URL 图片 → inlineData；tools 透传', () => {
    const img = 'data:image/png;base64,AAAA';
    const r = buildProtocolRequest({ baseUrl: 'https://g.com/v1beta', protocol: 'gemini' }, 'k', {
      model: 'g', stream: true, tools: [{ google_search: {} }],
      messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: img } }] }],
    });
    const parts = (r.body.contents as any[])[0].parts;
    expect(parts[0]).toEqual({ text: '看图' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAAA' } });
    expect(r.body.tools).toEqual([{ google_search: {} }]);
  });
});

describe('extractStreamDelta / Reasoning / Once', () => {
  it('openai 分片', () => {
    expect(extractStreamDelta('openai', { choices: [{ delta: { content: '你' } }] })).toBe('你');
    expect(extractStreamReasoning('openai', { choices: [{ delta: { reasoning_content: '想' } }] })).toBe('想');
  });
  it('anthropic 分片：content_block_delta 的 text/thinking，其余事件为空', () => {
    expect(extractStreamDelta('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: '好' } })).toBe('好');
    expect(extractStreamReasoning('anthropic', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思' } })).toBe('思');
    expect(extractStreamDelta('anthropic', { type: 'message_start' })).toBe('');
  });
  it('gemini 分片：parts 拼接，thought 部件归思维链', () => {
    const j = { candidates: [{ content: { parts: [{ text: '正' }, { text: '思', thought: true }, { text: '文' }] } }] };
    expect(extractStreamDelta('gemini', j)).toBe('正文');
    expect(extractStreamReasoning('gemini', j)).toBe('思');
  });
  it('一次性 JSON 三协议', () => {
    expect(extractOnceContent('openai', { choices: [{ message: { content: 'a' } }] })).toBe('a');
    expect(extractOnceContent('anthropic', { content: [{ type: 'text', text: 'b' }, { type: 'tool_use' }] })).toBe('b');
    expect(extractOnceContent('gemini', { candidates: [{ content: { parts: [{ text: 'c' }] } }] })).toBe('c');
  });
});

describe('modelsFetchArgs', () => {
  it('openai：Bearer 首 Key（多 Key 不整串塞头）', () => {
    const [url, init] = modelsFetchArgs({ baseUrl: 'https://api.x.com/v1', apiKey: 'k1,k2' });
    expect(url).toBe('https://api.x.com/v1/models');
    expect((init.headers as any).Authorization).toBe('Bearer k1');
  });
  it('anthropic / gemini：协议头 + 版本段补齐', () => {
    const [au, ai] = modelsFetchArgs({ baseUrl: 'https://api.anthropic.com', apiKey: 'ka', protocol: 'anthropic' });
    expect(au).toBe('https://api.anthropic.com/v1/models');
    expect((ai.headers as any)['x-api-key']).toBe('ka');
    const [gu, gi] = modelsFetchArgs({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'kg', protocol: 'gemini' });
    expect(gu).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect((gi.headers as any)['x-goog-api-key']).toBe('kg');
  });
  it('网关 aistudio：整串 Key 保持旧行为', () => {
    const [, init] = modelsFetchArgs({ baseUrl: 'https://x.pages.dev/api/gw/aistudio', apiKey: 'k1,k2' });
    expect((init.headers as any).Authorization).toBe('Bearer k1,k2');
  });
});
