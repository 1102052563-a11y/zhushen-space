import { describe, it, expect } from 'vitest';
import {
  TIER_CAP, usesTieredMemory, toTiered, fromTiered, weightOf, planDecay, applyDecay,
  reinterpretDirection, REINTERPRET_THRESHOLD, buildMemoryInjection, serializeTiersForEvo,
  type TieredMemory,
} from './memoryTiers';
import type { MemoryEntry } from '../store/characterStore';

const e = (content: string, time = ''): MemoryEntry => ({ time, location: '', content });
const many = (n: number, prefix = 'm') => Array.from({ length: n }, (_, i) => e(`${prefix}${i}`));
const T = (p: Partial<TieredMemory> = {}): TieredMemory => ({ recent: [], settled: [], core: [], ...p });

describe('memoryTiers · 适用范围（轮回乐园特化）', () => {
  it('只有 paradise 作用域的 NPC 维护三层；土著不配额', () => {
    expect(usesTieredMemory('契约者')).toBe(true);
    expect(usesTieredMemory('随从')).toBe(true);
    expect(usesTieredMemory('宠物')).toBe(true);
    expect(usesTieredMemory('土著')).toBe(false);
    expect(usesTieredMemory(undefined)).toBe(false);
  });
});

describe('memoryTiers · 结构互转（老档兼容）', () => {
  it('两层 → 三层：老档无 core 得空数组', () => {
    expect(toTiered({ shortTerm: [e('a')], longTerm: [e('b')] })).toEqual({ recent: [e('a')], settled: [e('b')], core: [] });
    expect(toTiered(undefined)).toEqual({ recent: [], settled: [], core: [] });
  });

  it('三层 → 两层+core：往返一致', () => {
    const t = T({ recent: [e('a')], settled: [e('b')], core: [e('c')] });
    const back = fromTiered(t);
    expect(back).toEqual({ shortTerm: [e('a')], longTerm: [e('b')], core: [e('c')] });
    expect(toTiered(back)).toEqual(t);
  });
});

describe('memoryTiers · 衰退规划', () => {
  it('各层都没满 → 无动作', () => {
    const p = planDecay(T({ recent: many(3), settled: many(2, 's') }));
    expect(p.dirty).toBe(false);
    expect(p.toSettle).toEqual([]);
  });

  it('近期超额 → 最旧的进待压缩（不是最新的）', () => {
    const p = planDecay(T({ recent: many(TIER_CAP.recent + 2) }));
    expect(p.toSettle).toHaveLength(2);
    expect(p.toSettle[0].content).toBe('m0');   // 最旧
    expect(p.dirty).toBe(true);
  });

  it('沉淀超额：重要的升核心、最轻的被丢弃', () => {
    const settled = [...many(TIER_CAP.settled, 's'), e('他为我挡下那一刀，重伤垂死')];
    const p = planDecay(T({ settled }));
    expect(p.toCore.some((x) => x.content.includes('重伤'))).toBe(true);
    expect(p.toDrop.length + p.toCore.length).toBe(1);   // 只超 1 条
  });

  it('核心已满 → 超额的沉淀只能被丢弃，不再升核心', () => {
    const p = planDecay(T({
      settled: [...many(TIER_CAP.settled, 's'), e('生死托付的遗言')],
      core: many(TIER_CAP.core, 'c'),
    }));
    expect(p.toCore).toEqual([]);
    expect(p.toDrop).toHaveLength(1);
  });

  it('weightOf：核心情节词权重远高于长度', () => {
    expect(weightOf(e('他背叛了我'))).toBeGreaterThan(weightOf(e('今天'.repeat(30))));
  });
});

describe('memoryTiers · 衰退执行', () => {
  it('搬运后各层数量正确、内容不丢', () => {
    const t = T({ recent: many(TIER_CAP.recent + 2), settled: [], core: [] });
    const p = planDecay(t);
    const next = applyDecay(t, p);
    expect(next.recent).toHaveLength(TIER_CAP.recent);
    expect(next.settled).toHaveLength(2);
    expect(next.recent.some((x) => x.content === 'm0')).toBe(false);   // 已挪走
    expect(next.settled.some((x) => x.content === 'm0')).toBe(true);
  });

  it('无变动时返回原对象（省一次 set）', () => {
    const t = T({ recent: many(2) });
    expect(applyDecay(t, planDecay(t))).toBe(t);
  });

  it('核心层不超过上限', () => {
    const t = T({ settled: [...many(TIER_CAP.settled, 's'), e('生死关头的托付')], core: many(TIER_CAP.core - 1, 'c') });
    const next = applyDecay(t, planDecay(t));
    expect(next.core.length).toBeLessThanOrEqual(TIER_CAP.core);
  });
});

describe('memoryTiers · 关系变化触发重解读', () => {
  it('信任+尊重净增达阈值 → warm（旧负面记忆该被善意重解）', () => {
    expect(reinterpretDirection({ trust: REINTERPRET_THRESHOLD })).toBe('warm');
    expect(reinterpretDirection({ trust: 8, respect: 8 })).toBe('warm');
  });

  it('净减达阈值 → cold（旧正面记忆该被扭曲）', () => {
    expect(reinterpretDirection({ trust: -20 })).toBe('cold');
  });

  it('小幅波动不触发（避免每回合都重写记忆）', () => {
    expect(reinterpretDirection({ trust: 5, respect: -2 })).toBeNull();
    expect(reinterpretDirection({})).toBeNull();
  });

  it('情欲/沉沦不参与判定（那是另一条轴，不改事实解读）', () => {
    expect(reinterpretDirection({ lust: 50, corruption: 50 })).toBeNull();
  });
});

describe('memoryTiers · 序列化', () => {
  it('⚠ 注入只给核心 + 最近 3 条（沉淀层是此前的浪费大头）', () => {
    const t = T({ recent: many(8), settled: many(8, 's'), core: [e('核心一')] });
    const s = buildMemoryInjection(t, '凌薇');
    expect(s).toContain('凌薇');
    expect(s).toContain('核心一');
    expect(s).toContain('m7');
    expect(s).toContain('m5');
    expect(s).not.toContain('m4');   // 只 3 条
    expect(s).not.toContain('s0');   // 沉淀层不注入
  });

  it('全空 → 不出内容', () => {
    expect(buildMemoryInjection(T(), '凌薇')).toBe('');
  });

  it('演化序列化带层级计数与待处理标记', () => {
    const t = T({ recent: many(TIER_CAP.recent + 1), core: [] });
    const s = serializeTiersForEvo(t, planDecay(t));
    expect(s).toContain('【近期记忆】');
    expect(s).toContain('【核心记忆】(0/5)');
    expect(s).toContain('待处理');
    expect(s).toContain('需压缩后移入沉淀');
  });

  it('无需衰退时明说，避免 AI 无事生非', () => {
    const t = T({ recent: many(2) });
    expect(serializeTiersForEvo(t, planDecay(t))).toContain('无需衰退');
  });
});
