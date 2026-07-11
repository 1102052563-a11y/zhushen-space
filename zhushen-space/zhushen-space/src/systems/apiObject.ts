// 结构化输出适配器（Waidrin `getObject` 的本项目版）
// ───────────────────────────────────────────────────────────────────────────
// 思路来自 p-e-w/waidrin 的 lib/backend.ts：调 AI 拿「结构化状态」时，用 JSON Schema
// 约束生成（Gemini responseSchema / OpenAI json_schema），拿回后再在客户端复校验一遍——
// 双保险(① 后端解码层约束 ② 客户端 schema 复校验)，从根上治「AI 乱填状态 / 漂移」。
//
// 本项目适配点：
//  1. 不引 zod（依赖零增加）——用一个够用的 JSON Schema 子集 + 手写轻量校验器。
//  2. 复用现有 `apiChatFallback`：`response_format` 经其 `opts.extra` 原样进请求体
//     （apiChat.ts 里 body = { model, messages, stream, ...extra }）。npcChatCompletion 已
//     用同一条 extra 通道塞过 Gemini 原生 `tools:[{google_search:{}}]`，证明网关会把
//     非 OpenAI 字段转发给 Gemini，故 response_format 也能骑同一条路透传。
//  3. 解析走项目统一的 `lenientJsonParse`（容忍裸键/单引号/尾逗号）。
//  4. 网关不确定性兜底：万一反代吞了 response_format，① 提示词里再声明一遍 schema，
//     ② 容错抽取(剥代码块/找平衡括号) + 校验失败把错误喂回模型重试。降级不崩。

import type { ApiConfig } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';

// ── JSON Schema 子集（够描述 NPC 对账/枚举挑选等场景；要更全再按需扩）──
export type JsonSchema =
  | { type: 'string'; enum?: string[]; const?: string; maxLength?: number; description?: string }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: JsonSchema; minItems?: number; maxItems?: number; description?: string }
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
      description?: string;
    };

export type ChatMsg = { role: string; content: string };

// ── 纯逻辑①：把返回文本里的 JSON 抠出来 ─────────────────────────────────────
// 兼容三种：裸 JSON、```json 代码块包裹、正文里夹一段 JSON。找不到返回 null。
export function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  let t = text.trim();
  // 剥 ```json ... ``` / ``` ... ``` 代码块
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim()) t = fence[1].trim();
  // 找第一个 { 或 [，做括号平衡扫描（跳过字符串内的括号与转义）取出完整块
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return t.slice(start, i + 1);
  }
  return null; // 括号未闭合（截断输出）
}

// ── 纯逻辑②：轻量 schema 校验（够抓「枚举越界 / 缺字段 / 类型错」）──────────────
// 返回错误信息数组，空数组 = 通过。刻意不做完整 JSON Schema，只覆盖我们用到的约束。
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errs: string[] = [];
  const T = (t: string) => errs.push(`${path} 应为 ${t}，实际 ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`);
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') { T('string'); break; }
      if (schema.const != null && value !== schema.const) errs.push(`${path} 必须等于 "${schema.const}"`);
      if (schema.enum && !schema.enum.includes(value)) errs.push(`${path} 取值 "${value}" 不在允许列表内（只能是：${schema.enum.join(' / ')}）`);
      if (schema.maxLength != null && value.length > schema.maxLength) errs.push(`${path} 超过最大长度 ${schema.maxLength}`);
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || Number.isNaN(value)) { T(schema.type); break; }
      if (schema.type === 'integer' && !Number.isInteger(value)) errs.push(`${path} 应为整数`);
      if (schema.minimum != null && value < schema.minimum) errs.push(`${path} 应 ≥ ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) errs.push(`${path} 应 ≤ ${schema.maximum}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') T('boolean');
      break;
    case 'array': {
      if (!Array.isArray(value)) { T('array'); break; }
      if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path} 至少 ${schema.minItems} 项`);
      if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path} 至多 ${schema.maxItems} 项`);
      value.forEach((v, i) => errs.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
      break;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) { T('object'); break; }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!(key in obj)) errs.push(`${path} 缺少必填字段 "${key}"`);
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) errs.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) if (!(key in schema.properties)) errs.push(`${path} 含未声明字段 "${key}"`);
      }
      break;
    }
  }
  return errs;
}

