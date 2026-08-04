import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_TEMPLATES, buildBuiltinTemplates, pickTemplates, buildTheaterStyleBlock, type TheaterTemplate,
} from './theaterTemplates';
import { useTheater } from '../store/theaterStore';

const t = (id: string, enabled = true): TheaterTemplate => ({ id, name: `花样${id}`, prompt: `写法${id}`, enabled, builtin: false });

/* 确定性 rand：依次返回给定序列（超出后回 0），让抽取结果可断言 */
const seqRand = (...vals: number[]) => { let i = 0; return () => (i < vals.length ? vals[i++] : 0); };

describe('pickTemplates（抽花样）', () => {
  it('只从启用的里抽', () => {
    const list = [t('a'), t('b', false), t('c', false)];
    expect(pickTemplates(list, 1, seqRand(0.9)).map((x) => x.id)).toEqual(['a']);
    expect(pickTemplates(list, 3).every((x) => x.enabled)).toBe(true);
  });

  it('抽出来不重复', () => {
    const list = [t('a'), t('b'), t('c')];
    const got = pickTemplates(list, 3, seqRand(0, 0, 0));
    expect(new Set(got.map((x) => x.id)).size).toBe(3);
  });

  it('count 超过可用数量时按池子大小夹取', () => {
    expect(pickTemplates([t('a'), t('b')], 9)).toHaveLength(2);
    expect(pickTemplates([t('a')], 0)).toHaveLength(1);   // 至少 1 条
  });

  it('★兜底：全禁用 / 空 / undefined → 回退内置全集，绝不返回空（否则注入块塌成空指令）', () => {
    expect(pickTemplates([t('a', false), t('b', false)], 2)).toHaveLength(2);
    expect(pickTemplates([], 2)).toHaveLength(2);
    expect(pickTemplates(undefined, 2)).toHaveLength(2);
    expect(pickTemplates([], 1, seqRand(0))[0].builtin).toBe(true);
  });

  it('无名条目视为无效（不会抽出一条空花样）', () => {
    const bad = [{ ...t('x'), name: '   ' }];
    const got = pickTemplates(bad, 1, seqRand(0));
    expect(got[0].name.trim()).not.toBe('');
    expect(got[0].builtin).toBe(true);   // 回退到了内置
  });
});

describe('buildTheaterStyleBlock（注入块）', () => {
  it('列出花样并声明优先于上面的风格清单', () => {
    const s = buildTheaterStyleBlock([t('a'), t('b')]);
    expect(s).toContain('本次小剧场·花样');
    expect(s).toContain('优先于上面任何风格清单');
    expect(s).toContain('【花样a】写法a');
    expect(s).toContain('【花样b】写法b');
    expect(s).toContain('两种花样可任选其一');
  });
  it('只有一条时不出「两种花样」那句', () => {
    expect(buildTheaterStyleBlock([t('a')])).not.toContain('两种花样');
  });
  it('空数组 → 空串（调用方跳过，不塞空块）', () => {
    expect(buildTheaterStyleBlock([])).toBe('');
  });
});

describe('theaterStore', () => {
  beforeEach(() => { useTheater.setState({ templates: [], seeded: false, pickCount: 2 }); });

  it('ensureSeeded 幂等：只种一次，玩家删掉的内置不会自己复活', () => {
    const T = useTheater.getState();
    T.ensureSeeded();
    expect(useTheater.getState().templates).toHaveLength(BUILTIN_TEMPLATES.length);
    useTheater.getState().remove(useTheater.getState().templates[0].id);
    const n = useTheater.getState().templates.length;
    useTheater.getState().ensureSeeded();
    expect(useTheater.getState().templates).toHaveLength(n);   // 没被重新种回来
  });

  it('restoreBuiltins 按 id 补缺，不动玩家自建的、不重复已有的', () => {
    const T = useTheater.getState();
    T.ensureSeeded();
    T.upsert({ name: '便利店打工', prompt: '写夜班' });
    const before = useTheater.getState().templates.length;
    useTheater.getState().remove(useTheater.getState().templates.find((x) => x.builtin)!.id);
    expect(useTheater.getState().restoreBuiltins()).toBe(1);
    const after = useTheater.getState().templates;
    expect(after).toHaveLength(before);
    expect(after.some((x) => x.name === '便利店打工')).toBe(true);
    expect(useTheater.getState().restoreBuiltins()).toBe(0);   // 都在了 → 补 0 条
  });

  it('upsert：新增 / 按 id 改；空名忽略；名字与提示词各自截断', () => {
    const T = useTheater.getState();
    T.upsert({ name: '  ' });
    expect(useTheater.getState().templates).toHaveLength(0);
    T.upsert({ name: '甲', prompt: 'p' });
    const id = useTheater.getState().templates[0].id;
    useTheater.getState().upsert({ name: '甲改', prompt: 'p2' }, id);
    expect(useTheater.getState().templates).toHaveLength(1);
    expect(useTheater.getState().templates[0]).toMatchObject({ name: '甲改', prompt: 'p2', builtin: false });
    useTheater.getState().upsert({ name: 'x'.repeat(50), prompt: 'y'.repeat(400) });
    const long = useTheater.getState().templates[1];
    expect(long.name).toHaveLength(20);
    expect(long.prompt).toHaveLength(300);
  });

  it('toggle / setAllEnabled / setPickCount 夹取到 1~3', () => {
    const T = useTheater.getState();
    T.ensureSeeded();
    const id = useTheater.getState().templates[0].id;
    useTheater.getState().toggle(id);
    expect(useTheater.getState().templates[0].enabled).toBe(false);
    useTheater.getState().setAllEnabled(true);
    expect(useTheater.getState().templates.every((x) => x.enabled)).toBe(true);
    useTheater.getState().setPickCount(9);
    expect(useTheater.getState().pickCount).toBe(3);
    useTheater.getState().setPickCount(0);
    expect(useTheater.getState().pickCount).toBe(1);
  });

  it('内置模板 id 唯一、每条都有写法指导（不是只有名字）', () => {
    expect(new Set(BUILTIN_TEMPLATES.map((x) => x.id)).size).toBe(BUILTIN_TEMPLATES.length);
    expect(BUILTIN_TEMPLATES.every((x) => x.prompt.trim().length >= 10)).toBe(true);
    expect(buildBuiltinTemplates().every((x) => x.enabled && x.builtin)).toBe(true);
  });
});
