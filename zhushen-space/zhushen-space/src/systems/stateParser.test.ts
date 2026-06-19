import { describe, it, expect } from 'vitest';
import { lenientJsonParse } from './stateParser';

describe('lenientJsonParse（容忍裸键/单引号/尾逗号的 JSON）', () => {
  it('标准 JSON', () => {
    expect(lenientJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('裸键（无引号）', () => {
    expect(lenientJsonParse('{a:1,b:2}')).toEqual({ a: 1, b: 2 });
  });
  it('尾逗号（对象/数组）', () => {
    expect(lenientJsonParse('{a:1,}')).toEqual({ a: 1 });
    expect(lenientJsonParse('{a:[1,2,],}')).toEqual({ a: [1, 2] });
  });
  it('单引号', () => {
    expect(lenientJsonParse("{'a':'b'}")).toEqual({ a: 'b' });
  });
  it('解析不了 → undefined', () => {
    expect(lenientJsonParse('not json')).toBeUndefined();
    expect(lenientJsonParse('{broken')).toBeUndefined();
  });
});
