import { describe, it, expect, beforeEach } from 'vitest';
import { parseCommIntents, stripCommBlocks, eligibleCommNpcs, inlineCommCooldownOk, noteInlineCommFired, resetInlineCommCooldown } from './inlineComm';

describe('parseCommIntents', () => {
  it('标准意图块', () => {
    const r = parseCommIntents('……正文结束。\n<通讯>\n私信|林岚|连日未见主角有些担心|问是否平安，提醒按时归队\n</通讯>');
    expect(r).toHaveLength(1);
    expect(r[0].sender).toBe('林岚');
    expect(r[0].reason).toContain('担心');
    expect(r[0].gist).toContain('平安');
  });

  it('全角分隔符与注释行', () => {
    const r = parseCommIntents('<通讯>\n<!-- 自检：不在身边？是 -->\n# 说明行\n私信｜阿玖｜任务线索到手｜把坐标发给主角\n</通讯>');
    expect(r).toHaveLength(1);
    expect(r[0].sender).toBe('阿玖');
  });

  it('示例污染防御：段数不足丢弃', () => {
    expect(parseCommIntents('<通讯>\n私信|只有俩段\n</通讯>')).toHaveLength(0);
    expect(parseCommIntents('<通讯>\n私信\n</通讯>')).toHaveLength(0);
  });

  it('三段式容错：省略动机', () => {
    const r = parseCommIntents('<通讯>\n私信|白芷|催主角回礼阁一趟\n</通讯>');
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('');
    expect(r[0].gist).toContain('回礼阁');
  });

  it('未闭合（流截断）也能解析', () => {
    const r = parseCommIntents('正文……\n<通讯>\n私信|林岚|想念|问好');
    expect(r).toHaveLength(1);
  });

  it('非私信类型跳过；无块返回空', () => {
    expect(parseCommIntents('<通讯>\n群聊|谁|a|b\n</通讯>')).toHaveLength(0);
    expect(parseCommIntents('没有块的正文')).toHaveLength(0);
  });
});

describe('stripCommBlocks', () => {
  it('闭合与未闭合都剥净', () => {
    expect(stripCommBlocks('前<通讯>\n私信|a|b|c\n</通讯>后')).toBe('前后');
    expect(stripCommBlocks('前<通讯>\n私信|a|b|c')).toBe('前');
  });
});

describe('eligibleCommNpcs', () => {
  const base = { onScene: false, isDead: false, archived: false };
  it('白名单+离场过滤 + favor 排序', () => {
    const r = eligibleCommNpcs({
      a: { id: 'a', name: '随从甲', npcTag: '随从', favor: 10, ...base },
      b: { id: 'b', name: '在场随从', npcTag: '随从', ...base, onScene: true },
      c: { id: 'c', name: '土著', npcTag: '土著', favor: 99, ...base },
      d: { id: 'd', name: '契约者乙', npcTag: '契约者', favor: 50, ...base },
      e: { id: 'e', name: '死了', npcTag: '随从', isDead: true, onScene: false, archived: false },
      f: { id: 'f', name: '', npcTag: '随从', ...base },
    });
    expect(r.map((n) => n.id)).toEqual(['d', 'a']);
  });
});

describe('inlineComm 冷却', () => {
  beforeEach(() => resetInlineCommCooldown());
  it('未发过=放行；发过后 everyN 回合内拦截', () => {
    expect(inlineCommCooldownOk(10, 3)).toBe(true);
    noteInlineCommFired(10);
    expect(inlineCommCooldownOk(11, 3)).toBe(false);
    expect(inlineCommCooldownOk(12, 3)).toBe(false);
    expect(inlineCommCooldownOk(13, 3)).toBe(true);
  });
});
