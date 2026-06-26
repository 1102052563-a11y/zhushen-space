import { describe, it, expect } from 'vitest';
import { snapshotPlayerBag, reconcilePlayerBag } from './itemWatchdog';
import { useItems } from '../store/itemStore';

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
    // 快照里有 P1+P2（dedupe 前），现背包只剩 P1（数量已累加）→ P2 视为合并、不捞回
    const snap = [...snapshotPlayerBag(), mk({ id: 'P2', name: '药水', category: '消耗品', gradeDesc: '白色', quantity: 3 })];
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
});
