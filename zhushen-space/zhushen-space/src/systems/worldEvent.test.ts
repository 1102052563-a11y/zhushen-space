import { describe, it, expect } from 'vitest';
import {
  EVENT_CAP, EVENT_FLOOR, scopeOf, isSettled, latestChain, activeEvents, byScope,
  needsMore, overflowIds, pendingDerivations, buildDerivationInjection,
  serializeEventsForEvo, buildActiveEventInjection,
  visibilityOf, normVisibility, narrativeEventView, isEventDue,
  pendingReveals, offeredReveals, buildRevealInjection, revealAcked, planRevealReconcile,
  REVEAL_OFFER_MAX, REVEAL_MAX_ATTEMPTS,
} from './worldEvent';
import type { WorldEvent } from '../store/miscStore';

function ev(p: Partial<WorldEvent> = {}): WorldEvent {
  return { id: 'W_1', time: '3年5月1日', location: '城南', desc: '初始描述', ...p };
}
const same = (a?: string, b?: string) => (a ?? '') === (b ?? '');

describe('worldEvent · 基础判定', () => {
  it('scopeOf 缺省按区域（老数据多是主角身边的事）', () => {
    expect(scopeOf(ev())).toBe('region');
    expect(scopeOf(ev({ scope: 'background' }))).toBe('background');
    expect(scopeOf(ev({ scope: 'region' }))).toBe('region');
  });

  it('isSettled 看 settledAt', () => {
    expect(isSettled(ev())).toBe(false);
    expect(isSettled(ev({ settledAt: 123 }))).toBe(true);
  });

  it('latestChain 取最新一节；无 chain 的老条目回退 desc', () => {
    const withChain = ev({ chain: [{ date: 'd1', text: '第一节' }, { date: 'd2', text: '第二节' }] });
    expect(latestChain(withChain)?.text).toBe('第二节');
    expect(latestChain(ev())?.text).toBe('初始描述');
    expect(latestChain(ev({ desc: '' }))).toBeNull();
  });
});

describe('worldEvent · 作用域与配额', () => {
  it('activeEvents 过滤已结算 + 非本世界；worldName 为空放行', () => {
    const list = [
      ev({ id: 'W_1', worldName: '丧尸围城' }),
      ev({ id: 'W_2', worldName: '永夜监狱' }),
      ev({ id: 'W_3', worldName: undefined }),
      ev({ id: 'W_4', worldName: '丧尸围城', settledAt: 1 }),
    ];
    expect(activeEvents(list, '丧尸围城', same).map((e) => e.id)).toEqual(['W_1', 'W_3']);
  });

  it('needsMore：不足下限才可派生', () => {
    const one = [ev({ scope: 'background' })];
    expect(needsMore(one, 'background')).toBe(true);
    const two = [ev({ id: 'W_1', scope: 'background' }), ev({ id: 'W_2', scope: 'background' })];
    expect(needsMore(two, 'background')).toBe(false);
    expect(EVENT_FLOOR).toBe(2);
  });

  it('超配额时保留高价值（有结算条件 > 脉络长 > 新的）', () => {
    const list = [
      ev({ id: 'W_1', scope: 'region', settleCond: '有终点' }),
      ev({ id: 'W_2', scope: 'region', chain: [{ date: 'd', text: 't' }, { date: 'd', text: 't' }] }),
      ev({ id: 'W_3', scope: 'region' }),
      ev({ id: 'W_4', scope: 'region' }),
    ];
    expect(EVENT_CAP.region).toBe(3);
    const over = overflowIds(list);
    expect(over).toHaveLength(1);
    expect(over[0]).not.toBe('W_1');   // 有结算条件的最不该被裁
  });

  it('两档分别计配额，互不挤占', () => {
    const list = [
      ...Array.from({ length: 4 }, (_, i) => ev({ id: `B${i}`, scope: 'background' })),
      ...Array.from({ length: 2 }, (_, i) => ev({ id: `R${i}`, scope: 'region' })),
    ];
    const over = overflowIds(list);
    expect(over).toHaveLength(1);           // 背景超 1 条
    expect(over.every((id) => id.startsWith('B'))).toBe(true);   // 区域未超，不该被裁
  });

  it('已结算的不参与配额裁剪（它们是历史）', () => {
    const list = Array.from({ length: 6 }, (_, i) => ev({ id: `W_${i}`, scope: 'region', settledAt: 1 }));
    expect(overflowIds(list)).toEqual([]);
  });

  it('byScope 分档', () => {
    const list = [ev({ id: 'W_1', scope: 'background' }), ev({ id: 'W_2' })];
    expect(byScope(list, 'background').map((e) => e.id)).toEqual(['W_1']);
    expect(byScope(list, 'region').map((e) => e.id)).toEqual(['W_2']);
  });
});

