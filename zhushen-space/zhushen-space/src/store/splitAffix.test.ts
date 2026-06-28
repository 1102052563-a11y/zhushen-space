import { describe, it, expect } from 'vitest';
import { splitAffixEntries } from './itemStore';

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
});
