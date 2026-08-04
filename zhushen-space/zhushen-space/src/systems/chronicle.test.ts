import { describe, it, expect } from 'vitest';
import {
  classifyText, extractEntities, turnFromDeedTime, volumeIdForRow, buildVolumes,
  digestVolume, overallDigest, buildCompileInput, sanitizeCompiled, compiledToEvents, buildPriorSaga,
  ORPHAN_VOLUME, type ChronicleSources,
} from './chronicle';
import type { WorldRecord } from '../store/worldRecordStore';

function mkRecord(p: Partial<WorldRecord> & { id: string; name: string }): WorldRecord {
  return {
    tier: '三阶', instanceId: 1, status: 'left', createdAt: 0, updatedAt: 0,
    ...p,
  } as WorldRecord;
}
const W1 = mkRecord({ id: 'w1', name: '生化危机', enteredAt: { turn: 10, worldTime: '第1日' }, leftAt: { turn: 40, worldTime: '第9日' } });
const W2 = mkRecord({ id: 'w2', name: '死神', status: 'active', enteredAt: { turn: 41, worldTime: '春' } });

describe('重要性分级', () => {
  it('生死/突破/通关类判金', () => {
    expect(classifyText('赤炎会首领战死于废墟')).toBe('gold');
    expect(classifyText('主角突破至四阶')).toBe('gold');
    expect(classifyText('获得传说级长剑')).toBe('gold');
  });
  it('战斗/结识/交易类判银', () => {
    expect(classifyText('与流浪商人交易了三枚晶石')).toBe('silver');
    expect(classifyText('初遇一名红发少女')).toBe('silver');
  });
  it('无关键词判灰，空文本判灰', () => {
    expect(classifyText('在旅店休息了一夜')).toBe('gray');
    expect(classifyText('')).toBe('gray');
    expect(classifyText('   ')).toBe('gray');
  });
  it('金优先于银（同时命中时不降级）', () => {
    expect(classifyText('交易途中被伏击，同伴战死')).toBe('gold');
  });
});

describe('实体互链', () => {
  const known = {
    npcs: [{ id: 'C1', name: '琴酒' }, { id: 'C2', name: '苏晓' }],
    factions: [{ id: 'F1', name: '黑衣组织' }],
    playerName: '林夜',
  };
  it('扫出文本里的人名/势力名/主角名', () => {
    const r = extractEntities('林夜与苏晓联手，重创了黑衣组织', known);
    expect(r.map((x) => x.name).sort()).toEqual(['林夜', '苏晓', '黑衣组织']);
    expect(r.find((x) => x.name === '苏晓')).toMatchObject({ type: 'npc', id: 'C2' });
  });
  it('单字名不参与匹配（否则满篇误命中）', () => {
    expect(extractEntities('王者归来', { npcs: [{ id: 'C9', name: '王' }] })).toEqual([]);
  });
  it('同名只出一次，且有数量上限', () => {
    const r = extractEntities('苏晓苏晓苏晓', known);
    expect(r).toHaveLength(1);
  });
  it('空文本/无名册安全返回空', () => {
    expect(extractEntities('', known)).toEqual([]);
    expect(extractEntities('随便什么', {})).toEqual([]);
  });
});

describe('回合号解析', () => {
  it('认得 autonomy 写的「第N回合」及常见变体', () => {
    expect(turnFromDeedTime('第47回合')).toBe(47);
    expect(turnFromDeedTime('T12')).toBe(12);
    expect(turnFromDeedTime('回合 8')).toBe(8);
  });
  it('认不出返回 undefined（不猜）', () => {
    expect(turnFromDeedTime('第三日·黄昏')).toBeUndefined();
    expect(turnFromDeedTime(undefined)).toBeUndefined();
  });
});

