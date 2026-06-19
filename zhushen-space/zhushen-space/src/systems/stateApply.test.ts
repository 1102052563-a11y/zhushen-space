import { describe, it, expect } from 'vitest';
import { sanitizeEntryName } from './stateApply';

describe('sanitizeEntryName（新角色姓名清洗·ENTRY_NAME_CN 轻量护栏）', () => {
  it('剥括号里的罗马音注释，保留中文', () => {
    expect(sanitizeEntryName('艾莉丝(Alice)')).toBe('艾莉丝');
    expect(sanitizeEntryName('凛（Rin）')).toBe('凛');
  });
  it('剥中文名尾部的「·英文 / 空格英文」', () => {
    expect(sanitizeEntryName('卡尔·Karl')).toBe('卡尔');
    expect(sanitizeEntryName('凛 Rin')).toBe('凛');
  });
  it('纯中文名 / 全中文音译 → 原样不动', () => {
    expect(sanitizeEntryName('苏晓')).toBe('苏晓');
    expect(sanitizeEntryName('约翰·史密斯')).toBe('约翰·史密斯');
  });
  it('纯英文/罗马音名无法机翻 → 原样返回（不删空、由调用方告警）', () => {
    expect(sanitizeEntryName('Alice')).toBe('Alice');
    expect(sanitizeEntryName('John Smith')).toBe('John Smith');
  });
  it('空值', () => {
    expect(sanitizeEntryName('')).toBe('');
    expect(sanitizeEntryName(undefined)).toBe('');
  });
});