describe('worldEvent · 派生支线（§5.4）', () => {
  it('只挑 outcome=derived 且未被消费的', () => {
    const list = [
      ev({ id: 'W_1', outcome: 'derived' }),
      ev({ id: 'W_2', outcome: 'derived', derivedAt: 111 }),
      ev({ id: 'W_3', outcome: 'historic' }),
      ev({ id: 'W_4' }),
    ];
    expect(pendingDerivations(list).map((e) => e.id)).toEqual(['W_1']);
  });

  it('注入块措辞是建议不是命令（钩不上要允许跳过）', () => {
    const s = buildDerivationInjection([ev({ id: 'W_1', name: '漕帮火并', outcome: 'derived', settleCond: '一方退出漕运' })]);
    expect(s).toContain('漕帮火并');
    expect(s).toContain('建议');
    expect(s).toContain('不要为了用上建议而硬造任务');
    expect(s).toContain('任务闸门');
  });

  it('无待派生 → 不出块', () => {
    expect(buildDerivationInjection([])).toBe('');
    expect(buildDerivationInjection([ev({ outcome: 'faded' })])).toBe('');
  });
});

describe('worldEvent · 序列化与注入', () => {
  it('演化序列化：带档位/脉络/结算条件，缺结算条件时点名提醒', () => {
    const s = serializeEventsForEvo([
      ev({ id: 'W_1', name: '北岭疫起', scope: 'background', settleCond: '疫情平息或蔓延至京畿', chain: [{ date: 'd1', text: '首例' }] }),
      ev({ id: 'W_2', name: '漕帮火并' }),
    ]);
    expect(s).toContain('W_1[背景]');
    expect(s).toContain('北岭疫起');
    expect(s).toContain('结算条件:疫情平息');
    expect(s).toContain('⚠未设结算条件');
    expect(serializeEventsForEvo([])).toContain('无活跃世界事件');
  });

  it('脉络只取最近 3 节（防注入块膨胀）', () => {
    const chain = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, text: `节点${i}` }));
    const s = serializeEventsForEvo([ev({ chain })]);
    expect(s).toContain('节点5');
    expect(s).toContain('节点3');
    expect(s).not.toContain('节点0');
  });

  it('正文注入取最新脉络节点（不是最初的 desc）', () => {
    const e = ev({ name: '北岭疫起', desc: '最初：出现首例', chain: [{ date: 'd2', text: '现在：已封三县' }] });
    const s = buildActiveEventInjection([e]);
    expect(s).toContain('已封三县');
    expect(s).not.toContain('出现首例');
    expect(s).toContain('勿替主角决定介入');
  });

  it('无活跃事件 → 不出块', () => {
    expect(buildActiveEventInjection([])).toBe('');
  });
});

/* ── P1·可见性（世界发生了 ≠ 正文知道了）── */
describe('worldEvent · 可见性门', () => {
  it('visibilityOf 缺省 known（老数据行为不变）；normVisibility 认中英文、认不出 undefined', () => {
    expect(visibilityOf(ev())).toBe('known');
    expect(normVisibility('hidden')).toBe('hidden');
    expect(normVisibility('隐秘')).toBe('hidden');
    expect(normVisibility('痕迹')).toBe('trace');
    expect(normVisibility('公开')).toBe('known');
    expect(normVisibility('牵涉主角')).toBe('direct');
    expect(normVisibility('乱写的')).toBeUndefined();
    expect(normVisibility('')).toBeUndefined();
  });

  it('narrativeEventView：hidden→null；trace→只给表象；known→最新脉络', () => {
    expect(narrativeEventView(ev({ visibility: 'hidden' }))).toBeNull();
    const t = narrativeEventView(ev({ visibility: 'trace', publicTrace: '城南连日封路', desc: '实为刺杀布置' }));
    expect(t?.text).toBe('城南连日封路');
    expect(t?.trace).toBe(true);
    expect(narrativeEventView(ev({ visibility: 'trace' }))).toBeNull();   // trace 没写表象 → 不进正文，别替 AI 编
    const k = narrativeEventView(ev({ knownBy: '林澈, 白九' }));
    expect(k?.text).toBe('初始描述');
    expect(k?.secret).toBe('林澈, 白九');
  });

  it('正文注入块：hidden 整条消失、不占名额；trace 不给事件名只给表象', () => {
    const s = buildActiveEventInjection([
      ev({ id: 'W_1', name: '刺杀行动', visibility: 'hidden', desc: '幕后密谋' }),
      ev({ id: 'W_2', name: '布防调整', visibility: 'trace', publicTrace: '卫兵换岗突然加倍', desc: '内情' }),
      ev({ id: 'W_3', name: '秋收庆典', desc: '全城筹备' }),
    ]);
    expect(s).not.toContain('刺杀行动');
    expect(s).not.toContain('幕后密谋');
    expect(s).not.toContain('布防调整');       // trace 连名字都不给
    expect(s).toContain('卫兵换岗突然加倍');
    expect(s).not.toContain('内情');
    expect(s).toContain('秋收庆典');
  });

  it('演化序列化带可见性与知情者；trace 缺表象点名补', () => {
    const s = serializeEventsForEvo([
      ev({ id: 'W_1', name: '布防调整', visibility: 'trace' }),
      ev({ id: 'W_2', name: '密约', visibility: 'hidden', knownBy: '大长老' }),
    ]);
    expect(s).toContain('可见性:trace');
    expect(s).toContain('⚠trace 必须补 publicTrace 表象');
    expect(s).toContain('可见性:hidden');
    expect(s).toContain('知情者:大长老');
  });
});

