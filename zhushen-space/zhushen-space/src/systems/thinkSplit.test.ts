/* 思维链折叠（P2）：splitThinkStream 流式二分 / extractLeakedThinking 结算抽取。
   口径铁律：extractLeakedThinking 抓到的 = stripLeakedThinking 删掉的（否则同段字既在正文又在折叠块）。 */
import { describe, it, expect } from 'vitest';
import { splitThinkStream, extractLeakedThinking, stripLeakedThinking, streamVisibleNarrative } from './stateApply';

describe('splitThinkStream（流式二分）', () => {
  it('预填开标签：闭合前通篇是思考，实时给 think', () => {
    expect(splitThinkStream('先排节拍……', true)).toEqual({ think: '先排节拍……', visible: null });
  });
  it('闭合后：think=闭合前内容，visible=其后正文', () => {
    expect(splitThinkStream('想完了。</think>\n林源睁开眼。', true)).toEqual({ think: '想完了。', visible: '林源睁开眼。' });
    expect(splitThinkStream('<think>想好了</think>正文开始。', false)).toEqual({ think: '想好了', visible: '正文开始。' });
  });
  it('闭合后正文暂空 → visible 仍为 null（占位不闪空）', () => {
    expect(splitThinkStream('想完了。</think>\n   ', true).visible).toBeNull();
  });
  it('无预填、以 <think 开头（含逐字部分前缀）判思考中', () => {
    expect(splitThinkStream('<think>我先想想', false)).toEqual({ think: '我先想想', visible: null });
    expect(splitThinkStream('<th', false)).toEqual({ think: null, visible: null });
  });
  it('普通正文零改动', () => {
    const n = '正文照旧。';
    expect(splitThinkStream(n, false)).toEqual({ think: null, visible: n });
  });
  it('streamVisibleNarrative 旧接口语义不变（隐藏模式还在用）', () => {
    expect(streamVisibleNarrative('自检完毕。</think>\n林源睁开眼。', true)).toBe('林源睁开眼。');
    expect(streamVisibleNarrative('确认语言，过一遍在场角色……', true)).toBeNull();
  });
});

describe('extractLeakedThinking（结算抽取·严格镜像 strip 口径）', () => {
  it('闭合块：strip 删掉的 = extract 抓到的', () => {
    const s = '<think>推演一下。</think>正文来了。';
    expect(stripLeakedThinking(s)).toBe('正文来了。');
    expect(extractLeakedThinking(s)).toBe('推演一下。');
  });
  it('孤立闭合（prefill 回显）：前缀草稿整段进折叠块', () => {
    const s = '排完节拍。</think>\n正文。';
    expect(stripLeakedThinking(s)).toBe('正文。');
    expect(extractLeakedThinking(s)).toBe('排完节拍。');
  });
  it('未闭合开标签：strip 不动 → extract 也不抓（防同段字双显）', () => {
    const s = '<think>悬空思考没闭合\n正文混着。';
    expect(stripLeakedThinking(s)).toBe(s);
    expect(extractLeakedThinking(s)).toBeNull();
  });
  it('多个闭合块拼接；无思维链返回 null', () => {
    expect(extractLeakedThinking('<think>a</think>中<thinking>b</thinking>尾')).toBe('a\n\nb');
    expect(extractLeakedThinking('纯正文')).toBeNull();
  });
});
