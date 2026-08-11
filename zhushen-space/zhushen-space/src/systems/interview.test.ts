import { describe, it, expect } from 'vitest';
import { parseInterview, interviewToHtml, interviewToText } from './interview';
import type { InterviewRecord } from '../store/interviewStore';

const SAMPLE = `标题: 七阶大人的一天
导语: 我们把话筒递到了她的面前。
问(姬记者): 最近坊间都说你换了新武器？
答(白夜): （挑眉）消息挺灵通啊。
旁白: 她把刀转了个花。
答(白夜): 不过来历保密。
这是被折行的续行。
手记: 有些答案，本身就是态度。`;

describe('🎤 大采访·行协议解析', () => {
  it('标题/导语/问/答/旁白/手记 各归其位，续行并进上一段', () => {
    const p = parseInterview(SAMPLE);
    expect(p.title).toBe('七阶大人的一天');
    expect(p.intro).toContain('话筒');
    expect(p.epilogue).toContain('态度');
    expect(p.segments).toHaveLength(4);
    expect(p.segments[0]).toMatchObject({ kind: 'q', speaker: '姬记者' });
    expect(p.segments[1]).toMatchObject({ kind: 'a', speaker: '白夜' });
    expect(p.segments[2].kind).toBe('nar');
    expect(p.segments[3].text).toContain('续行');
  });
  it('全角冒号/括号也认；无协议文本=空段（面板回退 rawText）', () => {
    const p = parseInterview('标题：测试\n问（记者）：好吗？\n答（甲）：好。');
    expect(p.title).toBe('测试');
    expect(p.segments).toHaveLength(2);
    expect(parseInterview('随便一段散文，没有任何前缀').segments).toHaveLength(0);
  });
});

describe('🎤 导出', () => {
  const rec: InterviewRecord = {
    id: 'iv_x', createdAt: 0, title: '标<题>', intro: '导语', epilogue: '手记',
    segments: [{ kind: 'q', speaker: '记', text: 'A<b>' }, { kind: 'a', speaker: '答', text: 'B' }, { kind: 'nar', text: 'N' }],
    rawText: 'raw', interviewers: ['记'], interviewees: ['答'], location: '某地', worldName: '世界', worldTime: '三月初',
  };
  it('HTML 自包含且转义、文本导出含问答', () => {
    const html = interviewToHtml(rec);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('标&lt;题&gt;');
    expect(html).toContain('A&lt;b&gt;');
    expect(html).not.toContain('<b>');
    const txt = interviewToText(rec);
    expect(txt).toContain('问（记）：A<b>');
    expect(txt).toContain('答（答）：B');
  });
});
