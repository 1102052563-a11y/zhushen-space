import { describe, it, expect } from 'vitest';
import {
  MIN_CIRCLE, MAX_INFO_HOPS, MAX_INFO_HOPS_SAME_CIRCLE, detectCircles, hops, canKnowAbout,
  circleMatesOf, relevantCircles, buildCircleInjection,
} from './socialCircle';
import type { RelNode, RelEdge } from './relationGraph';

const node = (id: string, name = id, p: Partial<RelNode> = {}): RelNode => ({ id, name, tierIdx: -1, ...p });
const edge = (a: string, b: string, p: Partial<RelEdge> = {}): RelEdge =>
  ({ a: a < b ? a : b, b: a < b ? b : a, kind: 'other' as RelEdge['kind'], ...p });

/* 两个互不相连的三角：{甲一 乙二 丙三} 与 {丁四 戊五 己六}
   ⚠ 名字刻意用**双字**——注入过滤有「名字 ≥2 字才参与命中」的守卫（单字名会误命中满天飞，同 npcDrive.mentions） */
const NODES = ['甲一', '乙二', '丙三', '丁四', '戊五', '己六'].map((n) => node(n));
const EDGES = [
  edge('甲一', '乙二'), edge('乙二', '丙三'), edge('甲一', '丙三'),
  edge('丁四', '戊五'), edge('戊五', '己六'), edge('丁四', '己六'),
];

describe('socialCircle · 社区检测', () => {
  it('两个互不相连的三角 → 两个圈子', () => {
    const cs = detectCircles(NODES, EDGES);
    expect(cs).toHaveLength(2);
    for (const c of cs) expect(c.members).toHaveLength(3);
  });

  it('确定性：同一份图反复算必得同一组圈子（否则注入内容会跳来跳去）', () => {
    const a = JSON.stringify(detectCircles(NODES, EDGES));
    const b = JSON.stringify(detectCircles(NODES, EDGES));
    const c = JSON.stringify(detectCircles([...NODES].reverse(), [...EDGES].reverse()));
    expect(a).toBe(b);
    expect(a).toBe(c);   // 输入顺序不同也一样（内部按 id 排序）
  });

  it('不足最小规模的不算圈子', () => {
    expect(MIN_CIRCLE).toBe(3);
    expect(detectCircles([node('甲一'), node('乙二')], [edge('甲一', '乙二')])).toEqual([]);
  });

  it('孤立节点不成圈', () => {
    const cs = detectCircles([...NODES, node('独行')], EDGES);
    expect(cs.every((c) => !c.members.includes('独行'))).toBe(true);
  });

  it('死亡节点不参与（死人不在任何社交圈里）', () => {
    const ns = NODES.map((n) => (n.id === '丙三' ? { ...n, isDead: true } : n));
    const cs = detectCircles(ns, EDGES);
    expect(cs.every((c) => !c.members.includes('丙三'))).toBe(true);
  });

  it('⚠ 好感虚拟边不算社交圈连接（那是主角的私人关系，不是圈子）', () => {
    const ns = [node('B1', '主角'), ...NODES];
    const es = [...EDGES, edge('B1', '甲一', { favorEdge: true }), edge('B1', '丁四', { favorEdge: true })];
    const cs = detectCircles(ns, es);
    expect(cs.every((c) => !c.members.includes('B1'))).toBe(true);
  });

  it('圈子按规模降序；id 取成员里字典序最小的', () => {
    const big = [node('阿甲'), node('阿乙'), node('阿丙'), node('阿丁')];
    const bigE = [edge('阿甲', '阿乙'), edge('阿乙', '阿丙'), edge('阿丙', '阿丁'), edge('阿甲', '阿丁')];
    const cs = detectCircles([...big, ...NODES.slice(0, 3)], [...bigE, ...EDGES.slice(0, 3)]);
    expect(cs.length).toBeGreaterThanOrEqual(1);
    expect(cs[0].members.length).toBeGreaterThanOrEqual(cs[cs.length - 1].members.length);
    for (const c of cs) expect(c.id).toBe([...c.members].sort()[0]);
  });
});

