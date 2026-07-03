import { describe, it, expect } from 'vitest';
import { splitAffixEntries, asText } from './itemStore';

describe('splitAffixEntries 词缀拆条（兼容数组 / JSON 数组串）', () => {
  it('普通【…】文本逐条', () => {
    expect(splitAffixEntries('【烈焰】：火伤+15%【冰封】：减速')).toEqual(['【烈焰】：火伤+15%', '【冰封】：减速']);
  });

  it('★JSON 数组串 ["a","b","c"] → 逐条（治"词缀显示成 [\"…\",\"…\"]"怪格式）', () => {
    const raw = '["【绝对和谐】：无效化。","【马赛克的尊严】：减伤99%。","【薛定谔的透视】：命中-50%。"]';
    expect(splitAffixEntries(raw)).toEqual(['【绝对和谐】：无效化。', '【马赛克的尊严】：减伤99%。', '【薛定谔的透视】：命中-50%。']);
  });

  it('本就是数组 → 逐条', () => {
    expect(splitAffixEntries(['【A】：x', '【B】：y'] as any)).toEqual(['【A】：x', '【B】：y']);
  });

  it('空 / undefined → []', () => {
    expect(splitAffixEntries('')).toEqual([]);
    expect(splitAffixEntries(undefined)).toEqual([]);
  });

  it('无【】单段原样', () => {
    expect(splitAffixEntries('单条说明')).toEqual(['单条说明']);
  });

  it('★数组里是 {name,desc} 对象 → "名：说明"（治 [object Object] / React #31 崩溃）', () => {
    expect(splitAffixEntries([{ name: '【绝对和谐】', desc: '无效化' }, { name: '【马赛克】', desc: '减伤99%' }] as any))
      .toEqual(['【绝对和谐】：无效化', '【马赛克】：减伤99%']);
  });

  it('★JSON 数组串里是对象 → 同样拆出', () => {
    const raw = JSON.stringify([{ name: '【A】', desc: 'x' }, { name: '【B】', desc: 'y' }]);
    expect(splitAffixEntries(raw)).toEqual(['【A】：x', '【B】：y']);
  });

  it('★{name,value}（三分：数值在 value）→ 保留 value 不丢', () => {
    expect(splitAffixEntries([{ name: '【暴击】', value: '+30%' }] as any)).toEqual(['【暴击】：+30%']);
  });

  it('★词缀字段本身又是对象(嵌套 {effect:{desc,value}}) → 递归扁平化，绝不出现 [object Object]（频道交易 [object Object] 根因）', () => {
    const nested = [
      { name: '【终末·湮灭】', effect: { desc: '附带终末权能', value: '0.3' } },
      { effect: { desc: '星骸共鸣' } },   // 缺 name，只有嵌套对象
    ] as any;
    const out = splitAffixEntries(nested);
    expect(out).toHaveLength(2);
    expect(out.join('|')).not.toContain('[object Object]');
    expect(out[0]).toContain('【终末·湮灭】');
    expect(out.join('|')).toContain('附带终末权能');
  });

  it('★单个对象(非数组) → 走扁平化而非 String()→[object Object]', () => {
    expect(splitAffixEntries({ name: '【孤】', desc: '单条' } as any)).toEqual(['【孤】：单条']);
    expect(splitAffixEntries({ foo: { bar: 1 } } as any).join('|')).not.toContain('[object Object]');
  });
});

describe('asText 对象兜底（防 React #31）', () => {
  it('{name,desc} → "名：说明"', () => {
    expect(asText({ name: '【绝对和谐】', desc: '无效化' })).toBe('【绝对和谐】：无效化');
  });
  it('对象数组 → 逐条 / 连接', () => {
    expect(asText([{ name: '【A】', desc: 'x' }, { name: '【B】', desc: 'y' }])).toBe('【A】：x / 【B】：y');
  });
  it('字符串/数字原样', () => {
    expect(asText('干净文本')).toBe('干净文本');
    expect(asText(42)).toBe('42');
  });
});
