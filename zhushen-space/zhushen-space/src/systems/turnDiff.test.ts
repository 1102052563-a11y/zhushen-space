import { describe, it, expect } from 'vitest';
import { diffEntityMap, diffItemList, diffFields } from './turnDiff';

describe('turnDiff 每回合净变化（数据库引入④·完整审计地基）', () => {
  it('diffEntityMap：新增 / 移除 / 字段变动', () => {
    const before = { C1: { name: '甲', realm: '一阶' }, C2: { name: '乙', realm: '二阶' } };
    const after = { C1: { name: '甲', realm: '三阶' }, C3: { name: '丙', realm: '一阶' } };   // C1 改 realm、C2 移除、C3 新增
    const evs = diffEntityMap(before, after, 'npc', ['name', 'realm']);
    expect(evs.find((e) => e.ref === '甲' && e.op === 'change')?.detail).toContain('realm');
    expect(evs.find((e) => e.ref === '丙')?.op).toBe('add');
    expect(evs.find((e) => e.ref === '乙')?.op).toBe('remove');
  });

  it('diffItemList：入袋 / 离袋 / 数量变动', () => {
    const before = [{ id: 'A', name: '剑', quantity: 1 }, { id: 'B', name: '药', quantity: 5 }];
    const after = [{ id: 'B', name: '药', quantity: 2 }, { id: 'C', name: '盾', quantity: 1 }];
    const evs = diffItemList(before, after);
    expect(evs.find((e) => e.ref === '盾')?.op).toBe('add');
    expect(evs.find((e) => e.ref === '剑')?.op).toBe('remove');
    expect(evs.find((e) => e.ref === '药')?.detail).toContain('5→2');
  });

  it('diffItemList 带 owner 前缀（NPC 持有物）', () => {
    const evs = diffItemList([], [{ id: 'X', name: '匕首', quantity: 1 }], '小蛇');
    expect(evs[0].ref).toBe('小蛇:匕首');
  });

  it('diffFields：单实体（主角）字段变动', () => {
    const ev = diffFields({ attrs: { str: 5 }, realm: '一阶' }, { attrs: { str: 9 }, realm: '一阶' }, 'char', '主角', ['attrs', 'realm']);
    expect(ev[0].detail).toContain('attrs');
    expect(ev[0].detail).not.toContain('realm');
  });

  it('无变化 → 空', () => {
    expect(diffEntityMap({ C1: { name: '甲' } }, { C1: { name: '甲' } }, 'npc', ['name'])).toEqual([]);
    expect(diffFields({ a: 1 }, { a: 1 }, 'char', 'x', ['a'])).toEqual([]);
  });
});
