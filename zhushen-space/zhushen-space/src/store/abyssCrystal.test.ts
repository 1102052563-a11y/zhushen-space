import { describe, it, expect, beforeEach } from 'vitest';
import { useAbyss } from './abyssStore';
import { useItems } from './itemStore';

/* P3 经济缝合：灵魂结晶（世界结算 A 级+发放的材料）此前全库零消耗——
   chargeWithCrystals 是它唯一的汇：小=1/中=2/大=4 单位，凑满 4 → 觉醒充能 +1，大件优先。 */

const crystal = (name: string, qty = 1) =>
  useItems.getState().addItem({ name, category: '材料', gradeDesc: '', effect: '', quantity: qty, equipped: false } as never);

const crystalCount = () =>
  useItems.getState().items.filter((i) => /灵魂结晶/.test(i.name)).reduce((s, i) => s + (i.quantity || 1), 0);

beforeEach(() => {
  useItems.setState({ items: [] } as never);
  useAbyss.setState({ meta: { ...(useAbyss.getState() as any).meta, awakenCharges: 0 } } as never);
});

describe('chargeWithCrystals（灵魂结晶→觉醒充能）', () => {
  it('★小×4 → 充能+1，结晶耗尽', () => {
    crystal('灵魂结晶(小)', 4);
    const r = useAbyss.getState().chargeWithCrystals();
    expect(r.ok).toBe(true);
    expect((useAbyss.getState() as any).meta.awakenCharges).toBe(1);
    expect(crystalCount()).toBe(0);
  });

  it('不足 4 单位 → 拒绝且不动任何东西', () => {
    crystal('灵魂结晶(小)', 3);
    const r = useAbyss.getState().chargeWithCrystals();
    expect(r.ok).toBe(false);
    expect((useAbyss.getState() as any).meta.awakenCharges).toBe(0);
    expect(crystalCount()).toBe(3);
  });

  it('★大件优先：大×1 就够，小×2 原封不动', () => {
    crystal('灵魂结晶(大)', 1);
    crystal('灵魂结晶(小)', 2);
    const r = useAbyss.getState().chargeWithCrystals();
    expect(r.ok).toBe(true);
    expect(crystalCount()).toBe(2);   // 只耗大，小×2 留着
  });

  it('全角括号/别体命名也认档位：灵魂结晶（中）×2 = 4 单位', () => {
    crystal('灵魂结晶（中）', 2);
    const r = useAbyss.getState().chargeWithCrystals();
    expect(r.ok).toBe(true);
    expect((useAbyss.getState() as any).meta.awakenCharges).toBe(1);
  });
});
