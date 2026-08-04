import { describe, it, expect } from 'vitest';
import {
  REPUTE_LEVELS, DEFAULT_LEVEL, defaultRepute, levelName, normLevel, normDim,
  normVisibility, canAffectRepute, applyRepute, MAX_DIMS_PER_ACT,
  dimForObserver, reputeSeenBy, checkCombos, formatRepute, buildReputeInjection, summarizeRepute,
} from './reputation';

const R = () => defaultRepute();

describe('reputation · 基础原语', () => {
  it('默认是「默默无闻」而不是最低档（刚到一个世界是无名，不是天怒人怨）', () => {
    expect(levelName(DEFAULT_LEVEL)).toBe('默默无闻');
    expect(defaultRepute()).toEqual({ official: 2, folk: 2, shadow: 2, trade: 2 });
  });

  it('levelName 夹取越界', () => {
    expect(levelName(-5)).toBe(REPUTE_LEVELS[0]);
    expect(levelName(99)).toBe(REPUTE_LEVELS[5]);
  });

  it('normLevel 认档名/数字，认不出返回 null（=不改）', () => {
    expect(normLevel('受人尊敬')).toBe(4);
    expect(normLevel('声誉：万众敬仰（本地）')).toBe(5);
    expect(normLevel('3')).toBe(3);
    expect(normLevel('人见人爱')).toBeNull();
    expect(normLevel('')).toBeNull();
  });

  it('normDim 中英都认', () => {
    expect(normDim('官方评价')).toBe('official');
    expect(normDim('民间')).toBe('folk');
    expect(normDim('暗域地位')).toBe('shadow');
    expect(normDim('地下')).toBe('shadow');
    expect(normDim('业界')).toBe('trade');
    expect(normDim('trade')).toBe('trade');
    expect(normDim('玄学')).toBeNull();
  });
});

describe('reputation · 可见性闸门（核心护栏）', () => {
  it('normVisibility 分类；认不出一律 unknown（拦）', () => {
    expect(normVisibility('当众斩杀，围观者甚多')).toBe('witnessed');
    expect(normVisibility('留下了带血的令牌作物证')).toBe('evidence');
    expect(normVisibility('已在城中传开')).toBe('rumored');
    expect(normVisibility('暗中进行，无人知晓')).toBe('secret');
    expect(normVisibility('随便写点什么')).toBe('unknown');
    expect(normVisibility(undefined)).toBe('unknown');
  });

  it('canAffectRepute：只有可见的三类算数', () => {
    expect(canAffectRepute('witnessed')).toBe(true);
    expect(canAffectRepute('evidence')).toBe(true);
    expect(canAffectRepute('rumored')).toBe(true);
    expect(canAffectRepute('secret')).toBe(false);
    expect(canAffectRepute('unknown')).toBe(false);
  });

  it('⚠ 无人知晓的行为整批拒绝（只影响个人恩怨，不动公共声誉）', () => {
    const r = applyRepute(R(), [{ dim: 'folk', delta: 2 }], { visibility: 'secret' });
    expect(r.applied).toEqual([]);
    expect(r.next).toEqual(defaultRepute());
    expect(r.rejected[0].reason).toContain('无人知晓');
  });

  it('⚠ 说不清来源（unknown）同样拦——这是给 AI 留的默认拒绝', () => {
    expect(applyRepute(R(), [{ dim: 'folk', delta: 1 }], { visibility: 'unknown' }).applied).toEqual([]);
  });
});

