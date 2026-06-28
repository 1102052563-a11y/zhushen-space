import { describe, it, expect } from 'vitest';
import { toLegalInt, sanitizeSixAttrs, sanitizeItemNumbers } from './numericGate';

describe('numericGate 数值校验闸门（数据库引入③）', () => {
  describe('toLegalInt', () => {
    it('正常数字原样取整', () => { expect(toLegalInt(42)).toBe(42); expect(toLegalInt(3.7)).toBe(4); });
    it('字符串数字 → 数字', () => { expect(toLegalInt('80')).toBe(80); });
    it('从 "很强(99)" 挖出数字', () => { expect(toLegalInt('很强(99)')).toBe(99); });
    it('纯垃圾 → fallback', () => { expect(toLegalInt('很强', 5)).toBe(5); expect(toLegalInt(undefined, 1)).toBe(1); });
    it('负数夹到 min', () => { expect(toLegalInt(-3, 0, 0)).toBe(0); });
    it('超 max 夹回', () => { expect(toLegalInt(99, 0, 0, 16)).toBe(16); });
  });

  describe('sanitizeSixAttrs', () => {
    it('★非数字/负/小数六维 → 夹成合法整数，报告改了哪几维', () => {
      const r = sanitizeSixAttrs({ str: '很强', agi: 10, con: -5, int: 8.6, cha: 7, luck: 5 });
      expect(r.attrs.str).toBe(0);    // 垃圾字符串 → 0
      expect(r.attrs.con).toBe(0);    // 负 → 0
      expect(r.attrs.int).toBe(9);    // 小数 → 取整
      expect(r.attrs.agi).toBe(10);   // 合法不动
      expect(r.fixed.sort()).toEqual(['con', 'int', 'str']);
    });
    it('全合法 → fixed 为空、不动', () => {
      expect(sanitizeSixAttrs({ str: 10, agi: 10, con: 10, int: 10, cha: 10, luck: 10 }).fixed).toEqual([]);
    });
    it('缺某维 → 不补不动', () => {
      expect(sanitizeSixAttrs({ str: 10 }).attrs.agi).toBeUndefined();
    });
  });

  describe('sanitizeItemNumbers', () => {
    it('数量为字符串/负 → 夹', () => {
      expect(sanitizeItemNumbers({ quantity: '3' })).toEqual({ quantity: 3 });
      expect(sanitizeItemNumbers({ quantity: -2 })).toEqual({ quantity: 0 });
    });
    it('强化等级超上限 → 夹到 maxEnhanceLevel', () => {
      expect(sanitizeItemNumbers({ enhanceLevel: 99, maxEnhanceLevel: 12 })).toEqual({ enhanceLevel: 12 });
    });
    it('合法 → null（无需写回）', () => {
      expect(sanitizeItemNumbers({ quantity: 3, enhanceLevel: 2, maxEnhanceLevel: 16 })).toBeNull();
    });
  });
});