describe('分卷', () => {
  const recs = [W1, W2];
  it('按 turn 落进世界的进出区间', () => {
    expect(volumeIdForRow({ turn: 20 }, recs)).toBe('w1');
    expect(volumeIdForRow({ turn: 50 }, recs)).toBe('w2');   // active 卷没有 leaveTurn → 开区间
  });
  it('区间边界闭合（进入/离开当回合都算本卷）', () => {
    expect(volumeIdForRow({ turn: 10 }, recs)).toBe('w1');
    expect(volumeIdForRow({ turn: 40 }, recs)).toBe('w1');
  });
  it('没有 turn 时退回按世界名匹配', () => {
    expect(volumeIdForRow({ world: '死神' }, recs)).toBe('w2');
  });
  it('老存档（无 meta）且世界记录不止一卷 → 散佚，绝不猜错卷', () => {
    expect(volumeIdForRow(undefined, recs, '死神')).toBe(ORPHAN_VOLUME);
  });
  it('只有一卷 active 时，无 meta 的老行归给它而不是丢进散佚', () => {
    expect(volumeIdForRow(undefined, [W2], '死神')).toBe('w2');
  });
  it('turn 落在所有区间之外 → 散佚', () => {
    expect(volumeIdForRow({ turn: 5 }, recs)).toBe(ORPHAN_VOLUME);
  });
});

describe('投影成卷', () => {
  const src: ChronicleSources = {
    records: [W1, W2],
    rows: [
      { row_id: '1', 时间: '第1日', 地点: '警局', 事件: '抵达浣熊市，与丧尸群遭遇' },
      { row_id: '2', 时间: '第2日', 地点: '街区', 事件: '在旅店休息了一夜' },
      { row_id: '3', 时间: '春', 地点: '尸魂界', 事件: '初遇朽木露琪亚' },
    ],
    rowMeta: { '1': { turn: 12, world: '生化危机' }, '2': { turn: 15 }, '3': { turn: 45 } },
    known: { npcs: [{ id: 'C1', name: '朽木露琪亚' }] },
    compiledIds: [],
  };

  it('纪要行按 rowMeta 落进正确的卷', () => {
    const vols = buildVolumes(src);
    const w1 = vols.find((v) => v.id === 'w1')!;
    const w2 = vols.find((v) => v.id === 'w2')!;
    expect(w1.events.filter((e) => e.kind === 'chronicleRow')).toHaveLength(2);
    expect(w2.events.filter((e) => e.kind === 'chronicleRow')).toHaveLength(1);
  });

  it('卷首尾自动生成，且都是金料', () => {
    const w1 = buildVolumes(src).find((v) => v.id === 'w1')!;
    const enter = w1.events.find((e) => e.kind === 'worldEnter')!;
    const leave = w1.events.find((e) => e.kind === 'worldLeave')!;
    expect(enter.tier).toBe('gold');
    expect(enter.title).toContain('生化危机');
    expect(leave).toBeTruthy();
  });

  it('进行中的卷没有「离开」事件', () => {
    const w2 = buildVolumes(src).find((v) => v.id === 'w2')!;
    expect(w2.events.find((e) => e.kind === 'worldLeave')).toBeUndefined();
    expect(w2.status).toBe('active');
  });

  it('卷间新卷在前、散佚垫底（turn=5 早于第一卷进入，落在所有区间之外）', () => {
    const withOrphan: ChronicleSources = {
      ...src,
      rows: [...(src.rows ?? []), { row_id: '9', 事件: '来历不明的一段' }],
      rowMeta: { ...src.rowMeta, '9': { turn: 5 } },
    };
    const vols = buildVolumes(withOrphan);
    expect(vols[0].id).toBe('w2');            // enterTurn 41 > 10
    expect(vols[vols.length - 1].id).toBe(ORPHAN_VOLUME);
  });

  it('进行中的卷是开区间：晚于它进入回合的行都归它（不会漏进散佚）', () => {
    const vols = buildVolumes({
      ...src,
      rows: [{ row_id: '9', 事件: '很久以后的一段' }],
      rowMeta: { '9': { turn: 999 } },
    });
    expect(vols.find((v) => v.id === ORPHAN_VOLUME)).toBeUndefined();
    expect(vols.find((v) => v.id === 'w2')!.events.some((e) => e.title.includes('很久以后'))).toBe(true);
  });

  it('离世总结的关键事件/人物结局进卷，关键事件判金', () => {
    const rec = mkRecord({
      id: 'w3', name: '海贼王', enteredAt: { turn: 1 }, leftAt: { turn: 9 },
      summary: {
        综合评价: 'A',
        关键事件: [{ 事件: '击沉海军支部', 结果: '悬赏翻倍', 影响: '成为通缉犯' }],
        人物结局: [{ 名称: '路飞', 结局: '扬帆离去', 关系: '挚友' }],
      },
    });
    const v = buildVolumes({ records: [rec] }).find((x) => x.id === 'w3')!;
    const key = v.events.find((e) => e.kind === 'keyEvent')!;
    expect(key.tier).toBe('gold');
    expect(key.detail).toContain('悬赏翻倍');
    expect(v.events.find((e) => e.kind === 'outcome')?.title).toContain('路飞');
    expect(v.rating).toBe('A');
  });

  it('deedLog 进卷并按「第N回合」归卷，附主人实体链', () => {
    const v = buildVolumes({
      records: [W1],
      deeds: [{ owner: '琴酒', ownerId: 'C1', log: [{ time: '第20回合', location: '酒吧', description: '与人火并，重伤而归' }] }],
    }).find((x) => x.id === 'w1')!;
    const d = v.events.find((e) => e.kind === 'deed')!;
    expect(d.turn).toBe(20);
    expect(d.title).toContain('琴酒');
    expect(d.entities?.some((en) => en.id === 'C1')).toBe(true);
  });

  it('归档任务按世界名归卷', () => {
    const v = buildVolumes({
      records: [W1],
      archivedTasks: [{ id: 't1', name: '找回疫苗', worldName: '生化危机', settledAt: 1 }],
    }).find((x) => x.id === 'w1')!;
    expect(v.events.find((e) => e.kind === 'questSettle')?.title).toContain('找回疫苗');
  });

  it('空事件行被跳过，不产生空条目', () => {
    const v = buildVolumes({ records: [W1], rows: [{ row_id: '1', 事件: '   ' }], rowMeta: { '1': { turn: 12 } } })
      .find((x) => x.id === 'w1')!;
    expect(v.events.filter((e) => e.kind === 'chronicleRow')).toHaveLength(0);
  });

  it('全空数据源不报错', () => {
    expect(buildVolumes({})).toEqual([]);
  });
});

