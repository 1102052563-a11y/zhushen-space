import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterAiTaskPatch, gateNewAiTask, isTerminalTaskStatus, isExemptTask,
  evidenceAnchored, gateRingAdvance, gateRingsPatch, gateTaskSettle, isSuccessSettleStatus,
} from './questGuard';
import { useMisc, type MiscTask, type QuestRing } from '../store/miscStore';
import { applyMiscCommands } from './miscParser';

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

/* ══ 环推进闸门（questAdvanceGate·治"部分完成就乱推/跳环/整条报完成"） ══ */

const NARR = '苏晓贴着锈蚀的管道摸进了矿洞深处，弩箭贯穿了铁鬃兽首领的咽喉。它轰然倒地，兽群四散奔逃。他割下首领的独角作为凭证，转身没入夜色。';

describe('evidenceAnchored（证据锚定：引用须真实出现在正文里）', () => {
  it('逐字摘录 → 命中；标点/空白差异不影响', () => {
    expect(evidenceAnchored('弩箭贯穿了铁鬃兽首领的咽喉', NARR)).toBe(true);
    expect(evidenceAnchored('弩箭，贯穿了 铁鬃兽首领的咽喉！', NARR)).toBe(true);
  });
  it('掐头去尾的部分摘录：只要有≥10字连续片段命中即可', () => {
    expect(evidenceAnchored('（主角）贴着锈蚀的管道摸进了矿洞深处并得手', NARR)).toBe(true);
  });
  it('编造 / 改写到面目全非 → 不命中', () => {
    expect(evidenceAnchored('苏晓轻松击杀了首领并夺回了矿石样本', NARR)).toBe(false);
  });
  it('引用太短（归一后<6字）不足以核验 → 不命中', () => {
    expect(evidenceAnchored('倒地', NARR)).toBe(false);
    expect(evidenceAnchored('', NARR)).toBe(false);
  });
});

describe('gateRingAdvance（推进裁决：summary 必给 + evidence 锚定）', () => {
  const ringed = task({ rings: [ring(1, 'active'), ring(2)] });
  it('summary 缺失 → 驳回；无环任务不拦（本就 no-op）', () => {
    expect(gateRingAdvance(ringed, { evidence: NARR.slice(0, 20) }, NARR)).toMatch(/summary/);
    expect(gateRingAdvance(task(), null, NARR)).toBeNull();
  });
  it('有正文时 evidence 缺失/对不上 → 驳回；逐字摘录 → 放行', () => {
    expect(gateRingAdvance(ringed, { summary: '击杀首领' }, NARR)).toMatch(/evidence/);
    expect(gateRingAdvance(ringed, { summary: '击杀首领', evidence: '苏晓一刀秒了所有敌人' }, NARR)).toMatch(/对不上/);
    expect(gateRingAdvance(ringed, { summary: '击杀首领', evidence: '弩箭贯穿了铁鬃兽首领的咽喉' }, NARR)).toBeNull();
  });
  it('未提供正文（旧调用路径）→ 只查 summary，不查证据', () => {
    expect(gateRingAdvance(ringed, { summary: '击杀首领' })).toBeNull();
  });
});

