import { describe, it, expect } from 'vitest';
import { parseDiary, tokenizeDiary, pushDiary, diariesOf, NPC_DIARY_CAP } from './npcDiary';

describe('parseDiary', () => {
  it('头字段+正文分离（全半角冒号）', () => {
    const r = parseDiary('日期：第7日\n天气: ☁️ 多云 / 15℃\n今天很累。\n但值得。\n纪念品：一枚弹壳——他留下的');
    expect(r.date).toBe('第7日');
    expect(r.weather).toContain('多云');
    expect(r.collection).toContain('弹壳');
    expect(r.content).toBe('今天很累。\n但值得。');
  });
  it('无头字段整段当正文', () => {
    const r = parseDiary('只有正文的一天。');
    expect(r.date).toBeUndefined();
    expect(r.content).toBe('只有正文的一天。');
  });
});

describe('tokenizeDiary', () => {
  it('三种标记切分', () => {
    const segs = tokenizeDiary('今天~~差点哭出来~~还好。██他的名字██不能写。【【绝不后悔】】');
    expect(segs.map((s) => s.type)).toEqual(['text', 'strike', 'text', 'censored', 'text', 'mark']);
    expect(segs[1].text).toBe('差点哭出来');
    expect(segs[3].text).toBe('他的名字');
    expect(segs[5].text).toBe('绝不后悔');
  });
  it('未闭合标记按纯文本', () => {
    const segs = tokenizeDiary('残缺~~未闭合');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('text');
  });
});

describe('pushDiary/diariesOf', () => {
  it('头插+cap+容忍脏extra', () => {
    let extra: Record<string, unknown> | undefined = { 情欲: 10 };
    for (let i = 0; i < 5; i++) extra = pushDiary(extra, { date: `第${i}日`, content: `d${i}`, at: i });
    const list = diariesOf(extra);
    expect(list).toHaveLength(NPC_DIARY_CAP);
    expect(list[0].content).toBe('d4');
    expect((extra as any).情欲).toBe(10);
    expect(diariesOf({ 日记: '不是数组' } as any)).toHaveLength(0);
  });
});
