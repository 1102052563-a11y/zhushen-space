import { describe, it, expect } from 'vitest';
import { rollbackEvoDomains } from './saveManager';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';

const persisted = (state: any) => JSON.stringify({ state, version: 0 });

describe('rollbackEvoDomains 回滚演化变量域（数据库引入②）', () => {
  it('★把 npc / items 还原到快照、跳过非回滚域', () => {
    // 现状：被"演化"改坏
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '改坏的名字', realm: '一阶', items: [] } } } as any);
    useItems.setState({ items: [{ id: 'I9', name: '多出来的脏物', category: '武器', quantity: 1 }] } as any);
    // 快照：演化前的好状态
    const snap = {
      turn: 5, ts: Date.now(),
      stores: {
        'drpg-npc': persisted({ npcs: { C1: { id: 'C1', name: '芙莉莲', realm: '四阶', items: [] } } }),
        'drpg-items': persisted({ items: [{ id: 'I0', name: '原本的剑', category: '武器', quantity: 1 }] }),
        'drpg-settings': persisted({ foo: 'bar' }),   // 非回滚域，应被忽略
      },
    };
    const restored = rollbackEvoDomains(snap);
    expect(restored).toContain('drpg-npc');
    expect(restored).toContain('drpg-items');
    expect(restored).not.toContain('drpg-settings');           // 配置不回滚
    expect(useNpc.getState().npcs.C1.name).toBe('芙莉莲');        // NPC 还原
    expect(useItems.getState().items.length).toBe(1);
    expect(useItems.getState().items[0].name).toBe('原本的剑');   // 背包还原
  });

  it('快照里缺某域 / 坏 JSON → 跳过不报错', () => {
    const snap = { turn: 3, ts: Date.now(), stores: { 'drpg-npc': '{坏的', 'drpg-items': persisted({ items: [] }) } };
    const restored = rollbackEvoDomains(snap);
    expect(restored).toContain('drpg-items');     // 好的还原
    expect(restored).not.toContain('drpg-npc');   // 坏的跳过
  });
});
