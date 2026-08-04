import { describe, it, expect, beforeEach } from 'vitest';
import { useMisc, type MiscTask } from '../store/miscStore';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useRowScope } from '../store/rowScopeStore';
import { collectStaleThreads, threadInCurrentWorld, FORESHADOW_UID, DUN_AGE } from './plotThreads';
import { pickThreads } from './storyStrip';

/* 🌍 世界作用域（worldScope 铁则）：轮回乐园是「一个世界一个世界进去做任务」——
   上个任务世界的未结算任务、未回收伏笔都不该跟进新世界。
   任务走**物理封存**（挪出 tasks ⇒ 所有读取点自动生效）；伏笔走**旁路索引 + 读时过滤**（表是 AI 可见的，不动结构）。 */

const HEADER = ['', '伏笔', '埋下时间', '涉及对象', '状态', '预期回收', '说明'];
const row = (id: string, title: string, state = '埋下'): string[] => [id, title, '', '', state, '', ''];

function seedThreads(rows: string[][]) {
  useTables.setState((s) => ({
    tables: {
      ...s.tables,
      foreshadowing: { ...(s.tables as Record<string, unknown>).foreshadowing as object, uid: FORESHADOW_UID, name: '伏笔表', content: [HEADER, ...rows] },
    },
  }) as never);
}

const task = (p: Partial<MiscTask> & { id: string; name: string }): MiscTask => ({
  desc: '', reward: '', penalty: '', status: '进行中', startTime: '', endTime: '', addedAt: 0, ...p,
});

beforeEach(() => {
  useMisc.setState({ tasks: [], archivedTasks: [], frozenTasks: [], worldName: '', lastWorldSettleAt: 0, worldTier: '' } as never);
  useRowScope.setState({ scopes: {} } as never);
  useTableJournal.setState({ entries: [] } as never);
  seedThreads([]);
});

describe('任务·离世封存 / 同名再入解封', () => {
  it('建档时自动记下所在世界；在乐园接的不记（＝跨世界，永不封存）', () => {
    useMisc.setState({ worldName: '斗罗大陆' } as never);
    useMisc.getState().upsertTask(task({ id: 'T_1', name: '入学试炼' }));
    expect(useMisc.getState().tasks[0].worldName).toBe('斗罗大陆');

    useMisc.setState({ worldName: '轮回乐园' } as never);
    useMisc.getState().upsertTask(task({ id: 'T_2', name: '乐园的委托' }));
    expect(useMisc.getState().tasks.find((t) => t.id === 'T_2')?.worldName).toBeUndefined();
  });

  it('★离开世界：本世界未结算任务挪进 frozenTasks，别的世界与乐园的任务原地不动', () => {
    useMisc.setState({
      tasks: [
        task({ id: 'T_1', name: '斗罗的', worldName: '斗罗大陆' }),
        task({ id: 'T_2', name: '海贼的', worldName: '海贼王' }),
        task({ id: 'T_3', name: '乐园的' }),                       // 无 worldName = 跨世界
      ],
    } as never);
    expect(useMisc.getState().freezeTasksOfWorld('斗罗大陆', 50)).toBe(1);
    expect(useMisc.getState().tasks.map((t) => t.id)).toEqual(['T_2', 'T_3']);
    expect(useMisc.getState().frozenTasks.map((t) => t.id)).toEqual(['T_1']);
    expect(useMisc.getState().frozenTasks[0].frozenAt).toBe(50);
  });

  it('★同名再入选「继承」→ 原样捞回进行中，frozenAt 清掉', () => {
    useMisc.setState({ tasks: [task({ id: 'T_1', name: '甲', worldName: '斗罗大陆' })] } as never);
    useMisc.getState().freezeTasksOfWorld('斗罗大陆', 50);
    expect(useMisc.getState().thawTasksOfWorld('斗罗大陆')).toBe(1);
    expect(useMisc.getState().frozenTasks).toHaveLength(0);
    expect(useMisc.getState().tasks[0]).toMatchObject({ id: 'T_1', name: '甲' });
    expect(useMisc.getState().tasks[0].frozenAt).toBeUndefined();
  });

  it('解封只认同名世界；别的世界的封存留着不动', () => {
    useMisc.setState({
      frozenTasks: [
        { ...task({ id: 'T_1', name: '斗罗的', worldName: '斗罗大陆' }), frozenAt: 1 },
        { ...task({ id: 'T_2', name: '海贼的', worldName: '海贼王' }), frozenAt: 1 },
      ],
    } as never);
    expect(useMisc.getState().thawTasksOfWorld('海贼王')).toBe(1);
    expect(useMisc.getState().tasks.map((t) => t.id)).toEqual(['T_2']);
    expect(useMisc.getState().frozenTasks.map((t) => t.id)).toEqual(['T_1']);
  });

  it('乐园名当入参 → 不封存任何东西（在乐园里不该触发离世封存）', () => {
    useMisc.setState({ tasks: [task({ id: 'T_1', name: '甲', worldName: '轮回乐园' })] } as never);
    expect(useMisc.getState().freezeTasksOfWorld('轮回乐园', 5)).toBe(0);
    expect(useMisc.getState().tasks).toHaveLength(1);
  });

  it('unfreezeTask：玩家手动捞回单条', () => {
    useMisc.setState({ frozenTasks: [{ ...task({ id: 'T_9', name: '手动捞', worldName: 'X' }), frozenAt: 3 }] } as never);
    useMisc.getState().unfreezeTask('T_9');
    expect(useMisc.getState().tasks.map((t) => t.id)).toEqual(['T_9']);
    expect(useMisc.getState().frozenTasks).toHaveLength(0);
  });
});

