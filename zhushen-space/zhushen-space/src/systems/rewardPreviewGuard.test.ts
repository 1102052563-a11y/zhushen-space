import { describe, it, expect } from 'vitest';
import { previewRewardCurrencyAmounts, stripPreviewRewardCurrency } from './stateParser';

const tc = (amount: number, type = '乐园币') => ({ type: 'transferCurrency', data: { amount, type, to: 'B1' } } as any);

describe('奖励预告守卫（治"正文只是奖励预告、货币却真加了"）', () => {
  it('从"🎁奖励预告"行抽出货币金额', () => {
    const raw = '任务卡…\n🎁 奖励预告: 灵魂结晶(小)×1、黄金技能点碎片×1、乐园币+1500\n正文继续…';
    expect(previewRewardCurrencyAmounts(raw)).toEqual(new Set([1500]));
  });

  it('奖励预览行 + 魂币也抽', () => {
    expect(previewRewardCurrencyAmounts('奖励预览：魂币+80')).toEqual(new Set([80]));
  });

  it('普通行不抽（非预告）', () => {
    expect(previewRewardCurrencyAmounts('主角击杀敌人，获得乐园币+50').size).toBe(0);
  });

  it('★纯预告（无到手语境）→ 拦', () => {
    const raw = '🎁 奖励预告: 乐园币+1500';
    const r = stripPreviewRewardCurrency(raw, [tc(1500)]);
    expect(r.blocked).toBe(1);
    expect(r.cmds.length).toBe(0);   // 提前发放的 1500 被拦
  });

  it('★击杀奖励乐园币（同金额但有"击杀/获得"到手语境）→ 放行', () => {
    const raw = '🎁 奖励预告: 乐园币+1500\n主角斩杀哥布林首领，获得乐园币+1500！';
    expect(stripPreviewRewardCurrency(raw, [tc(1500)]).blocked).toBe(0);   // 真击杀到手，不拦
  });

  it('★开宝箱得乐园币（同金额）→ 放行', () => {
    const raw = '🎁 奖励预告: 乐园币+1500\n打开宝箱，开出乐园币1500。';
    expect(stripPreviewRewardCurrency(raw, [tc(1500)]).blocked).toBe(0);
  });

  it('★猩红卡片得乐园币（卡片到手语境）→ 放行', () => {
    const raw = '🎁 奖励预告: 乐园币+1500\n翻开猩红卡片，领取乐园币1500。';
    expect(stripPreviewRewardCurrency(raw, [tc(1500)]).blocked).toBe(0);
  });

  it('★同回合的真实入账（金额不同）放行', () => {
    const raw = '🎁 奖励预告: 乐园币+1500\n主角当场捡到一袋钱：乐园币+50';
    const r = stripPreviewRewardCurrency(raw, [tc(1500), tc(50)]);
    expect(r.blocked).toBe(1);
    expect(r.cmds.map((c) => c.data.amount)).toEqual([50]);   // 只拦 1500 预告，放行真实的 50
  });

  it('★结算回合（含【结算任务】）正常发放，不拦', () => {
    const raw = '【结算任务】\n🎁 奖励预告: 乐园币+1500';
    const r = stripPreviewRewardCurrency(raw, [tc(1500)]);
    expect(r.blocked).toBe(0);
    expect(r.cmds.length).toBe(1);
  });

  it('无奖励预告 → 一律不拦', () => {
    const r = stripPreviewRewardCurrency('普通正文·乐园币+1500', [tc(1500)]);
    expect(r.blocked).toBe(0);
  });

  it('★也拦 transferSpiritStones（旧货币指令名）', () => {
    const ss = { type: 'transferSpiritStones', data: { amount: 1500, grade: '乐园币', to: 'B1' } } as any;
    const r = stripPreviewRewardCurrency('🎁 奖励预告: 乐园币+1500', [ss]);
    expect(r.blocked).toBe(1);
  });

  it('★也拦 createItem 一个货币名（前端会折算进钱包）', () => {
    const ci = { type: 'createItem', data: { name: '乐园币', quantity: 1500 } } as any;
    const r = stripPreviewRewardCurrency('🎁 奖励预告: 乐园币+1500', [ci]);
    expect(r.blocked).toBe(1);
  });

  it('支出（from=B1）不误拦', () => {
    const spend = { type: 'transferCurrency', data: { amount: 1500, type: '乐园币', from: 'B1' } } as any;
    const r = stripPreviewRewardCurrency('🎁 奖励预告: 乐园币+1500', [spend]);
    expect(r.blocked).toBe(0);   // 只拦"给主角入账"，不拦支出
  });
});
