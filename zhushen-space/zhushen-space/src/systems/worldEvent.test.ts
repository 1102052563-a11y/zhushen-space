import { describe, it, expect } from 'vitest';
import {
  EVENT_CAP, EVENT_FLOOR, scopeOf, isSettled, latestChain, activeEvents, byScope,
  needsMore, overflowIds, pendingDerivations, buildDerivationInjection,
  serializeEventsForEvo, buildActiveEventInjection,
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
