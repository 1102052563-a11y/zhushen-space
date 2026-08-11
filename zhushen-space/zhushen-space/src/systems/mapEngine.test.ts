import { describe, it, expect } from 'vitest';
import {
  emptyWorldMap, ingestTurn, touchMentions, applyDiscover, applySetNode, applyLink, applyVisit,
  splitLocationPath, placeNode, sectorAngle, travelQuote, serializeWorldPois, serializeSceneMap,
  buildMapDigest, eventPinsFor, mapWorldKey, resolveNodeIn,
  MAP_CANVAS_W, MAP_CANVAS_H, type WorldMapData, type MapNode,
} from './mapEngine';

// ── 小工具：按名字找节点（测试断言用）──
const byName = (d: WorldMapData, name: string): MapNode | undefined =>
  Object.values(d.nodes).find((n) => n.name === name);

const WN = '生化危机2';

const ingested = (loc: string, turn = 1, prev?: WorldMapData) =>
  ingestTurn(prev ?? emptyWorldMap(), { worldName: WN, location: loc, turn });

describe('splitLocationPath（地点全路径 → 层级段）', () => {
  it('剥世界名前缀 + 空格/·分隔', () => {
    expect(splitLocationPath('生化危机2 浣熊市 警察局 二楼回廊', WN)).toEqual(['浣熊市', '警察局', '二楼回廊']);
    expect(splitLocationPath('生化危机2·浣熊市·警察局', WN)).toEqual(['浣熊市', '警察局']);
  });
  it('无世界名前缀也照拆；空串返回空', () => {
    expect(splitLocationPath('浣熊市 武器店', WN)).toEqual(['浣熊市', '武器店']);
    expect(splitLocationPath('', WN)).toEqual([]);
    expect(splitLocationPath('  ', WN)).toEqual([]);
  });
  it('段数封顶 4', () => {
    expect(splitLocationPath('a b c d e f', WN).length).toBe(4);
  });
});

describe('sectorAngle（方位提示 → 扇区角）', () => {
  it('中英都认；复合方位优先', () => {
    expect(sectorAngle('N')).toBeCloseTo(-Math.PI / 2);
    expect(sectorAngle('东北')).toBeCloseTo(-Math.PI / 4);
    expect(sectorAngle('SW')).toBeCloseTo((3 * Math.PI) / 4);
    expect(sectorAngle('胡言乱语')).toBeNull();
    expect(sectorAngle('')).toBeNull();
  });
});

describe('ingestTurn（每回合确定性建图）', () => {
  it('位置路径 → 区域+场所（已访）+足迹+面包屑', () => {
    const r = ingested('生化危机2 浣熊市 警察局', 3);
    expect(r.changed).toBe(true);
    expect(r.newNames).toEqual(['浣熊市', '警察局']);
    const region = byName(r.data, '浣熊市')!;
    const site = byName(r.data, '警察局')!;
    expect(region.kind).toBe('region');
    expect(region.status).toBe('visited');
    expect(site.parentId).toBe(region.id);
    expect(site.status).toBe('visited');
    expect(site.lastVisitTurn).toBe(3);
    expect(r.arrivedId).toBe(site.id);
    expect(r.data.trail).toEqual([site.id]);
    expect(r.data.currentPath).toEqual(['浣熊市', '警察局']);
  });

  it('幂等：同位置重放不新建、不再变更', () => {
    const r1 = ingested('生化危机2 浣熊市 警察局', 3);
    const r2 = ingestTurn(r1.data, { worldName: WN, location: '生化危机2 浣熊市 警察局', turn: 3 });
    expect(r2.newNames).toEqual([]);
    expect(r2.changed).toBe(false);
    expect(Object.keys(r2.data.nodes).length).toBe(2);
  });

  it('移动到新场所 → 足迹成路（road 边）', () => {
    const r1 = ingested('生化危机2 浣熊市 警察局', 1);
    const r2 = ingestTurn(r1.data, { worldName: WN, location: '生化危机2 浣熊市 武器店', turn: 2 });
    const a = byName(r2.data, '警察局')!;
    const b = byName(r2.data, '武器店')!;
    expect(r2.data.edges).toEqual([{ a: a.id, b: b.id, kind: 'road' }]);
    expect(r2.data.trail).toEqual([a.id, b.id]);
  });

  it('名称包含匹配吸收别名，不裂新节点', () => {
    const r1 = ingested('生化危机2 浣熊市 警察局', 1);
    const r2 = ingestTurn(r1.data, { worldName: WN, location: '生化危机2 浣熊市 警察局二楼', turn: 2 });
    expect(r2.newNames).toEqual([]);   // 「警察局二楼」包含匹配到「警察局」
    const site = byName(r2.data, '警察局')!;
    expect(site.aliases).toContain('警察局二楼');
  });

  it('世界大事：region 档=已探 / background=传闻；不降级已访', () => {
    const r = ingestTurn(emptyWorldMap(), {
      worldName: WN, location: '生化危机2 浣熊市 警察局', turn: 1,
      events: [
        { location: '生化危机2 浣熊市 圣玛丽医院', scope: 'region' },
        { location: '生化危机2 森林边缘', scope: 'background' },
        { location: '生化危机2 浣熊市 警察局', scope: 'background' },   // 主角已访，不许被拉低
      ],
    });
    expect(byName(r.data, '圣玛丽医院')!.status).toBe('discovered');
    expect(byName(r.data, '森林边缘')!.status).toBe('rumored');
    expect(byName(r.data, '警察局')!.status).toBe('visited');
  });

  it('传闻超龄归档，图钉豁免', () => {
    let d = ingestTurn(emptyWorldMap(), {
      worldName: WN, location: '', turn: 1,
      events: [{ location: '生化危机2 森林边缘', scope: 'background' }, { location: '生化危机2 旧钟楼', scope: 'background' }],
    }).data;
    const pinId = byName(d, '旧钟楼')!.id;
    d = { ...d, nodes: { ...d.nodes, [pinId]: { ...d.nodes[pinId], pinned: true } } };
    const r = ingestTurn(d, { worldName: WN, location: '', turn: 40, archiveAfter: 10 });
    expect(byName(r.data, '森林边缘')!.archived).toBe(true);
    expect(byName(r.data, '旧钟楼')!.archived).toBeUndefined();
  });
});

