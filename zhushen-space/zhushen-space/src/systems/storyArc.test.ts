import { describe, it, expect, beforeEach } from 'vitest';
import { parsePlanReply, buildArcInjection, arcJudgeInjection, applyArcJudgment, looksLikeNarrativeText } from './storyArc';
import { useArc } from '../store/arcStore';

/* 🧭 故事弧线：行协议解析 + 注入 + 判定幂等。钉住三条命门：
   ① 过拍判定必须幂等（拍号≠当前拍即忽略）——「仅重算变量」会重放同一份杂项回包；
   ② 退出/走完后 buildArcInjection 必须立刻返回空（撤销引导=只认 active）；
   ③ 跑偏护栏与 App.guidanceLooksLikeNarrative 同口径。 */

const startTwoBeats = () => {
  useArc.getState().startArc(
    { title: '试炼', throughline: '揪出商会内奸', landmarks: '', difficulty: '常规', redlines: '姬小满不能死', blind: false },
    [{ idx: 1, goal: '发现账本异常' }, { idx: 2, goal: '码头对峙揭穿内奸' }],
  );
};

describe('故事弧线 · 分拍行协议', () => {
  it('弧名/拍N/第N拍 都认，按号排序重编号', () => {
    const p = parsePlanReply('弧名: 内奸迷局\n拍2: 反咬一口\n拍1: 发现账本异常\n第3拍：码头对峙', 'x');
    expect(p.title).toBe('内奸迷局');
    expect(p.beats.map((b) => b.goal)).toEqual(['发现账本异常', '反咬一口', '码头对峙']);
    expect(p.beats.map((b) => b.idx)).toEqual([1, 2, 3]);
  });
  it('超 6 拍裁剪；没有拍行=抛错；缺弧名回退', () => {
    const many = Array.from({ length: 8 }, (_, i) => `拍${i + 1}: 目标${i + 1}`).join('\n');
    expect(parsePlanReply(many, 'fb').beats).toHaveLength(6);
    expect(parsePlanReply(many, 'fb').title).toBe('fb');
    expect(() => parsePlanReply('随便聊聊没有协议', 'fb')).toThrow(/协议/);
  });
});

describe('故事弧线 · 注入与生命周期', () => {
  beforeEach(() => useArc.getState().clearAll());

  it('未启动=零注入；启动后注入含贯穿线/目标/红线/让路纪律；指令缓存后进注入', () => {
    expect(buildArcInjection()).toEqual([]);
    startTwoBeats();
    let inj = buildArcInjection();
    expect(inj).toHaveLength(1);
    expect(inj[0].content).toContain('揪出商会内奸');
    expect(inj[0].content).toContain('第 1/2 拍');
    expect(inj[0].content).toContain('姬小满不能死');
    expect(inj[0].content).toContain('顺势让路');
    expect(inj[0].content).toContain('现编中');   // 指令未生成→拍目标兜底
    useArc.getState().setBeatInstruction(1, '衔接：从账房收账切入；靠拢：让掌柜主动递出一本对不上的账。');
    inj = buildArcInjection();
    expect(inj[0].content).toContain('对不上的账');
    expect(inj[0].content).not.toContain('现编中');
  });

  it('退出后立刻零注入（撤销引导）', () => {
    startTwoBeats();
    useArc.getState().exitArc('玩家手动退出');
    expect(buildArcInjection()).toEqual([]);
    expect(useArc.getState().endedReason).toContain('退出');
  });
});

describe('故事弧线 · 过拍判定（挂杂项·幂等）', () => {
  beforeEach(() => useArc.getState().clearAll());

  it('判定协议：不活跃=空串；活跃含当前拍号', () => {
    expect(arcJudgeInjection()).toBe('');
    startTwoBeats();
    const j = arcJudgeInjection();
    expect(j).toContain('arcBeat.1 = done');
    expect(j).toContain('arcRedline');
  });

  it('过拍：拍号对上才推进；重放/错号忽略（幂等）；走完自动收官', () => {
    startTwoBeats();
    applyArcJudgment('...<upstore>xx</upstore>\narcBeat.2 = done｜错号', { genNext: false });
    expect(useArc.getState().beats[0].status).toBe('active');   // 错号被忽略
    applyArcJudgment('arcBeat.1 = done｜账本异常已当面摊开', { genNext: false });
    let A = useArc.getState();
    expect(A.beats[0].status).toBe('done');
    expect(A.beats[1].status).toBe('active');
    applyArcJudgment('arcBeat.1 = done｜重放同一份回包', { genNext: false });
    expect(useArc.getState().beats[1].status).toBe('active');   // 重放安全
    applyArcJudgment('arcBeat.2 = done｜内奸已揭穿', { genNext: false });
    A = useArc.getState();
    expect(A.active).toBe(false);
    expect(A.endedReason).toContain('收官');
    expect(buildArcInjection()).toEqual([]);
  });

  it('破红线：自动退出并记录原因', () => {
    startTwoBeats();
    applyArcJudgment('arcRedline = 姬小满在本轮正文中死亡', { genNext: false });
    const A = useArc.getState();
    expect(A.active).toBe(false);
    expect(A.endedReason).toContain('红线');
    expect(buildArcInjection()).toEqual([]);
  });
});

describe('故事弧线 · 跑偏护栏（与 guidanceLooksLikeNarrative 同口径）', () => {
  it('要点式指令放行；带正文结构标记/超长判跑偏', () => {
    expect(looksLikeNarrativeText('衔接：从账房切入；靠拢：掌柜递出账本。')).toBe(false);
    expect(looksLikeNarrativeText('【正文】她走进来……\n状态栏如下')).toBe(true);
    expect(looksLikeNarrativeText('x'.repeat(2300))).toBe(true);
  });
});
