import { describe, it, expect } from 'vitest';
import {
  extractJsonBlock,
  validateAgainstSchema,
  coerceToObject,
  buildResponseFormat,
  type JsonSchema,
} from './apiObject';

describe('apiObject · extractJsonBlock 容错抽取', () => {
  it('裸 JSON 对象/数组直接取', () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonBlock('[1,2,3]')).toBe('[1,2,3]');
  });
  it('剥 ```json 代码块', () => {
    expect(extractJsonBlock('```json\n{"choice":"卡尔"}\n```')).toBe('{"choice":"卡尔"}');
    expect(extractJsonBlock('```\n{"x":true}\n```')).toBe('{"x":true}');
  });
  it('正文里夹一段 JSON 也能抠出（模型没听话时）', () => {
    expect(extractJsonBlock('好的，结果如下：{"choice":"奥娜"}。以上。')).toBe('{"choice":"奥娜"}');
  });
  it('平衡括号扫描：跳过字符串内的花括号', () => {
    expect(extractJsonBlock('{"name":"a}b","ok":true}')).toBe('{"name":"a}b","ok":true}');
  });
  it('嵌套对象取完整外层', () => {
    expect(extractJsonBlock('{"a":{"b":1},"c":2}')).toBe('{"a":{"b":1},"c":2}');
  });
  it('截断/无 JSON 返回 null', () => {
    expect(extractJsonBlock('{"a":1')).toBeNull();      // 未闭合
    expect(extractJsonBlock('没有任何 JSON')).toBeNull();
    expect(extractJsonBlock('')).toBeNull();
  });
});

describe('apiObject · validateAgainstSchema 轻量校验', () => {
  const npcSchema: JsonSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 20 },
      tier: { type: 'integer', minimum: 0, maximum: 13 },
      onScene: { type: 'boolean' },
    },
    required: ['name', 'tier'],
    additionalProperties: false,
  };

  it('合法对象无错误', () => {
    expect(validateAgainstSchema({ name: '卡尔', tier: 3, onScene: true }, npcSchema)).toEqual([]);
  });
  it('缺必填字段被抓', () => {
    const e = validateAgainstSchema({ tier: 3 }, npcSchema);
    expect(e.some((m) => m.includes('缺少必填字段 "name"'))).toBe(true);
  });
  it('类型错被抓', () => {
    const e = validateAgainstSchema({ name: '卡尔', tier: '三' }, npcSchema);
    expect(e.some((m) => m.includes('应为 integer'))).toBe(true);
  });
  it('数值越界被抓', () => {
    expect(validateAgainstSchema({ name: '卡尔', tier: 99 }, npcSchema).some((m) => m.includes('≤ 13'))).toBe(true);
  });
  it('未声明字段被抓（additionalProperties:false）', () => {
    const e = validateAgainstSchema({ name: '卡尔', tier: 3, ghost: 1 }, npcSchema);
    expect(e.some((m) => m.includes('未声明字段 "ghost"'))).toBe(true);
  });

  // ★ 核心：动态枚举 = 引用完整性。治重名/ghost 的那一刀。
  it('枚举越界被抓：模型编了个不在现有 NPC 列表里的名字', () => {
    const pick: JsonSchema = { type: 'string', enum: ['卡尔', '奥娜', '__NEW__'] };
    expect(validateAgainstSchema('卡尔', pick)).toEqual([]);            // 现有名 → 过
    expect(validateAgainstSchema('__NEW__', pick)).toEqual([]);         // 哨兵 → 过
    const e = validateAgainstSchema('卡尔特', pick);                    // 近似别名 → 拒
    expect(e.length).toBe(1);
    expect(e[0]).toContain('不在允许列表内');
  });

  it('数组长度约束（Waidrin .length(n) 的等价）', () => {
    const three: JsonSchema = { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 };
    expect(validateAgainstSchema(['a', 'b', 'c'], three)).toEqual([]);
    expect(validateAgainstSchema(['a', 'b'], three).some((m) => m.includes('至少 3 项'))).toBe(true);
    expect(validateAgainstSchema(['a', 'b', 'c', 'd'], three).some((m) => m.includes('至多 3 项'))).toBe(true);
  });
});

describe('apiObject · coerceToObject 端到端（抠+解析+校验）', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { choice: { type: 'string', enum: ['卡尔', '奥娜', '__NEW__'] } },
    required: ['choice'],
    additionalProperties: false,
  };

  it('代码块包裹 + 合法枚举 → ok', () => {
    const r = coerceToObject('```json\n{"choice":"奥娜"}\n```', schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { choice: string }).choice).toBe('奥娜');
  });
  it('宽松 JSON（裸键/单引号/尾逗号）也能救活', () => {
    const r = coerceToObject("{choice: '卡尔',}", schema);
    expect(r.ok).toBe(true);
  });
  it('枚举越界 → 不 ok 且给出清晰错误', () => {
    const r = coerceToObject('{"choice":"卡尔特"}', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('不在允许列表内');
  });
  it('压根没 JSON → 不 ok', () => {
    const r = coerceToObject('模型跑题了，输出了一段正文', schema);
    expect(r.ok).toBe(false);
  });
});

describe('apiObject · buildResponseFormat 请求体形状', () => {
  it('组出 Gemini/OpenAI 通吃的 json_schema 结构', () => {
    const schema: JsonSchema = { type: 'object', properties: { x: { type: 'boolean' } }, required: ['x'] };
    const rf = buildResponseFormat(schema, 'decision');
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('decision');
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema).toBe(schema);
  });
});
