// 发帖动机抽签单测：分组/数量/来源不变量（随机只测不变量）。
import { describe, it, expect } from 'vitest';
import { buildMotiveDraw, CHANNEL_MOTIVES } from './channelFlavor';

describe('buildMotiveDraw', () => {
  it('空频道 / 仅无动机池的频道（system）→ 返回空串', () => {
    expect(buildMotiveDraw([])).toBe('');
    expect(buildMotiveDraw(['system'])).toBe('');
  });

  it('按频道分组；每频道 ≤ perChannel 个；动机全部来自该频道池且不重复', () => {
    const text = buildMotiveDraw(['general', 'trade'], 4);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBe(2);
    const gLine = lines.find((l) => l.startsWith('- 综合：'))!;
    expect(gLine).toBeTruthy();
    const picked = gLine.replace('- 综合：', '').split('、');
    expect(picked.length).toBe(4);
    expect(new Set(picked).size).toBe(4);
    for (const p of picked) expect(CHANNEL_MOTIVES.general).toContain(p);
    expect(lines.some((l) => l.startsWith('- 交易：'))).toBe(true);
  });

  it('perChannel 超过池子大小时全取', () => {
    const text = buildMotiveDraw(['battle'], 999);
    const line = text.split('\n').find((l) => l.startsWith('- 战斗：'))!;
    expect(line.replace('- 战斗：', '').split('、').length).toBe(CHANNEL_MOTIVES.battle!.length);
  });

  it('注入块带说明头', () => {
    expect(buildMotiveDraw(['world'])).toContain('发帖动机抽签');
  });
});