describe('reputation · 变动护栏', () => {
  it('单次最多影响 3 个维度，超出的按绝对值裁掉最小的', () => {
    const r = applyRepute(R(), [
      { dim: 'folk', delta: 3 }, { dim: 'official', delta: -2 },
      { dim: 'shadow', delta: 2 }, { dim: 'trade', delta: 1 },
    ], { visibility: 'witnessed' });
    expect(r.applied).toHaveLength(MAX_DIMS_PER_ACT);
    expect(r.applied.some((c) => c.dim === 'trade')).toBe(false);   // 最小的被裁
    expect(r.rejected.some((x) => x.dim === 'trade')).toBe(true);
  });

  it('非崩塌事件：一次只动一档（哪怕 AI 写 +5）', () => {
    const r = applyRepute(R(), [{ dim: 'folk', delta: 5 }], { visibility: 'witnessed' });
    expect(r.next.folk).toBe(DEFAULT_LEVEL + 1);
  });

  it('崩塌事件（背叛/被揭穿）允许跨级暴跌', () => {
    const r = applyRepute({ ...R(), official: 5 }, [{ dim: 'official', delta: -4 }], { visibility: 'witnessed', collapse: true });
    expect(r.next.official).toBe(1);
  });

  it('已在上/下限时不再变动并记录理由', () => {
    const top = applyRepute({ ...R(), folk: 5 }, [{ dim: 'folk', delta: 1 }], { visibility: 'witnessed' });
    expect(top.applied).toEqual([]);
    expect(top.rejected[0].reason).toContain('上/下限');
    const bottom = applyRepute({ ...R(), folk: 0 }, [{ dim: 'folk', delta: -1 }], { visibility: 'witnessed' });
    expect(bottom.next.folk).toBe(0);
  });

  it('delta=0 的条目直接忽略', () => {
    const r = applyRepute(R(), [{ dim: 'folk', delta: 0 }], { visibility: 'witnessed' });
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('维度互不冲销：动民间不影响官方', () => {
    const r = applyRepute(R(), [{ dim: 'folk', delta: 1 }], { visibility: 'rumored' });
    expect(r.next.folk).toBe(3);
    expect(r.next.official).toBe(DEFAULT_LEVEL);
  });
});

describe('reputation · 观察者视角', () => {
  it('按身份读对应维度，认不出默认看民间', () => {
    expect(dimForObserver('城主府捕头')).toBe('official');
    expect(dimForObserver('黑市掮客')).toBe('shadow');
    expect(dimForObserver('铁匠铺掌柜')).toBe('trade');
    expect(dimForObserver('街边卖菜的')).toBe('folk');
    expect(dimForObserver(undefined)).toBe('folk');
  });

  it('同一份声誉，不同人看到不同档', () => {
    const rep = { official: 0, folk: 5, shadow: 2, trade: 2 };
    expect(reputeSeenBy(rep, '捕头').name).toBe('天怒人怨');
    expect(reputeSeenBy(rep, '农夫').name).toBe('万众敬仰');
  });
});

describe('reputation · 复合效应与序列化', () => {
  it('官民双高 → 庙堂之高；官暗双高 → 双面身份', () => {
    expect(checkCombos({ official: 4, folk: 4, shadow: 2, trade: 2 }).some((c) => c.key === 'court')).toBe(true);
    expect(checkCombos({ official: 5, folk: 2, shadow: 5, trade: 2 }).some((c) => c.key === 'twoface')).toBe(true);
  });

  it('任一维度触底 → 该圈子通缉', () => {
    const c = checkCombos({ official: 0, folk: 2, shadow: 2, trade: 2 });
    expect(c.some((x) => x.key === 'hunted-official')).toBe(true);
  });

  it('全默认档 → 无复合效应、不出注入块（省预算）', () => {
    expect(checkCombos(defaultRepute())).toEqual([]);
    expect(buildReputeInjection(defaultRepute(), '丧尸围城')).toEqual([]);
  });

  it('动过就出块，且写明"社会评价≠私人好感"', () => {
    const out = buildReputeInjection({ ...R(), folk: 5 }, '丧尸围城');
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('丧尸围城');
    expect(out[0].content).toContain('民间口碑:万众敬仰');
    expect(out[0].content).toContain('不等于某个人对主角的私人好感');
  });

  it('formatRepute / summarizeRepute', () => {
    expect(formatRepute(defaultRepute())).toContain('官方评价:默默无闻');
    expect(summarizeRepute(defaultRepute())).toContain('未在此世留下名声');
    expect(summarizeRepute({ ...R(), shadow: 5 })).toBe('暗域地位万众敬仰');
  });
});
