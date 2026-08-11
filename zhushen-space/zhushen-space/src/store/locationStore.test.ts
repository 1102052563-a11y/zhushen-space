import { describe, it, expect, beforeEach } from 'vitest';
import { useLocations, splitLocPath, locationTreeLines } from './locationStore';

describe('🗺 已探索地点树', () => {
  beforeEach(() => { useLocations.getState().clearAll(); });

  it('splitLocPath 认各种分隔符、滤空段、限深', () => {
    expect(splitLocPath('新宿区-御苑')).toEqual(['新宿区', '御苑']);
    expect(splitLocPath('A · B / C')).toEqual(['A', 'B', 'C']);
    expect(splitLocPath('王都>内城→王宫')).toEqual(['王都', '内城', '王宫']);
    expect(splitLocPath('')).toEqual([]);
    expect(splitLocPath('a-b-c-d-e-f-g')).toHaveLength(5);
  });

  it('recordVisit 补建祖先链、叶节点计数；连续同地不重复计', () => {
    const s = useLocations.getState();
    s.recordVisit('新宿区-御苑', '现代东京', 3);
    let nodes = useLocations.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.path === '新宿区')?.visits).toBe(0);      // 祖先=结构节点
    expect(nodes.find((n) => n.path === '新宿区-御苑')?.visits).toBe(1); // 叶=到访计数
    // 连续同地（每回合兜底重复调）→ 不再计数
    useLocations.getState().recordVisit('新宿区-御苑', '现代东京', 4);
    expect(useLocations.getState().nodes.find((n) => n.path === '新宿区-御苑')?.visits).toBe(1);
    // 去了别处再回来 → 计数+1
    useLocations.getState().recordVisit('新宿区-车站', '现代东京', 5);
    useLocations.getState().recordVisit('新宿区-御苑', '现代东京', 6);
    nodes = useLocations.getState().nodes;
    expect(nodes.find((n) => n.path === '新宿区-御苑')?.visits).toBe(2);
    expect(nodes.find((n) => n.path === '新宿区-车站')?.visits).toBe(1);
  });

  it('removeNode 连同子孙一起删；世界隔离互不影响', () => {
    const s = useLocations.getState();
    s.recordVisit('王都-内城-王宫', '古代王国', 1);
    useLocations.getState().recordVisit('王都平原', '另一个世界', 2);
    useLocations.getState().removeNode('古代王国', '王都');
    const nodes = useLocations.getState().nodes;
    expect(nodes.filter((n) => n.world === '古代王国')).toHaveLength(0);
    expect(nodes.filter((n) => n.world === '另一个世界')).toHaveLength(1);
  });

  it('locationTreeLines：世界过滤、<2 节点不出、缩进表层级、纪要随行', () => {
    const s = useLocations.getState();
    s.recordVisit('城东', '世界A', 1);
    expect(locationTreeLines(useLocations.getState().nodes, '世界A')).toEqual([]);   // 只有1节点=太少
    useLocations.getState().recordVisit('城东-旧钟楼', '世界A', 2);
    useLocations.getState().setNote('世界A', '城东-旧钟楼', '藏着地下入口');
    const lines = locationTreeLines(useLocations.getState().nodes, '世界A');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('城东');
    expect(lines[1]).toContain('　');           // 二级缩进
    expect(lines[1]).toContain('旧钟楼');
    expect(lines[1]).toContain('藏着地下入口');
    expect(locationTreeLines(useLocations.getState().nodes, '世界B')).toEqual([]);  // 别的世界看不到
  });
});
