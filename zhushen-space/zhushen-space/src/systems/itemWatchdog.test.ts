import { describe, it, expect } from 'vitest';
import { snapshotPlayerBag, reconcilePlayerBag } from './itemWatchdog';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';

const mk = (over: any) => ({ id: 'X', name: '剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0, ...over });

describe('itemWatchdog 看门狗对账（Phase 1·自动捞回静默丢失）', () => {
  it('★静默移除(裸 removeItem，不进最近删除) → 对账自动捞回', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '寒铁剑' }), mk({ id: 'B', name: '玄铁斧' })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    useItems.setState((s) => ({ items: s.items.filter((x) => x.id !== 'B') }));   // 模拟某条静默路径吞掉 B
    const r = reconcilePlayerBag(snap);
    expect(r.restored).toBe(1);
    expect(useItems.getState().items.find((x) => x.name === '玄铁斧')).toBeTruthy();
  });

  it('正常销毁(binItem→进最近删除) → 不捞回（尊重真实删除）', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '寒铁剑' })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    useItems.getState().binItem(useItems.getState().items[0], { kind: 'broken', reason: '碎了' });
    const r = reconcilePlayerBag(snap);
    expect(r.restored).toBe(0);
    expect(useItems.getState().items.length).toBe(0);
  });

  it('可堆叠物被合并(同名同品质仍有存活条目) → 不捞回（数量已保留）', () => {
    useItems.setState({ items: [mk({ id: 'P1', name: '药水', category: '消耗品', gradeDesc: '白色', quantity: 8 })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    snap.player.push(mk({ id: 'P2', name: '药水', category: '消耗品', gradeDesc: '白色', quantity: 3 }));   // 快照含 P1+P2(dedupe 前)，现只剩 P1 → P2 视为合并、不捞回
    expect(reconcilePlayerBag(snap).restored).toBe(0);
  });

  it('★装备静默消失(非合并·非删除) → 捞回，且恢复为未装备（避免槽位冲突）', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '神剑', category: '武器', equipped: true, equipSlot: 'weapon' })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    useItems.setState({ items: [] });   // 模拟静默清空
    const r = reconcilePlayerBag(snap);
    expect(r.restored).toBe(1);
    const got = useItems.getState().items[0];
    expect(got.name).toBe('神剑');
    expect(got.equipped).toBe(false);
  });

  it('无变化 → 捞回 0', () => {
    useItems.setState({ items: [mk({ id: 'A' })], recentlyDeleted: [] });
    expect(reconcilePlayerBag(snapshotPlayerBag()).restored).toBe(0);
  });

  it('id 已被复用(占位) → 不重复加（防覆盖现有物品）', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '原剑' })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    useItems.setState({ items: [mk({ id: 'A', name: '新占位物' })] });   // 同 id 已被别的物品占用
    const r = reconcilePlayerBag(snap);
    expect(r.restored).toBe(0);
    expect(useItems.getState().items.length).toBe(1);
  });

  // ── Phase 2：经官方 store 方法的移除被登记，看门狗不误捞（交易/赌坊/赠予不可恢复，避免回收复制刷物）──
  it('★store.removeItem 主动转出(交易/赠予/赌坊) → 已登记 → 对账不误捞回', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '剑' }), mk({ id: 'B', name: '盾' })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();              // 清空登记 + 快照
    useItems.getState().removeItem('B');           // 模拟把 B 卖了/赠予了
    expect(reconcilePlayerBag(snap).restored).toBe(0);
    expect(useItems.getState().items.find((x) => x.id === 'B')).toBeFalsy();   // 保持移除、未被复制回来
  });

  it('★store.consumeItem 整件用尽(卖光/用光) → 已登记 → 不误捞回', () => {
    useItems.setState({ items: [mk({ id: 'P', name: '药', category: '消耗品', quantity: 2 })], recentlyDeleted: [] });
    const snap = snapshotPlayerBag();
    useItems.getState().consumeItem('P', 2);       // 整件用尽
    expect(reconcilePlayerBag(snap).restored).toBe(0);
  });

  it('snapshot 清空登记：上一窗口登记的 id 不泄漏影响新窗口对账', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '甲' })], recentlyDeleted: [] });
    useItems.getState().removeItem('A');           // 登记 id 'A'（上一窗口）
    useItems.setState({ items: [mk({ id: 'A', name: '新甲' })], recentlyDeleted: [] });   // 新窗口又出现 id 'A'(不同物)
    const snap = snapshotPlayerBag();              // 应清空登记
    useItems.setState({ items: [] });              // 裸 filter 静默删它（未登记）
    expect(reconcilePlayerBag(snap).restored).toBe(1);   // 应捞回 → 证明上次对 'A' 的登记已被快照清空
  });

  // ── Phase 1b：随从/宠物背包同样纳入看门狗 ──
  const npcItem = (over: any) => ({ id: 'NX', name: '随从剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, ...over });
  const setCompanion = (items: any[]) => useNpc.setState({ npcs: { C1: { id: 'C1', name: '小蛇', npcTag: '随从', isDead: false, items } } as any });

  it('★随从装备静默消失 → 捞回到该随从', () => {
    useItems.setState({ items: [], recentlyDeleted: [] });
    setCompanion([npcItem({ id: 'N1', name: '蛇牙匕首' }), npcItem({ id: 'N2', name: '皮甲', category: '防具' })]);
    const snap = snapshotPlayerBag();
    setCompanion([npcItem({ id: 'N1', name: '蛇牙匕首' })]);   // N2 被某静默路径吞掉
    expect(reconcilePlayerBag(snap).restored).toBe(1);
    expect((useNpc.getState().npcs.C1.items as any[]).find((x) => x.id === 'N2')).toBeTruthy();
  });

  it('随从物品经 removeNpcItem 转出(已登记) → 不误捞', () => {
    useItems.setState({ items: [], recentlyDeleted: [] });
    setCompanion([npcItem({ id: 'N1', name: '蛇牙匕首' })]);
    const snap = snapshotPlayerBag();
    useNpc.getState().removeNpcItem('C1', 'N1');   // 主动转出
    expect(reconcilePlayerBag(snap).restored).toBe(0);
  });

  it('随从已死亡 → 不恢复其遗物', () => {
    useItems.setState({ items: [], recentlyDeleted: [] });
    setCompanion([npcItem({ id: 'N1', name: '蛇牙匕首' })]);
    const snap = snapshotPlayerBag();
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '小蛇', npcTag: '随从', isDead: true, items: [] } } as any });
    expect(reconcilePlayerBag(snap).restored).toBe(0);
  });

  // ── 防刷装备：物品被移到从者身上(转移会换新 id)→ 全局存在性检查 → 不重复找回 ──
  it('★物品放到从者装备栏(换了新id·同名同品)→ 不重复找回（防无限刷装备）', () => {
    useItems.setState({ items: [mk({ id: 'A', name: '神剑', category: '武器', gradeDesc: '金色' })], recentlyDeleted: [] });
    useNpc.setState({ npcs: {} } as any);
    const snap = snapshotPlayerBag();   // 快照：玩家背包有神剑A，无从者
    // 模拟"放到从者装备栏"：玩家背包移除，从者 C1 多出一把同名神剑（新 id、装备态）
    useItems.setState({ items: [] });
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '小蛇', npcTag: '随从', isDead: false, items: [{ id: 'NEW_99', name: '神剑', category: '武器', gradeDesc: '金色', equipped: true }] } } as any });
    const r = reconcilePlayerBag(snap);
    expect(r.restored).toBe(0);                          // 不找回
    expect(useItems.getState().items.length).toBe(0);    // 背包不再凭空多出第二把（无刷物）
  });
});