/* ── P1·暗流到期（due） ── */
describe('worldEvent · isEventDue', () => {
  it('到点才算到期；解析不出 / 无 due / 已结算 → 不催', () => {
    const e = ev({ due: '3年5月10日' });
    expect(isEventDue(e, '3年5月9日')).toBe(false);
    expect(isEventDue(e, '3年5月10日')).toBe(true);
    expect(isEventDue(e, '3年6月1日')).toBe(true);
    expect(isEventDue(ev(), '3年6月1日')).toBe(false);
    expect(isEventDue(ev({ due: '雪化之时' }), '3年6月1日')).toBe(false);   // 解析不出=不催，settleCond 兜着
    expect(isEventDue(ev({ due: '3年5月10日', settledAt: 1 }), '3年6月1日')).toBe(false);
  });

  it('演化序列化：到期标 ⏰ 并要求当轮结算或显式展期', () => {
    const s = serializeEventsForEvo([ev({ id: 'W_1', name: '舰队抵港', due: '3年5月10日' })], '3年5月11日');
    expect(s).toContain('⏰已到预计结算时刻');
    const s2 = serializeEventsForEvo([ev({ id: 'W_1', name: '舰队抵港', due: '3年5月10日' })], '3年5月1日');
    expect(s2).toContain('到期:3年5月10日');
    expect(s2).not.toContain('⏰');
  });
});

/* ── P1·显露递交（后台演了 ≠ 正文知道了）── */
describe('worldEvent · 显露递交', () => {
  const settled = (p: Partial<WorldEvent> = {}) =>
    ev({ settledAt: 100, reveal: { state: 'pending', attempts: 0 }, ...p });

  it('pendingReveals：只挑 已落幕+pending+非hidden+本世界；先落幕的排前', () => {
    const list = [
      settled({ id: 'W_1', settledAt: 300 }),
      settled({ id: 'W_2', settledAt: 100 }),
      settled({ id: 'W_3', visibility: 'hidden' }),
      settled({ id: 'W_4', reveal: { state: 'delivered', attempts: 1 } }),
      settled({ id: 'W_5', worldName: '别的世界' }),
      ev({ id: 'W_6' }),   // 未结算
    ];
    expect(pendingReveals(list, '', same).map((e) => e.id)).toEqual(['W_2', 'W_1']);
    expect(offeredReveals(list, '', same)).toHaveLength(Math.min(2, REVEAL_OFFER_MAX));
  });

  it('注入块：候选措辞是"情境合适才带出"，trace 只给表象', () => {
    const s = buildRevealInjection([
      settled({ id: 'W_1', name: '漕帮火并', chain: [{ date: 'd', text: '【落幕·historic】漕帮北堂覆灭' }] }),
      settled({ id: 'W_2', name: '密谋败露', visibility: 'trace', publicTrace: '府衙连夜贴出海捕文书' }),
    ], '', same);
    expect(s).toContain('漕帮火并');
    expect(s).toContain('漕帮北堂覆灭');
    expect(s).not.toContain('密谋败露');   // trace 不给名
    expect(s).toContain('海捕文书');
    expect(s).toContain('勿硬塞');
    expect(buildRevealInjection([], '', same)).toBe('');
  });

  it('revealAcked：事件名或表象片段命中即算承接（无视标点空白）', () => {
    const e = settled({ name: '漕帮火并' });
    expect(revealAcked('街头巷尾都在议论漕帮、火并的下场', e)).toBe(true);
    expect(revealAcked('今天天气不错', e)).toBe(false);
    const t = settled({ visibility: 'trace', name: '密谋', publicTrace: '府衙连夜贴出海捕文书' });
    expect(revealAcked('他路过府衙，见连夜贴出海捕文书，眉头一皱', t)).toBe(true);
  });

  it('planRevealReconcile：接住=deliver；没接=bump；满3次且非direct=shelve；direct 永不搁置', () => {
    const list = [
      settled({ id: 'W_1', name: '漕帮火并' }),
      settled({ id: 'W_2', name: '北岭疫报', reveal: { state: 'pending', attempts: REVEAL_MAX_ATTEMPTS - 1 } }),
    ];
    const plan = planRevealReconcile(list, '', same, '正文里聊到了漕帮火并的结局');
    expect(plan.deliver).toEqual(['W_1']);
    expect(plan.shelve).toEqual(['W_2']);   // 第 3 次仍没接住 → 搁置
    const direct = [settled({ id: 'W_9', name: '袭营', visibility: 'direct', reveal: { state: 'pending', attempts: 9 } })];
    const p2 = planRevealReconcile(direct, '', same, '无关正文');
    expect(p2.shelve).toEqual([]);
    expect(p2.bump[0]).toEqual({ id: 'W_9', attempts: 10 });   // direct 永不过期，继续候选
  });
});
