import { describe, it, expect } from 'vitest';
import { parseSearchReply, searchCandidateBlock } from './paradiseSearch';

describe('parseSearchReply', () => {
  it('标准 JSON + claim 归一', () => {
    const r = parseSearchReply('```json\n{"results":[{"title":"坊市异动","source":"云来坊市告示","preview":"三日前起东市封闭","content":"详情正文","claim":"fact"},{"title":"无claim条目","source":"小报","content":"内容","claim":"离谱值"}]}\n```');
    expect(r).toHaveLength(2);
    expect(r[0].claim).toBe('fact');
    expect(r[1].claim).toBe('mixed');
    expect(r[1].preview).toBe('内容');
  });

  it('缺 title/content 的条目丢弃；条数夹到5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, source: 's', content: 'c' }));
    const r = parseSearchReply(JSON.stringify({ results: [{ title: '', content: 'x' }, { title: 'y', content: '' }, ...many] }));
    expect(r).toHaveLength(5);
  });

  it('烂输出返回空数组', () => {
    expect(parseSearchReply('不是JSON')).toHaveLength(0);
    expect(parseSearchReply('')).toHaveLength(0);
  });
});

describe('searchCandidateBlock', () => {
  it('空候选给「禁编大事」兜底文案', () => {
    expect(searchCandidateBlock([])).toContain('禁止编造大事件');
  });
  it('trace 标表象且不给真名', () => {
    const b = searchCandidateBlock([{ refId: 'e1', kind: 'trace', title: '', text: '东城连夜封路，有巡卫盘查', settled: false } as any]);
    expect(b).toContain('[表象]');
    expect(b).toContain('封路');
  });
});
