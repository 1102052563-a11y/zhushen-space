import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';

/* 登场骨架 tag/ow 键（登场即分类·治「宠物/召唤物出生即被世界默认钉成土著」）：
   npc.<id>={tag:"召唤物", ow:"B1", …} → applySkeleton 直落 npcTag/ownerId；
   前端世界默认标签只在骨架没给 tag 时兜底（App.applyEntryResult 检查 !npcTag 在 applySkeleton 之后）。 */

describe('applySkeleton：tag（五选一标签）', () => {
  beforeEach(() => { useNpc.setState({ npcs: {} }); });

  it('合法标签直落 npcTag（召唤物/宠物/随从/土著/契约者）', () => {
    useNpc.getState().applySkeleton('G3', { n: '岩甲龟', tag: '召唤物', ow: 'B1' });
    const r = useNpc.getState().npcs['G3'];
    expect(r.npcTag).toBe('召唤物');
    expect(r.ownerId).toBe('B1');
    useNpc.getState().applySkeleton('C5', { n: '小黑', tag: '宠物' });
    expect(useNpc.getState().npcs['C5'].npcTag).toBe('宠物');
  });

  it('非法标签丢弃（留给前端世界默认兜底），不写脏值', () => {
    useNpc.getState().applySkeleton('C1', { n: '路人甲', tag: 'boss' });
    expect(useNpc.getState().npcs['C1'].npcTag).toBeUndefined();
  });

  it('tag/ow 是已知骨架键：不落进 extra 兜底桶', () => {
    useNpc.getState().applySkeleton('C2', { n: '小白', tag: '宠物', ow: 'B1' });
    const ex = useNpc.getState().npcs['C2'].extra ?? {};
    expect(ex['tag']).toBeUndefined();
    expect(ex['ow']).toBeUndefined();
  });
});

describe('applySkeleton：ow（主人编号·归属外键）', () => {
  beforeEach(() => { useNpc.setState({ npcs: {} }); });

  it('B1 / C·G 编号合法；小写归一大写', () => {
    useNpc.getState().applySkeleton('C7', { n: '灵狐', tag: '宠物', ow: 'C3' });
    expect(useNpc.getState().npcs['C7'].ownerId).toBe('C3');
    useNpc.getState().applySkeleton('G2', { n: '火鸦', tag: '召唤物', ow: 'b1' });
    expect(useNpc.getState().npcs['G2'].ownerId).toBe('B1');
  });

  it('非法主人编号（人名/自创ID）丢弃 → ownerOf 缺省回退 B1 语义', () => {
    useNpc.getState().applySkeleton('C8', { n: '幼龙', tag: '宠物', ow: '主角' });
    expect(useNpc.getState().npcs['C8'].ownerId).toBeUndefined();
  });
});
