import { describe, it, expect } from 'vitest';
import {
  clampDispositionDelta, stageOf, dispositionLine,
  DISP_TURN_CAP, DISP_TURN_CAP_STRONG,
} from './dispositionGuard';

const plain = '希尔薇冷淡地看了他一眼，转身继续擦拭手中的酒杯。';   // 无强事件·无救赎词

describe('dispositionGuard · 每回合增量限速', () => {
  it('常规增量按 cap 封顶（信任/尊重/情欲 ≤ +8）', () => {
    expect(clampDispositionDelta('trust', 50, '希尔薇', plain)).toBe(8);
    expect(clampDispositionDelta('respect', 99, '希尔薇', plain)).toBe(8);
    expect(clampDispositionDelta('lust', 30, '希尔薇', plain)).toBe(8);
  });

  it('沉沦常规增量 ≤ +5', () => {
    expect(clampDispositionDelta('corruption', 40, '希尔薇', plain)).toBe(5);
  });

  it('未超 cap 的增量原样通过', () => {
    expect(clampDispositionDelta('trust', 3, '希尔薇', plain)).toBe(3);
    expect(clampDispositionDelta('corruption', 2, '希尔薇', plain)).toBe(2);
    expect(clampDispositionDelta('lust', 0, '希尔薇', plain)).toBe(0);
  });

  it('强事件（就近关键词）把上限放宽到 +30', () => {
    const strong = '混乱中希尔薇被人下了媚药，浑身发烫。';
    expect(clampDispositionDelta('lust', 100, '希尔薇', strong)).toBe(30);
    expect(clampDispositionDelta('corruption', 100, '希尔薇', strong)).toBe(30);
  });

  it('强事件关键词离 NPC 名太远（>窗口）则不放宽，仍按常规 cap', () => {
    const far = '城外有人下了媚药闹出人命。' + '。'.repeat(60) + '希尔薇只是路过，听旁人说了这事。';
    expect(clampDispositionDelta('lust', 100, '希尔薇', far)).toBe(8);
  });
});

describe('dispositionGuard · 沉沦棘轮（只增难减）', () => {
  it('无救赎事件时沉沦不许降（负增量归 0）', () => {
    expect(clampDispositionDelta('corruption', -20, '希尔薇', plain)).toBe(0);
  });
  it('出现救赎/决裂情节才准降沉沦（降幅仍受 cap）', () => {
    expect(clampDispositionDelta('corruption', -20, '希尔薇', '希尔薇终于幡然醒悟，挣脱了控制。')).toBe(-5);
  });
  it('非棘轮轴（信任/情欲）可以自由回落（受 cap）', () => {
    expect(clampDispositionDelta('lust', -50, '希尔薇', '希尔薇觉得扫兴，情欲尽消。')).toBe(-8);
    expect(clampDispositionDelta('trust', -3, '希尔薇', '他又一次失信，希尔薇有些失望。')).toBe(-3);
  });
});

describe('dispositionGuard · 阶段映射', () => {
  it('信任四档', () => {
    expect(stageOf('trust', 0).label).toBe('戒备');
    expect(stageOf('trust', 40).label).toBe('将信将疑');
    expect(stageOf('trust', 70).label).toBe('信赖');
    expect(stageOf('trust', 100).label).toBe('托付');
  });
  it('沉沦五档（0=守身）', () => {
    expect(stageOf('corruption', 0).label).toBe('守身');
    expect(stageOf('corruption', 10).label).toBe('动摇');
    expect(stageOf('corruption', 100).label).toBe('沦陷');
  });
  it('dispositionLine 缺字段时回退默认值', () => {
    const line = dispositionLine({});
    expect(line).toContain('信任10·戒备');
    expect(line).toContain('情欲0·无感');
    expect(line).toContain('沉沦0·守身');
  });
});

describe('dispositionGuard · 常量自洽', () => {
  it('常规 cap ≤ 强事件 cap', () => {
    for (const ax of ['trust', 'respect', 'lust', 'corruption'] as const) {
      expect(DISP_TURN_CAP[ax]).toBeLessThanOrEqual(DISP_TURN_CAP_STRONG[ax]);
    }
  });
});