describe('切入点·摘要', () => {
  it('卷摘要给出评价/停留/史事数', () => {
    const v = buildVolumes({ records: [W1], rows: [{ row_id: '1', 事件: '大战一场' }], rowMeta: { '1': { turn: 20 } } })
      .find((x) => x.id === 'w1')!;
    const d = digestVolume(v);
    expect(d.find((x) => x.label === '停留')?.value).toBe('30 回合');
    expect(d.find((x) => x.label === '史事')).toBeTruthy();
  });

  it('同行最多：统计卷内出现次数最多的 NPC（出现 2 次以上才算）', () => {
    const known = { npcs: [{ id: 'C1', name: '苏晓' }] };
    const v = buildVolumes({
      records: [W1], known,
      rows: [
        { row_id: '1', 事件: '与苏晓并肩作战' },
        { row_id: '2', 事件: '苏晓提出分道扬镳' },
      ],
      rowMeta: { '1': { turn: 12 }, '2': { turn: 13 } },
    }).find((x) => x.id === 'w1')!;
    expect(digestVolume(v).find((x) => x.label === '同行最多')?.value).toContain('苏晓');
  });

  it('全史概览统计卷数与里程碑数', () => {
    const o = overallDigest(buildVolumes({ records: [W1, W2] }));
    expect(o.find((x) => x.label === '历世')?.value).toContain('2 卷');
    expect(o.find((x) => x.label === '里程碑')).toBeTruthy();
  });
});

