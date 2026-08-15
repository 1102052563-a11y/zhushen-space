// 📡 <广场舆论> 回注块单测：门控（开关/条数/空池）、热度排序取前N、排除系统/主角线/玩家挂单、双护栏文案。
import { describe, it, expect, beforeEach } from 'vitest';
import { buildChannelBuzzInjection } from './channelBuzz';
import { useChannel, type ChannelMessage } from '../store/channelStore';

const mkPost = (over: Partial<ChannelMessage>): ChannelMessage => ({
  id: over.id ?? 'M_1', channel: 'general', authorName: '测试者', kind: 'chat',
  content: '内容', postedAt: 1000, ...over,
});

const seed = (messages: ChannelMessage[], patch: Partial<ReturnType<typeof useChannel.getState>['settings']> = {}) => {
  useChannel.setState((s) => ({ messages, settings: { ...s.settings, enabled: true, injectBuzzCount: 3, ...patch } }));
};

beforeEach(() => { useChannel.setState((s) => ({ messages: [], settings: { ...s.settings, enabled: true, injectBuzzCount: 3 } })); });

describe('buildChannelBuzzInjection', () => {
  it('功能关 / 条数0 / 无帖 → 零块', () => {
    seed([mkPost({ heat: 500 })], { enabled: false });
    expect(buildChannelBuzzInjection()).toEqual([]);
    seed([mkPost({ heat: 500 })], { injectBuzzCount: 0 });
    expect(buildChannelBuzzInjection()).toEqual([]);
    seed([]);
    expect(buildChannelBuzzInjection()).toEqual([]);
  });

  it('按热度取前N；排除 system/speak/byPlayer', () => {
    seed([
      mkPost({ id: 'M_1', content: '低热帖', heat: 10 }),
      mkPost({ id: 'M_2', content: '高热帖', heat: 900 }),
      mkPost({ id: 'M_3', content: '中热帖', heat: 300 }),
      mkPost({ id: 'M_4', content: '次热帖', heat: 200 }),
      mkPost({ id: 'M_5', content: '系统公告', channel: 'system', heat: 999 }),
      mkPost({ id: 'M_6', content: '主角发言', speak: true, byPlayer: true, heat: 999 }),
      mkPost({ id: 'M_7', content: '玩家挂单', byPlayer: true, heat: 999 }),
    ]);
    const [block] = buildChannelBuzzInjection();
    expect(block.role).toBe('system');
    expect(block.content).toContain('高热帖');
    expect(block.content).toContain('中热帖');
    expect(block.content).toContain('次热帖');
    expect(block.content).not.toContain('低热帖');       // 第4名被 N=3 截掉
    expect(block.content).not.toContain('系统公告');
    expect(block.content).not.toContain('主角发言');
    expect(block.content).not.toContain('玩家挂单');
    expect(block.content.indexOf('高热帖')).toBeLessThan(block.content.indexOf('中热帖'));   // 热度降序
  });

  it('无 heat 的老帖按时间兜底仍可入选；长内容截断', () => {
    seed([
      mkPost({ id: 'M_1', content: 'A'.repeat(300), postedAt: 2000 }),
      mkPost({ id: 'M_2', content: '旧帖', postedAt: 1000 }),
    ]);
    const [block] = buildChannelBuzzInjection();
    expect(block.content).toContain('旧帖');
    expect(block.content).not.toContain('A'.repeat(120));   // 90 字截断
  });

  it('双护栏文案在块内', () => {
    seed([mkPost({ heat: 100 })]);
    const [block] = buildChannelBuzzInjection();
    expect(block.content).toContain('广场舆论');
    expect(block.content).toContain('禁止出现论坛帖子格式');
    expect(block.content).toContain('主角不一定看过');
  });
});