describe('伏笔·世界归属过滤（旁路索引，不动表结构）', () => {
  it('★只有「明确记了别的任务世界」才过滤；无索引一律保留（老存档/手动加的行绝不弄丢）', () => {
    useRowScope.getState().note(FORESHADOW_UID, '1', { world: '斗罗大陆' });
    useRowScope.getState().note(FORESHADOW_UID, '2', { world: '海贼王' });
    expect(threadInCurrentWorld('1', '海贼王')).toBe(false);   // 别的世界 → 滤掉
    expect(threadInCurrentWorld('2', '海贼王')).toBe(true);    // 本世界 → 留
    expect(threadInCurrentWorld('99', '海贼王')).toBe(true);   // 无索引 → 留（不确定就别藏）
  });

  it('乐园埋的线 / 人在乐园 / 世界名未知 → 全留', () => {
    useRowScope.getState().note(FORESHADOW_UID, '1', { world: '轮回乐园' });
    expect(threadInCurrentWorld('1', '海贼王')).toBe(true);    // 乐园埋的线跨世界有效
    useRowScope.getState().note(FORESHADOW_UID, '2', { world: '斗罗大陆' });
    expect(threadInCurrentWorld('2', '轮回乐园')).toBe(true);  // 人在乐园 → 不过滤
    expect(threadInCurrentWorld('2', '')).toBe(true);          // 世界名未知 → 不过滤
  });

  it('★<伏笔催收> 不再催上个世界的线头', () => {
    const turn = 100;
    useMisc.setState({ worldName: '海贼王', turnCount: turn } as never);
    seedThreads([row('1', '斗罗埋的陈年线'), row('2', '海贼埋的陈年线')]);
    useTableJournal.setState({
      entries: [
        { id: 1, turn: turn - DUN_AGE - 5, uid: FORESHADOW_UID, sheetName: '伏笔表', command: 'updateRow' as const, rowId: '1', pos: 0, before: null, after: null },
        { id: 2, turn: turn - DUN_AGE - 5, uid: FORESHADOW_UID, sheetName: '伏笔表', command: 'updateRow' as const, rowId: '2', pos: 0, before: null, after: null },
      ],
    } as never);
    useRowScope.getState().note(FORESHADOW_UID, '1', { world: '斗罗大陆' });
    useRowScope.getState().note(FORESHADOW_UID, '2', { world: '海贼王' });

    const stale = collectStaleThreads(turn);
    expect(stale.map((t) => t.rowId)).toEqual(['2']);
  });

  it('★楼层信息条的伏笔段同口径过滤', () => {
    useRowScope.getState().note(FORESHADOW_UID, '1', { world: '斗罗大陆' });
    useRowScope.getState().note(FORESHADOW_UID, '2', { world: '海贼王' });
    const content = [HEADER, row('1', '斗罗的'), row('2', '海贼的'), row('3', '没索引的')];
    expect(pickThreads(content, 5, 6, '海贼王').map((t) => t.title)).toEqual(['海贼的', '没索引的']);
    expect(pickThreads(content, 5, 6, '').map((t) => t.title)).toHaveLength(3);   // 不传世界 → 不过滤（兼容旧调用）
  });
});

describe('rowScopeStore', () => {
  it('key 带表前缀：不同表的同号 row 互不覆盖', () => {
    const R = useRowScope.getState();
    R.note('foreshadowing', '1', { world: 'A' });
    R.note('chronicle', '1', { world: 'B' });
    expect(useRowScope.getState().worldOf('foreshadowing', '1')).toBe('A');
    expect(useRowScope.getState().worldOf('chronicle', '1')).toBe('B');
  });

  it('noteMany 批量写；查无返回 undefined', () => {
    useRowScope.getState().noteMany([
      { uid: 'foreshadowing', rowId: '5', meta: { world: 'X', turn: 3 } },
      { uid: 'foreshadowing', rowId: '6', meta: { world: 'Y' } },
    ]);
    expect(useRowScope.getState().worldOf('foreshadowing', '5')).toBe('X');
    expect(useRowScope.getState().worldOf('foreshadowing', '6')).toBe('Y');
    expect(useRowScope.getState().worldOf('foreshadowing', '404')).toBeUndefined();
  });
});