// ── 纯逻辑③：抠 JSON + 宽松解析 + 校验，一步到位 ─────────────────────────────
export function coerceToObject<T = unknown>(
  rawContent: string,
  schema: JsonSchema,
): { ok: true; value: T } | { ok: false; errors: string[] } {
  const block = extractJsonBlock(rawContent);
  if (!block) return { ok: false, errors: ['响应里找不到 JSON（可能被截断或模型没按格式输出）'] };
  const parsed = lenientJsonParse(block);
  if (parsed === undefined) return { ok: false, errors: ['JSON 解析失败（即便放宽引号/尾逗号后仍非法）'] };
  const errors = validateAgainstSchema(parsed, schema);
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed as T };
}

// ── 组请求体：response_format（Gemini responseSchema / OpenAI json_schema 同名字段）──
export function buildResponseFormat(schema: JsonSchema, name = 'result', strict = true) {
  return { type: 'json_schema' as const, json_schema: { name, strict, schema } };
}

// ── 提示词兜底：把 schema 也写进对话，网关即便吞了 response_format 模型也倾向输出合法 JSON ──
function withSchemaInstruction(messages: ChatMsg[], schema: JsonSchema): ChatMsg[] {
  const note =
    `\n\n【输出格式·铁则】只输出一个合法 JSON，且严格符合下述 JSON Schema；` +
    `不要 markdown 代码块、不要任何解释或多余文字：\n${JSON.stringify(schema)}`;
  const out = [...messages];
  // 追加到最后一条 user 消息尾部；没有则新增一条 system
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') { out[i] = { ...out[i], content: out[i].content + note }; return out; }
  }
  return [{ role: 'system', content: note.trim() }, ...out];
}

export interface ObjectOpts {
  name?: string;           // json_schema 名（调试用）
  strict?: boolean;        // OpenAI 严格模式；Gemini 兼容层会忽略，默认 true
  retries?: number;        // 校验失败重试次数（把错误喂回模型自我修正），默认 1
  timeoutMs?: number;      // 传给 apiChatFallback 的空闲超时，默认 60s
  label?: string;          // 调试日志标签
  reinforcePrompt?: boolean; // 是否附带提示词兜底，默认 true
  extra?: Record<string, unknown>; // 额外请求体字段（temperature 等）
}

/** Waidrin getObject 的本项目版：schema 约束生成 → 抠 JSON → 客户端复校验 → 失败重试。
 *  chain 走 resolveApiChain(featureKey, legacy)（与全项目一致）。返回校验通过的对象。 */
export async function apiChatObject<T = unknown>(
  chain: ApiConfig[],
  messages: ChatMsg[],
  schema: JsonSchema,
  opts: ObjectOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const responseFormat = buildResponseFormat(schema, opts.name ?? 'result', opts.strict ?? true);
  let msgs = opts.reinforcePrompt === false ? [...messages] : withSchemaInstruction(messages, schema);
  let lastErr = '未知错误';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { content } = await apiChatFallback(chain, msgs, {
      timeoutMs: opts.timeoutMs ?? 60000,
      label: opts.label ?? 'apiChatObject',
      extra: { response_format: responseFormat, ...(opts.extra ?? {}) },
    });
    const r = coerceToObject<T>(content, schema);
    if (r.ok) return r.value;
    lastErr = r.errors.join('；');
    // 把上次输出 + 校验错误喂回去，让模型自我修正（Waidrin 客户端 schema.parse 失败即重试的思路）
    msgs = [
      ...msgs,
      { role: 'assistant', content: (content || '').slice(0, 4000) },
      { role: 'user', content: `上一次输出不符合要求：${lastErr}。请**只**输出符合 schema 的合法 JSON，不要解释、代码块或多余文字。` },
    ];
  }
  throw new Error(`结构化输出校验失败（已重试 ${retries} 次）：${lastErr}`);
}

/** 动态枚举挑选：强制模型只能从 allowed 里选一个（可加哨兵值表示「都不是」）。
 *  这是 Waidrin 用 z.enum(现有角色名) 做「引用完整性」的最小复刻——治重名/ghost：
 *  正文提到某名字时，让模型在【现有 NPC 名 + __NEW__】里裁决，物理上编不出错别名。 */
export async function pickFromList(
  chain: ApiConfig[],
  question: string,
  allowed: string[],
  opts: ObjectOpts = {},
): Promise<string> {
  const schema: JsonSchema = {
    type: 'object',
    properties: { choice: { type: 'string', enum: allowed } },
    required: ['choice'],
    additionalProperties: false,
  };
  const r = await apiChatObject<{ choice: string }>(chain, [{ role: 'user', content: question }], schema, {
    label: 'pickFromList',
    ...opts,
  });
  return r.choice;
}
