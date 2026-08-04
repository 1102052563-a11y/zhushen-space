import { describe, it, expect } from 'vitest';
import {
  CRITICAL_AT, INTENSITY_WEIGHT, BALANCE_BAND, normIntensity, normDirection, phaseOf,
  netIntervention, verdictOf, VERDICT_LABEL, stepProgress, needsCriticalEvent, defaultCriticalName,
  planMerges, applyMerge, formatEra, serializeErasForEvo,
  type PotentialEra, type ChainNode,
} from './eraModel';

const node = (direction: ChainNode['direction'], intensity: ChainNode['intensity']): ChainNode => ({ direction, intensity });
const era = (p: Partial<PotentialEra> = {}): PotentialEra => ({
  name: '灵潮复苏', pct: 20, phase: '萌芽', drivers: '', blockers: '', desc: '', chain: [], ...p,
});

describe('eraModel · 归一与阶段', () => {
  it('normIntensity / normDirection', () => {
    expect(normIntensity('高强度')).toBe('高');
    expect(normIntensity('轻微')).toBe('低');
    expect(normIntensity('说不清')).toBe('中');
    expect(normDirection('抑止')).toBe('抑止');
    expect(normDirection('遏制')).toBe('抑止');
    expect(normDirection('推动')).toBe('推动');
    expect(normDirection(undefined)).toBe('推动');
  });

  it('phaseOf 分三段，80% 即临界', () => {
    expect(phaseOf(10)).toBe('萌芽');
    expect(phaseOf(50)).toBe('发展');
    expect(phaseOf(CRITICAL_AT)).toBe('临界');
    expect(phaseOf(100)).toBe('临界');
  });
});

describe('eraModel · 净干预与裁决', () => {
  it('按强度加权求和：高±2 / 中±1 / 低±0.5', () => {
    expect(netIntervention([node('推动', '高')])).toBe(INTENSITY_WEIGHT.高);
    expect(netIntervention([node('抑止', '高')])).toBe(-INTENSITY_WEIGHT.高);
    expect(netIntervention([node('推动', '高'), node('抑止', '中'), node('推动', '低')])).toBe(2 - 1 + 0.5);
    expect(netIntervention([])).toBe(0);
  });

  it('偏推动=定鼎、偏抑止=归墟、势均力敌=派生后续', () => {
    expect(verdictOf(3)).toBe('settle');
    expect(verdictOf(-3)).toBe('void');
    expect(verdictOf(0)).toBe('derive');
    expect(verdictOf(BALANCE_BAND - 0.1)).toBe('derive');
    expect(verdictOf(BALANCE_BAND)).toBe('settle');
    expect(VERDICT_LABEL.settle).toBe('定鼎');
  });
});

describe('eraModel · 进度（单向不可回退）', () => {
  it('推动多 → 涨得快', () => {
    const a = stepProgress(20, [node('推动', '高'), node('推动', '高')]);
    const b = stepProgress(20, [node('推动', '低')]);
    expect(a).toBeGreaterThan(b);
  });

  it('⚠ 被压制也**绝不倒退**，只是涨得极慢', () => {
    const next = stepProgress(50, [node('抑止', '高'), node('抑止', '高')]);
    expect(next).toBeGreaterThanOrEqual(50);
    expect(next - 50).toBeLessThanOrEqual(1);
  });

  it('封顶 100，且单次涨幅有上限（防一步登天）', () => {
    expect(stepProgress(99, Array.from({ length: 20 }, () => node('推动', '高')))).toBe(100);
    expect(stepProgress(0, Array.from({ length: 20 }, () => node('推动', '高')))).toBeLessThanOrEqual(12);
  });
});

describe('eraModel · 临界事件派生', () => {
  it('达 80% 且无关联临界事件 → 该派生', () => {
    expect(needsCriticalEvent(era({ pct: CRITICAL_AT }))).toBe(true);
    expect(needsCriticalEvent(era({ pct: 79 }))).toBe(false);
    expect(needsCriticalEvent(era({ pct: 90, criticalEvent: '灵寂大劫' }))).toBe(false);
  });

  it('默认临界事件名可用且带原时代名', () => {
    expect(defaultCriticalName(era({ name: '灵潮复苏' }))).toContain('灵潮复苏');
  });
});

describe('eraModel · 合并（保守：至少 2 个公共词）', () => {
  it('关联的两条被识别为可合并', () => {
    const list = [
      era({ name: '灵气狂暴化', desc: '灵气 狂暴 妖兽 异变' }),
      era({ name: '妖兽大规模异变', desc: '妖兽 异变 灵气 开智' }),
    ];
    const plans = planMerges(list);
    expect(plans).toHaveLength(1);
    expect(plans[0].absorb).toContain('妖兽大规模异变');
  });

  it('⚠ 不相干的绝不合并（宁可不并）', () => {
    const list = [
      era({ name: '灵潮复苏', desc: '灵气 回归 修行' }),
      era({ name: '星际殖民', desc: '曲率 航道 殖民' }),
    ];
    expect(planMerges(list)).toEqual([]);
  });

  it('合并执行：进度取最高、脉络合并、开始日期取最早', () => {
    const list = [
      era({ name: 'A', desc: '灵气 妖兽', pct: 30, startDate: '3年5月', chain: [node('推动', '中')] }),
      era({ name: 'B', desc: '灵气 妖兽', pct: 55, startDate: '2年1月', chain: [node('抑止', '低')] }),
    ];
    const merged = applyMerge(list, planMerges(list)[0]);
    expect(merged).toHaveLength(1);
    expect(merged[0].pct).toBe(55);
    expect(merged[0].startDate).toBe('2年1月');
    expect(merged[0].chain).toHaveLength(2);
    expect(merged[0].phase).toBe('发展');
  });

  it('目标不存在时原样返回，不炸', () => {
    const list = [era({ name: 'A' })];
    expect(applyMerge(list, { keep: '不存在', absorb: ['A'] })).toBe(list);
  });
});

describe('eraModel · 序列化', () => {
  it('formatEra 含进度/阶段/净干预/因子', () => {
    const s = formatEra(era({ pct: 45, phase: '发展', drivers: '灵脉复苏', blockers: '宗门封锁', chain: [node('推动', '高')] }));
    expect(s).toContain('45%');
    expect(s).toContain('[发展]');
    expect(s).toContain('净干预:+2');
    expect(s).toContain('灵脉复苏');
  });

  it('演化序列化把"待派生临界事件"和"建议合并"显式列出（前端已算好）', () => {
    const list = [
      era({ name: '灵潮复苏', desc: '灵气 妖兽', pct: 85 }),
      era({ name: '妖兽异变', desc: '灵气 妖兽', pct: 40 }),
    ];
    const s = serializeErasForEvo(list);
    expect(s).toContain('已达临界待派生');
    expect(s).toContain('建议合并');
  });

  it('空列表有明确说明', () => {
    expect(serializeErasForEvo([])).toContain('无正在酝酿');
  });
});
