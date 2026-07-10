import { describe, it, expect, beforeEach } from 'vitest';
import { useItems } from '../store/itemStore';
import { drainSceneNotices } from './allocNotice';
import { buyFromListing } from './channelTrade';
import type { ChannelMessage } from '../store/channelStore';

/* 公共频道交易 → 场外通报：治"频道里把东西卖了/买了，正文却不知道"OOC。
   买/卖除了确定性扣加货币(adjustCurrency 自带货币通报)，还要 pushSceneNotice 一条"你在广场买下/卖出 X"的行为通报。 */
const listing = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: 'm1', channel: 'trade', kind: 'sell', authorName: '铁匠老王', byPlayer: false,
  content: '出售一把好刀',
  offer: { itemName: '星陨匕首', category: '武器', gradeDesc: '蓝色', effect: '锋利', price: '500', currency: '乐园币', qty: 1 },
  ...over,
} as any);

describe('channelTrade · 频道交易场外通报', () => {
  beforeEach(() => { drainSceneNotices(); useItems.getState().setCurrency({ 乐园币: 10000, 灵魂钱币: 0 }); });

  it('buyFromListing 成功 → 推送"你在广场买下 X"场外通报（+货币通报）', () => {
    const r = buyFromListing(listing());
    expect(r.ok).toBe(true);
    const notices = drainSceneNotices({ 乐园币: 9500 } as any).join('\n');
    expect(notices).toContain('买下【星陨匕首】');
    expect(notices).toContain('契约者广场');
    expect(notices).toContain('乐园币');   // adjustCurrency 的货币通报也在
  });

  it('货币不足 → 不成交、不推送频道交易通报', () => {
    useItems.getState().setCurrency({ 乐园币: 100 });
    const r = buyFromListing(listing());
    expect(r.ok).toBe(false);
    expect(drainSceneNotices().filter((n) => n.includes('频道交易')).length).toBe(0);
  });
});
