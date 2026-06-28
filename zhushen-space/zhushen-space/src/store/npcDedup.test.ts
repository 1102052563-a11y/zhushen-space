import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';

const set = (npcs: Record<string, any>) => useNpc.setState({ npcs } as any);

describe('dedupeAliasNpcs 跨语言/畸形名重复合并', () => {
  beforeEach(() => set({}));

  it('★C_Frieren(英文+C_前缀) 同阶位同职业 → 合并进 芙莉莲(中文)，物品并入', () => {
    set({
      C1: { id: 'C1', name: '芙莉莲', realm: '四阶|魔法使', profession: '魔法使', isDead: false, onScene: true, items: [] },
      C2: { id: 'C2', name: 'C_Frieren', realm: '四阶|魔法使', profession: '魔法使', isDead: false, onScene: true, items: [{ id: 'X', name: '魔杖' }] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(1);
    expect(useNpc.getState().npcs.C2).toBeUndefined();   // 畸形名档被合并删除
    expect((useNpc.getState().npcs.C1.items as any[]).some((x) => x.id === 'X')).toBe(true);  // 物品并入
  });

  it('不同阶位 → 不合并（C_Fern二阶 ≠ 芙莉莲四阶），但剥掉 C_ 前缀', () => {
    set({
      C1: { id: 'C1', name: '芙莉莲', realm: '四阶|魔法使', profession: '魔法使', isDead: false, items: [] },
      C3: { id: 'C3', name: 'C_Fern', realm: '二阶|魔法使', profession: '魔法使', isDead: false, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(0);
    expect(useNpc.getState().npcs.C3).toBeDefined();           // 不误删
    expect(useNpc.getState().npcs.C3.name).toBe('Fern');       // 剥掉泄漏的 C_ 前缀
  });

  it('两个不同职业的中文名NPC不受影响', () => {
    set({
      C1: { id: 'C1', name: '芙莉莲', realm: '四阶|魔法使', profession: '魔法使', isDead: false, items: [] },
      C2: { id: 'C2', name: '辛美尔', realm: '四阶|战士', profession: '战士', isDead: false, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(0);
    expect(useNpc.getState().npcs.C2).toBeDefined();
  });

  it('无职业 → 不敢合并（保守，避免误并两个不同的四阶角色）', () => {
    set({
      C1: { id: 'C1', name: '芙莉莲', realm: '四阶', profession: '', isDead: false, items: [] },
      C2: { id: 'C2', name: 'Frieren', realm: '四阶', profession: '', isDead: false, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(0);   // 无职业匹配 → 不合并，只剥前缀（本例无前缀）
    expect(useNpc.getState().npcs.C2).toBeDefined();
  });
});
