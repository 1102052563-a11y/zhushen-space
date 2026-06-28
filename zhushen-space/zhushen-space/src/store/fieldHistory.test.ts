import { describe, it, expect, beforeEach } from 'vitest';
import { useFieldHistory } from './fieldHistoryStore';

describe('fieldHistoryStore 字段历史趋势', () => {
  beforeEach(() => useFieldHistory.getState().clear());

  it('★只在值变化时追加点（阶梯函数·省体积）', () => {
    const h = useFieldHistory.getState();
    h.record('npc:C1:con', 1, 75);
    h.record('npc:C1:con', 2, 75);   // 没变 → 不记
    h.record('npc:C1:con', 3, 80);   // 变了 → 记
    h.record('npc:C1:con', 4, 80);   // 没变
    h.record('npc:C1:con', 5, 30);   // 变了（无故掉了）
    const pts = useFieldHistory.getState().seriesOf('npc:C1:con');
    expect(pts.map((p) => p.value)).toEqual([75, 80, 30]);
    expect(pts.map((p) => p.turn)).toEqual([1, 3, 5]);
  });

  it('文本字段（阶位）同样阶梯记录', () => {
    const h = useFieldHistory.getState();
    h.record('npc:C1:realm', 1, '一阶');
    h.record('npc:C1:realm', 4, '二阶');
    expect(useFieldHistory.getState().seriesOf('npc:C1:realm').map((p) => p.value)).toEqual(['一阶', '二阶']);
  });

  it('每键封顶 40 点（丢最早）', () => {
    const h = useFieldHistory.getState();
    for (let i = 0; i < 50; i++) h.record('player:str', i, i);
    const pts = useFieldHistory.getState().seriesOf('player:str');
    expect(pts.length).toBe(40);
    expect(pts[0].value).toBe(10);
    expect(pts[39].value).toBe(49);
  });

  it('clear 清空', () => {
    useFieldHistory.getState().record('player:con', 1, 5);
    useFieldHistory.getState().clear();
    expect(useFieldHistory.getState().seriesOf('player:con')).toEqual([]);
  });
});
