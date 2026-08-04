import { describe, it, expect } from 'vitest';
import {
  drawDivination, divinationSeed, drawPool, buildDivinationInjection,
  hasDivinationLeak, scrubDivination, ICHING, MAJOR_ARCANA, MINOR_ARCANA,
} from './divination';

describe('divination · 抽取确定性', () => {
  it('同 seed 必得同结果（跨读档/回退不跳）', () => {
    const a = drawDivination(12345);
    const b = drawDivination(12345);
    expect(a).toEqual(b);
  });

  it('不同 seed 大概率不同（抽 30 组至少出现 10 种宏观层）', () => {
    const macros = new Set(Array.from({ length: 30 }, (_, i) => drawDivination(i * 7919).macro));
    expect(macros.size).toBeGreaterThanOrEqual(10);
  });

  it('divinationSeed 绑「世界+事件」，不绑回合', () => {
    expect(divinationSeed('wr_1', 'W_3')).toBe(divinationSeed('wr_1', 'W_3'));
    expect(divinationSeed('wr_1', 'W_3')).not.toBe(divinationSeed('wr_1', 'W_4'));
    expect(divinationSeed('wr_1', 'W_3')).not.toBe(divinationSeed('wr_2', 'W_3'));
  });

  it('三层格式：宏观=符号·卦名，发展/细节=3 张顿号分隔', () => {
    const d = drawDivination(999);
    const [sym, name] = d.macro.split('·');
    expect(ICHING.some((h) => h.symbol === sym && h.name === name)).toBe(true);
    const dev = d.dev.split('、');
    const det = d.detail.split('、');
    expect(dev).toHaveLength(3);
    expect(det).toHaveLength(3);
    for (const c of dev) expect(MAJOR_ARCANA).toContain(c.replace('(逆位)', ''));
    for (const c of det) expect(MINOR_ARCANA).toContain(c.replace('(逆位)', ''));
  });

  it('同一组内无放回（3 张互不重复）', () => {
    for (const seed of [1, 42, 777, 20260804]) {
      const d = drawDivination(seed);
      const dev = d.dev.split('、').map((c) => c.replace('(逆位)', ''));
      const det = d.detail.split('、').map((c) => c.replace('(逆位)', ''));
      expect(new Set(dev).size).toBe(3);
      expect(new Set(det).size).toBe(3);
    }
  });

  it('drawPool 出 n 组且组间不同', () => {
    const pool = drawPool(555, 5);
    expect(pool).toHaveLength(5);
    expect(new Set(pool.map((p) => `${p.macro}|${p.dev}`)).size).toBeGreaterThan(1);
  });
});

describe('divination · 注入块', () => {
  it('空数组不出块', () => {
    expect(buildDivinationInjection([])).toBe('');
  });

  it('出块含三层 + 解读指南 + 封词铁则', () => {
    const s = buildDivinationInjection([drawDivination(1)]);
    expect(s).toContain('<命运罗盘>');
    expect(s).toContain('宏观:');
    expect(s).toContain('解读指南');
    expect(s).toContain('禁止把占卜术语写进任何产出内容');
    expect(s).toContain('</命运罗盘>');
  });

  it('多组时带序号', () => {
    const s = buildDivinationInjection(drawPool(2, 3));
    expect(s).toContain('1. 宏观:');
    expect(s).toContain('3. 宏观:');
  });
});

describe('divination · 泄漏检测与清洗（提示词失守时的机读护栏）', () => {
  it('识别卦象符号 / 牌名 / 逆位 / 元词', () => {
    expect(hasDivinationLeak('局势如䷿一般晦暗')).toBe(true);
    expect(hasDivinationLeak('此事应高塔之象')).toBe(true);
    expect(hasDivinationLeak('皇帝(逆位)、节制')).toBe(true);
    expect(hasDivinationLeak('大阿卡那指示凶兆')).toBe(true);
    expect(hasDivinationLeak('城南米价上涨，米商囤积居奇')).toBe(false);
    expect(hasDivinationLeak('')).toBe(false);
    expect(hasDivinationLeak(undefined)).toBe(false);
  });

  it('多次调用结果稳定（正则带 g 标志时的 lastIndex 陷阱）', () => {
    const t = '此事应高塔之象';
    expect(hasDivinationLeak(t)).toBe(true);
    expect(hasDivinationLeak(t)).toBe(true);
    expect(hasDivinationLeak(t)).toBe(true);
  });

  it('scrubDivination 剥词并清理残留标点', () => {
    expect(scrubDivination('旧秩序松动（高塔(逆位)）')).toBe('旧秩序松动');
    expect(scrubDivination('皇帝(逆位)、节制、力量')).toBe('');
    expect(scrubDivination('米价上涨')).toBe('米价上涨');
  });

  it('清洗后不再有泄漏', () => {
    const dirty = '局势如䷿·未济，应高塔(逆位)之兆，星币五当头';
    expect(hasDivinationLeak(scrubDivination(dirty))).toBe(false);
  });
});
