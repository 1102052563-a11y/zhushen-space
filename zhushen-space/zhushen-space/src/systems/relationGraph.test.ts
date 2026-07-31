import { describe, it, expect } from 'vitest';
import {
  buildRelationGraph, egoSubgraph, layoutRelationGraph, classifyRelation, PLAYER_NODE_ID,
} from './relationGraph';
import type { NpcRecord } from '../store/npcStore';

function mk(id: string, name: string, relations = '', extra: Partial<NpcRecord> = {}): NpcRecord {
  return {
    id, name, gender: '', realm: '三阶·Lv.25', personality: '', status: '一切正常',
    callPlayer: '', background: '', innerThought: '', relations, favor: 0,
    appearance5: '', motiveNow: '', shortGoal: '', longGoal: '', inCombat: false,
    appearanceDetail: '', title: '', items: [], extra: {}, onScene: true, updatedAt: 0,
    ...extra,
  } as NpcRecord;
}

const OPTS = { playerName: '林越', playerTier: '四阶' };

describe('classifyRelation', () => {
  it('宿敌优先于其它含「敌」的词', () => {
    expect(classifyRelation('宿敌')).toBe('enemy');
    expect(classifyRelation('势不两立的死敌')).toBe('enemy');
  });
  it('同门归盟友、师徒归主从（顺序即优先级）', () => {
    expect(classifyRelation('师兄')).toBe('ally');
    expect(classifyRelation('师父')).toBe('lord');
    expect(classifyRelation('爱徒')).toBe('lord');   // 「徒」不被亲缘的「弟」抢走
  });
  it('认不出的词归 other', () => {
    expect(classifyRelation('说不清')).toBe('other');
  });
});

describe('buildRelationGraph', () => {
  it('按 C 编号与姓名两种写法都能连上边', () => {
    const recs = [
      mk('C1', '苏晓', 'C2:宿敌;B1:旧识'),
      mk('C2', '王卡', '苏晓:宿敌'),
    ];
    const g = buildRelationGraph(recs, OPTS);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['B1', 'C1', 'C2']);
    const e = g.edges.find((x) => x.a === 'C1' && x.b === 'C2');
    expect(e?.kind).toBe('enemy');
    expect(e?.ab).toBe('宿敌');
    expect(e?.ba).toBe('宿敌');   // 姓名写法解析回 C1，双向都记上
  });

  it('无档案的引用留成 ghost 节点，长句目标丢弃', () => {
    const g = buildRelationGraph([mk('C1', '苏晓', '张三:旧部;这是一句根本不像人名的长长描述:随便')], OPTS);
    const ghosts = g.nodes.filter((n) => n.ghost);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].name).toBe('张三');
  });

  it('AI 直书主角姓名时并到 B1，不另开 ghost', () => {
    const g = buildRelationGraph([mk('C1', '苏晓', '林越:契约同伴')], OPTS);
    expect(g.nodes.some((n) => n.ghost)).toBe(false);
    expect(g.edges.some((e) => e.a === PLAYER_NODE_ID || e.b === PLAYER_NODE_ID)).toBe(true);
  });

  it('好感虚拟边只在超过阈值时连，且不吞掉真实关系边', () => {
    const recs = [mk('C1', '苏晓', '', { favor: 88 }), mk('C2', '王卡', '', { favor: 20 })];
    const g = buildRelationGraph(recs, OPTS);
    const favors = g.edges.filter((e) => e.favorEdge);
    expect(favors).toHaveLength(1);
    expect(favors[0].favorVal).toBe(88);
    expect(g.nodes.some((n) => n.id === 'C2')).toBe(false);   // 无边且未开 showIsolated → 不入图
  });

  it('[object Object] 脏数据与自引用被丢弃', () => {
    const g = buildRelationGraph([mk('C1', '苏晓', '[object Object];C1:自己')], OPTS);
    expect(g.edges).toHaveLength(0);
  });

  it('centerId 指定的孤立角色仍然保留（否则 ego 图上连自己都看不到）', () => {
    const g = buildRelationGraph([mk('C7', '孤狼')], { ...OPTS, centerId: 'C7' });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['B1', 'C7']);
  });
});

describe('egoSubgraph', () => {
  //  C1 — C2 — C3 — C4   （一条链，方便验证跳数）
  const chain = buildRelationGraph([
    mk('C1', '甲', 'C2:盟友'),
    mk('C2', '乙', 'C3:盟友'),
    mk('C3', '丙', 'C4:盟友'),
    mk('C4', '丁'),
  ], { ...OPTS, favorEdges: false });

  it('1 跳只取直接邻居', () => {
    const g = egoSubgraph(chain, 'C2', 1);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['C1', 'C2', 'C3']);
    expect(g.edges).toHaveLength(2);
  });

  it('2 跳向外再扩一层', () => {
    const g = egoSubgraph(chain, 'C2', 2);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['C1', 'C2', 'C3', 'C4']);
  });

  it('保留入选节点彼此之间的边（不只是到中心的边）', () => {
    const tri = buildRelationGraph([
      mk('C1', '甲', 'C2:盟友;C3:盟友'),
      mk('C2', '乙', 'C3:宿敌'),
      mk('C3', '丙'),
    ], { ...OPTS, favorEdges: false });
    const g = egoSubgraph(tri, 'C1', 1);
    expect(g.edges).toHaveLength(3);   // C1-C2 / C1-C3 / C2-C3
  });

  it('中心不在图里 → 空图', () => {
    expect(egoSubgraph(chain, 'C99', 1).nodes).toHaveLength(0);
  });
});

describe('layoutRelationGraph', () => {
  const recs = [mk('C1', '甲', 'C2:盟友'), mk('C2', '乙', 'C3:宿敌'), mk('C3', '丙')];
  const g = buildRelationGraph(recs, OPTS);

  it('确定性：同一批节点两次布局完全一致', () => {
    expect(layoutRelationGraph(g.nodes, g.edges, 900)).toEqual(layoutRelationGraph(g.nodes, g.edges, 900));
  });

  it('缺省把主角钉在画布中心', () => {
    const pos = layoutRelationGraph(g.nodes, g.edges, 900);
    expect(pos[PLAYER_NODE_ID]).toEqual({ x: 450, y: 450 });
  });

  it('传 centerId 则改钉该角色，主角让出中心', () => {
    const pos = layoutRelationGraph(g.nodes, g.edges, 900, 'C2');
    expect(pos.C2).toEqual({ x: 450, y: 450 });
    expect(pos[PLAYER_NODE_ID]).not.toEqual({ x: 450, y: 450 });
  });

  it('所有点都落在画布内', () => {
    const pos = layoutRelationGraph(g.nodes, g.edges, 900, 'C2');
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(900);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(900);
    }
  });
});
