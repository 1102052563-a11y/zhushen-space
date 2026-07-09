import { describe, it, expect } from 'vitest';
import { detectAutoAction, detectDifficulty } from './autoDiceDetect';

describe('detectAutoAction 关键词门', () => {
  it('战斗类 → str', () => {
    expect(detectAutoAction('我挥剑砍向敌人')?.attrKey).toBe('str');
    expect(detectAutoAction('拔刀与他交手')?.attrKey).toBe('str');
  });
  it('社交类 → cha', () => {
    expect(detectAutoAction('我试着说服守卫放行')?.attrKey).toBe('cha');
    expect(detectAutoAction('恐吓那个商人')?.attrKey).toBe('cha');
  });
  it('敏捷/智力/体质/幸运各归其位', () => {
    expect(detectAutoAction('悄悄潜行绕到背后')?.attrKey).toBe('agi');
    expect(detectAutoAction('仔细分析这道阵法')?.attrKey).toBe('int');
    expect(detectAutoAction('硬抗住这一击')?.attrKey).toBe('con');
    expect(detectAutoAction('赌一把手气')?.attrKey).toBe('luck');
  });
  it('日常/闲聊/情感 → null（不 roll）', () => {
    expect(detectAutoAction('我坐下来吃了顿饭')).toBeNull();
    expect(detectAutoAction('和她聊聊今天的天气')).toBeNull();
    expect(detectAutoAction('静静看着远方，心里五味杂陈')).toBeNull();
    expect(detectAutoAction('')).toBeNull();
    expect(detectAutoAction('   ')).toBeNull();
  });
  it('多类命中时按优先级：社交先于力量', () => {
    // 「挥」(str) 与「威胁」(cha) 同现 → cha 优先（先扫社交，降误判为纯武力）
    expect(detectAutoAction('我一边挥拳一边威胁他快说')?.attrKey).toBe('cha');
  });
});

describe('detectDifficulty 措辞粗判', () => {
  it('默认普通', () => {
    expect(detectDifficulty('我砍他一刀')).toBe('普通');
  });
  it('困难 / 极难 / 几乎不可能 / 简单', () => {
    expect(detectDifficulty('这一击非常艰难')).toBe('困难');
    expect(detectDifficulty('简直难如登天')).toBe('极难');
    expect(detectDifficulty('这几乎不可能完成')).toBe('几乎不可能');
    expect(detectDifficulty('轻松跃过矮墙')).toBe('简单');
  });
  it('优先级：几乎不可能 > 极难 > 困难', () => {
    // 同时含「困难」与「几乎不可能」→ 取最高档
    expect(detectDifficulty('虽然困难，但几乎不可能完成')).toBe('几乎不可能');
  });
});
