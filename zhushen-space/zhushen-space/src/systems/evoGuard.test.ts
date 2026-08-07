import { describe, it, expect } from 'vitest';
import {
  currentEvoEpoch, bumpEvoEpoch, evoEpochStale,
  parseWorldTime, compareWorldTimes, guardTimeAdvance,
} from './evoGuard';
import { useTurnInsight } from '../store/turnInsightStore';
import { useMisc } from '../store/miscStore';
import { applyMiscCommands } from './miscParser';

describe('evoGuard·世界纪元', () => {
  it('bump 后旧捕获值 stale', () => {
    const ep = currentEvoEpoch();
    expect(evoEpochStale(ep)).toBe(false);
    bumpEvoEpoch();
    expect(evoEpochStale(ep)).toBe(true);
    expect(evoEpochStale(currentEvoEpoch())).toBe(false);
  });
});

describe('evoGuard·parseWorldTime', () => {
  it('历法年+月日+时辰', () => {
    const p = parseWorldTime('斗罗历 2 月 17 日 · 卯时');
    expect(p.md).toEqual({ month: 2, day: 17 });
    expect(p.clockMin).toBe(6 * 60);
  });
  it('年月日+钟点', () => {
    const p = parseWorldTime('1943年6月6日 14:30');
    expect(p.year).toBe(1943);
    expect(p.md).toEqual({ month: 6, day: 6 });
    expect(p.clockMin).toBe(14 * 60 + 30);
  });
  it('第N天（无历法世界）', () => {
    expect(parseWorldTime('进入世界第 3 天').seq).toBe(3);
    expect(parseWorldTime('第十日 黄昏').seq).toBe(10);
  });
  it('年号 vs 时长：「还有2年」「2年后」不算年份', () => {
    expect(parseWorldTime('轮回历3年').year).toBe(3);
    expect(parseWorldTime('第3天，距离大劫还有2年').year).toBe(null);
    expect(parseWorldTime('2年后的约定').year).toBe(null);
  });
  it('认不出 → 全 null', () => {
    const p = parseWorldTime('春');
    expect(p.year).toBe(null); expect(p.md).toBe(null); expect(p.seq).toBe(null); expect(p.clockMin).toBe(null);
  });
});

describe('evoGuard·compareWorldTimes', () => {
  it('月日向前/向后', () => {
    expect(compareWorldTimes('6月2日', '6月5日')).toBe('forward');
    expect(compareWorldTimes('6月5日', '6月2日')).toBe('backward');
  });
  it('跨年环绕：12月30 → 1月2 视作向前', () => {
    expect(compareWorldTimes('12月30日', '1月2日')).toBe('forward');
  });
  it('年份明确时不做环绕：同年 6月5 → 6月2 是倒退', () => {
    expect(compareWorldTimes('3年6月5日', '3年6月2日')).toBe('backward');
    expect(compareWorldTimes('3年12月30日', '4年1月2日')).toBe('forward');
  });
  it('同日比钟点；缺钟点=same', () => {
    expect(compareWorldTimes('6月2日 20:00', '6月2日 08:00')).toBe('backward');
    expect(compareWorldTimes('6月2日 08:00', '6月2日 20:00')).toBe('forward');
    expect(compareWorldTimes('6月2日', '6月2日 20:00')).toBe('same');
  });
  it('第N天计数', () => {
    expect(compareWorldTimes('第3天', '第4天')).toBe('forward');
    expect(compareWorldTimes('第4天', '第3天')).toBe('backward');
    expect(compareWorldTimes('第3天 巳时', '第3天 卯时')).toBe('backward');
  });
  it('只有年份可比', () => {
    expect(compareWorldTimes('轮回历3年', '轮回历4年')).toBe('forward');
    expect(compareWorldTimes('轮回历3年', '轮回历2年')).toBe('backward');
  });
  it('格式互异 / 认不出 → unknown（放行）', () => {
    expect(compareWorldTimes('第3天', '6月2日')).toBe('unknown');
    expect(compareWorldTimes('春', '夏')).toBe('unknown');
    expect(compareWorldTimes('轮回历3年', '轮回历3年6月')).toBe('unknown');
  });
});

describe('evoGuard·miscParser 集成（timeLocation 写入过闸）', () => {
  it('倒退写入被拦：worldTime 保留原值', () => {
    useMisc.setState({ worldTime: '6月5日 20:00', worldName: '斗罗大陆', paradiseTime: '' } as never);
    applyMiscCommands('<upstore>\ntimeLocation.worldTime = "6月5日 08:00"\n</upstore>', { domain: 'world' });
    expect(useMisc.getState().worldTime).toBe('6月5日 20:00');
  });
  it('向前写入正常应用', () => {
    useMisc.setState({ worldTime: '6月5日 20:00', worldName: '斗罗大陆' } as never);
    applyMiscCommands('<upstore>\ntimeLocation.worldTime = "6月6日 07:00"\n</upstore>', { domain: 'world' });
    expect(useMisc.getState().worldTime).toBe('6月6日 07:00');
  });
  it('本块同时切世界 → 新旧时间不可比，放行', () => {
    useMisc.setState({ worldTime: '1943年6月6日', worldName: '战争世界' } as never);
    applyMiscCommands('<upstore>\ntimeLocation.worldName = "斗罗大陆"\ntimeLocation.worldTime = "斗罗历 3年1月2日"\n</upstore>', { domain: 'world' });
    expect(useMisc.getState().worldTime).toBe('斗罗历 3年1月2日');
  });
  it('身处轮回乐园 → 时间由回归同步规则治理，放行', () => {
    useMisc.setState({ worldTime: '1943年6月6日', worldName: '轮回乐园' } as never);
    applyMiscCommands('<upstore>\ntimeLocation.worldTime = "轮回历3年"\n</upstore>', { domain: 'world' });
    expect(useMisc.getState().worldTime).toBe('轮回历3年');
  });
});

describe('evoGuard·guardTimeAdvance（只进不退闸）', () => {
  it('确定倒退 → 拦截并记一致性日志', () => {
    const before = (useTurnInsight.getState().consistency ?? []).length;
    expect(guardTimeAdvance('世界时间', '6月5日 20:00', '6月5日 08:00')).toBe(true);
    const log = useTurnInsight.getState().consistency ?? [];
    expect(log.length).toBe(before + 1);
    expect(log[log.length - 1].kind).toBe('time-regression');
  });
  it('向前 / 相同 / 认不出 / 空值 → 放行', () => {
    expect(guardTimeAdvance('世界时间', '6月2日', '6月5日')).toBe(false);
    expect(guardTimeAdvance('世界时间', '6月2日', '6月2日')).toBe(false);
    expect(guardTimeAdvance('世界时间', '春', '一个陌生的黄昏')).toBe(false);
    expect(guardTimeAdvance('世界时间', '', '6月5日')).toBe(false);
  });
});
