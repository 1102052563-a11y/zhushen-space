import { describe, it, expect } from 'vitest';
import { mergeRings, type QuestRing } from './miscStore';

const ring = (idx: number, status: QuestRing['status'], extra: Partial<QuestRing> = {}): QuestRing =>
  ({ idx, goal: `环${idx}目标`, status, ...extra });

describe('mergeRings（按 idx 合并环·治"老是吃掉前面几环"）', () => {
  it('AI 增量只发当前+后续环（漏掉已 done 的前面环）→ 前面环绝不被吞掉；新 idx 被忽略（路线图锁定·不新增环）', () => {
    const existing = [ring(1, 'done'), ring(2, 'done'), ring(3, 'active'), ring(4, 'planned')];
    const incoming = [ring(3, 'active'), ring(4, 'planned'), ring(5, 'planned')]; // 漏了已完成的 1、2；夹带新环 5
    const out = mergeRings(existing, incoming);
    expect(out.map((r) => r.idx)).toEqual([1, 2, 3, 4]);     // 1、2 仍在（旧 bug 会丢成 [3,4,5]）；5 被忽略（总环数冻结在创建时）
    expect(out.find((r) => r.idx === 1)?.status).toBe('done');
    expect(out.find((r) => r.idx === 2)?.status).toBe('done');
    expect(out.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('通过 add rings 推进（incoming 把更后的环设 active）→ 旧 active 归一为 done、全程仅一个 active', () => {
    const existing = [ring(1, 'done'), ring(2, 'done'), ring(3, 'active'), ring(4, 'planned')];
    const incoming = [ring(4, 'active'), ring(5, 'planned')]; // 漏了 1、2、3；把 4 设 active；夹带新环 5
    const out = mergeRings(existing, incoming);
    expect(out.map((r) => r.idx)).toEqual([1, 2, 3, 4]);          // 新环 5 被忽略（路线图锁定）
    expect(out.find((r) => r.idx === 3)?.status).toBe('done');    // 旧 active(3) 自动落 done
    expect(out.find((r) => r.idx === 4)?.status).toBe('active');
    expect(out.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('incoming 同 idx 的缺省字段（undefined）不清空既有 reward/penalty；已定实环的 goal 冻结（路线图锁定）', () => {
    const existing = [ring(1, 'done'), ring(2, 'active', { reward: '乐园币+500', penalty: '扣500' })];
    // 模拟 sanitizeRings 产物：reward/penalty 键存在但为 undefined
    const incoming = [ring(2, 'active', { goal: '环2新目标', reward: undefined, penalty: undefined })];
    const out = mergeRings(existing, incoming);
    const r2 = out.find((r) => r.idx === 2)!;
    expect(r2.reward).toBe('乐园币+500');   // 未被 undefined 覆盖
    expect(r2.penalty).toBe('扣500');
    expect(r2.goal).toBe('环2目标');         // 内容一经定实即冻结，AI 改写被忽略（只有占位环可填实）
  });

  it('占位环（goal 为"待规划"类）允许被填实', () => {
    const existing = [ring(1, 'active'), { idx: 2, goal: '（待推进后规划）', status: 'planned' } as QuestRing];
    const incoming = [{ idx: 2, goal: '突入城主府夺回圣物', status: 'planned', reward: '乐园币+800' } as QuestRing];
    const out = mergeRings(existing, incoming);
    const r2 = out.find((r) => r.idx === 2)!;
    expect(r2.goal).toBe('突入城主府夺回圣物');   // 占位环可填实（旧档渐进式过渡）
    expect(r2.reward).toBe('乐园币+800');
  });

  it('既有为空/缺失 → 直接采用 incoming', () => {
    const incoming = [ring(1, 'active'), ring(2, 'planned')];
    expect(mergeRings(undefined, incoming)).toBe(incoming);
    expect(mergeRings([], incoming)).toBe(incoming);
  });

  it('AI 发完整数组（含已完成环）→ 等同就地更新，不引入重复', () => {
    const existing = [ring(1, 'done'), ring(2, 'active'), ring(3, 'planned')];
    const incoming = [ring(1, 'done'), ring(2, 'done'), ring(3, 'active')]; // 正常推进的完整数组
    const out = mergeRings(existing, incoming);
    expect(out.map((r) => r.idx)).toEqual([1, 2, 3]);
    expect(out.find((r) => r.idx === 2)?.status).toBe('done');
    expect(out.find((r) => r.idx === 3)?.status).toBe('active');
    expect(out.filter((r) => r.status === 'active')).toHaveLength(1);
  });
});
