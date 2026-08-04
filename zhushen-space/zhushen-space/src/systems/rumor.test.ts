import { describe, it, expect } from 'vitest';
import {
  IMPACT_LEVELS, normImpact, impactIndex, latestNode, nextSeq, isDue, needsCompress,
  compressRumor, rankValue, pruneRumors, shouldPromote, worldRumors, injectable,
  buildRumorInjection, serializeRumorsForEvo, seedRumorsFromWorldCard,
  FALLBACK_DUE_TURNS, type Rumor, type RumorNode,
} from './rumor';

function node(p: Partial<RumorNode> = {}): RumorNode {
  return { seq: 1, date: '3年5月10日', expire: '3年5月12日', turn: 0, truth: '真', told: '传', drift: '差', cause: '因', ...p };
}
function rumor(p: Partial<Rumor> = {}): Rumor {
  return { id: 'R_1', name: '米商囤粮', impact: '圈内谈资', scope: '城南', nodes: [node()], createdAt: 0, ...p };
}
const same = (a?: string, b?: string) => (a ?? '') === (b ?? '');

describe('rumor · 基础原语', () => {
  it('normImpact 容忍后缀，认不出回落最低档', () => {
    expect(normImpact('全民热议')).toBe('全民热议');
    expect(normImpact('影响力：局部焦点（扩散中）')).toBe('局部焦点');
    expect(normImpact('人尽皆知')).toBe('零星耳闻');
    expect(normImpact(undefined)).toBe('零星耳闻');
  });

  it('impactIndex 与五档顺序一致', () => {
    expect(IMPACT_LEVELS).toHaveLength(5);
    expect(impactIndex('零星耳闻')).toBe(0);
    expect(impactIndex('文化烙印')).toBe(4);
    expect(impactIndex('不存在的档')).toBe(0);
  });

  it('latestNode / nextSeq 取最新与下一编号', () => {
    const r = rumor({ nodes: [node({ seq: 1 }), node({ seq: 2, told: '新版本' })] });
    expect(latestNode(r)?.told).toBe('新版本');
    expect(nextSeq(r)).toBe(3);
    expect(latestNode(rumor({ nodes: [] }))).toBeNull();
    expect(nextSeq(rumor({ nodes: [] }))).toBe(1);
  });
});

describe('rumor · 时效闸门（省 token 的关键）', () => {
  it('未到时效 → 不到期（这一轮一条指令都不该发）', () => {
    const r = rumor({ nodes: [node({ expire: '3年5月20日' })] });
    expect(isDue(r, '3年5月12日', 5)).toBe(false);
  });

  it('到点/过点 → 到期', () => {
    const r = rumor({ nodes: [node({ expire: '3年5月12日' })] });
    expect(isDue(r, '3年5月12日', 5)).toBe(true);
    expect(isDue(r, '3年5月18日', 5)).toBe(true);
  });

  it('时间串解析不出 → 回落回合兜底，绝不永冻', () => {
    const r = rumor({ nodes: [node({ expire: '朔月之后', turn: 10 })] });
    expect(isDue(r, '天启历·蛇年', 10 + FALLBACK_DUE_TURNS - 1)).toBe(false);
    expect(isDue(r, '天启历·蛇年', 10 + FALLBACK_DUE_TURNS)).toBe(true);
  });

  it('空节点的传闻直接算到期（交给演化去补）', () => {
    expect(isDue(rumor({ nodes: [] }), '3年5月10日', 0)).toBe(true);
  });
});

describe('rumor · 压缩', () => {
  it('节点数达阈值才压缩', () => {
    expect(needsCompress(rumor({ nodes: [node(), node({ seq: 2 })] }))).toBe(false);
    expect(needsCompress(rumor({ nodes: [node(), node({ seq: 2 }), node({ seq: 3 })] }))).toBe(true);
  });

  it('压缩保留最早日期 + 最新认知 + 全程诱因串（不丢"怎么变成这样"）', () => {
    const r = rumor({ nodes: [
      node({ seq: 1, date: '3年5月1日', cause: '有人目击' }),
      node({ seq: 2, date: '3年5月6日', cause: '茶馆说书添油加醋' }),
      node({ seq: 3, date: '3年5月11日', told: '最新版本', truth: '最新真相', drift: '最新偏差', cause: '官府贴了告示' }),
    ] });
    const c = compressRumor(r);
    expect(c.nodes).toHaveLength(1);
    expect(c.nodes[0].date).toBe('3年5月1日');       // 最早
    expect(c.nodes[0].told).toBe('最新版本');         // 最新认知
    expect(c.nodes[0].truth).toBe('最新真相');
    expect(c.nodes[0].cause).toContain('有人目击');
    expect(c.nodes[0].cause).toContain('官府贴了告示');
    expect(c.nodes[0].cause).toContain('历经3次流变');
  });

  it('单节点压缩是恒等的', () => {
    const r = rumor();
    expect(compressRumor(r)).toBe(r);
  });
});

