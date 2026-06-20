import { describe, it, expect } from 'vitest';
import { sanitizeEntryName, stripLeakedThinking } from './stateApply';

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

describe('stripLeakedThinking（剥泄漏进正文的思维链块）', () => {
  it('删任意位置的闭合 think/thinking/thought 块', () => {
    expect(stripLeakedThinking('<think>盘算一下</think>正文开始')).toBe('正文开始');
    expect(stripLeakedThinking('前文<thinking>x\ny</thinking>后文')).toBe('前文后文');
    expect(stripLeakedThinking('<thought>a</thought>正文')).toBe('正文');
  });
  it('删开头孤立的 </think>（预填充回显残留）', () => {
    expect(stripLeakedThinking('</think>\n正文')).toBe('正文');
  });
  it('未闭合的开标签不动（避免把悬空链内容暴露成正文）', () => {
    expect(stripLeakedThinking('<think>还没说完就被截断')).toBe('<think>还没说完就被截断');
  });
  it('无思维链 / 空值 → 原样', () => {
    expect(stripLeakedThinking('一段普通正文，没有标签。')).toBe('一段普通正文，没有标签。');
    expect(stripLeakedThinking('')).toBe('');
  });
});
