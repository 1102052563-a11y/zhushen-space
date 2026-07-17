import { describe, it, expect } from 'vitest';
import { filterAiTaskPatch, gateNewAiTask, isTerminalTaskStatus, isExemptTask } from './questGuard';
import type { MiscTask, QuestRing } from '../store/miscStore';

const task = (over: Partial<MiscTask> = {}): MiscTask => ({
  id: 'T_1', name: '猎杀铁鬃兽', desc: '在黑森林猎杀铁鬃兽首领', reward: '乐园币+500、技能点+1',
  penalty: '扣乐园币300', status: '进行中', startTime: '', endTime: '', addedAt: 1, ...over,
});
const ring = (idx: number, status: QuestRing['status'] = 'planned'): QuestRing => ({ idx, goal: `环${idx}目标`, status });

describe('filterAiTaskPatch（AI 结构锁：已建档任务只许推进）', () => {
  it('结构字段（名称/描述/奖励）改写被冻结并计入 dropped；推进类字段（status/progress/rating）放行', () => {
    const existing = task();
    const { patch, dropped } = filterAiTaskPatch(existing, {
      name: '全新任务名', desc: '被 AI 重写的描述', reward: '乐园币+99999',
      status: '进行中·受挫', progress: '刚从情报贩子处拿到巢穴位置', rating: 'B',
    });
    expect(patch).toEqual({ status: '进行中·受挫', progress: '刚从情报贩子处拿到巢穴位置', rating: 'B' });
    expect(dropped).toHaveLength(3);
    expect(dropped.join('')).toMatch(/名称/);
    expect(dropped.join('')).toMatch(/描述/);
    expect(dropped.join('')).toMatch(/奖励/);
  });

  it('set 重发整行（原样字段 + 空串默认值）不误报：与现值相同或为空的结构字段不计入 dropped', () => {
    const existing = task();
    const { patch, dropped } = filterAiTaskPatch(existing, {
      name: existing.name, desc: existing.desc, reward: existing.reward, penalty: '', status: '进行中',
    });
    expect(dropped).toEqual([]);
    expect(patch).toEqual({ status: '进行中' });
  });

  it('kind 缺省视为支线：重发 kind:"支线" 不误报；试图改成主线才驳回', () => {
    const existing = task();   // 无 kind = 支线
    expect(filterAiTaskPatch(existing, { kind: '支线' }).dropped).toEqual([]);
    const up = filterAiTaskPatch(existing, { kind: '主线' });
    expect(up.dropped.join('')).toMatch(/线别/);
    expect(up.patch.kind).toBeUndefined();
  });

  it('无环扁平任务被补加环结构 → 冻结；既有环任务的 rings 放行（内容另有 mergeRings 冻结）', () => {
    const flat = filterAiTaskPatch(task(), { rings: [ring(1, 'active'), ring(2)] });
    expect(flat.patch.rings).toBeUndefined();
    expect(flat.dropped.join('')).toMatch(/rings/);

    const ringed = filterAiTaskPatch(task({ rings: [ring(1, 'active'), ring(2)] }), { rings: [ring(1, 'done'), ring(2, 'active')] });
    expect(ringed.patch.rings).toHaveLength(2);
    expect(ringed.dropped).toEqual([]);
  });

  it('id / addedAt 为合成字段：静默忽略、不进 patch 也不进 dropped（addedAt 是"一世界一主线"边界依据，绝不能被刷新）', () => {
    const { patch, dropped } = filterAiTaskPatch(task({ addedAt: 1000 }), { id: 'T_1', addedAt: 99999, status: '进行中' } as Partial<MiscTask>);
    expect(patch).toEqual({ status: '进行中' });
    expect(dropped).toEqual([]);
  });
});

describe('gateNewAiTask（布置闸：每轮配额 + 在场支线上限）', () => {
  const side = (id: string, over: Partial<MiscTask> = {}) => task({ id, ...over });

  it('每轮新建配额用尽 → 驳回；未用尽 → 放行', () => {
    expect(gateNewAiTask(side('T_9'), [], { sideMax: 4, newPerRound: 1, roundCreated: 1 })).toMatch(/配额/);
    expect(gateNewAiTask(side('T_9'), [], { sideMax: 4, newPerRound: 1, roundCreated: 0 })).toBeNull();
  });

  it('在场支线满额 → 驳回新建支线；主线不占额也不受此限', () => {
    const four = [side('T_1'), side('T_2'), side('T_3'), side('T_4')];
    expect(gateNewAiTask(side('T_9'), four, { sideMax: 4, newPerRound: 0, roundCreated: 0 })).toMatch(/上限/);
    expect(gateNewAiTask(side('T_9', { kind: '主线' }), four, { sideMax: 4, newPerRound: 0, roundCreated: 0 })).toBeNull();
  });

  it('职业任务 / 进阶通告不计入在场支线数，也不受配额与上限（专用通道豁免）', () => {
    const mixed = [side('T_1'), side('T_2'), side('T_3'), side('T_4', { prof: true }), side('T_5', { desc: '【来自乐园的进阶通告】猎杀……' })];
    // 计数只有 3 条普通支线 < 4 → 放行
    expect(gateNewAiTask(side('T_9'), mixed, { sideMax: 4, newPerRound: 0, roundCreated: 0 })).toBeNull();
    // 进阶通告新建：即便配额已用尽仍放行
    const advanced = side('T_9', { name: '进阶任务·猎杀魔祸领主' });
    expect(isExemptTask(advanced)).toBe(true);
    expect(gateNewAiTask(advanced, mixed, { sideMax: 4, newPerRound: 1, roundCreated: 1 })).toBeNull();
  });

  it('一次性已完成任务（建完立即归档、不占进行中列表）不受支线上限，但仍占每轮配额', () => {
    const five = [side('T_1'), side('T_2'), side('T_3'), side('T_4'), side('T_5')];
    const done = side('T_9', { status: '已完成' });
    expect(gateNewAiTask(done, five, { sideMax: 4, newPerRound: 2, roundCreated: 0 })).toBeNull();
    expect(gateNewAiTask(done, five, { sideMax: 4, newPerRound: 1, roundCreated: 1 })).toMatch(/配额/);
  });

  it('sideMax=0 / newPerRound=0 表示不限', () => {
    const many = Array.from({ length: 20 }, (_, i) => side(`T_${i + 1}`));
    expect(gateNewAiTask(side('T_99'), many, { sideMax: 0, newPerRound: 0, roundCreated: 15 })).toBeNull();
  });
});

describe('isTerminalTaskStatus（结算态判定·自 miscParser 移入）', () => {
  it.each([
    ['进行中', false], ['进行中·环3', false], ['未完成', false],
    ['已完成', true], ['达成', true], ['已失败', true], ['已放弃', true], ['已作废', true], ['取消', true],
  ])('%s → %s', (s, want) => expect(isTerminalTaskStatus(s)).toBe(want));
});
