// 世界详情库·世界名解析（resolveWorldNameFrom）：worldName 由杂项演化按正文改写，会漂移出
// 空格/标点/「世界名+地点」等变体——测精确/归一/双向子串三级匹配与防误并。
import { describe, it, expect } from 'vitest';
import { resolveWorldNameFrom } from './worldDetail';

const NAMES = ['我欲封天', '火影忍者', '仙逆', '一拳超人', '刀剑神域', 'Fate/Zero', '仙剑奇侠传四'];

describe('resolveWorldNameFrom', () => {
  it('精确命中', () => {
    expect(resolveWorldNameFrom(NAMES, '火影忍者')).toBe('火影忍者');
  });

  it('归一相等：空格/间隔号/大小写差异', () => {
    expect(resolveWorldNameFrom(NAMES, '火影 忍者')).toBe('火影忍者');
    expect(resolveWorldNameFrom(NAMES, '刀剑·神域')).toBe('刀剑神域');
    expect(resolveWorldNameFrom(NAMES, 'fate/zero')).toBe('Fate/Zero');
  });

  it('子串：worldName 带地点后缀（库名 ⊂ raw）', () => {
    expect(resolveWorldNameFrom(NAMES, '火影忍者·木叶村')).toBe('火影忍者');
    expect(resolveWorldNameFrom(NAMES, '我欲封天（云杰郡）')).toBe('我欲封天');
  });

  it('子串：raw 是库名前缀（raw ⊂ 库名）取最长命中', () => {
    expect(resolveWorldNameFrom(NAMES, '仙剑奇侠传')).toBe('仙剑奇侠传四');
  });

  it('多候选子串取最长：不把「仙逆」误配给更短的碎片', () => {
    // 「仙剑奇侠传四」含「仙」，「仙逆」也含「仙」——raw「仙逆前传」应命中「仙逆」（最长可含子串）
    expect(resolveWorldNameFrom(NAMES, '仙逆·铁柱村')).toBe('仙逆');
  });

  it('防误并：空串/过短/毫无交集不命中', () => {
    expect(resolveWorldNameFrom(NAMES, '')).toBeNull();
    expect(resolveWorldNameFrom(NAMES, '仙')).toBeNull();          // 归一后 <2 字，不模糊
    expect(resolveWorldNameFrom(NAMES, '轮回乐园')).toBeNull();     // 不在库
    expect(resolveWorldNameFrom(NAMES, '主神空间')).toBeNull();
  });

  it('候选为空数组不崩', () => {
    expect(resolveWorldNameFrom([], '火影忍者')).toBeNull();
  });
});
