// 复刻补丁后的 sseLineDelta 逻辑，用真实样本验证
function sseLineDelta(line) {
  const t = line.trim();
  if (!t || t === '[DONE]') return '';
  const d = t.startsWith('data:') ? t.replace(/^data:\s*/, '').trim() : t;
  if (!d || d === '[DONE]' || (d[0] !== '{' && d[0] !== '[')) return '';
  try { const j = JSON.parse(d); return j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''; } catch { return ''; }
}

const cases = [
  ['标准SSE',      'data: {"choices":[{"delta":{"content":"hi"}}]}', 'hi'],
  ['裸JSON假流式',  '{"id":"chatcmpl-1782446120587623192","object":"chat.completion.chunk","created":1782446120,"model":"假流式-gemini-3-flash-preview","choices":[{"delta":{"content":"片段"}}]}', '片段'],
  ['SSE心跳注释',   ': ping', ''],
  ['event行',      'event: message', ''],
  ['DONE',         'data: [DONE]', ''],
  ['裸DONE',       '[DONE]', ''],
  ['空行',         '', ''],
];

let ok = 0;
for (const [name, input, expect] of cases) {
  const got = sseLineDelta(input);
  const pass = got === expect;
  if (pass) ok++;
  console.log(`${pass ? '✓' : '✗'} ${name}: 期望[${expect}] 实得[${got}]`);
}
// NDJSON 多行累积（报错的真实场景：多个分片拼接）
const body = [
  '{"object":"chat.completion.chunk","choices":[{"delta":{"content":"轮回"}}]}',
  '{"object":"chat.completion.chunk","choices":[{"delta":{"content":"乐园"}}]}',
  '{"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
].join('\n');
const acc = body.split('\n').reduce((a, l) => a + sseLineDelta(l), '');
const accPass = acc === '轮回乐园';
if (accPass) ok++;
console.log(`${accPass ? '✓' : '✗'} NDJSON多行累积: 期望[轮回乐园] 实得[${acc}]`);
console.log(`\n${ok}/${cases.length + 1} 通过`);
