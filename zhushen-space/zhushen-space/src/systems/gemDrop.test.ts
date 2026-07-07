import { describe, it, expect } from 'vitest';
import { countPlayerKills, gemDropGrade, rollGemDrops, GEM_DROP_DEFAULT } from './gemDrop';

describe('countPlayerKills', () => {
  it('<击杀结算> 块：行数−表头', () => {
    const narr = '正文…\n<击杀结算>\n主角 +3 → 12\n哥布林|同阶|主角+1\n狼|碾压|主角+1\n</击杀结算>\n后续';
    expect(countPlayerKills(narr)).toBe(2);
  });
  it('无块 + 击杀动词 → 关键词兜底计数', () => {
    expect(countPlayerKills('他一刀斩杀了魔物。')).toBe(1);
    expect(countPlayerKills('斩杀第一个，又击杀第二个。')).toBe(2);
  });
  it('主角自身死亡 → 不触发（关键词兜底）', () => {
    expect(countPlayerKills('主角被击杀，当场身亡。')).toBe(0);
  });
  it('无击杀 → 0', () => expect(countPlayerKills('风和日丽，什么都没发生。')).toBe(0));
  it('块行数封顶 8', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `敌${i}|同阶|主角+1`).join('\n');
    expect(countPlayerKills(`<击杀结算>\n头\n${rows}\n</击杀结算>`)).toBe(8);
  });
});

describe('gemDropGrade（品级随主角进度缩放）', () => {
  it('一阶普通掉落 → 白色（rng=0.5，不跳档）', () => {
    expect(gemDropGrade('一阶', 1, () => 0.5)).toBe('白色');
  });
  it('跳档惊喜（rng<0.12 → +2）', () => {
    expect(gemDropGrade('一阶', 1, () => 0.05)).toBe('蓝色');   // 1 + 2 = 3 档
  });
  it('高阶主角掉高阶宝石', () => {
    const g = gemDropGrade('绝强', 95, () => 0.5);
    expect(typeof g).toBe('string');
    expect(g.length).toBeGreaterThan(0);
  });
});

describe('rollGemDrops', () => {
  it('禁用 → 空', () => {
    const drops = rollGemDrops('<击杀结算>\n头\n敌|同阶|主角+1\n</击杀结算>', {
      tier: '一阶', level: 1, config: { ...GEM_DROP_DEFAULT, enabled: false }, rng: () => 0,
    });
    expect(drops).toEqual([]);
  });
  it('必定掉落（rng=0<rate）：数量=min(击杀数, maxPerTurn)，全为宝石且标记击杀掉落', () => {
    const narr = '<击杀结算>\n头\nA|同阶|主角+1\nB|同阶|主角+1\n</击杀结算>';
    const drops = rollGemDrops(narr, { tier: '三阶', level: 25, config: { enabled: true, rate: 0.5, maxPerTurn: 3 }, rng: () => 0 });
    expect(drops).toHaveLength(2);
    for (const d of drops) {
      expect(d.category).toBe('宝石');
      expect(d.acquisition).toBe('击杀掉落');
      expect(d.tags).toContain('掉落');
      expect(d.gemSet).toBeTruthy();
    }
  });
  it('必不掉落（rng=0.99≥rate）→ 空', () => {
    const narr = '<击杀结算>\n头\nA|同阶|主角+1\n</击杀结算>';
    expect(rollGemDrops(narr, { tier: '一阶', level: 1, config: { enabled: true, rate: 0.16, maxPerTurn: 3 }, rng: () => 0.99 })).toEqual([]);
  });
  it('无击杀 → 空', () => {
    expect(rollGemDrops('平静的一天', { tier: '一阶', level: 1, rng: () => 0 })).toEqual([]);
  });
  it('maxPerTurn 封顶', () => {
    const rows = Array.from({ length: 8 }, (_, i) => `敌${i}|同阶|主角+1`).join('\n');
    const drops = rollGemDrops(`<击杀结算>\n头\n${rows}\n</击杀结算>`, {
      tier: '五阶', level: 45, config: { enabled: true, rate: 1, maxPerTurn: 2 }, rng: () => 0,
    });
    expect(drops).toHaveLength(2);
  });
});