describe('gateRingsPatch（环状态单向 + 跨环限幅）', () => {
  const ringsBase = (): QuestRing[] => [ring(1, 'done'), ring(2, 'active'), ring(3), ring(4), ring(5)];

  it('状态回退（done→active / active→planned）被剔除，其余字段保留', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { rings: [{ ...ring(1, 'active'), summary: '补总结' }, { ...ring(2), status: 'planned' } as QuestRing] }, 1);
    expect(g.dropped.join('')).toMatch(/回退/);
    expect(g.patch.rings?.[0].status).toBeUndefined();       // 回退状态被剔
    expect(g.patch.rings?.[0].summary).toBe('补总结');        // 其余字段照留
    expect(g.flips).toBe(0);
  });

  it('一轮翻多个环（>上限）→ rings/currentRing 整组驳回', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { rings: [ring(2, 'done'), ring(3, 'done'), ring(4, 'active')], currentRing: 4 }, 1);
    expect(g.dropped.join('')).toMatch(/每轮上限/);
    expect(g.patch.rings).toBeUndefined();
    expect(g.patch.currentRing).toBeUndefined();
    expect(g.flips).toBe(0);
  });

  it('把 active 直接指到后面环、中间 planned 环不交代 → 悬空跳跃，整组驳回', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { rings: [ring(5, 'active')], currentRing: 5 }, 1);   // 环3~4 会悬空成 active 后方的 planned
    expect(g.patch.rings).toBeUndefined();
    expect(g.patch.currentRing).toBeUndefined();
    expect(g.dropped.join('')).toMatch(/跨环必须逐环/);
  });

  it('单环推进（≤上限）→ 放行并回报 flips；currentRing 与合并后 active 对齐', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { rings: [ring(2, 'done'), ring(3, 'active')], currentRing: 9 }, 1);
    expect(g.dropped).toEqual([]);
    expect(g.flips).toBe(1);
    expect(g.patch.currentRing).toBe(3);   // 9 是胡写的，归一到合并后的 active 环
  });

  it('jumpMax=0 表示不限幅', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { rings: [ring(2, 'done'), ring(3, 'done'), ring(4, 'active')] }, 0);
    expect(g.patch.rings).toBeDefined();
    expect(g.flips).toBe(2);
  });

  it('只动 currentRing 不动 rings：与当前 active 不符 → 剔除（防"只改指针假装推进"）', () => {
    const ex = task({ rings: ringsBase() });
    const g = gateRingsPatch(ex, { currentRing: 4 }, 1);
    expect(g.patch.currentRing).toBeUndefined();
    expect(g.dropped.join('')).toMatch(/currentRing/);
    expect(gateRingsPatch(ex, { currentRing: 2 }, 1).patch.currentRing).toBe(2);   // 与 active 一致=照抄，放行
  });
});

describe('gateTaskSettle（整条成功结算闸：强制环须全达成）', () => {
  const mk = (statuses: Array<[QuestRing['status'], boolean?]>): MiscTask =>
    task({ kind: '主线', finale: '斩杀矿洞之主', rings: statuses.map(([st, opt], i) => ({ ...ring(i + 1, st), optional: opt || undefined })) });

  it('强制环全 done/skipped → 放行（贪婪环还剩 planned 也不影响=见好就收）', () => {
    expect(gateTaskSettle(mk([['done'], ['skipped'], ['done']]), '已完成')).toBeNull();
    expect(gateTaskSettle(mk([['done'], ['done'], ['planned', true]]), '已完成')).toBeNull();
  });
  it('只差最后一个强制环（终局打完没来得及 ringAdvance 的合法收尾）→ 放行', () => {
    expect(gateTaskSettle(mk([['done'], ['done'], ['active']]), '已完成')).toBeNull();
  });
  it('还剩 ≥2 个强制环 / 中途环未达成 → 驳回', () => {
    expect(gateTaskSettle(mk([['done'], ['active'], ['planned']]), '已完成')).toMatch(/强制环/);
    expect(gateTaskSettle(mk([['active'], ['planned'], ['planned']]), '已达成')).toMatch(/强制环/);
  });
  it('失败/放弃向结算不经此闸；扁平无环任务不拦（语义交给复核裁判）', () => {
    expect(gateTaskSettle(mk([['active'], ['planned'], ['planned']]), '已失败')).toBeNull();
    expect(gateTaskSettle(mk([['active'], ['planned'], ['planned']]), '已放弃')).toBeNull();
    expect(gateTaskSettle(task(), '已完成')).toBeNull();
  });
  it('isSuccessSettleStatus：成功向才算；"完成失败"这类混词不算成功', () => {
    expect(isSuccessSettleStatus('已完成')).toBe(true);
    expect(isSuccessSettleStatus('任务达成')).toBe(true);
    expect(isSuccessSettleStatus('已失败')).toBe(false);
    expect(isSuccessSettleStatus('进行中')).toBe(false);
  });
});

