import { describe, it, expect } from 'vitest';
import { extractAdvanceClaims, buildReviewMessages, parseReviewVerdicts, reviewQuestAdvancement } from './questAdvanceReview';
import type { MiscTask, QuestRing } from '../store/miscStore';

const ring = (idx: number, status: QuestRing['status'] = 'planned', over: Partial<QuestRing> = {}): QuestRing =>
  ({ idx, goal: `环${idx}目标`, status, ...over });
const task = (over: Partial<MiscTask> = {}): MiscTask => ({
  id: 'T_1', name: '肃清矿洞', desc: '肃清矿洞', reward: '乐园币+500', penalty: '扣乐园币300',
  status: '进行中', startTime: '', endTime: '', addedAt: 1, ...over,
});

const NARR = '苏晓摸进矿洞深处，弩箭贯穿了铁鬃兽首领的咽喉，兽群四散奔逃。';

describe('extractAdvanceClaims（从任务演化回复抽推进/跳环/结算主张）', () => {
  const tasks = [
    task({ rings: [ring(1, 'active'), ring(2), ring(3)], finale: '斩杀矿洞之主', progress: '已探明巢穴位置' }),
    task({ id: 'T_2', name: '送信', desc: '把信送到铁匠铺' }),   // 扁平支线
  ];

  it('ringAdvance / 整条成功结算 / 跳环 都被抽出；新建与未知任务忽略', () => {
    const reply = `<quest_cot>推演…</quest_cot>
<upstore>
ringAdvance("T_1", {"summary":"击杀首领","rating":"A","evidence":"弩箭贯穿了铁鬃兽首领的咽喉"})
add("T_2", {"5":"已完成"})
add("T_1", {"rings":[{"idx":2,"status":"done","goal":"环2目标"}]})
ringAdvance("T_99", {"summary":"不存在的任务"})
set({"0":"T_50","1":"新任务","2":"目标","3":"奖","4":"罚","5":"进行中"})
add("T_1", {"progress":"只是进度更新"})
</upstore>`;
    const claims = extractAdvanceClaims(reply, tasks);
    expect(claims.map((c) => `${c.id}:${c.kind}`)).toEqual(['T_1:ring', 'T_2:settle', 'T_1:jump']);
    expect(claims[0].goal).toBe('环1目标');
    expect(claims[0].evidence).toMatch(/弩箭/);
    expect(claims[0].progress).toBe('已探明巢穴位置');   // 跨回合完成的目标靠它补早先要件
    expect(claims[1].goal).toBe('把信送到铁匠铺');       // 扁平任务结算也复核（确定性闸管不到语义）
    expect(claims[2].goal).toMatch(/环2「环2目标」标 done/);
  });

  it('失败向结算 / 纯 progress 更新 / 无环任务的 ringAdvance 不进复核', () => {
    const reply = `<upstore>\nadd("T_2", {"5":"已失败"})\nadd("T_1", {"progress":"探路中"})\nringAdvance("T_2")\n</upstore>`;
    expect(extractAdvanceClaims(reply, tasks)).toEqual([]);
  });

  it('「见好就收/继续赌」选择点：主张判据改写成"只核验表态"，不要求终局战斗证据重现', () => {
    const choice = [task({
      finale: '斩杀矿洞之主',
      rings: [ring(1, 'done'), ring(2, 'active'), ring(3, 'planned', { optional: true })],
    })];
    const advance = extractAdvanceClaims('<upstore>\nringAdvance("T_1", {"summary":"选择继续","rating":"A","evidence":"我要继续"})\n</upstore>', choice);
    expect(advance[0].goal).toMatch(/选择点.*【继续】/);
    const settle = extractAdvanceClaims('<upstore>\nadd("T_1", {"5":"已完成"})\n</upstore>', choice);
    expect(settle[0].goal).toMatch(/选择点.*【见好就收】/);
  });
});

describe('buildReviewMessages / parseReviewVerdicts', () => {
  it('主张编号 1-based、附证据/总结/已记录进度；裁判 JSON 宽容解析', () => {
    const claims = extractAdvanceClaims(
      '<upstore>\nringAdvance("T_1", {"summary":"击杀首领","rating":"A","evidence":"弩箭贯穿"})\n</upstore>',
      [task({ rings: [ring(1, 'active')], progress: '已探明巢穴' })]);
    const { system, user } = buildReviewMessages(claims, NARR);
    expect(system).toMatch(/全部要件/);
    expect(user).toMatch(/1\. \[环推进\]/);
    expect(user).toMatch(/已记录进度/);
    const v = parseReviewVerdicts('前置废话 {"verdicts":[{"i":1,"pass":false,"reason":"缺护送要件"}]}');
    expect(v?.get(1)).toEqual({ pass: false, reason: '缺护送要件' });
    expect(parseReviewVerdicts('不是JSON')).toBeNull();
  });
});

describe('reviewQuestAdvancement（FAIL 的整行剔除；ring 类降级成 progress；裁判故障 fail-open）', () => {
  const tasks = [task({ rings: [ring(1, 'active'), ring(2)] })];
  const reply = `<quest_cot>…</quest_cot>
<upstore>
ringAdvance("T_1", {"summary":"击杀了首领","rating":"A","evidence":"弩箭贯穿了铁鬃兽首领的咽喉"})
add("T_1", {"progress":"顺手记的进度"})
</upstore>`;

  it('裁判 FAIL → ringAdvance 行被替换成 progress 更新，其余行原样', async () => {
    const out = await reviewQuestAdvancement(reply, NARR, tasks,
      async () => '{"verdicts":[{"i":1,"pass":false,"reason":"目标含撤离要件，正文无证据"}]}');
    expect(out).not.toMatch(/ringAdvance/);
    expect(out).toMatch(/add\("T_1",\{"progress":"击杀了首领"\}\)/);
    expect(out).toMatch(/顺手记的进度/);
  });

  it('裁判 PASS → 原样放行；无主张时不调裁判', async () => {
    const out = await reviewQuestAdvancement(reply, NARR, tasks,
      async () => '{"verdicts":[{"i":1,"pass":true,"reason":""}]}');
    expect(out).toBe(reply);
    let called = 0;
    const none = await reviewQuestAdvancement('<upstore></upstore>', NARR, tasks, async () => { called++; return ''; });
    expect(none).toBe('<upstore></upstore>');
    expect(called).toBe(0);
  });

  it('裁判抛错 / 输出解析不了 → fail-open 放行原回复', async () => {
    expect(await reviewQuestAdvancement(reply, NARR, tasks, async () => { throw new Error('504'); })).toBe(reply);
    expect(await reviewQuestAdvancement(reply, NARR, tasks, async () => '裁判开小差')).toBe(reply);
  });
});
