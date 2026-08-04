import { describe, it, expect, beforeEach } from 'vitest';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import type { MiscTask } from '../store/miscStore';
import { pickThreads, pickQuests, weatherGlyph } from './storyStrip';
import { DUN_AGE } from './plotThreads';

/* 伏笔表行结构：[row_id, 伏笔, 埋下时间, 涉及对象, 状态, 预期回收, 说明]（content[0] 为表头行） */
const HEADER = ['', '伏笔', '埋下时间', '涉及对象', '状态', '预期回收', '说明'];
const row = (id: string, title: string, state: string, expect = ''): string[] => [id, title, '第1章', '某人', state, expect, ''];

/* pickThreads 的「列表」来自入参 content，「账龄」来自 plotThreads 读的两个 store —— 两边喂同一批行才真实 */
function seed(rows: string[][], journal: { rowId: string; turn: number }[]) {
  useTables.setState((s) => ({
    tables: {
      ...s.tables,
      foreshadowing: { ...(s.tables as Record<string, unknown>).foreshadowing as object, uid: 'foreshadowing', name: '伏笔表', content: [HEADER, ...rows] },
    },
  }) as never);
  useTableJournal.setState({
    entries: journal.map((e, i) => ({
      id: i + 1, turn: e.turn, uid: 'foreshadowing', sheetName: '伏笔表',
      command: 'updateRow' as const, rowId: e.rowId, pos: 0, before: null, after: null,
    })),
  });
  return [HEADER, ...rows];
}

const task = (p: Partial<MiscTask> & { id: string; name: string }): MiscTask => ({
  desc: '', reward: '', penalty: '', status: '进行中', startTime: '', endTime: '', addedAt: 0, ...p,
});

beforeEach(() => { seed([], []); });

describe('pickThreads（楼层信息条·伏笔段）', () => {
  it('剔除已回收/已废弃，只留未收的线头', () => {
    const content = seed([
      row('1', '黑袍人不摘兜帽', '埋下'),
      row('2', '断剑的来历', '已回收'),
      row('3', '城主的账本', '已废弃'),
      row('4', '井底的哭声', '发展中'),
    ], [{ rowId: '1', turn: 10 }, { rowId: '4', turn: 10 }]);
    const out = pickThreads(content, 10);
    expect(out.map((t) => t.rowId)).toEqual(['1', '4']);
  });

  it('账龄达到催收线的标 stale 并排到最前，未催收的保持表内顺序', () => {
    const turn = 100;
    const content = seed([
      row('1', '新鲜线头', '埋下'),
      row('2', '陈旧线头', '埋下'),
      row('3', '另一条新鲜的', '发展中'),
    ], [
      { rowId: '1', turn: turn - 1 },                 // 账龄 1 → 不催
      { rowId: '2', turn: turn - DUN_AGE - 5 },       // 账龄 20 → 催收
      { rowId: '3', turn: turn - 2 },                 // 账龄 2 → 不催
    ]);
    const out = pickThreads(content, turn);
    expect(out[0].rowId).toBe('2');
    expect(out[0].stale).toBe(true);
    expect(out[0].age).toBe(DUN_AGE + 5);
    expect(out.slice(1).map((t) => t.rowId)).toEqual(['1', '3']);   // 稳定排序：未催收的保持原顺序
    expect(out.slice(1).every((t) => !t.stale)).toBe(true);
  });

  it('日志里查无记录 = 久远，排在有账龄的催收项之前', () => {
    const turn = 100;
    const content = seed([
      row('1', '有账龄的陈旧线头', '埋下'),
      row('2', '久远到日志都没了的线头', '埋下'),
    ], [{ rowId: '1', turn: turn - DUN_AGE - 1 }]);
    const out = pickThreads(content, turn);
    expect(out[0].rowId).toBe('2');
    expect(out[0].age).toBeNull();
    expect(out[0].stale).toBe(true);
  });

  it('缺 row_id 或标题的脏行跳过；cap 截断', () => {
    const content = seed([
      row('1', '甲', '埋下'), row('2', '乙', '埋下'), row('3', '丙', '埋下'),
      ['', '没有 id', '', '', '埋下', '', ''],
      ['9', '', '', '', '埋下', '', ''],
    ], []);
    expect(pickThreads(content, 1).map((t) => t.title)).toEqual(['甲', '乙', '丙']);
    expect(pickThreads(content, 1, 2)).toHaveLength(2);
  });

  it('无表 / 只有表头 → 空数组，不抛', () => {
    expect(pickThreads(undefined, 5)).toEqual([]);
    expect(pickThreads([HEADER], 5)).toEqual([]);
  });
});

