import { describe, it, expect, beforeEach } from 'vitest';
import { applyMapCommands } from './mapParser';
import { useMap } from '../store/mapStore';
import { usePlayer } from '../store/playerStore';

const WN = '生化危机2';

/* 每例重置：清空地图 + 主角站在 浣熊市 警察局（ingest 保证兜底区域存在） */
beforeEach(() => {
  useMap.setState({ byWorld: {} });
  useMap.getState().setSettings({ enabled: true, aiWrite: true, maxNewPerTurn: 5, archiveAfter: 30 });
  usePlayer.getState().setProfile({ location: '生化危机2 浣熊市 警察局' });
  useMap.getState().ingest(WN, { location: '生化危机2 浣熊市 警察局', turn: 1 });
});

const nodeByName = (name: string) =>
  Object.values(useMap.getState().dataOf(WN).nodes).find((n) => n.name === name);

describe('applyMapCommands（地图演化指令解析）', () => {
  it('解析 <upstore> 块里的三种指令（含中文键/单引号 JSON）', () => {
    const n = applyMapCommands([
      '<think>自检…</think>',
      '<upstore>',
      'discoverNode("下水道入口", {parent:"浣熊市", danger:4, dir:"E", note:"幸存者口中的近道", tags:"捷径,危险"})',
      "discoverNode(\"森林边缘\", {'类型':'区域', '状态':'传闻', '方位':'北'})",
      'setNode("警察局", {备注:"暂时安全的据点", 危险:2})',
      'linkNodes("警察局", "下水道入口", {kind:"secret"})',
      '</upstore>',
    ].join('\n'), { worldName: WN, turn: 2 });
    expect(n).toBe(4);
    expect(nodeByName('下水道入口')!.danger).toBe(4);
    expect(nodeByName('森林边缘')!.kind).toBe('region');
    expect(nodeByName('警察局')!.note).toBe('暂时安全的据点');
    expect(useMap.getState().dataOf(WN).edges.some((e) => e.kind === 'secret')).toBe(true);
  });

  it('无 parent 的场所落进主角当前区域（兜底）', () => {
    applyMapCommands('<upstore>\ndiscoverNode("孤儿院", {danger:3})\n</upstore>', { worldName: WN, turn: 2 });
    const region = nodeByName('浣熊市')!;
    expect(nodeByName('孤儿院')!.parentId).toBe(region.id);
  });

  it('每轮新增上限：超出配额的 discoverNode 丢弃，合并不占额', () => {
    useMap.getState().setSettings({ maxNewPerTurn: 2 });
    const n = applyMapCommands([
      '<upstore>',
      'discoverNode("甲地", {parent:"浣熊市"})',
      'discoverNode("乙地", {parent:"浣熊市"})',
      'discoverNode("丙地", {parent:"浣熊市"})',
      'discoverNode("警察局", {danger:2})',   // 合并进已有节点，不吃配额
      '</upstore>',
    ].join('\n'), { worldName: WN, turn: 2 });
    expect(n).toBe(3);   // 甲/乙 created + 警察局 merged
    expect(nodeByName('丙地')).toBeUndefined();
  });

  it('总开关关闭时不应用任何指令', () => {
    useMap.getState().setSettings({ enabled: false });
    const n = applyMapCommands('<upstore>\ndiscoverNode("甲地", {parent:"浣熊市"})\n</upstore>', { worldName: WN, turn: 2 });
    expect(n).toBe(0);
  });

  it('坏行/未知指令静默跳过，不炸整块', () => {
    const n = applyMapCommands([
      '<upstore>',
      'discoverNode("下水道入口", {parent:"浣熊市"',   // 括号没闭合
      'destroyEverything("哈哈")',
      'setNode("不存在的地方", {danger:1})',
      'discoverNode("武器店", {parent:"浣熊市"})',
      '</upstore>',
    ].join('\n'), { worldName: WN, turn: 2 });
    expect(n).toBe(1);
    expect(nodeByName('武器店')).toBeTruthy();
  });
});
