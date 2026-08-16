import { describe, it, expect } from 'vitest';
import { parseDmReply, dmMsgToHistoryText } from './dmProtocol';

describe('parseDmReply 行协议', () => {
  it('完整协议：状态头+心声+多条消息+花样', () => {
    const r = parseDmReply([
      '状态: 疲惫｜乐园西区宿舍｜刚做完强化训练，正瘫在床上擦汗',
      '心声: 他这个点找我，八成又要借钱……',
      '说: 在。',
      '说: 有事？',
      '撤回: 你要是又来借钱就免开尊口',
      '戳: 1',
    ].join('\n'));
    expect(r.meta?.emotion).toBe('疲惫');
    expect(r.meta?.location).toBe('乐园西区宿舍');
    expect(r.meta?.state).toContain('擦汗');
    expect(r.meta?.thought).toContain('借钱');
    expect(r.msgs.map((m) => m.kind)).toEqual(['text', 'text', 'recalled', 'poke']);
    expect(r.msgs[2].orig).toContain('免开尊口');
  });

  it('全角冒号与两段状态也认', () => {
    const r = parseDmReply('状态：紧张｜手心冒汗地盯着门口\n说：你到了吗');
    expect(r.meta?.emotion).toBe('紧张');
    expect(r.meta?.state).toContain('盯着门口');
    expect(r.meta?.location).toBeUndefined();
    expect(r.msgs).toHaveLength(1);
  });

  it('引用消息：原话 => 回应', () => {
    const r = parseDmReply('引用: 我明天就出发 => 你疯了？那副本你现在进去就是送死');
    expect(r.msgs[0].kind).toBe('quote');
    expect(r.msgs[0].quote).toBe('我明天就出发');
    expect(r.msgs[0].text).toContain('送死');
  });

  it('AI 没按协议输出 → 整段当一条纯文本（绝不丢回复）', () => {
    const r = parseDmReply('哈哈，好啊，明天老地方见。\n带上你上次说的那瓶酒。');
    expect(r.msgs).toHaveLength(1);
    expect(r.msgs[0].kind).toBe('text');
    expect(r.msgs[0].text).toContain('老地方见');
    expect(r.msgs[0].text).toContain('那瓶酒');
    expect(r.meta).toBeUndefined();
  });

  it('协议行与散文行混排：散文归并为纯文本消息', () => {
    const r = parseDmReply('说: 等我十分钟\n（远处传来集合哨声）\n说: 到了');
    expect(r.msgs.map((m) => m.kind)).toEqual(['text', 'text', 'text']);
    expect(r.msgs[1].text).toContain('集合哨声');
  });

  it('条数硬上限4 + 戳/撤回各限1', () => {
    const r = parseDmReply(['说: 1', '说: 2', '戳: 1', '戳: 1', '撤回: a', '撤回: b', '说: 3'].join('\n'));
    expect(r.msgs.length).toBeLessThanOrEqual(4);
    expect(r.msgs.filter((m) => m.kind === 'poke')).toHaveLength(1);
    expect(r.msgs.filter((m) => m.kind === 'recalled')).toHaveLength(1);
  });

  it('代码围栏剥离 + 空输入', () => {
    expect(parseDmReply('```\n说: ok\n```').msgs[0].text).toBe('ok');
    expect(parseDmReply('').msgs).toHaveLength(0);
  });

  it('表情包字段：贴: 名称 → sticker kind', () => {
    const r = parseDmReply('说: 收到\n贴: 猫猫点头');
    expect(r.msgs.map((m) => m.kind)).toEqual(['text', 'sticker']);
    expect(r.msgs[1].text).toBe('猫猫点头');
    expect(dmMsgToHistoryText({ kind: 'sticker', text: '猫猫点头' })).toBe('[表情包] 猫猫点头');
  });

  it('历史压缩口径', () => {
    expect(dmMsgToHistoryText({ kind: 'recalled', text: '撤回了一条消息', orig: '秘密' })).toBe('[你撤回的消息] 秘密');
    expect(dmMsgToHistoryText({ kind: 'poke', text: '' })).toBe('[你戳了戳对方]');
    expect(dmMsgToHistoryText({ kind: 'quote', text: '不行', quote: '借我点钱' })).toBe('[引用「借我点钱」] 不行');
    expect(dmMsgToHistoryText({ text: '普通' })).toBe('普通');
  });
});
