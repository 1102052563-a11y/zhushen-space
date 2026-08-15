import { describe, it, expect } from 'vitest';
import { splitSegs } from './PrivateFieldValue';

describe('私密词条·复合值分段（治"挤成一坨"）', () => {
  it('分号 / 空格竖线 / 全角竖线 / 换行 都拆开', () => {
    expect(splitSegs('A；B')).toEqual(['A', 'B']);
    expect(splitSegs('A | B')).toEqual(['A', 'B']);
    expect(splitSegs('A｜B')).toEqual(['A', 'B']);
    expect(splitSegs('A\nB')).toEqual(['A', 'B']);
  });
  it('截图那种长复合串拆成多段', () => {
    const v = '粉色【生理】咽喉反射仍明显敏锐 | 反应:【低经验】对亲近本能绷紧；(部位:乳房) 经验:0/穿环:0次';
    const segs = splitSegs(v);
    expect(segs.length).toBe(3);
    expect(segs[0]).toContain('咽喉反射');
    expect(segs[2]).toContain('部位:乳房');
  });
  it('句号+空格转段但保留句号；空段滤除', () => {
    expect(splitSegs('第一句。 第二句')).toEqual(['第一句。', '第二句']);
    expect(splitSegs('A；；B；')).toEqual(['A', 'B']);
  });
  it('单段/空值不误拆（buff 内部无空格竖线不受影响）', () => {
    expect(splitSegs('单独一句话')).toEqual(['单独一句话']);
    expect(splitSegs('效果|激活|层数')).toEqual(['效果|激活|层数']);   // 无空格半角竖线不拆
    expect(splitSegs('')).toEqual([]);
  });
});
