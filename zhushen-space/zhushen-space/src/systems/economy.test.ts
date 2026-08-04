import { describe, it, expect } from 'vitest';
import {
  PHASES, COMMODITIES, normPhase, normSupply, normTrend, normCommodityKey,
  PHASE_MUL, SUPPLY_MUL, MAX_SWING, stepIndex, priceFactor,
  seedEconomy, formatEconomy, buildEconomyInjection, serializeEconomyForEvo,
  type Economy,
} from './economy';

const econ = (p: Partial<Economy> = {}): Economy => ({
  phase: '复苏', phaseNote: '', index: 100, events: [], updatedTurn: 0,
  commodities: COMMODITIES.map((key) => ({ key, supply: '平稳', trend: '→', note: '', driver: '' })),
  ...p,
});

describe('economy · 归一', () => {
  it('normPhase / normSupply / normTrend 容忍后缀，认不出有安全回落', () => {
    expect(normPhase('整体处于繁荣期')).toBe('繁荣');
    expect(normPhase('说不清')).toBe('复苏');
    expect(normSupply('粮食紧缺得很')).toBe('紧缺');
    expect(normSupply('')).toBe('平稳');
    expect(normTrend('价格上涨')).toBe('↑');
    expect(normTrend('↓')).toBe('↓');
    expect(normTrend('横盘')).toBe('→');
  });

  it('normCommodityKey 把物品分类映射到大宗三类', () => {
    expect(normCommodityKey('小麦')).toBe('粮食');
    expect(normCommodityKey('铁矿石')).toBe('矿产');
    expect(normCommodityKey('煤炭')).toBe('能源');
    expect(normCommodityKey('长剑')).toBeNull();
    expect(normCommodityKey(undefined)).toBeNull();
  });
});

describe('economy · 物价指数推进（前端算死）', () => {
  it('确定性：同输入必得同结果', () => {
    expect(stepIndex(100, '繁荣', 7)).toBe(stepIndex(100, '繁荣', 7));
  });

  it('单次涨跌不超过 ±30%（卡里的封顶）', () => {
    for (const phase of PHASES) {
      for (let t = 0; t < 40; t++) {
        const next = stepIndex(100, phase, t);
        expect(Math.abs(next - 100) / 100).toBeLessThanOrEqual(MAX_SWING + 1e-9);
      }
    }
  });

  it('方向符合相位：繁荣偏涨、萧条偏跌（统计意义）', () => {
    const avg = (phase: Parameters<typeof stepIndex>[1]) =>
      Array.from({ length: 40 }, (_, t) => stepIndex(100, phase, t)).reduce((a, b) => a + b, 0) / 40;
    expect(avg('繁荣')).toBeGreaterThan(100);
    expect(avg('萧条')).toBeLessThan(100);
  });

  it('长期迭代不跑飞（夹在 20~500）', () => {
    let v = 100;
    for (let t = 0; t < 300; t++) v = stepIndex(v, '繁荣', t);
    expect(v).toBeLessThanOrEqual(500);
    let d = 100;
    for (let t = 0; t < 300; t++) d = stepIndex(d, '萧条', t);
    expect(d).toBeGreaterThanOrEqual(20);
  });
});

