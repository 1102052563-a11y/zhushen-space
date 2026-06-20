import { describe, it, expect, afterEach } from 'vitest';
import {
  pickDeed,
  personalityBucket,
  behaviorBiasFor,
  seedFrom,
  setCorpusOverride,
  type DeedCtx,
} from './autonomyCorpus';

const baseCtx: DeedCtx = {
  name: '凌薇',
  paradise: '天启乐园',
  rating: 'A',
  realm: 'B阶·Lv.7',
  personality: '冷静谨慎',
};

afterEach(() => setCorpusOverride(null)); // 每个用例后清掉覆盖，互不污染

describe('autonomyCorpus · 选择器引擎', () => {
  it('确定性：同 event/ctx/seed 必出同一句', () => {
    const a = pickDeed('mission_return', baseCtx, 12345);
    const b = pickDeed('mission_return', baseCtx, 12345);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('填好所有槽位：不残留 {xxx} 占位符', () => {
    for (let s = 0; s < 50; s++) {
      const out = pickDeed('mission_return', baseCtx, seedFrom(s, '凌薇'));
      expect(out).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(out).toContain('凌薇');
    }
  });

  it('多样性：不同 seed 能产出不止一种结果', () => {
    const set = new Set<string>();
    for (let s = 0; s < 40; s++) set.add(pickDeed('mission_return', baseCtx, s));
    expect(set.size).toBeGreaterThan(1);
  });

  it('优雅兜底：未知事件返回空串而非报错', () => {
    expect(pickDeed('no_such_event', baseCtx, 1)).toBe('');
  });

  it('mission_death 带上 NPC 名与任务世界，且 paradise 不漏槽', () => {
    const out = pickDeed('mission_death', { name: '周岩', paradise: '天启乐园' }, 7);
    expect(out).toContain('周岩');
    expect(out).not.toMatch(/\{/);
  });

  it('rating 缺某档时回退最近档，不留空槽', () => {
    const out = pickDeed('mission_return', { ...baseCtx, rating: 'SS' }, 3);
    expect(out).not.toMatch(/（\s*级）/); // SS 在库里有，但即便回退也不该留空括号
    expect(out).not.toMatch(/\{/);
  });

  it('空槽被 tidy 清理：无悬空标点 / 连续空格', () => {
    // arena_win 缺 enemy/n，验证清理后不出现 "  " 或 " ，"
    const out = pickDeed('arena_win', { name: '凌薇' }, 9);
    expect(out).not.toMatch(/ {2,}/);
    expect(out).not.toMatch(/ [，。；）」]/);
  });
});

describe('autonomyCorpus · 性格分桶 & 行为倾向', () => {
  it('关键词命中对应原型', () => {
    expect(personalityBucket('嗜血好斗，睚眦必报')).toBe('嗜杀');
    expect(personalityBucket('稳重缜密')).toBe('谨慎');
    expect(personalityBucket('精明逐利的商人')).toBe('功利');
  });

  it('无命中回退中性', () => {
    expect(personalityBucket('温柔')).toBe('中性');
    expect(personalityBucket(undefined)).toBe('中性');
  });

  it('行为倾向：嗜杀更爱竞技、团队型更爱组队', () => {
    expect(behaviorBiasFor('嗜杀').arena).toBeGreaterThan(behaviorBiasFor('温柔').arena);
    expect(behaviorBiasFor('重情义气').team).toBeGreaterThan(behaviorBiasFor('嗜血').team);
  });
});

describe('autonomyCorpus · 只增不改的扩展', () => {
  it('setCorpusOverride 给已有事件加句式：池子变大，老句仍在', () => {
    const before = new Set<string>();
    for (let s = 0; s < 60; s++) before.add(pickDeed('rank_up', baseCtx, s));

    setCorpusOverride({ events: { rank_up: ['{name} 一举踏入 {realm}，名动一方。'] } });
    const after = new Set<string>();
    for (let s = 0; s < 60; s++) after.add(pickDeed('rank_up', baseCtx, s));

    expect(after.size).toBeGreaterThanOrEqual(before.size); // 加水不减水
    expect([...after].some((t) => t.includes('名动一方'))).toBe(true); // 新句生效
  });

  it('setCorpusOverride 可新增整个事件 key，引擎零改即认', () => {
    expect(pickDeed('marry', baseCtx, 1)).toBe(''); // 默认库没有
    setCorpusOverride({ events: { marry: ['{name} 与同伴结为道侣。'] } });
    expect(pickDeed('marry', baseCtx, 1)).toContain('凌薇');
  });
});
