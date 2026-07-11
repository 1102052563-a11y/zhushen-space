import { describe, it, expect } from 'vitest';
import { toHtmlWithImages, ttsAttribSpeaker } from './narrativeHtml';

describe('narrativeHtml · ttsAttribSpeaker 对话归属', () => {
  const known = ['卡尔', '奥娜'];
  it('名字+说话动词 → 命中', () => {
    expect(ttsAttribSpeaker('卡尔冷笑道：', known)).toBe('卡尔');
    expect(ttsAttribSpeaker('奥娜轻声说：', known)).toBe('奥娜');
  });
  it('无动词但有名字 → 兜底取最后出现的', () => {
    expect(ttsAttribSpeaker('卡尔与奥娜并肩而立。', known)).toBe('奥娜');
  });
  it('无已知名字 / 空 → undefined', () => {
    expect(ttsAttribSpeaker('远处传来声音。', known)).toBeUndefined();
    expect(ttsAttribSpeaker('', known)).toBeUndefined();
  });
});

describe('narrativeHtml · 对话小喇叭注入', () => {
  it('speakable 时每句对话末尾插 dialogue-play 图标 + 归属说话人', () => {
    const html = toHtmlWithImages('卡尔说：「上吧！」他挥了挥手。', undefined, { speakable: true, npcNames: ['卡尔'] });
    expect(html).toContain('class="dialogue-play"');
    expect(html).toContain('data-line="上吧！"');
    expect(html).toContain('data-speaker="卡尔"');
  });
  it('不开 speakable 时不注入', () => {
    const html = toHtmlWithImages('卡尔说：「上吧！」', undefined);
    expect(html).not.toContain('dialogue-play');
  });
  it('归属不到说话人 → data-speaker 为空（仍可点朗读）', () => {
    const html = toHtmlWithImages('「谁在那里？」', undefined, { speakable: true, npcNames: ['卡尔'] });
    expect(html).toContain('class="dialogue-play"');
    expect(html).toContain('data-speaker=""');
  });
  it('对话内 & 被转义进属性（可安全放 data-line）', () => {
    const html = toHtmlWithImages('他嘀咕：「涨了&跌了」', undefined, { speakable: true, npcNames: [] });
    expect(html).toContain('data-line="涨了&amp;跌了"');
  });
  it('“”双引号对话也识别', () => {
    const html = toHtmlWithImages('她道：“好的。”', undefined, { speakable: true, npcNames: [] });
    expect(html).toContain('data-line="好的。"');
  });
});
