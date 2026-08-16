import { describe, it, expect } from 'vitest';
import { parseRefineReply, serializeForRefine } from './npcRefine';
import type { NpcRecord } from '../store/npcStore';

const npc = {
  id: 'C1', name: '蕾姆', gender: '女', npcTag: '土著', profession: '女仆',
  relations: 'B1:主仆',
  deedLog: [
    { time: '第3日', location: '宅邸', description: '为主角整理书房', addedAt: 1 },
    { time: '第3日', location: '宅邸', description: '整理书房时打碎花瓶被安慰', addedAt: 2 },
    { time: '', location: '', description: '偷偷学做主角家乡的菜', addedAt: 3 },
  ],
} as unknown as NpcRecord;

describe('parseRefineReply', () => {
  it('正常整理结果：解析出 deeds+relations 并记前后条数', () => {
    const reply = '```json\n{"deeds":[{"time":"第3日","location":"宅邸","description":"蕾姆为主角整理书房时打碎花瓶，被主角安慰"},{"time":"","location":"","description":"蕾姆偷偷学做主角家乡的菜"}],"relations":"B1:主仆·信任渐深"}\n```';
    const o = parseRefineReply(reply, npc);
    expect(o.beforeDeeds).toBe(3);
    expect(o.afterDeeds).toBe(2);
    expect(o.deeds[0].description).toContain('打碎花瓶');
    expect(o.relations).toBe('B1:主仆·信任渐深');
  });
  it('防清档：原有经历非空而结果为空 → 抛错', () => {
    expect(() => parseRefineReply('{"deeds":[],"relations":""}', npc)).toThrow(/防清档/);
  });
  it('防膨胀：结果条数远超原有 → 抛错（精编只该压缩）', () => {
    const many = JSON.stringify({ deeds: Array.from({ length: 20 }, (_, i) => ({ time: '', location: '', description: `条目${i}内容内容` })), relations: '' });
    expect(() => parseRefineReply(many, npc)).toThrow(/膨胀/);
  });
  it('解析不出 JSON → 抛错', () => {
    expect(() => parseRefineReply('抱歉，我做不到。', npc)).toThrow(/解析/);
  });
  it('description 为空的条目被丢弃；超长字段被截断', () => {
    const reply = JSON.stringify({ deeds: [{ time: 'x'.repeat(99), location: '', description: '有效条目内容够长' }, { description: '' }], relations: 'r'.repeat(3000) });
    const o = parseRefineReply(reply, npc);
    expect(o.afterDeeds).toBe(1);
    expect(o.deeds[0].time.length).toBeLessThanOrEqual(40);
    expect(o.relations.length).toBeLessThanOrEqual(2000);
  });
});

describe('serializeForRefine', () => {
  it('只序列化身份抬头+经历+关系网（不含数值/私密）', () => {
    const s = serializeForRefine(npc);
    expect(s).toContain('[C1] 蕾姆');
    expect(s).toContain('经历记录·现状（3 条）');
    expect(s).toContain('[第3日@宅邸]');
    expect(s).toContain('关系网·现状');
    expect(s).toContain('B1:主仆');
  });
});
