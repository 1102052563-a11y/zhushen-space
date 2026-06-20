import { describe, it, expect } from 'vitest';
import { sanitizeEntryName, stripLeakedThinking, maskProtectedBlocks, restoreProtectedBlocks } from './stateApply';

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

describe('maskProtectedBlocks / restoreProtectedBlocks（两段式渲染·保护状态栏/任务块）', () => {
  const SAMPLE = [
    '时间结算块',
    '时间结算：+3分钟',
    '',
    '【主角资源】',
    'HP：100/100',
    '',
    '正文第一段。',
    '',
    '【任务目标：进西侧】',
    '',
    '正文第二段。',
  ].join('\n');

  it('把时间结算块 + 【】块替换成 〔§N〕，正文保留', () => {
    const { masked, blocks } = maskProtectedBlocks(SAMPLE);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe('时间结算块\n时间结算：+3分钟');
    expect(blocks[1]).toBe('【主角资源】\nHP：100/100');
    expect(blocks[2]).toBe('【任务目标：进西侧】');
    expect(masked).toContain('〔§0〕');
    expect(masked).toContain('正文第一段。');
    expect(masked).not.toContain('HP：100/100');   // 块已被遮起来，不进渲染
  });

  it('★round-trip：渲染保住占位符 → 原样还原', () => {
    const { masked, blocks } = maskProtectedBlocks(SAMPLE);
    expect(restoreProtectedBlocks(masked, blocks)).toBe(SAMPLE);
  });

  it('★信息不丢：渲染模型漏掉占位符 → 块补回开头', () => {
    const { blocks } = maskProtectedBlocks(SAMPLE);
    const renderedNoSentinels = '润色后的第一段。\n\n润色后的第二段。';   // 模型把占位符弄丢了
    const out = restoreProtectedBlocks(renderedNoSentinels, blocks);
    for (const b of blocks) expect(out).toContain(b);   // 三个块都还在
    expect(out).toContain('润色后的第一段。');
  });

  it('★流式模式(prependDropped=false)：只替换已出现的占位符，未到的块不补到开头', () => {
    const { blocks } = maskProtectedBlocks(SAMPLE);
    const partial = '〔§0〕\n\n刚写到这一半。';   // 流式中途，只来了第 0 个占位符
    const out = restoreProtectedBlocks(partial, blocks, false);
    expect(out).toContain(blocks[0]);        // 已出现 → 替换
    expect(out).not.toContain(blocks[1]);    // 未出现 → 不补到开头（还在流的路上）
    expect(out).toContain('刚写到这一半。');
  });

  it('无保护块 → masked 等于原文、restore 原样', () => {
    const { masked, blocks } = maskProtectedBlocks('纯正文一段。\n纯正文两段。');
    expect(blocks).toHaveLength(0);
    expect(masked).toBe('纯正文一段。\n纯正文两段。');
    expect(restoreProtectedBlocks('纯正文一段。', [])).toBe('纯正文一段。');
  });
});
