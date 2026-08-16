import { describe, it, expect } from 'vitest';
import { parseLiveReply, LIVE_GIFTS, giftByKey, giftGuideBlock } from './liveRoom';

describe('parseLiveReply', () => {
  it('标准 JSON 全字段+夹取', () => {
    const show = parseLiveReply(JSON.stringify({
      roomTitle: '深夜杂谈', roomDesc: '聊聊最近的副本', viewers: '1.2万',
      thought: '今天人不多啊',
      contents: [{ dialogue: '来了来了', state: '揉了揉眼睛' }, { dialogue: '昨天那单亏麻了', state: '叹气' }],
      barrage: Array.from({ length: 20 }, (_, i) => ({ name: `观众${i}`, c: '哈哈哈' })),
      ranking: [{ name: '榜一', score: '9999' }, { name: '榜二', score: 100 }],
      superchat: [{ name: '土豪', amount: 500, c: '主播喝水' }],
    }));
    expect(show).not.toBeNull();
    expect(show!.contents).toHaveLength(2);
    expect(show!.barrage).toHaveLength(15);
    expect(show!.ranking[0].score).toBe(9999);
    expect(show!.viewers).toBe(12);   // '1.2万' 抠数字=12（宽容够用）
  });
  it('无 contents 判废；烂输出 null', () => {
    expect(parseLiveReply(JSON.stringify({ roomTitle: 'x', contents: [] }))).toBeNull();
    expect(parseLiveReply('不是JSON')).toBeNull();
  });
});

describe('gifts', () => {
  it('12礼三档·价格递增·favor 0~3', () => {
    expect(LIVE_GIFTS).toHaveLength(12);
    for (let i = 1; i < LIVE_GIFTS.length; i++) expect(LIVE_GIFTS[i].price).toBeGreaterThan(LIVE_GIFTS[i - 1].price);
    expect(giftByKey('yacht')!.tier).toBe(3);
    expect(giftGuideBlock()).toContain('豪礼');
  });
});