describe('pickQuests（楼层信息条·任务段）', () => {
  it('主线置顶，其余保持既有顺序', () => {
    const out = pickQuests([
      task({ id: 'T_1', name: '支线甲' }),
      task({ id: 'T_2', name: '主线', kind: '主线' }),
      task({ id: 'T_3', name: '支线乙' }),
    ]);
    expect(out.map((q) => q.id)).toEqual(['T_2', 'T_1', 'T_3']);
    expect(out[0].main).toBe(true);
    expect(out[1].main).toBe(false);
  });

  it('当前环优先按 currentRing 对齐 idx，没有 currentRing 才退回第一个 active', () => {
    const rings = [
      { idx: 1, goal: '第一环', status: 'done' as const },
      { idx: 2, goal: '第二环', status: 'active' as const },
      { idx: 3, goal: '第三环', status: 'planned' as const },
    ];
    const [byCursor] = pickQuests([task({ id: 'T_1', name: '多环', rings, currentRing: 3 })]);
    expect(byCursor.ringGoal).toBe('第三环');
    expect(byCursor.ringIdx).toBe(3);
    expect(byCursor.ringTotal).toBe(3);

    const [byStatus] = pickQuests([task({ id: 'T_2', name: '多环', rings })]);
    expect(byStatus.ringGoal).toBe('第二环');
    expect(byStatus.ringIdx).toBe(2);
  });

  it('单环扁平任务（无 rings）不报环号', () => {
    const [q] = pickQuests([task({ id: 'T_1', name: '扁平任务', progress: '已找到线索' })]);
    expect(q.ringGoal).toBe('');
    expect(q.ringIdx).toBe(0);
    expect(q.ringTotal).toBe(0);
    expect(q.progress).toBe('已找到线索');
  });

  it('锁定/职业标记透传；缺 id 或名字的脏数据剔除；cap 截断；空入参不抛', () => {
    const out = pickQuests([
      task({ id: 'T_1', name: '锁住的', locked: true, prof: true }),
      task({ id: '', name: '没有 id' }),
      task({ id: 'T_3', name: '   ' }),
      task({ id: 'T_4', name: '正常的' }),
    ]);
    expect(out.map((q) => q.id)).toEqual(['T_1', 'T_4']);
    expect(out[0].locked).toBe(true);
    expect(out[0].prof).toBe(true);
    expect(pickQuests([task({ id: 'T_1', name: '甲' }), task({ id: 'T_2', name: '乙' })], 1)).toHaveLength(1);
    expect(pickQuests(undefined)).toEqual([]);
  });
});

describe('weatherGlyph', () => {
  it('常见天气各归各的图标（先匹配更具体的）', () => {
    expect(weatherGlyph('晴')).toBe('☀');
    expect(weatherGlyph('多云')).toBe('⛅');
    expect(weatherGlyph('阴')).toBe('☁');
    expect(weatherGlyph('小雨')).toBe('🌦');
    expect(weatherGlyph('雷阵雨')).toBe('⛈');    // 「雷」比「雨」先命中
    expect(weatherGlyph('大雪')).toBe('❄');       // 「暴雪|大雪」比「雪」先命中
    expect(weatherGlyph('浓雾')).toBe('🌫');
  });

  it('空 → 空串；认不出的奇异天气 → 占位图标（不留空格子）', () => {
    expect(weatherGlyph('')).toBe('');
    expect(weatherGlyph(undefined)).toBe('');
    expect(weatherGlyph('灰烬垂落')).toBe('🌡');
  });
});
