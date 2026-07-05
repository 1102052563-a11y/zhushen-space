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

  it('★全新空壳罗马音档(Akaza·无阶位/职业/头衔) + 在场中文正档唯一 → 合并进正档（治"新登场生成两次"）', () => {
    set({
      C1: { id: 'C1', name: '猗窝座', realm: '五阶', profession: '', title: '上弦之叁', isDead: false, onScene: true, items: [] },
      C2: { id: 'C2', name: 'Akaza', realm: '', profession: '', title: '', isDead: false, onScene: true, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(1);
    expect(useNpc.getState().npcs.C2).toBeUndefined();   // 空壳重复档被合并删除
    expect(useNpc.getState().npcs.C1).toBeDefined();
  });

  it('在场中文正档有多个(歧义) → 空壳罗马音档保守不合并', () => {
    set({
      C1: { id: 'C1', name: '猗窝座', realm: '五阶', isDead: false, onScene: true, items: [] },
      C2: { id: 'C2', name: '童磨', realm: '五阶', isDead: false, onScene: true, items: [] },
      C3: { id: 'C3', name: 'Akaza', realm: '', isDead: false, onScene: true, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(0);   // 2 个在场中文正档 → 歧义 → 不敢乱并
    expect(useNpc.getState().npcs.C3).toBeDefined();
  });

  it('空壳罗马音档但中文正档不在场 → 不合并（缺在场唯一信号·避免误并离场角色）', () => {
    set({
      C1: { id: 'C1', name: '猗窝座', realm: '五阶', isDead: false, onScene: false, items: [] },
      C2: { id: 'C2', name: 'Akaza', realm: '', isDead: false, onScene: true, items: [] },
    });
    expect(useNpc.getState().dedupeAliasNpcs()).toBe(0);   // 正档不在场 → 兜底不触发
    expect(useNpc.getState().npcs.C2).toBeDefined();
  });
});

describe('★NPC facade 闸门（同真名重复建档·subscribe 即时合并·不结构性可行故复用 dedupeByName）', () => {
  beforeEach(() => set({}));

  it('setState 两个 id 同一真名 → 闸门自动合并成一个（重复建档无法跨状态变动存活）', () => {
    set({
      C1: { id: 'C1', name: '张三', realm: '二阶|剑客', personality: '豪爽', favor: 50, isDead: false, items: [] },
      C2: { id: 'C2', name: '张三', realm: '二阶|剑客', personality: '', favor: 10, isDead: false, items: [] },
    });
    const zhangs = Object.values(useNpc.getState().npcs).filter((n: any) => n.name === '张三');
    expect(zhangs.length).toBe(1);   // 被 facade 闸门合并
  });

  it('不同真名不误合（闸门只认精确同名）', () => {
    set({
      C1: { id: 'C1', name: '张三', realm: '二阶', isDead: false, items: [] },
      C2: { id: 'C2', name: '李四', realm: '二阶', isDead: false, items: [] },
    });
    expect(Object.keys(useNpc.getState().npcs).length).toBe(2);   // 不同名不动
  });
});

describe('★幽灵结构性根除（#1·applyColumns 无名不建壳守卫）', () => {
  beforeEach(() => set({}));

  it('新 id 只发好感度（无名字列）→ 不凭空建幽灵', () => {
    useNpc.getState().applyColumns('C22', { '15': 50 });   // favor.C22 短指令·未建档
    expect(useNpc.getState().npcs.C22).toBeUndefined();    // 幽灵源头被堵
  });

  it('新 id 只发阶位（无名字列）→ 不建幽灵', () => {
    useNpc.getState().applyColumns('C23', { '2': '三阶|剑客' });
    expect(useNpc.getState().npcs.C23).toBeUndefined();
  });

  it('新 id 带名字列 → 正常建档（登场/add 照常）', () => {
    useNpc.getState().applyColumns('C24', { '1': '张三', '15': 60, '2': '二阶' });
    expect(useNpc.getState().npcs.C24?.name).toBe('张三');
    expect(useNpc.getState().npcs.C24?.favor).toBe(60);
  });

  it('已存在真名 NPC 无名字列更新 → 照常（prev 存在放行）', () => {
    set({ C1: { id: 'C1', name: '李四', realm: '二阶', isDead: false, items: [] } });
    useNpc.getState().applyColumns('C1', { '15': 99 });
    expect(useNpc.getState().npcs.C1?.favor).toBe(99);
  });
});

describe('★幽灵 facade 闸门（#1·subscribe 结构性清除·不再单靠 pruneGhostNpcs 时序）', () => {
  beforeEach(() => set({}));

  it('★沉淀幽灵（跨过一次状态变动仍是无名空壳）→ 闸门自动清除', () => {
    set({ C9: { id: 'C9', name: 'C9', isDead: false, items: [] } });                 // ① 建无名空壳(name===id·新建·宽限保留)
    expect(useNpc.getState().npcs.C9).toBeDefined();                                 //    宽限一次：本回合建档中不误删
    set({ C9: { id: 'C9', name: 'C9', isDead: false, items: [] },                    // ② 再一次状态变动 → C9 成"沉淀幽灵"
          C1: { id: 'C1', name: '张三', realm: '二阶', favor: 5, isDead: false, items: [] } });
    expect(useNpc.getState().npcs.C9).toBeUndefined();                               //    沉淀幽灵被结构性清除
    expect(useNpc.getState().npcs.C1).toBeDefined();                                 //    真名 NPC 不动
  });

  it('★新建无名空壳享一次宽限（护本回合正在建档的新角色·先建壳后补名）', () => {
    set({ C7: { id: 'C7', name: 'C7', isDead: false, items: [] } });
    expect(useNpc.getState().npcs.C7).toBeDefined();   // 新建幽灵 prev 无 → 宽限·不误删
  });

  it('占位名但有真实身份(背景) → 非幽灵，即便沉淀也保留', () => {
    set({ C8: { id: 'C8', name: 'C8', background: '神秘剑客', isDead: false, items: [] } });
    set({ C8: { id: 'C8', name: 'C8', background: '神秘剑客', isDead: false, items: [] },
          C1: { id: 'C1', name: '张三', realm: '二阶', favor: 5, isDead: false, items: [] } });
    expect(useNpc.getState().npcs.C8).toBeDefined();   // 有身份→非空壳→绝不删
  });

  it('★pruneGhosts() 全量（启动/读档路径）：删当前全部幽灵、留真名', () => {
    set({ C6: { id: 'C6', name: 'C6', isDead: false, items: [] },                    // 新建·subscribe 宽限保留
          C5: { id: 'C5', name: '王五', realm: '三阶', favor: 10, isDead: false, items: [] } });
    expect(useNpc.getState().npcs.C6).toBeDefined();                                 // 宽限
    const removed = useNpc.getState().pruneGhosts();                                 // 不传 settledPrev＝删全部幽灵
    expect(removed).toBe(1);
    expect(useNpc.getState().npcs.C6).toBeUndefined();
    expect(useNpc.getState().npcs.C5).toBeDefined();
  });
});
