import { describe, it, expect } from 'vitest';
import {
  POWER_PER_TIER, tierNumOf, bioNumOf, powerIndex, powerRatio,
  crowdVerdict, worldPowerReport, formatPowerReport, VERDICT_TEXT,
} from './causalWeight';

describe('causalWeight · 阶位与档位解析', () => {
  it('tierNumOf：阶位名 / 等级 / 两者取高', () => {
    expect(tierNumOf('一阶')).toBe(1);
    expect(tierNumOf('三阶中期')).toBe(3);      // 走 normalizeTier，容忍后缀
    expect(tierNumOf('无上之境')).toBe(14);
    expect(tierNumOf(undefined, 35)).toBe(4);   // Lv.35 → 四阶
    expect(tierNumOf('二阶', 35)).toBe(4);      // 阶位滞后于等级 → 取高
    expect(tierNumOf('结丹期')).toBe(1);        // 认不出 → 保守按一阶
  });

  it('bioNumOf：T码 / 中文档名 / 数字 / 认不出', () => {
    expect(bioNumOf('T3·勇士')).toBe(3);
    expect(bioNumOf('T12')).toBe(12);
    expect(bioNumOf(7)).toBe(7);
    expect(bioNumOf('T5·领主')).toBe(5);
    expect(bioNumOf('')).toBeNull();
    expect(bioNumOf(undefined)).toBeNull();
    expect(bioNumOf('T99')).toBe(16);           // 夹到 MAX_BIO_NUM
  });

  it('powerIndex：生物强度只做阶内 ±0.75 微调，绝不抬过一整阶', () => {
    expect(powerIndex('三阶')).toBe(3);                       // 无 bio → 就是阶序号
    const low = powerIndex('三阶', undefined, 'T0·杂鱼');
    const high = powerIndex('三阶', undefined, 'T16·无上');
    expect(low).toBeGreaterThanOrEqual(3 - 0.75);
    expect(high).toBeLessThanOrEqual(3 + 0.75);
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeLessThanOrEqual(1.5);
    // 关键不变量：三阶顶配 bio 也不该越过四阶底配
    expect(high).toBeLessThan(powerIndex('四阶', undefined, 'T0·杂鱼') + 1);
  });
});

describe('causalWeight · R 与判定档', () => {
  it('powerRatio 是阶差的指数：同阶=1，每高一阶 ×POWER_PER_TIER', () => {
    expect(powerRatio(3, 3)).toBe(1);
    expect(powerRatio(4, 3)).toBe(POWER_PER_TIER);
    expect(powerRatio(5, 3)).toBe(POWER_PER_TIER ** 2);
    expect(powerRatio(2, 3)).toBeCloseTo(1 / POWER_PER_TIER);
  });

  it('crowdVerdict 四档边界', () => {
    expect(crowdVerdict(0.25)).toBe('outmatched');
    expect(crowdVerdict(0.999)).toBe('outmatched');
    expect(crowdVerdict(1)).toBe('crowd_valid');
    expect(crowdVerdict(9.9)).toBe('crowd_valid');
    expect(crowdVerdict(10)).toBe('tactics_needed');
    expect(crowdVerdict(999)).toBe('tactics_needed');
    expect(crowdVerdict(1000)).toBe('dominate');
  });

  it('轮回乐园校准：阶差→判定符合设计意图', () => {
    const v = (gap: number) => crowdVerdict(powerRatio(1 + gap, 1));
    expect(v(0)).toBe('crowd_valid');       // 同阶：群体逻辑生效
    expect(v(1)).toBe('crowd_valid');       // 高一阶：打得过但吃力
    expect(v(2)).toBe('tactics_needed');    // 高二阶：要设局
    expect(v(3)).toBe('tactics_needed');    // 高三阶：设局＋重大代价
    expect(v(5)).toBe('dominate');          // 高五阶：降维打击
    expect(v(-1)).toBe('outmatched');       // 低一阶：反过来被碾
  });
});

describe('causalWeight · worldPowerReport', () => {
  it('四阶契约者进一阶世界 → tactics_needed，并给出可判定的约束文案', () => {
    const rep = worldPowerReport({ tier: '四阶' }, { tier: '一阶' });
    expect(rep.actorIdx).toBe(4);
    expect(rep.crowdIdx).toBe(1);
    expect(rep.R).toBe(POWER_PER_TIER ** 3);
    expect(rep.verdict).toBe('tactics_needed');
    expect(rep.line).toContain('[因果权重]');
    expect(formatPowerReport(rep)).toContain(VERDICT_TEXT.tactics_needed);
  });

  it('二阶主角进五阶世界 → outmatched（无限流必须有的那一档）', () => {
    const rep = worldPowerReport({ tier: '二阶' }, { tier: '五阶' });
    expect(rep.verdict).toBe('outmatched');
    expect(rep.R).toBeLessThan(1);
    expect(formatPowerReport(rep)).toContain('力量劣势方是他自己');
  });

  it('巅峰战力可超世界阶：从自由文本扫出最高阶名，且与群体基准分开算', () => {
    const rep = worldPowerReport(
      { tier: '四阶' },
      { tier: '一阶', peakPower: '本世界绝大多数人不过一阶，唯有镇守山门的老祖据传已至七阶。' },
    );
    expect(rep.crowdIdx).toBe(1);          // 群体仍按世界阶
    expect(rep.peakIdx).toBe(7);           // 巅峰超阶被识别
    expect(rep.vsPeak).toBe('below');
    expect(rep.line).toContain('高于主角');
    expect(rep.verdict).toBe('tactics_needed');   // 对群体的判定不受巅峰影响
  });

  it('无巅峰战力文本 → peakIdx/vsPeak 为 null，行文里不带巅峰段', () => {
    const rep = worldPowerReport({ tier: '三阶' }, { tier: '三阶' });
    expect(rep.peakIdx).toBeNull();
    expect(rep.vsPeak).toBeNull();
    expect(rep.line).not.toContain('巅峰');
    expect(rep.verdict).toBe('crowd_valid');
  });

  it('主角强于巅峰 → above', () => {
    const rep = worldPowerReport({ tier: '九阶' }, { tier: '二阶', peakPower: '顶点是三阶的城主' });
    expect(rep.vsPeak).toBe('above');
    expect(rep.verdict).toBe('dominate');
  });

  it('formatPowerReport 容忍空值', () => {
    expect(formatPowerReport(null)).toBe('');
    expect(formatPowerReport(undefined)).toBe('');
  });
});
