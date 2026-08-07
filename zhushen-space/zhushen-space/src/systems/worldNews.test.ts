import { describe, it, expect } from 'vitest';
import { buildNewsCandidates, serializeNewsCandidates, parseNewsReply, newsStale, type NewsCandidate } from './worldNews';
import type { WorldEvent } from '../store/miscStore';
import type { Rumor } from './rumor';

const same = (a?: string, b?: string) => (a ?? '') === (b ?? '');

function ev(p: Partial<WorldEvent> = {}): WorldEvent {
  return { id: 'W_1', time: '3年5月1日', location: '城南', desc: '初始描述', ...p };
}
function ru(p: Partial<Rumor> = {}): Rumor {
  return {
    id: 'R_1', name: '灰袍人传说', impact: '街谈巷议' as Rumor['impact'], scope: '全城', createdAt: 1,
    nodes: [{ seq: 1, date: 'd', expire: '', turn: 1, truth: '其实是主角', told: '城里出了个灰袍侠客', drift: '身份错认', cause: '目击' }],
    ...p,
  };
}

describe('worldNews · 候选构造（可见性门）', () => {
  it('hidden 连候选都进不来；trace 只给表象不给名；known/direct 给最新脉络；已落幕也算', () => {
    const cands = buildNewsCandidates([
      ev({ id: 'W_1', name: '刺杀计划', visibility: 'hidden', desc: '幕后' }),
      ev({ id: 'W_2', name: '布防调整', visibility: 'trace', publicTrace: '卫兵换岗加倍', desc: '实为刺杀布置' }),
      ev({ id: 'W_3', name: '秋收庆典', chain: [{ date: 'd', text: '庆典进入第三日' }] }),
      ev({ id: 'W_4', name: '漕帮火并', settledAt: 9, chain: [{ date: 'd', text: '【落幕】北堂覆灭' }] }),
    ], [], '', same);
    const ids = cands.map((c) => c.refId);
    expect(ids).not.toContain('W_1');
    expect(ids).toEqual(expect.arrayContaining(['W_2', 'W_3', 'W_4']));
    const trace = cands.find((c) => c.refId === 'W_2')!;
    expect(trace.kind).toBe('trace');
    expect(trace.title).toBe('');
    expect(trace.text).toBe('卫兵换岗加倍');
    expect(cands.find((c) => c.refId === 'W_3')!.text).toBe('庆典进入第三日');
    const s = serializeNewsCandidates(cands);
    expect(s).not.toContain('刺杀计划');
    expect(s).not.toContain('实为刺杀布置');   // trace 的内情描述绝不进候选
    expect(s).toContain('只能进论坛猜测');
  });

  it('传闻只给「流传」版本，真相/偏差绝不进候选；按世界过滤', () => {
    const cands = buildNewsCandidates([], [ru(), ru({ id: 'R_2', worldName: '别的世界' })], '', same);
    expect(cands).toHaveLength(1);
    expect(cands[0].text).toBe('城里出了个灰袍侠客');
    expect(serializeNewsCandidates(cands)).not.toContain('其实是主角');
    expect(serializeNewsCandidates(cands)).not.toContain('身份错认');
  });
});

describe('worldNews · 回复解析与夹取', () => {
  const cands: NewsCandidate[] = [
    { refId: 'W_2', kind: 'trace', title: '', text: '卫兵换岗加倍' },
    { refId: 'W_3', kind: 'event', title: '秋收庆典', text: '庆典进入第三日' },
  ];

  it('正常 JSON：news/forums 都收，字段归一', () => {
    const items = parseNewsReply(`{"news":[{"title":"庆典盛况","body":"全城同庆","outlet":"王都日报","source_type":"official","claim":"fact","heat":"全城","ref":"W_3"}],
      "forums":[{"title":"换岗怎么回事","body":"有人知道吗","outlet":"茶馆","claim":"rumor","replies":["肯定出事了","别瞎猜"]}]}`, cands);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'news', sourceType: 'official', claim: 'fact', title: '庆典盛况' });
    expect(items[1]).toMatchObject({ kind: 'forum', sourceType: 'unofficial', claim: 'rumor' });
    expect(items[1].replies).toEqual(['肯定出事了', '别瞎猜']);
  });

  it('trace 硬夹：ref 指向表象候选的"新闻"降级为论坛+unofficial，fact 降 mixed', () => {
    const items = parseNewsReply('{"news":[{"title":"卫兵异动真相","body":"官方证实要出大事","source_type":"official","claim":"fact","ref":"W_2"}],"forums":[]}', cands);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('forum');
    expect(items[0].sourceType).toBe('unofficial');
    expect(items[0].claim).toBe('mixed');
  });

  it('垃圾输入 → 空数组；空壳条目被裁；超额截断', () => {
    expect(parseNewsReply('不是JSON', cands)).toEqual([]);
    expect(parseNewsReply('{"news":[{"title":"","body":""}],"forums":[]}', cands)).toEqual([]);
    const many = JSON.stringify({ news: Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: 'b' })), forums: [] });
    expect(parseNewsReply(many, cands).length).toBeLessThanOrEqual(4);
  });
});

describe('worldNews · 过期提示', () => {
  it('走了 ≥6 回合才提示', () => {
    expect(newsStale(10, 15)).toBe(false);
    expect(newsStale(10, 16)).toBe(true);
  });
});
