import { describe, it, expect } from 'vitest';
import { lenientJsonParse, pickTargetItem } from './stateParser';

describe('lenientJsonParse（容忍裸键/单引号/尾逗号的 JSON）', () => {
  it('标准 JSON', () => {
    expect(lenientJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('裸键（无引号）', () => {
    expect(lenientJsonParse('{a:1,b:2}')).toEqual({ a: 1, b: 2 });
  });
  it('尾逗号（对象/数组）', () => {
    expect(lenientJsonParse('{a:1,}')).toEqual({ a: 1 });
    expect(lenientJsonParse('{a:[1,2,],}')).toEqual({ a: [1, 2] });
  });
  it('单引号', () => {
    expect(lenientJsonParse("{'a':'b'}")).toEqual({ a: 'b' });
  });
  it('解析不了 → undefined', () => {
    expect(lenientJsonParse('not json')).toBeUndefined();
    expect(lenientJsonParse('{broken')).toBeUndefined();
  });
});

describe('pickTargetItem（消耗/销毁的目标物品定位，容忍 AI 把名字塞进 itemId）', () => {
  const bag = [
    { id: 'I_B1_14', name: '古旧的炼金学徒手札' },
    { id: 'I_B1_03', name: '次级止血喷雾' },
    { id: 'I_B1_07', name: '寒铁长剑' },
  ];

  it('★回归：AI 把物品名误塞进 itemId、且漏填 name → 仍能按名字找到', () => {
    // 即本次 bug：name=undefined，itemId 实为物品名
    expect(pickTargetItem(bag, '古旧的炼金学徒手札', undefined)?.id).toBe('I_B1_14');
  });

  it('正常：itemId 命中真实 id、name 也相符 → 用它', () => {
    expect(pickTargetItem(bag, 'I_B1_14', '古旧的炼金学徒手札')?.id).toBe('I_B1_14');
  });

  it('正常：只给 name（无 itemId）→ 按名字精确找到', () => {
    expect(pickTargetItem(bag, undefined, '寒铁长剑')?.id).toBe('I_B1_07');
  });

  it('优先级：itemId 命中物品A，但 name 指向物品B → 信任 name，返回 B 而非 A', () => {
    // itemId 指向手札，但 name 给的是长剑 → 不能动手札，应返回长剑
    expect(pickTargetItem(bag, 'I_B1_14', '寒铁长剑')?.id).toBe('I_B1_07');
  });

  it('安全：给了 name 却谁也匹配不上（哪怕 itemId 命中某物）→ 返回 null（宁可不删也不误删）', () => {
    expect(pickTargetItem(bag, 'I_B1_14', '不存在的传说圣剑')).toBeNull();
  });

  it('安全：纯 id 格式的幻觉 itemId、无 name → 返回 null，不会误匹配到任何中文名物品', () => {
    expect(pickTargetItem(bag, 'I_FAKE_99', undefined)).toBeNull();
  });
});
