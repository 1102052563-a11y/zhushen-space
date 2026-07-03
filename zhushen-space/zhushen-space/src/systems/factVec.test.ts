import { describe, it, expect } from 'vitest';
import { buildMemPool } from './factVec';

const src = {
  narrativeFacts: [{ title: '契约', text: '主角与芙莉莲结契', keywords: ['契约', '芙莉莲'] }],
  largeSummaries: ['第一阶段大总结'],
  smallSummaries: ['本回合小结'],
  worldEvents: [{ time: '第3天', location: '深渊', desc: '巴卡尔苏醒' }],
};

describe('buildMemPool · factsOnly（只召回长期事实）', () => {
  it('默认(factsOnly=false)：长期事实 + 小结 + 大结 + 世界大事都进池', () => {
    const kinds = buildMemPool(src).map((p) => p.kind).sort();
    expect(kinds).toEqual(['event', 'fact', 'large', 'small']);
  });

  it('★factsOnly=true：只放长期事实，其他都不进池', () => {
    const pool = buildMemPool(src, 1000, true);
    expect(pool.length).toBe(1);
    expect(pool[0].kind).toBe('fact');
    expect(pool.some((p) => p.kind !== 'fact')).toBe(false);
    expect(pool[0].body).toBe('主角与芙莉莲结契');   // body=注入正文的文本
  });

  it('factsOnly=true 但无长期事实 → 空池（小结/大结/世界大事一律不进）', () => {
    expect(buildMemPool({ largeSummaries: ['x'], smallSummaries: ['y'], worldEvents: [{ time: 't', location: 'l', desc: 'd' }] }, 1000, true)).toEqual([]);
  });
});
