import { describe, it, expect, beforeEach } from 'vitest';
import { isInitialVarEntry, parseInitialVars, seedInitialVars } from './initialVars';
import { useVariables } from '../store/variableStore';
import type { WorldBook, WorldBookEntry } from '../store/settingsStore';

/* 🌱 [初始变量] 内容包种子：识别 → 宽容解析 → 已存在跳过。 */
const book = (entries: WorldBookEntry[]): WorldBook => ({ id: 'b1', name: '测试包', entries, enabled: true, createdAt: 0 });
const entry = (comment: string, content: string): WorldBookEntry =>
  ({ uid: 1, key: [], keysecondary: [], comment, content, constant: false, selective: false, enabled: false, order: 0, position: 0 });

describe('initialVars · 内容包初始变量', () => {
  beforeEach(() => { useVariables.setState({ variables: [] }); });

  it('标题识别：[初始变量]/InitialVariables 两写法·禁用条目也认', () => {
    expect(isInitialVarEntry('[初始变量]')).toBe(true);
    expect(isInitialVarEntry(' InitialVariables ')).toBe(true);
    expect(isInitialVarEntry('初始变量')).toBe(true);
    expect(isInitialVarEntry('战斗规则')).toBe(false);
  });

  it('简写对象：类型按值推断', () => {
    const { defs } = parseInitialVars('{"好感度": 10, "阵营": "中立", "已觉醒": false}');
    expect(defs).toHaveLength(3);
    expect(defs.find((d) => d.key === '好感度')).toMatchObject({ type: 'number', value: 10 });
    expect(defs.find((d) => d.key === '阵营')).toMatchObject({ type: 'string', value: '中立' });
    expect(defs.find((d) => d.key === '已觉醒')).toMatchObject({ type: 'boolean', value: false });
  });

  it('全量数组 + 宽容 JSON（裸键/尾逗号）', () => {
    const { defs } = parseInitialVars('[{key: "堕落值", type: "number", value: 0, min: 0, max: 100, desc: "黑化程度",},]');
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ key: '堕落值', type: 'number', min: 0, max: 100 });
  });

  it('种入：已存在 key 跳过绝不覆盖·统计正确', () => {
    useVariables.getState().upsertDefinition({ key: '好感度', label: '好感度', type: 'number', value: 77, showInStatusBar: false });
    const r = seedInitialVars([book([entry('[初始变量]', '{"好感度": 0, "新变量": "x"}')])]);
    expect(r.entryCount).toBe(1);
    expect(r.seeded).toEqual(['新变量']);
    expect(r.skipped).toEqual(['好感度']);
    expect(useVariables.getState().variables.find((v) => v.key === '好感度')?.value).toBe(77);
  });

  it('烂 JSON 记 errors 不炸；无 [初始变量] 条目 entryCount=0', () => {
    const r1 = seedInitialVars([book([entry('[初始变量]', '这不是JSON')])]);
    expect(r1.errors.length).toBe(1);
    expect(r1.seeded.length).toBe(0);
    const r2 = seedInitialVars([book([entry('普通条目', '{}')])]);
    expect(r2.entryCount).toBe(0);
  });
});
