import { describe, it, expect } from 'vitest';
import { flattenAiText } from './flattenAiText';

describe('flattenAiText（把 AI 返回的对象/数组安全摊平成可读文本）', () => {
  it('原样返回基本类型', () => {
    expect(flattenAiText('hello')).toBe('hello');
    expect(flattenAiText(42)).toBe('42');
    expect(flattenAiText(true)).toBe('true');
  });
  it('null/undefined → 空串', () => {
    expect(flattenAiText(null)).toBe('');
    expect(flattenAiText(undefined)).toBe('');
  });
  it('数组用「；」连接并过滤空值', () => {
    expect(flattenAiText(['a', 'b'])).toBe('a；b');
    expect(flattenAiText(['a', '', 'b'])).toBe('a；b');
  });
  it('{id/target, relation} → "X:Y"', () => {
    expect(flattenAiText({ target: '张三', relation: '好友' })).toBe('张三:好友');
    expect(flattenAiText({ name: '李四', rel: '师父' })).toBe('李四:师父');
  });
  it('普通对象拼其值（「·」连接）', () => {
    expect(flattenAiText({ a: '甲', b: '乙' })).toBe('甲·乙');
  });
  it('嵌套（数组里含关系对象）', () => {
    expect(flattenAiText(['x', { target: '王五', relation: '敌人' }])).toBe('x；王五:敌人');
  });
});