describe('socialCircle · 跳数与信息传播（可判定的防超距）', () => {
  it('hops 算最短路，不可达为 Infinity', () => {
    expect(hops(NODES, EDGES, '甲一', '甲一')).toBe(0);
    expect(hops(NODES, EDGES, '甲一', '乙二')).toBe(1);
    expect(hops(NODES, EDGES, '甲一', '丁四')).toBe(Infinity);
  });

  it('同圈且距离够近 → 可以知道', () => {
    const cs = detectCircles(NODES, EDGES);
    expect(canKnowAbout(NODES, EDGES, cs, '甲一', '丙三').ok).toBe(true);
  });

  it('≤2 跳 → 可经中间人传话', () => {
    const ns = [...NODES, node('庚七')];
    const es = [...EDGES, edge('丙三', '庚七')];
    const cs = detectCircles(ns, es);
    const v = canKnowAbout(ns, es, cs, '甲一', '庚七');
    expect(v.ok).toBe(true);
    expect(v.hops).toBeLessThanOrEqual(MAX_INFO_HOPS_SAME_CIRCLE);
  });

  it('⚠ 无链路 → 拒绝，且措辞点明"对他而言根本不存在"', () => {
    const cs = detectCircles(NODES, EDGES);
    const v = canKnowAbout(NODES, EDGES, cs, '甲一', '丁四');
    expect(v.ok).toBe(false);
    expect(v.hops).toBe(Infinity);
    expect(v.reason).toContain('根本不存在');
  });

  it('⚠ 长链会被标签传播并成一个大圈，但两端离太远仍须拒绝（否则防超距失效）', () => {
    const chain = ['甲链', '乙链', '丙链', '丁链', '戊链'].map((n) => node(n));
    const ce = [edge('甲链', '乙链'), edge('乙链', '丙链'), edge('丙链', '丁链'), edge('丁链', '戊链')];
    const cs = detectCircles(chain, ce);
    const v = canKnowAbout(chain, ce, cs, '甲链', '戊链');
    expect(v.hops).toBe(4);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('超出信息传播半径');
  });

  it('同圈的放宽额度高于不同圈，但都是有限的', () => {
    expect(MAX_INFO_HOPS_SAME_CIRCLE).toBeGreaterThan(MAX_INFO_HOPS);
    expect(Number.isFinite(MAX_INFO_HOPS_SAME_CIRCLE)).toBe(true);
  });
});

describe('socialCircle · 注入过滤', () => {
  it('circleMatesOf 给出同圈其他人', () => {
    const cs = detectCircles(NODES, EDGES);
    expect(circleMatesOf(cs, '甲一').sort()).toEqual(['丙三', '乙二']);
    expect(circleMatesOf(cs, '不存在')).toEqual([]);
  });

  it('只有名字在近期文本里出现过的圈子才值得注入', () => {
    const cs = detectCircles(NODES, EDGES);
    expect(relevantCircles(cs, '')).toEqual([]);
    expect(relevantCircles(cs, '今天天气不错')).toEqual([]);
    const hit = relevantCircles(cs, '甲一和乙二在码头碰了面');
    expect(hit).toHaveLength(1);
    expect(hit[0].members).toContain('甲一');
  });

  it('命中多的圈子排前面，且有条数上限', () => {
    const cs = detectCircles(NODES, EDGES);
    const both = relevantCircles(cs, '甲一乙二丙三都在，丁四也来了', 2);
    expect(both.length).toBeLessThanOrEqual(2);
    expect(both[0].members).toContain('甲一');   // 命中 3 个 > 命中 1 个
  });

  it('注入块写明"圈外的事不会自己传进来"；无命中不出块', () => {
    const cs = detectCircles(NODES, EDGES);
    expect(buildCircleInjection(cs, '')).toEqual([]);
    const out = buildCircleInjection(cs, '甲一在码头');
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('<社交圈>');
    expect(out[0].content).toContain('圈外的事不会自己传进来');
  });
});
