import { describe, it, expect } from 'vitest';
import { emptyCtx, evalUnlocks, progressOf, ratingRank, buildAchvCtx, sweepAchievements, type AchvCtx } from './achievementEngine';
import { ACHV_CATALOG } from './achievementCatalog';

const RARITIES = new Set(['D', 'C', 'B', 'A', 'S', 'SS', 'SSS']);
const CATEGORIES = new Set(['战斗', '探索', '任务', '生存', '隐藏', '其他']);

function maxedCtx(): AchvCtx {
  const c = emptyCtx();
  for (const k of Object.keys(c) as (keyof AchvCtx)[]) c[k] = 1e9;
  return c;
}

describe('成就目录·结构守卫（唯一事实源）', () => {
  it('id 全局唯一且带 cat_ 前缀', () => {
    const seen = new Set<string>();
    for (const d of ACHV_CATALOG) {
      expect(d.id.startsWith('cat_'), `${d.id} 缺 cat_ 前缀`).toBe(true);
      expect(seen.has(d.id), `${d.id} 重复`).toBe(false);
      seen.add(d.id);
    }
  });

  it('必填字段齐全、rarity/category 在白名单内、target>0', () => {
    for (const d of ACHV_CATALOG) {
      expect(d.name.trim().length, `${d.id} 缺 name`).toBeGreaterThan(0);
      expect(d.desc.trim().length, `${d.id} 缺 desc`).toBeGreaterThan(0);
      expect(d.condition.trim().length, `${d.id} 缺 condition`).toBeGreaterThan(0);
      expect(RARITIES.has(d.rarity), `${d.id} 非法 rarity=${d.rarity}`).toBe(true);
      expect(CATEGORIES.has(d.category), `${d.id} 非法 category=${d.category}`).toBe(true);
      expect(d.target, `${d.id} target 须 >0`).toBeGreaterThan(0);
    }
  });

  it('metric 对零快照求值：有限数且不为负（不抛错）', () => {
    const zero = emptyCtx();
    for (const d of ACHV_CATALOG) {
      const v = d.metric(zero);
      expect(Number.isFinite(v), `${d.id} metric 非有限数`).toBe(true);
      expect(v, `${d.id} metric 为负`).toBeGreaterThanOrEqual(0);
    }
  });

  it('名称不重复（图鉴可读性）', () => {
    const names = new Set<string>();
    for (const d of ACHV_CATALOG) {
      expect(names.has(d.name), `成就名「${d.name}」重复`).toBe(false);
      names.add(d.name);
    }
  });
});

describe('evalUnlocks·纯求值', () => {
  it('零快照不解锁任何成就', () => {
    expect(evalUnlocks(ACHV_CATALOG, emptyCtx(), new Set())).toHaveLength(0);
  });

  it('拉满快照解锁全部成就', () => {
    expect(evalUnlocks(ACHV_CATALOG, maxedCtx(), new Set())).toHaveLength(ACHV_CATALOG.length);
  });

  it('已持有 id 被过滤（幂等重授的前置）', () => {
    const owned = new Set(ACHV_CATALOG.map((d) => d.id));
    expect(evalUnlocks(ACHV_CATALOG, maxedCtx(), owned)).toHaveLength(0);
    const half = new Set(ACHV_CATALOG.slice(0, 10).map((d) => d.id));
    expect(evalUnlocks(ACHV_CATALOG, maxedCtx(), half)).toHaveLength(ACHV_CATALOG.length - 10);
  });

  it('metric 抛错/NaN 的条目被跳过，不炸整次求值', () => {
    const bad = [
      { id: 'cat_x1', name: 'x1', desc: 'x', condition: 'x', category: '其他', type: '普通', rarity: 'C', target: 1, metric: () => { throw new Error('boom'); } },
      { id: 'cat_x2', name: 'x2', desc: 'x', condition: 'x', category: '其他', type: '普通', rarity: 'C', target: 1, metric: () => NaN },
      { id: 'cat_x3', name: 'x3', desc: 'x', condition: 'x', category: '其他', type: '普通', rarity: 'C', target: 1, metric: () => 5 },
    ];
    const out = evalUnlocks(bad as any, emptyCtx(), new Set());
    expect(out.map((d) => d.id)).toEqual(['cat_x3']);
  });
});

describe('progressOf·图鉴进度', () => {
  it('cur 夹在 [0, target]，pct 在 [0,1]', () => {
    const zero = emptyCtx();
    const maxed = maxedCtx();
    for (const d of ACHV_CATALOG) {
      const p0 = progressOf(d, zero);
      expect(p0.cur).toBeGreaterThanOrEqual(0);
      expect(p0.cur).toBeLessThanOrEqual(d.target);
      expect(p0.pct).toBeGreaterThanOrEqual(0);
      const p1 = progressOf(d, maxed);
      expect(p1.cur).toBe(d.target);
      expect(p1.pct).toBe(1);
    }
  });
});

describe('ratingRank·评价档位', () => {
  it('前缀最长优先，识别不了=0', () => {
    expect(ratingRank('SSS')).toBe(9);
    expect(ratingRank('SS')).toBe(8);
    expect(ratingRank('SS-')).toBe(8);
    expect(ratingRank('S+')).toBe(7);
    expect(ratingRank('s')).toBe(7);
    expect(ratingRank('A-')).toBe(6);
    expect(ratingRank('E-')).toBe(2);
    expect(ratingRank('')).toBe(0);
    expect(ratingRank(undefined)).toBe(0);
    expect(ratingRank('优秀')).toBe(0);
  });
});

describe('store 接线·冒烟（默认空档）', () => {
  it('buildAchvCtx 不抛错且各字段为有限数', () => {
    const c = buildAchvCtx();
    for (const [k, v] of Object.entries(c)) {
      expect(Number.isFinite(v as number), `ctx.${k} 非有限数`).toBe(true);
    }
  });

  it('sweepAchievements 空档幂等：两次调用都不炸、结果一致', () => {
    const a = sweepAchievements();
    const b = sweepAchievements();
    expect(Array.isArray(a)).toBe(true);
    // 第二次不应再新解锁第一次已发的任何条目
    for (const n of b) expect(a.includes(n)).toBe(false);
  });
});
