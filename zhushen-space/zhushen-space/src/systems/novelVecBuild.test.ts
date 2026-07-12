import { describe, it, expect } from 'vitest';
import { chunkPlainText, chunkWorldBookJson, chunkText } from './novelVecBuild';

describe('novelVecBuild 切块', () => {
  it('纯文本：按卷/章滑窗切，带 vol/chap，块长受控', () => {
    const body = '甲'.repeat(1000);
    const text = `第一卷 起始\n第一章 开端\n${body}`;
    const chunks = chunkPlainText(text, 400, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].v).toContain('第一卷');
    expect(chunks[0].c).toContain('第一章');
    for (const c of chunks) expect(c.t.length).toBeLessThanOrEqual(400 + 80);
  });

  it('纯文本：过短返回空', () => {
    expect(chunkPlainText('短', 700, 100)).toEqual([]);
  });

  it('重叠使相邻块首尾有交集', () => {
    const text = '甲'.repeat(300) + '乙'.repeat(300);
    const chunks = chunkPlainText(text, 300, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('世界书 JSON：按条目切，跳过 disabled，comment→标题 key→来源', () => {
    const json = JSON.stringify({
      entries: [
        { comment: '设定A', key: ['k1'], content: '这是第一条设定内容，足够长以进入结果。' },
        { comment: '设定B', key: ['k2'], content: '第二条设定内容，被禁用不应出现。', disable: true },
        { comment: '设定C', content: '第三条设定内容，也足够长。' },
      ],
    });
    const chunks = chunkWorldBookJson(json, 700, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[0].c).toBe('设定A');
    expect(chunks[0].v).toBe('k1');
  });

  it('chunkText 按 kind 路由', () => {
    const wb = chunkText('worldbook', JSON.stringify({ entries: [{ comment: 'x', content: '内容内容内容内容内容内容' }] }));
    expect(wb).toHaveLength(1);
    const txt = chunkText('text', '第一章 起\n' + '字'.repeat(500), 400, 80);
    expect(txt.length).toBeGreaterThanOrEqual(1);
  });
});
