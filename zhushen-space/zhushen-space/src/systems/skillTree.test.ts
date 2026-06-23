import { describe, it, expect } from 'vitest';
import { validateTree, canRankUp, treeAttrDelta } from './skillTree';

const byId = (tree: any): Record<string, any> => Object.fromEntries(tree.nodes.map((n: any) => [n.id, n]));

describe('validateTree · 阶位 gate 按前置链深度递进（封顶七阶）', () => {
  it('线性链：深度1=一阶，每深一层 +1 阶，深度≥7 封顶七阶', () => {
    const nodes: any[] = [{ id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [] }];
    for (let i = 1; i <= 9; i++) nodes.push({ id: `n${i}`, kind: 'minor', layer: i, branch: 'b1', prereqs: [i === 1 ? 'core' : `n${i - 1}`] });
    const { tree } = validateTree({ source: 'ai', branches: [{ id: 'b1', name: 'B1' }], nodes });
    const m = byId(tree);
    expect(m.core.tierGate).toBe('一阶'); // depth 0
    expect(m.n1.tierGate).toBe('一阶');   // depth 1 → idx 0
    expect(m.n2.tierGate).toBe('二阶');   // depth 2 → idx 1
    expect(m.n6.tierGate).toBe('六阶');   // depth 6 → idx 5
    expect(m.n7.tierGate).toBe('七阶');   // depth 7 → idx 6
    expect(m.n8.tierGate).toBe('七阶');   // depth 8 → 封顶七阶
    expect(m.n9.tierGate).toBe('七阶');
  });
  it('显式阶位保留并封顶七阶（内置大节点 / DIY 手设）', () => {
    const { tree } = validateTree({ source: 'builtin', branches: [{ id: 'b1', name: 'B1' }], nodes: [
      { id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [] },
      { id: 'a', kind: 'major', layer: 2, branch: 'b1', prereqs: ['core'], tierGate: '五阶', grants: { skill: { name: 'S' } } },
      { id: 'b', kind: 'major', layer: 3, branch: 'b1', prereqs: ['a'], tierGate: '九阶', grants: { skill: { name: 'S2' } } },
    ] });
    const m = byId(tree);
    expect(m.a.tierGate).toBe('五阶');   // 合法阶位保留
    expect(m.b.tierGate).toBe('七阶');   // 九阶 → 封顶七阶
  });
});

describe('validateTree · 属性收口（减少微星 + 大/中节点不给·所有树含内置）', () => {
  it('微星每维封顶 +1；medium/major/capstone 清 ptAttr+attrBonus；sink/core 保留', () => {
    const { tree } = validateTree({ source: 'builtin', branches: [{ id: 'b1', name: 'B1' }], nodes: [
      { id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [], ptAttr: { str: 1, int: 1 }, grants: { trait: { name: 'CoreT', attrBonus: '力量+2', effect: 'x' } } },
      { id: 'mi', kind: 'minor', layer: 1, branch: 'b1', prereqs: ['core'], ptAttr: { int: 3 } },
      { id: 'me', kind: 'medium', layer: 2, branch: 'b1', prereqs: ['mi'], ptAttr: { int: 2 }, grants: { skill: { name: 'MS', attrBonus: '智力+2' } } },
      { id: 'mj', kind: 'major', layer: 3, branch: 'b1', prereqs: ['me'], ptAttr: { int: 4 }, grants: { skill: { name: 'JS', attrBonus: '智力+4' } } },
      { id: 'sk', kind: 'capstone', layer: 4, branch: 'b1', prereqs: ['mj'], sink: true, realAttr: true, ptAttr: { int: 1 } },
    ] });
    const m = byId(tree);
    expect(m.mi.ptAttr).toEqual({ int: 1 });            // 微星 3 → 1
    expect(m.core.ptAttr).toEqual({ str: 1, int: 1 });  // core(minor) 已 ≤1 → 保留
    expect(m.core.grants.trait.attrBonus).toBe('力量+2'); // core 不被清
    expect(m.me.ptAttr).toBeUndefined();                // medium 清 ptAttr
    expect(m.me.grants.skill.attrBonus).toBe('');       // medium 清 attrBonus
    expect(m.mj.ptAttr).toBeUndefined();                // major 清
    expect(m.mj.grants.skill.attrBonus).toBe('');
    expect(m.sk.ptAttr).toEqual({ int: 1 });            // 无尽端点 sink 保留
  });
  it('treeAttrDelta 反映微星封顶（智力堆叠被削）', () => {
    const { tree } = validateTree({ source: 'builtin', branches: [{ id: 'b1', name: 'B1' }], nodes: [
      { id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [], ptAttr: { int: 1 } },
      { id: 'a', kind: 'minor', layer: 1, branch: 'b1', prereqs: ['core'], ptAttr: { int: 4 } },
    ] });
    const delta = treeAttrDelta(tree, { ranks: { core: 1, a: 3 } }); // a 点满 3 次
    expect(delta.int).toBe(1 + 1 * 3); // core1 + a(封顶1×3)=4（封顶前会是 1 + 4×3 = 13）
  });
});

describe('canRankUp · 阶位 gate 实际拦截', () => {
  const mk = () => validateTree({ source: 'ai', branches: [{ id: 'b1', name: 'B1' }], nodes: [
    { id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [] },
    { id: 'n1', kind: 'minor', layer: 1, branch: 'b1', prereqs: ['core'] },
    { id: 'n2', kind: 'minor', layer: 2, branch: 'b1', prereqs: ['n1'] },
    { id: 'n3', kind: 'minor', layer: 3, branch: 'b1', prereqs: ['n2'] }, // 深度3 → 三阶
  ] }).tree;
  const prog = { ranks: { core: 1, n1: 3, n2: 3 } };
  it('一阶玩家点三阶节点 → 拦截·提示阶位不足', () => {
    const chk = canRankUp(mk(), 'n3', prog, { level: 1, tier: '一阶' });
    expect(chk.ok).toBe(false);
    expect(chk.reason).toContain('阶位不足');
  });
  it('三阶玩家(Lv.25) → 通过阶位 gate', () => {
    expect(canRankUp(mk(), 'n3', prog, { level: 25, tier: '三阶' }).ok).toBe(true);
  });
  it('传承提前解锁(express) → 免阶位 gate', () => {
    expect(canRankUp(mk(), 'n3', prog, { level: 1, tier: '一阶', expressBranches: new Set(['b1']) }).ok).toBe(true);
  });
});