describe('economy · 物价系数（⚠ 与既有公允价相乘，不替换）', () => {
  it('无经济数据 → 系数 1（不影响既有定价）', () => {
    expect(priceFactor(null)).toBe(1);
    expect(priceFactor(undefined, '长剑')).toBe(1);
  });

  it('相位影响整体：繁荣 > 复苏 > 衰退 > 萧条', () => {
    const f = (p: Economy['phase']) => priceFactor(econ({ phase: p }));
    expect(f('繁荣')).toBeGreaterThan(f('复苏'));
    expect(f('复苏')).toBeGreaterThan(f('衰退'));
    expect(f('衰退')).toBeGreaterThan(f('萧条'));
    expect(PHASE_MUL.繁荣).toBeGreaterThan(PHASE_MUL.萧条);
  });

  it('命中大宗品类才叠供需乘数；不命中的物品只受相位影响', () => {
    const e = econ({
      commodities: [
        { key: '粮食', supply: '紧缺', trend: '↑', note: '', driver: '' },
        { key: '矿产', supply: '过剩', trend: '↓', note: '', driver: '' },
        { key: '能源', supply: '平稳', trend: '→', note: '', driver: '' },
      ],
    });
    expect(priceFactor(e, '小麦')).toBeGreaterThan(priceFactor(e, '长剑'));
    expect(priceFactor(e, '铁矿石')).toBeLessThan(priceFactor(e, '长剑'));
    expect(SUPPLY_MUL.紧缺).toBeGreaterThan(SUPPLY_MUL.过剩);
  });

  it('系数夹在 [0.6, 1.8]——再极端的行情也不该让装备贵到离谱', () => {
    const wild = econ({ phase: '繁荣', index: 500, commodities: [{ key: '粮食', supply: '紧缺', trend: '↑', note: '', driver: '' }] });
    expect(priceFactor(wild, '小麦')).toBeLessThanOrEqual(1.8);
    const crash = econ({ phase: '萧条', index: 20, commodities: [{ key: '矿产', supply: '过剩', trend: '↓', note: '', driver: '' }] });
    expect(priceFactor(crash, '铁矿')).toBeGreaterThanOrEqual(0.6);
  });
});

describe('economy · 播种（进世界·零 API）', () => {
  it('从世界描述扫关键词定相位', () => {
    expect(seedEconomy({ worldName: 'W', desc: '连年战乱，饥荒遍地' }).phase).toBe('萧条');
    expect(seedEconomy({ worldName: 'W', desc: '商贸发达，一派盛世' }).phase).toBe('繁荣');
  });

  it('无关键词 → 确定性摇一个温和相位（同世界名必得同结果）', () => {
    const a = seedEconomy({ worldName: '丧尸围城', desc: '一座普通的沿海城市' });
    const b = seedEconomy({ worldName: '丧尸围城', desc: '一座普通的沿海城市' });
    expect(a.phase).toBe(b.phase);
    expect(['复苏', '衰退']).toContain(a.phase);
  });

  it('播种出三类大宗、指数从 100 起，且带世界名（world 作用域）', () => {
    const e = seedEconomy({ worldName: '永夜监狱', turn: 5 });
    expect(e.commodities.map((c) => c.key)).toEqual([...COMMODITIES]);
    expect(e.index).toBe(100);
    expect(e.worldName).toBe('永夜监狱');
    expect(e.updatedTurn).toBe(5);
    expect(e.events).toEqual([]);
  });

  it('萧条世界的初始行情是紧缺+上涨（战乱物价飞涨）', () => {
    const e = seedEconomy({ worldName: 'W', desc: '废土，末日后的世界' });
    expect(e.commodities.every((c) => c.supply === '紧缺' && c.trend === '↑')).toBe(true);
  });
});

describe('economy · 序列化', () => {
  it('formatEconomy 含相位/指数/大宗；有事件才列事件', () => {
    const s = formatEconomy(econ({ phase: '衰退', index: 92 }));
    expect(s).toContain('衰退');
    expect(s).toContain('92');
    expect(s).toContain('粮食');
    expect(s).not.toContain('经济事件');
    expect(formatEconomy(econ({ events: [{ name: '港口封锁', desc: '', stage: '推进中' }] }))).toContain('港口封锁[推进中]');
  });

  it('注入块写明"勿据此另行结算数值"；无数据不出块', () => {
    expect(buildEconomyInjection(null)).toEqual([]);
    const out = buildEconomyInjection(econ());
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('<本世界经济>');
    expect(out[0].content).toContain('勿据此另行结算数值');
  });

  it('演化序列化说明"指数由前端推进"，防 AI 自己编数字', () => {
    expect(serializeEconomyForEvo(econ())).toContain('由前端按公式推进');
    expect(serializeEconomyForEvo(null)).toContain('尚未建立');
  });
});
