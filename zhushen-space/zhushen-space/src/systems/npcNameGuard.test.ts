import { describe, it, expect } from 'vitest';
import { buildAliasSchema, shouldMerge } from './npcNameGuard';

describe('npcNameGuard · buildAliasSchema 动态枚举', () => {
  it('enum = 现有名 + 哨兵 __NEW__', () => {
    const s = buildAliasSchema(['卡尔', '奥娜']) as any;
    expect(s.type).toBe('object');
    expect(s.properties.canonical.enum).toEqual(['卡尔', '奥娜', '__NEW__']);
    expect(s.properties.confidence.enum).toEqual(['high', 'low']);
    expect(s.required).toEqual(['canonical', 'confidence']);
    expect(s.additionalProperties).toBe(false);
  });
  it('名单超上限被截断（护 token/schema 体量），哨兵仍在', () => {
    const many = Array.from({ length: 60 }, (_, i) => `N${i}`);
    const s = buildAliasSchema(many) as any;
    expect(s.properties.canonical.enum.length).toBe(41);        // 40 名 + __NEW__
    expect(s.properties.canonical.enum.at(-1)).toBe('__NEW__');
  });
});

describe('npcNameGuard · shouldMerge 只在「现有名 + high」时动手', () => {
  const existing = ['卡尔', '奥娜'];
  it('现有名 + high → 返回规范名', () => {
    expect(shouldMerge({ canonical: '卡尔', confidence: 'high' }, existing)).toBe('卡尔');
  });
  it('__NEW__ → 不合并', () => {
    expect(shouldMerge({ canonical: '__NEW__', confidence: 'high' }, existing)).toBeNull();
  });
  it('把握 low → 不合并（宁可留着也不误并两个不同人）', () => {
    expect(shouldMerge({ canonical: '卡尔', confidence: 'low' }, existing)).toBeNull();
  });
  it('越界名（不在现有名单）→ 不合并（双保险，模型即便越界也不误 merge）', () => {
    expect(shouldMerge({ canonical: '卡尔特', confidence: 'high' }, existing)).toBeNull();
  });
  it('空/残缺裁决 → 不合并', () => {
    expect(shouldMerge(null, existing)).toBeNull();
    expect(shouldMerge(undefined, existing)).toBeNull();
    expect(shouldMerge({ confidence: 'high' }, existing)).toBeNull();
  });
});
