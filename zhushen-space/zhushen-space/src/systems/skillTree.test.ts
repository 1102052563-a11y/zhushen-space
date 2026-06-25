import { describe, it, expect } from 'vitest';
import { validateTree, canRankUp, treeAttrDelta, autoLayout } from './skillTree';

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
  it('noTierGate=true → 清空所有 tierGate·一阶可点深层(生成时关闭阶位限制)', () => {
    const nodes: any[] = [{ id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [] }];
    for (let i = 1; i <= 8; i++) nodes.push({ id: `n${i}`, kind: 'minor', layer: i, branch: 'b1', prereqs: [i === 1 ? 'core' : `n${i - 1}`] });
    const { tree } = validateTree({ source: 'ai', noTierGate: true, branches: [{ id: 'b1', name: 'B1' }], nodes });
    expect(tree.noTierGate).toBe(true);
    expect(tree.nodes.every((n) => !n.tierGate)).toBe(true);   // 全部清空
    const prog = { ranks: { core: 1, n1: 3, n2: 3, n3: 3, n4: 3 }, spent: 0, aiBonusPP: 99 };
    const chk = canRankUp(tree, 'n5', prog, { level: 1, tier: '一阶' });
    expect(chk.ok, chk.reason).toBe(true);   // 一阶点深层节点不被阶位拦（给足潜能点排除 pp 干扰）
  });
});

describe('validateTree · 属性收口（减少微星 + 大/中节点不给·所有树含内置）', () => {
  it('微星每次点亮只 +1 属性点(收敛单一主维)；medium/major/capstone 清 ptAttr+attrBonus；sink 保留', () => {
    const { tree } = validateTree({ source: 'builtin', branches: [{ id: 'b1', name: 'B1' }], nodes: [
      { id: 'core', kind: 'minor', layer: 0, branch: 'b1', prereqs: [], ptAttr: { str: 1, int: 1 }, grants: { trait: { name: 'CoreT', attrBonus: '力量+2', effect: 'x' } } },
      { id: 'mi', kind: 'minor', layer: 1, branch: 'b1', prereqs: ['core'], ptAttr: { int: 3 } },
      { id: 'mu', kind: 'minor', layer: 1, branch: 'b1', prereqs: ['core'], ptAttr: { str: 2, agi: 3, int: 1 } },
      { id: 'me', kind: 'medium', layer: 2, branch: 'b1', prereqs: ['mi'], ptAttr: { int: 2 }, grants: { skill: { name: 'MS', attrBonus: '智力+2' } } },
      { id: 'mj', kind: 'major', layer: 3, branch: 'b1', prereqs: ['me'], ptAttr: { int: 4 }, grants: { skill: { name: 'JS', attrBonus: '智力+4' } } },
      { id: 'sk', kind: 'capstone', layer: 4, branch: 'b1', prereqs: ['mj'], sink: true, realAttr: true, ptAttr: { int: 1 } },
    ] });
    const m = byId(tree);
    expect(m.mi.ptAttr).toEqual({ int: 1 });            // 微星 {int:3} → {int:1}
    expect(m.mu.ptAttr).toEqual({ agi: 1 });            // 多维 {str:2,agi:3,int:1} → 取最大维 agi=1（总 +1）
    expect(m.core.ptAttr).toEqual({ str: 1 });          // core {str:1,int:1} → 收敛单维 {str:1}（每次点亮只 +1）
    expect(m.core.grants.trait.attrBonus).toBe('力量+2'); // core 的天赋 attrBonus 不被清
    expect(m.me.ptAttr).toBeUndefined();                // medium 清 ptAttr
    expect(m.me.grants.skill.attrBonus).toBe('');       // medium 清 attrBonus
    expect(m.mj.ptAttr).toBeUndefined();                // major 清
    expect(m.mj.grants.skill.attrBonus).toBe('');
    expect(m.sk.ptAttr).toEqual({ int: 1 });            // 无尽端点 sink 保留（真实属性 ×80）
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
    // ppBase=0 后 1 级玩家潜能点为 0；本例只验「express 免阶位 gate」，故给足潜能点(aiBonusPP)以隔离 PP 预算变量。
    expect(canRankUp(mk(), 'n3', { ...prog, aiBonusPP: 5 }, { level: 1, tier: '一阶', expressBranches: new Set(['b1']) }).ok).toBe(true);
  });
});

describe('autoLayout · 主干式(trunk) 布局', () => {
  it('通用主干竖直居中、专精流派从主干顶端向两侧分流且更靠上', () => {
    const { tree } = validateTree({
      source: 'ai', layout: 'trunk',
      branches: [{ id: 'trunk', name: '通用' }, { id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
      nodes: [
        { id: 'core', kind: 'minor', branch: 'trunk', layer: 0, prereqs: [] },
        { id: 't1', kind: 'minor', branch: 'trunk', layer: 1, prereqs: ['core'] },
        { id: 't2', kind: 'minor', branch: 'trunk', layer: 2, prereqs: ['t1'] },   // 主干末端(深度2)
        { id: 'a1', kind: 'medium', branch: 'a', layer: 3, prereqs: ['t2'], grants: { skill: { name: 'A1' } } },
        { id: 'a2', kind: 'major', branch: 'a', layer: 4, prereqs: ['a1'], grants: { skill: { name: 'A2' } } },
        { id: 'b1', kind: 'medium', branch: 'b', layer: 3, prereqs: ['t2'], grants: { skill: { name: 'B1' } } },
      ],
    });
    expect(tree.layout).toBe('trunk');
    const t = autoLayout(tree);
    const m = byId(t);
    expect(m.core.x).toBe(m.t1.x);          // 主干竖直：x 一致
    expect(m.t1.x).toBe(m.t2.x);
    expect(Math.sign(m.a1.x - m.t2.x)).not.toBe(Math.sign(m.b1.x - m.t2.x));   // 两条流派分列主干两侧
    expect(m.a1.y).toBeLessThan(m.t2.y);    // 流派起点比主干末端更靠上(y 更小)
    expect(m.a2.y).toBeLessThan(m.a1.y);    // 越深越往上
  });
});
