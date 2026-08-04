import { describe, it, expect, beforeEach } from 'vitest';
import { paradiseFame, fameTierOf, isRenowned, contractorBaseline, buildFameInjection, FAME_TIERS } from './paradiseFame';
import { usePlayer, DEFAULT_PLAYER_PROFILE } from '../store/playerStore';
import { useTeam } from '../store/adventureTeamStore';
import { useWorldRecord } from '../store/worldRecordStore';
import { useAbyss } from '../store/abyssStore';
import { useGuild } from '../store/guildStore';

/* 每例前把所有来源清干净 —— 声望是纯派生，输入清零则输出必须是"无名之辈" */
beforeEach(() => {
  usePlayer.setState({ profile: { ...DEFAULT_PLAYER_PROFILE } } as never);
  useTeam.setState({ established: false, disbanded: false, rank: 'E', name: '' } as never);
  useWorldRecord.setState({ records: [] } as never);
  useAbyss.setState({ meta: { deepestFloor: 0, clearsCount: 0 } } as never);
  useGuild.setState({ my: null } as never);
});

const setProfile = (p: Record<string, unknown>) =>
  usePlayer.setState((s) => ({ profile: { ...s.profile, ...p } } as never));

describe('paradiseFame · 空状态', () => {
  it('毫无成就 → 无名之辈、零来源、不出注入块', () => {
    const r = paradiseFame();
    expect(r.tier).toBe('无名之辈');
    expect(r.score).toBe(0);
    expect(r.sources).toEqual([]);
    expect(buildFameInjection()).toEqual([]);
  });

  it('烙印起始 1 级不算成就（那是每个契约者都有的）', () => {
    setProfile({ brandLevel: '1' });
    expect(paradiseFame().sources).toEqual([]);
  });
});

describe('paradiseFame · 各来源计分', () => {
  it('竞技场：越靠前分越高；出榜(>100)不计', () => {
    setProfile({ arenaRank: '第1名' });
    const first = paradiseFame().score;
    setProfile({ arenaRank: '第100名' });
    const last = paradiseFame().score;
    expect(first).toBeGreaterThan(last);
    expect(last).toBeGreaterThan(0);
    setProfile({ arenaRank: '第350名' });
    expect(paradiseFame().sources).toEqual([]);
    setProfile({ arenaRank: '（未上榜）' });
    expect(paradiseFame().sources).toEqual([]);
  });

  it('烙印等级：≥2 才计，且封顶', () => {
    setProfile({ brandLevel: '5' });
    expect(paradiseFame().score).toBe(15);
    setProfile({ brandLevel: '99' });
    expect(paradiseFame().score).toBe(30);   // 封顶
  });

  it('深渊：层深与通关分别计、各自封顶', () => {
    useAbyss.setState({ meta: { deepestFloor: 37, clearsCount: 2 } } as never);
    const r = paradiseFame();
    expect(r.sources.some((s) => s.label.includes('第37层'))).toBe(true);
    expect(r.sources.some((s) => s.label.includes('通关2次'))).toBe(true);
    useAbyss.setState({ meta: { deepestFloor: 999, clearsCount: 99 } } as never);
    expect(paradiseFame().score).toBe(24 + 18);   // 双封顶
  });

  it('深渊未下过 → 不产生来源', () => {
    useAbyss.setState({ meta: { deepestFloor: 0, clearsCount: 0 } } as never);
    expect(paradiseFame().sources).toEqual([]);
  });

  it('冒险团：须已建团且未解散；E 阶不计分', () => {
    useTeam.setState({ established: false, rank: 'S' } as never);
    expect(paradiseFame().sources).toEqual([]);
    useTeam.setState({ established: true, disbanded: false, rank: 'E', name: '暗渊远征队' } as never);
    expect(paradiseFame().sources).toEqual([]);
    useTeam.setState({ established: true, disbanded: false, rank: 'S', name: '暗渊远征队' } as never);
    expect(paradiseFame().score).toBe(26);
    useTeam.setState({ established: true, disbanded: true, rank: 'S', name: '暗渊远征队' } as never);
    expect(paradiseFame().sources).toEqual([]);
  });

  it('公会：等级 + 要职加成', () => {
    useGuild.setState({ my: { name: '拂晓', level: 5, role: 'member' } } as never);
    const member = paradiseFame().score;
    useGuild.setState({ my: { name: '拂晓', level: 5, role: 'leader' } } as never);
    const leader = paradiseFame().score;
    expect(leader - member).toBe(8);
  });

  it('世界结算评级：只取最好的 3 次，S 以上权重明显更高', () => {
    useWorldRecord.setState({
      records: [
        { name: 'W1', summary: { 综合评价: 'SSS' } }, { name: 'W2', summary: { 综合评价: 'S' } },
        { name: 'W3', summary: { 综合评价: 'B' } }, { name: 'W4', summary: { 综合评价: 'C' } },
        { name: 'W5', summary: {} }, { name: 'W6' },
      ],
    } as never);
    const r = paradiseFame();
    expect(r.sources).toHaveLength(3);
    expect(r.score).toBe(30 + 16 + 4);   // SSS + S + B（丢掉最低的 C）
  });
});

describe('paradiseFame · 档位与用途', () => {
  it('fameTierOf 单调不降', () => {
    let prevIdx = -1;
    for (const sc of [0, 5, 8, 20, 40, 70, 110, 170, 999]) {
      const idx = FAME_TIERS.indexOf(fameTierOf(sc));
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = idx;
    }
    expect(fameTierOf(0)).toBe('无名之辈');
    expect(fameTierOf(999)).toBe('传说级契约者');
  });

  it('isRenowned 第 5 档起才算"名号传开"', () => {
    expect(isRenowned({ tier: '崭露头角', score: 0, sources: [], line: '' })).toBe(false);
    expect(isRenowned({ tier: '名号在外', score: 0, sources: [], line: '' })).toBe(true);
  });

  it('契约者初始态度基线：尊重随声望走，信任只轻微加成', () => {
    const low = contractorBaseline({ tier: '无名之辈', score: 0, sources: [], line: '' });
    const high = contractorBaseline({ tier: '传说级契约者', score: 0, sources: [], line: '' });
    expect(low).toEqual({ trust: 10, respect: 10 });
    expect(high.respect).toBeGreaterThan(high.trust);      // 认识 ≠ 信任
    expect(high.respect).toBeLessThanOrEqual(40);
    expect(high.trust).toBeLessThanOrEqual(20);
  });

  it('注入块：有成就才出；⚠ 高声望时须写明土著无感知（防破认知隔离）', () => {
    setProfile({ arenaRank: '第1名', brandLevel: '20' });
    useAbyss.setState({ meta: { deepestFloor: 90, clearsCount: 5 } } as never);
    useTeam.setState({ established: true, disbanded: false, rank: 'SSS', name: '暗渊远征队' } as never);
    const out = buildFameInjection();
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('<乐园声望>');
    expect(out[0].content).toContain('跨世界');
    expect(out[0].content).toContain('土著对此一无所知');
    expect(out[0].content).toContain('勿据此结算数值');
  });

  it('低声望时不出现"名号已传开"那句', () => {
    setProfile({ brandLevel: '2' });
    const out = buildFameInjection();
    expect(out).toHaveLength(1);
    expect(out[0].content).not.toContain('名号已传开');
  });
});
