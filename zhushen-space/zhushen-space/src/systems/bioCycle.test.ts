import { describe, it, expect } from 'vitest';
import { worldDayIndex, cycleStateOf, pregnancyStateOf, dailyMood, GESTATION_DAYS } from './bioCycle';
import type { BioProfile } from '../store/bioCycleStore';

const P = (patch: Partial<BioProfile> = {}): BioProfile => ({ on: true, lastPeriodStartDay: 100, cycleLen: 28, periodLen: 5, ...patch });

describe('🌸 worldDayIndex 日序', () => {
  it('年月日 → 年×360+(月-1)×30+日；第N日直接用；抠不出=null', () => {
    expect(worldDayIndex('第 3 日 · 上午')).toBe(3);
    expect(worldDayIndex('2 月 17 日 · 卯时')).toBe(47);
    expect(worldDayIndex('斗罗历 1002 年 2 月 17 日')).toBe(1002 * 360 + 47);
    expect(worldDayIndex('黄昏时分')).toBeNull();
    expect(worldDayIndex('')).toBeNull();
  });
});

describe('🌸 cycleStateOf 周期相位', () => {
  it('经期→卵泡→排卵→黄体 按天推进；跨周期取模', () => {
    const p = P();
    expect(cycleStateOf(p, 100).phase).toBe('经期');
    expect(cycleStateOf(p, 100).dayOfPeriod).toBe(1);
    expect(cycleStateOf(p, 104).phase).toBe('经期');
    expect(cycleStateOf(p, 108).phase).toBe('卵泡期');
    expect(cycleStateOf(p, 114).phase).toBe('排卵期');   // 28-14=第14天（0起）排卵
    expect(cycleStateOf(p, 114).fertile).toBe(true);
    expect(cycleStateOf(p, 120).phase).toBe('黄体期');
    expect(cycleStateOf(p, 128).phase).toBe('经期');      // 下一周期
    expect(cycleStateOf(p, 128).daysIntoCycle).toBe(1);
  });
  it('锚点在未来（数据错）夹为第1天不炸', () => {
    expect(cycleStateOf(P({ lastPeriodStartDay: 999 }), 100).daysIntoCycle).toBe(1);
  });
});

describe('🌸 pregnancyStateOf 孕程', () => {
  it('孕周/孕期/预产/产后', () => {
    const p = P({ pregnant: { sinceDay: 100 } });
    expect(pregnancyStateOf(p, 100)).toMatchObject({ weeks: 0, trimester: 1 });
    expect(pregnancyStateOf(p, 100 + 15 * 7)).toMatchObject({ weeks: 15, trimester: 2 });
    expect(pregnancyStateOf(p, 100 + 30 * 7)).toMatchObject({ weeks: 30, trimester: 3 });
    expect(pregnancyStateOf(p, 100)!.dueInDays).toBe(GESTATION_DAYS);
    const pp = pregnancyStateOf(p, 100 + GESTATION_DAYS + 10)!;
    expect(pp.postpartumDay).toBe(10);
    expect(pregnancyStateOf(p, 100 + GESTATION_DAYS + 100)).toBeNull();   // 恢复期已过=状态消失
    expect(pregnancyStateOf(P(), 100)).toBeNull();                        // 没怀=null
  });
});

describe('🌸 dailyMood 种子日基调', () => {
  it('同种子同日恒定；跨日/跨种子会变化（抽样验证非常数）', () => {
    const a = dailyMood('C1', 100, '经期');
    expect(dailyMood('C1', 100, '经期')).toEqual(a);   // 确定性
    const days = [100, 101, 102, 103, 104, 105, 106, 107];
    const bases = new Set(days.map((d) => dailyMood('C1', d, '经期').base));
    expect(bases.size).toBeGreaterThan(1);             // 不是每天同一个词
  });
});