/* ══ miscParser 接线（端到端：闸门在解析入口真的拦得住） ══ */
describe('miscParser 接线（环推进闸门端到端）', () => {
  const NARR = '苏晓潜入据点，夺回了样本，但线人仍被困在塔楼。';
  const seed = (ts: MiscTask[]) => useMisc.setState({ tasks: ts.map((x) => ({ ...x, rings: x.rings?.map((r) => ({ ...r })) })) } as never);
  beforeEach(() => { useMisc.setState({ tasks: [], archivedTasks: [] } as never); });

  it('ringAdvance 无 evidence → 驳回、环不动、summary 转存 progress（信息不丢）', () => {
    seed([task({ rings: [ring(1, 'active'), ring(2)] })]);
    applyMiscCommands('<upstore>\nringAdvance("T_1", {"summary":"夺回样本","rating":"A"})\n</upstore>', { domain: 'tasks', narrative: NARR });
    const t = useMisc.getState().tasks[0];
    expect(t.rings?.[0].status).toBe('active');
    expect(t.progress).toBe('夺回样本');
  });

  it('ringAdvance evidence 逐字命中正文 → 推进生效', () => {
    seed([task({ rings: [ring(1, 'active'), ring(2)] })]);
    applyMiscCommands('<upstore>\nringAdvance("T_1", {"summary":"夺回样本","rating":"A","evidence":"潜入据点，夺回了样本"})\n</upstore>', { domain: 'tasks', narrative: NARR });
    const t = useMisc.getState().tasks[0];
    expect(t.rings?.[0].status).toBe('done');
    expect(t.rings?.[1].status).toBe('active');
  });

  it('强制环没打完就整条"已完成" → 结算被驳回，任务保持进行中不归档', () => {
    seed([task({ kind: '主线', rings: [ring(1, 'done'), ring(2, 'active'), ring(3)] })]);
    applyMiscCommands('<upstore>\nadd("T_1", {"5":"已完成"})\n</upstore>', { domain: 'tasks', narrative: NARR });
    expect(useMisc.getState().tasks).toHaveLength(1);
    expect(useMisc.getState().tasks[0].status).toBe('进行中');
    expect(useMisc.getState().archivedTasks).toHaveLength(0);
  });

  it('只差最后强制环的"已完成" → 放行归档（07-15"终局打完没 ringAdvance"合法收尾不回归）', () => {
    seed([task({ kind: '主线', rings: [ring(1, 'done'), ring(2, 'done'), ring(3, 'active')] })]);
    applyMiscCommands('<upstore>\nadd("T_1", {"5":"已完成"})\n</upstore>', { domain: 'tasks', narrative: NARR });
    expect(useMisc.getState().tasks).toHaveLength(0);
    expect(useMisc.getState().archivedTasks[0]?.status).toBe('已完成');
  });

  it('同一任务一轮两次环操作 → 第二次被丢弃（每轮每任务一种环操作）', () => {
    seed([task({ rings: [ring(1, 'active'), ring(2), ring(3)] })]);
    applyMiscCommands(`<upstore>
ringAdvance("T_1", {"summary":"夺回样本","rating":"A","evidence":"潜入据点，夺回了样本"})
ringAdvance("T_1", {"summary":"又推一环","rating":"A","evidence":"潜入据点，夺回了样本"})
</upstore>`, { domain: 'tasks', narrative: NARR });
    const t = useMisc.getState().tasks[0];
    expect(t.rings?.filter((r) => r.status === 'done')).toHaveLength(1);
    expect(t.rings?.[1].status).toBe('active');
  });

  it('玩家路径 taskGuard:false 全豁免（面板/手动生成不经闸门）', () => {
    seed([task({ rings: [ring(1, 'active'), ring(2)] })]);
    applyMiscCommands('<upstore>\nringAdvance("T_1")\n</upstore>', { domain: 'tasks', taskGuard: false });
    expect(useMisc.getState().tasks[0].rings?.[0].status).toBe('done');
  });
});