describe('修史（编纂）', () => {
  it('编纂输入只送流水（纪要/事迹），不送已提炼的金料', () => {
    const rec = mkRecord({
      id: 'w4', name: '测试世界', enteredAt: { turn: 1 }, leftAt: { turn: 5 },
      summary: { 关键事件: [{ 事件: '这是已提炼的关键事件' }] },
    });
    const v = buildVolumes({ records: [rec], rows: [{ row_id: '1', 时间: '第1日', 事件: '这是流水' }], rowMeta: { '1': { turn: 2 } } })
      .find((x) => x.id === 'w4')!;
    const { text, count } = buildCompileInput(v);
    expect(text).toContain('这是流水');
    expect(text).not.toContain('这是已提炼的关键事件');
    expect(count).toBe(1);
  });

  it('实录过长时截取最近的部分（近事更值得细写）', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ row_id: String(i + 1), 事件: `第${i}件事` }));
    const rowMeta = Object.fromEntries(rows.map((r) => [r.row_id!, { turn: 12 }]));
    const v = buildVolumes({ records: [W1], rows, rowMeta }).find((x) => x.id === 'w1')!;
    const { count, text } = buildCompileInput(v, 160);
    expect(count).toBe(160);
    expect(text).toContain('第299件事');
    expect(text).not.toContain('第0件事');
  });

  it('AI 产出被夹取：条数上限、字段长度、tier 合法性', () => {
    const raw = {
      entries: Array.from({ length: 90 }, () => ({
        title: 'x'.repeat(200), detail: 'y'.repeat(900), tier: 'platinum', timeText: 'z'.repeat(90), 地点: '某处',
      })),
    };
    const out = sanitizeCompiled(raw, 40);
    expect(out).toHaveLength(40);
    expect(out[0].title.length).toBeLessThanOrEqual(80);
    expect(out[0].detail!.length).toBeLessThanOrEqual(300);
    expect(out[0].timeText!.length).toBeLessThanOrEqual(40);
    expect(['gold', 'silver', 'gray']).toContain(out[0].tier);
  });

  it('吃中文键（时间/地点/事件/详述）与英文键两种形态', () => {
    const out = sanitizeCompiled({ entries: [{ 时间: '第3日', 地点: '钟楼', 事件: '斩杀首领', 详述: '一刀两断' }] });
    expect(out[0]).toMatchObject({ timeText: '第3日', location: '钟楼', title: '斩杀首领', detail: '一刀两断' });
    expect(out[0].tier).toBe('gold');   // 未给 tier → 按文本自动判定
  });

  it('无标题的脏条目被丢弃；非数组输入安全返回空', () => {
    expect(sanitizeCompiled({ entries: [{ detail: '只有详述' }] })).toEqual([]);
    expect(sanitizeCompiled(null)).toEqual([]);
    expect(sanitizeCompiled({ foo: 1 })).toEqual([]);
  });

  it('裸数组也吃（AI 少包一层的常见情况）', () => {
    expect(sanitizeCompiled([{ title: '直接给数组' }])).toHaveLength(1);
  });

  it('正史条目转成展示事件后与实录同构（UI 一套渲染两态）', () => {
    const evs = compiledToEvents(sanitizeCompiled([{ title: '斩将夺旗', tier: 'gold' }]), 'w1', '生化危机');
    expect(evs[0]).toMatchObject({ kind: 'compiled', tier: 'gold', title: '斩将夺旗', world: '生化危机' });
    expect(evs[0].id).toContain('w1');
  });
});

/* 前尘提要（P2 读回）：编纂正史 → 进入新世界的跨世界前情记忆；无编纂退回离世总结；都无则 ''。 */
describe('buildPriorSaga（前尘提要）', () => {
  it('★有编纂：卷首题记 + 金档优先的条目标题', () => {
    const vol = {
      preface: '此界一役，血未冷。',
      entries: [
        { title: '救下药铺孤女', tier: 'silver' as const },
        { title: '斩杀魔将·屠苏', tier: 'gold' as const },
        { title: '路过茶摊', tier: 'gray' as const },
      ],
    };
    const out = buildPriorSaga('生化危机', vol);
    expect(out).toContain('【生化危机】');
    expect(out).toContain('此界一役');
    expect(out.indexOf('斩杀魔将·屠苏')).toBeLessThan(out.indexOf('救下药铺孤女'));   // 金档排前
  });

  it('无编纂 → 退回离世总结（状态/评价/经历概述/偏转）', () => {
    const out = buildPriorSaga('海贼王', undefined, { 状态: '已通关', 综合评价: 'A', 经历概述: ['夺回梅丽号', '结识草帽团'], 世界线偏转: '海军提前现身' });
    expect(out).toContain('已通关');
    expect(out).toContain('评价 A');
    expect(out).toContain('夺回梅丽号');
  });

  it('两者都无 → 空串（过场不注块）；限长生效', () => {
    expect(buildPriorSaga('空界')).toBe('');
    const long = buildPriorSaga('X', { entries: [{ title: 'T'.repeat(500), tier: 'gold' as const }] }, null, 100);
    expect(long.length).toBeLessThanOrEqual(100);
  });
});