describe('touchMentions（正文提及触达）', () => {
  it('正文含节点名 → 刷新 lastSeenTurn 并解除归档', () => {
    let d = ingested('生化危机2 浣熊市 警察局', 1).data;
    const id = byName(d, '警察局')!.id;
    d = { ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id], archived: true } } };
    const r = touchMentions(d, '他回头望了一眼警察局的方向。', 9);
    expect(r.changed).toBe(true);
    expect(r.data.nodes[id].lastSeenTurn).toBe(9);
    expect(r.data.nodes[id].archived).toBe(false);
    expect(touchMentions(r.data, '与地点无关的正文', 10).changed).toBe(false);
  });
});

describe('placeNode（确定性落位）', () => {
  it('首节点居中；同输入恒同输出；不越画布', () => {
    expect(placeNode([], '浣熊市')).toEqual({ x: MAP_CANVAS_W / 2, y: MAP_CANVAS_H / 2 });
    const sibs = [{ x: 500, y: 320 }];
    const p1 = placeNode(sibs, '武器店', 'E');
    const p2 = placeNode(sibs, '武器店', 'E');
    expect(p1).toEqual(p2);
    expect(p1.x).toBeGreaterThanOrEqual(70);
    expect(p1.x).toBeLessThanOrEqual(MAP_CANVAS_W - 70);
    expect(p1.y).toBeGreaterThanOrEqual(64);
    expect(p1.y).toBeLessThanOrEqual(MAP_CANVAS_H - 74);
  });
  it('旧节点永不重排：连续 ingest 不改已有坐标', () => {
    const r1 = ingested('生化危机2 浣熊市 警察局', 1);
    const s1 = byName(r1.data, '警察局')!;
    const r2 = ingestTurn(r1.data, { worldName: WN, location: '生化危机2 浣熊市 武器店', turn: 2 });
    const s2 = byName(r2.data, '警察局')!;
    expect({ x: s2.x, y: s2.y }).toEqual({ x: s1.x, y: s1.y });
  });
  it('20 个同层节点两两不撞（间距 ≥ 60）且无 NaN', () => {
    let d = emptyWorldMap();
    for (let i = 0; i < 20; i++) {
      d = ingestTurn(d, { worldName: WN, location: `生化危机2 浣熊市 场所${i}号`, turn: i + 1 }).data;
    }
    const sites = Object.values(d.nodes).filter((n) => n.kind === 'site');
    expect(sites.length).toBe(20);
    for (const s of sites) { expect(Number.isFinite(s.x)).toBe(true); expect(Number.isFinite(s.y)).toBe(true); }
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      expect(Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y)).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('applyDiscover / applySetNode / applyLink（AI 指令护栏）', () => {
  const base = () => ingested('生化危机2 浣熊市 警察局', 1).data;

  it('新场所挂进解析出的区域；危险夹取；标签/备注收编', () => {
    const { data, result } = applyDiscover(base(), '下水道入口', {
      parent: '浣熊市', danger: 99, note: 'n'.repeat(200), tags: '捷径,危险,a,b,c,d', dir: 'E', status: '传闻',
    }, 2, { allowCreate: true });
    expect(result).toBe('created');
    const n = byName(data, '下水道入口')!;
    expect(n.kind).toBe('site');
    expect(n.parentId).toBe(byName(data, '浣熊市')!.id);
    expect(n.danger).toBe(5);
    expect(n.note.length).toBeLessThanOrEqual(60);
    expect(n.tags.length).toBeLessThanOrEqual(4);
    expect(n.status).toBe('rumored');
  });

  it('中文键 + 兜底区域 + link 连边', () => {
    const { data, result } = applyDiscover(base(), '武器店', { 上级: '', 危险: 2, 连接: '警察局', 状态: '已探' }, 2,
      { fallbackRegionName: '浣熊市', allowCreate: true });
    expect(result).toBe('created');
    const n = byName(data, '武器店')!;
    expect(n.status).toBe('discovered');
    expect(data.edges.some((e) => (e.a === n.id || e.b === n.id))).toBe(true);
  });

  it('区域不可解析 → dropped；配额用尽 → dropped；新大区域可建', () => {
    expect(applyDiscover(base(), '幽灵码头', { parent: '不存在的城' }, 2, { allowCreate: true }).result).toBe('dropped');
    expect(applyDiscover(base(), '幽灵码头', { parent: '浣熊市' }, 2, { allowCreate: false }).result).toBe('dropped');
    const r = applyDiscover(base(), '森林边缘', { kind: 'region', dir: '北' }, 2, { allowCreate: true });
    expect(r.result).toBe('created');
    expect(byName(r.data, '森林边缘')!.kind).toBe('region');
  });

  it('同名/含名再发现 → 合并吸收，不裂节点；AI 写 visited 收编为已探', () => {
    const d1 = applyDiscover(base(), '下水道入口', { parent: '浣熊市' }, 2, { allowCreate: true }).data;
    const r = applyDiscover(d1, '下水道', { danger: 4, status: 'visited' }, 3, { allowCreate: true });
    expect(r.result).toBe('merged');
    const n = byName(r.data, '下水道入口')!;
    expect(n.danger).toBe(4);
    expect(n.status).toBe('discovered');   // 绝不因 AI 声称到场而升到 visited
    expect(Object.values(r.data.nodes).filter((x) => x.kind === 'site').length).toBe(2);
  });

  it('setNode：状态只升不降；未知名返回 ok=false', () => {
    const d1 = applyDiscover(base(), '下水道入口', { parent: '浣熊市' }, 2, { allowCreate: true }).data;
    const r = applySetNode(d1, '下水道入口', { status: '已探', note: '涌出腐臭' }, 3);
    expect(r.ok).toBe(true);
    expect(byName(r.data, '下水道入口')!.status).toBe('discovered');
    const down = applySetNode(r.data, '警察局', { status: '传闻' }, 3);
    expect(byName(down.data, '警察局')!.status).toBe('visited');
    expect(applySetNode(r.data, '不存在', { danger: 1 }, 3).ok).toBe(false);
  });

  it('linkNodes：同区域场所可连；跨区域场所拒绝；隐秘边；重复边幂等', () => {
    let d = applyDiscover(base(), '下水道入口', { parent: '浣熊市' }, 2, { allowCreate: true }).data;
    d = applyDiscover(d, '森林边缘', { kind: 'region' }, 2, { allowCreate: true }).data;
    d = applyDiscover(d, '猎屋', { parent: '森林边缘' }, 2, { allowCreate: true }).data;
    const ok = applyLink(d, '警察局', '下水道入口', { kind: '隐秘' });
    expect(ok.ok).toBe(true);
    expect(ok.data.edges.find((e) => e.kind === 'secret')).toBeTruthy();
    const again = applyLink(ok.data, '下水道入口', '警察局', {});
    expect(again.data.edges.length).toBe(ok.data.edges.length);
    expect(applyLink(ok.data, '警察局', '猎屋', {}).ok).toBe(false);
  });
});

describe('applyVisit + travelQuote', () => {
  it('点图移动：标记已访 + 连通足迹；报价按跳数与危险', () => {
    let d = ingested('生化危机2 浣熊市 警察局', 1).data;
    d = applyDiscover(d, '武器店', { parent: '浣熊市', danger: 1, status: '已探' }, 1, { allowCreate: true }).data;
    d = applyDiscover(d, '下水道入口', { parent: '浣熊市', danger: 4, link: '武器店' }, 1, { allowCreate: true }).data;
    const jcj = byName(d, '警察局')!, wqd = byName(d, '武器店')!, xsd = byName(d, '下水道入口')!;
    d = applyLink(d, '警察局', '武器店', {}).data;
    // 有通路：警察局→武器店→下水道 = 2 跳，危险 4 → 上浮
    const q = travelQuote(d, jcj.id, xsd.id);
    expect(q.hops).toBe(2);
    expect(q.via).toEqual(['武器店']);
    expect(q.risk).toBe(4);
    expect(q.minutes % 5).toBe(0);
    expect(q.minutes).toBeGreaterThan(30);
    // 无通路：同区域按 2 跳估
    const lone = applyDiscover(d, '孤儿院', { parent: '浣熊市' }, 1, { allowCreate: true }).data;
    expect(travelQuote(lone, jcj.id, byName(lone, '孤儿院')!.id).hops).toBe(2);
    // applyVisit
    const v = applyVisit(d, wqd.id, 5);
    expect(v.data.nodes[wqd.id].status).toBe('visited');
    expect(v.data.trail[v.data.trail.length - 1]).toBe(wqd.id);
  });
});

describe('序列化（注入/占位符/digest）', () => {
  it('空图返回空串 / 占位文案', () => {
    expect(serializeWorldPois(emptyWorldMap())).toBe('');
    expect(serializeSceneMap(emptyWorldMap(), 'nope')).toBe('');
    expect(buildMapDigest(emptyWorldMap())).toBe('（暂无已知地点）');
  });
  it('世界层/场景层摘要包含状态与通路', () => {
    let d = ingested('生化危机2 浣熊市 警察局', 1).data;
    d = applyDiscover(d, '下水道入口', { parent: '浣熊市', danger: 4, note: '幸存者口中的近道', link: '警察局' }, 2, { allowCreate: true }).data;
    const region = byName(d, '浣熊市')!;
    const pois = serializeWorldPois(d, region.id);
    expect(pois).toContain('浣熊市');
    expect(pois).toContain('当前');
    const scene = serializeSceneMap(d, region.id);
    expect(scene).toContain('警察局〔已访');
    expect(scene).toContain('下水道入口〔传闻·危险4〕：幸存者口中的近道');
    expect(scene).toContain('通路：');
    const digest = buildMapDigest(d, region.id);
    expect(digest).toContain('■ 浣熊市（已访·当前）');
    expect(digest).toContain('- 警察局');
  });
  it('eventPinsFor 把未结算大事钉到节点', () => {
    const d = ingested('生化危机2 浣熊市 警察局', 1).data;
    const pins = eventPinsFor(d, WN, [
      { location: '生化危机2 浣熊市 警察局', name: '尸潮围城' },
      { location: '生化危机2 浣熊市 警察局', name: '旧事', settledAt: 123 },
      { location: '别的世界 某地', name: '无关' },
    ]);
    const site = byName(d, '警察局')!;
    expect(pins[site.id]).toEqual(['尸潮围城']);
  });
});

describe('地点图元数据', () => {
  it('hasImage/imagePrompt 在触达与 AI 补丁中保留（引擎操作绝不弄丢图）', () => {
    let d = ingested('生化危机2 浣熊市 警察局', 1).data;
    const id = byName(d, '警察局')!.id;
    d = { ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id], hasImage: true, imagePrompt: 'police station, night' } } };
    const r1 = ingestTurn(d, { worldName: WN, location: '生化危机2 浣熊市 警察局二楼', turn: 5 });
    expect(r1.data.nodes[id].hasImage).toBe(true);
    const r2 = applySetNode(r1.data, '警察局', { danger: 3, note: '有异响' }, 6);
    expect(r2.data.nodes[id].hasImage).toBe(true);
    expect(r2.data.nodes[id].imagePrompt).toBe('police station, night');
    expect(r2.data.nodes[id].danger).toBe(3);
  });
});

describe('杂项', () => {
  it('mapWorldKey：空世界名归轮回乐园', () => {
    expect(mapWorldKey('')).toBe('轮回乐园');
    expect(mapWorldKey(' 甲铁城 ')).toBe('甲铁城');
  });
  it('resolveNodeIn：本名 > 别名 > 包含', () => {
    const d = ingested('生化危机2 浣熊市 警察局', 1).data;
    const nodes = Object.values(d.nodes);
    expect(resolveNodeIn(nodes, '警察局')!.name).toBe('警察局');
    expect(resolveNodeIn(nodes, 'RPD警察局')!.name).toBe('警察局');
    expect(resolveNodeIn(nodes, '完全无关')).toBeNull();
  });
});
