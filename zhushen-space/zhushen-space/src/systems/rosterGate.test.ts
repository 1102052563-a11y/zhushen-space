import { describe, it, expect } from 'vitest';
import { extractFirstJsonBlock, parseRosterGateReply, localNameScan, buildRosterGateMessages, type RosterGateItem } from './rosterGate';

const roster: RosterGateItem[] = [
  { id: 'C1', name: '蕾姆', hint: '土著·女仆' },
  { id: 'C2', name: '韩立' },
  { id: 'C7', name: '灰袍老者' },
];

describe('extractFirstJsonBlock', () => {
  it('剥 think/代码围栏后抠出第一个平衡 JSON 块', () => {
    const reply = '<think>想一想谁变了</think>\n```json\n{"selected":["蕾姆"]}\n```\n以上。';
    expect(extractFirstJsonBlock(reply)).toBe('{"selected":["蕾姆"]}');
  });
  it('嵌套结构取到配对闭合为止', () => {
    expect(extractFirstJsonBlock('前缀 {"a":{"b":[1,2]},"c":"x"} 尾巴')).toBe('{"a":{"b":[1,2]},"c":"x"}');
  });
  it('没有 JSON 返回空串', () => {
    expect(extractFirstJsonBlock('本轮没有人需要更新')).toBe('');
  });
  it('未闭合（被截断）时原样返回剩余部分交给宽松解析', () => {
    expect(extractFirstJsonBlock('{"selected":["蕾姆"')).toBe('{"selected":["蕾姆"');
  });
});

describe('parseRosterGateReply', () => {
  it('标准 {"selected":[...]} 按名字求交出 id', () => {
    const r = parseRosterGateReply('{"selected":["蕾姆","韩立"]}', roster)!;
    expect([...r.selected].sort()).toEqual(['C1', 'C2']);
    expect(r.rawNames).toEqual(['蕾姆', '韩立']);
  });
  it('空数组是合法结果（本轮没人变化）', () => {
    const r = parseRosterGateReply('{"selected":[]}', roster)!;
    expect(r.selected.size).toBe(0);
  });
  it('名单外的名字被忽略但保留在 rawNames 供审计', () => {
    const r = parseRosterGateReply('{"selected":["蕾姆","不存在的人"]}', roster)!;
    expect([...r.selected]).toEqual(['C1']);
    expect(r.rawNames).toContain('不存在的人');
  });
  it('名字归一化匹配（空白/间隔号差异不掉链）+ 也认 id', () => {
    const r = parseRosterGateReply('{"selected":["灰袍·老者","C2"]}', roster)!;
    expect([...r.selected].sort()).toEqual(['C2', 'C7']);
  });
  it('兼容 characters 键 / 对象元素 / 裸数组', () => {
    expect([...parseRosterGateReply('{"characters":[{"name":"韩立"}]}', roster)!.selected]).toEqual(['C2']);
    expect([...parseRosterGateReply('["蕾姆"]', roster)!.selected]).toEqual(['C1']);
  });
  it('宽松解析：裸键/单引号/尾逗号', () => {
    expect([...parseRosterGateReply("{selected:['韩立',]}", roster)!.selected]).toEqual(['C2']);
  });
  it('整体解析不出 JSON → null（调用方 fail-open）', () => {
    expect(parseRosterGateReply('抱歉我无法完成这个任务', roster)).toBeNull();
  });
});

describe('localNameScan', () => {
  it('名字出现在正文（归一化子串）即入选', () => {
    const s = localNameScan(roster, '韩立掀开帘子走了进来，蕾 姆连忙起身行礼。');
    expect([...s].sort()).toEqual(['C1', 'C2']);
  });
  it('未点名的不入选（抓不到沉默目击者是已知取舍）', () => {
    expect(localNameScan(roster, '房间里一片寂静。').size).toBe(0);
  });
});

describe('buildRosterGateMessages', () => {
  it('system 含判定标准与输出契约；user 含名单块与正文块', () => {
    const msgs = buildRosterGateMessages('【任务】判定谁变了。', roster, '正文若干。');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('【任务】判定谁变了。');
    expect(msgs[0].content).toContain('{"selected":');
    expect(msgs[1].content).toContain('C1｜蕾姆（土著·女仆）');
    expect(msgs[1].content).toContain('<本回合正文>');
  });
});
