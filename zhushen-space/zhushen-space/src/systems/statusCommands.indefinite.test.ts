import { describe, it, expect, beforeEach } from 'vitest';
import { applyTimedStatusCommands, expireStatuses } from './statusCommands';
import { usePlayer, type StatusEffect } from '../store/playerStore';

/* ⚠「永续状态过几个回合消失不见」根治：
   AI 常把永久性写进 name/effect 而**不给 duration**（BUFF_AS_STATUS_RULE 早写明"永久的别用 addStatus"，AI 照样违反）。
   旧逻辑只拿 duration 字段测 INDEFINITE_STATUS_RE → 漏判 → 塞 DEFAULT_STATUS_TURNS=4 → 四回合后被 expireStatuses 清掉。
   现改为合并 name/type/effect/desc/duration 一起测；且**仅在 AI 没给出可解析时长时**才咨询，明写的 duration 永远优先。 */

const stats = () => usePlayer.getState().profile.statusEffects ?? [];
const named = (n: string) => stats().find((e) => e.name === n);
const reset = () => usePlayer.getState().setStatusEffects([]);

describe('永续状态不被默认时长/过期清理误杀', () => {
  beforeEach(reset);

  it('★永续写在 name 里、没给 duration → 不塞默认时长，永不过期', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"永续·龙鳞护体","tone":"buff","effect":"鳞甲覆体"})', 1);
    expect(named('永续·龙鳞护体')?.durationTurns).toBeUndefined();
    expireStatuses(99);
    expect(named('永续·龙鳞护体')).toBeTruthy();
  });

  it('★永久写在 effect 里、没给 duration → 同样永不过期', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"神血淬体","effect":"永久提升体质与恢复力"})', 1);
    expect(named('神血淬体')?.durationTurns).toBeUndefined();
    expireStatuses(99);
    expect(named('神血淬体')).toBeTruthy();
  });

  it('普通状态没给 duration → 仍按默认 4 回合过期（没把兜底关掉）', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"轻微擦伤"})', 1);
    expect(named('轻微擦伤')?.durationTurns).toBe(4);
    expireStatuses(4);                          // 起于第1回合、第4回合才过了3个回合 → 还在
    expect(named('轻微擦伤')).toBeTruthy();
    expireStatuses(5);                          // 满 4 回合 → 清
    expect(named('轻微擦伤')).toBeFalsy();
  });

  it('控制类状态没给 duration → 仍按 2 回合过期', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"眩晕"})', 1);
    expect(named('眩晕')?.durationTurns).toBe(2);
  });

  it('★AI 明写 duration → 以 duration 为准，不被 effect 里一句"永久"绑架', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"灼烧","duration":"3回合","effect":"灼伤会留下永久疤痕"})', 1);
    expect(named('灼烧')?.durationTurns).toBe(3);
    expireStatuses(4);
    expect(named('灼烧')).toBeFalsy();
  });

  it('duration 写"永久" → 照旧永不过期（原有行为不回归）', () => {
    applyTimedStatusCommands('addStatus("B1",{"name":"烙印","duration":"永久"})', 1);
    expect(named('烙印')?.durationTurns).toBeUndefined();
    expireStatuses(99);
    expect(named('烙印')).toBeTruthy();
  });
});

describe('存量救援：旧存档里已被塞了默认时长的永续状态', () => {
  beforeEach(reset);
  const stale = (p: Partial<StatusEffect>): StatusEffect =>
    ({ id: 'ST_x', name: '永续·血脉觉醒', startTurn: 1, durationTurns: 4, ...p } as StatusEffect);

  it('★durationDesc 为空(=时长是前端兜底塞的) + 自称永续 → 绝不清', () => {
    usePlayer.getState().setStatusEffects([stale({})]);
    expireStatuses(99);
    expect(stats().length).toBe(1);
  });

  it('durationDesc 非空(=AI 明写过时长) → 照常按时限过期', () => {
    usePlayer.getState().setStatusEffects([stale({ name: '狂暴', durationDesc: '3回合', durationTurns: 3 })]);
    expireStatuses(9);
    expect(stats().length).toBe(0);
  });
});