describe('rumor · 裁剪与升格', () => {
  it('rankValue 以影响力为主、活跃度为次', () => {
    expect(rankValue(rumor({ impact: '全民热议' }))).toBeGreaterThan(rankValue(rumor({ impact: '圈内谈资' })));
    const a = rumor({ impact: '圈内谈资', nodes: [node(), node({ seq: 2 })] });
    const b = rumor({ impact: '圈内谈资' });
    expect(rankValue(a)).toBeGreaterThan(rankValue(b));
  });

  it('超出上限按价值裁剪，低价值先走', () => {
    const list = [
      rumor({ id: 'R_1', impact: '零星耳闻' }),
      rumor({ id: 'R_2', impact: '全民热议' }),
      rumor({ id: 'R_3', impact: '局部焦点' }),
    ];
    const { kept, dropped } = pruneRumors(list, 2);
    expect(kept.map((r) => r.id)).toEqual(['R_2', 'R_3']);
    expect(dropped.map((r) => r.id)).toEqual(['R_1']);
  });

  it('未超上限时原样返回', () => {
    const list = [rumor()];
    expect(pruneRumors(list, 5).kept).toBe(list);
    expect(pruneRumors(list, 5).dropped).toEqual([]);
  });

  it('文化烙印才升格', () => {
    expect(shouldPromote(rumor({ impact: '文化烙印' }))).toBe(true);
    expect(shouldPromote(rumor({ impact: '全民热议' }))).toBe(false);
  });
});

describe('rumor · 世界作用域与注入', () => {
  it('worldRumors 只留本世界的；worldName 为空放行（老数据）', () => {
    const list = [
      rumor({ id: 'R_1', worldName: '丧尸围城' }),
      rumor({ id: 'R_2', worldName: '永夜监狱' }),
      rumor({ id: 'R_3', worldName: undefined }),
    ];
    expect(worldRumors(list, '丧尸围城', same).map((r) => r.id)).toEqual(['R_1', 'R_3']);
  });

  it('注入门槛：够不上局部焦点的不出', () => {
    const list = [rumor({ id: 'R_1', impact: '圈内谈资' }), rumor({ id: 'R_2', impact: '局部焦点' })];
    expect(injectable(list).map((r) => r.id)).toEqual(['R_2']);
  });

  it('⚠ 注入块只给流传版本，绝不泄露真相与偏差', () => {
    const r = rumor({ impact: '全民热议', nodes: [node({ told: '说是米商囤了三千石', truth: '实为官仓调粮', drift: '张冠李戴' })] });
    const s = buildRumorInjection([r]);
    expect(s).toContain('说是米商囤了三千石');
    expect(s).not.toContain('实为官仓调粮');
    expect(s).not.toContain('张冠李戴');
    expect(s).toContain('不保证属实');
  });

  it('无够格传闻 → 不出块', () => {
    expect(buildRumorInjection([])).toBe('');
    expect(buildRumorInjection([rumor({ impact: '零星耳闻' })])).toBe('');
  });

  it('演化序列化含真相/偏差 + 到期与压缩标记', () => {
    const due = rumor({ id: 'R_1', nodes: [node({ expire: '3年5月1日' })] });
    const notDue = rumor({ id: 'R_2', nodes: [node({ expire: '3年9月1日' })] });
    const s = serializeRumorsForEvo([due, notDue], '3年5月12日', 3);
    expect(s).toContain('R_1');
    expect(s).toContain('⏰到期待结算');
    expect(s).toContain('未到时效');
    expect(s).toContain('真相:真');
    expect(serializeRumorsForEvo([], '', 0)).toContain('无活跃传闻');
  });
});

describe('rumor · 世界卡播种（零 API）', () => {
  it('从前人遗产 + 剧情偏移各切一条，起步压在圈内谈资', () => {
    const seeds = seedRumorsFromWorldCard({
      priorLegacy: '三年前有个戴铁面的外乡人一夜之间清了南堂赌坊。此后无人再敢开赌局。',
      plotDrift: '原本该在去年覆灭的血蔷薇教团至今仍盘踞在北岭，势力比原著更盛。',
      worldTime: '3年5月10日', turn: 7,
    });
    expect(seeds).toHaveLength(2);
    for (const s of seeds) {
      expect(s.impact).toBe('圈内谈资');
      expect(s.node.told.length).toBeGreaterThanOrEqual(12);
      expect(s.node.truth).toBeTruthy();
      expect(s.node.drift).toBeTruthy();
      expect(s.node.turn).toBe(7);
      expect(s.node.date).toBe('3年5月10日');
    }
    expect(seeds[0].node.truth).toContain('前任契约者');
  });

  it('太短的句子不成传闻；两段都空 → 不播种', () => {
    expect(seedRumorsFromWorldCard({ priorLegacy: '无。', plotDrift: '' })).toEqual([]);
    expect(seedRumorsFromWorldCard({})).toEqual([]);
  });
});
