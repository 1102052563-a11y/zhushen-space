import { useItems } from '../store/itemStore';
import { usePlayer } from '../store/playerStore';
import { soulStake, type SoulStakeKind } from './casinoEngine';

/* 魂赌结算：按筹码类型 + 胜负发放奖惩（纯确定性，前端直接落库）。
   - soulcoin：数额型，净额结算
   - item：输则销毁该装备，赢则保住 + 魂币彩头
   - talent：输则随机一项六维 −1~2，赢则魂币 + 一项六维 +1
   返回一句结算摘要（展示 + 流水）。设计见记忆 casino-feature。*/

const SIX = ['str', 'agi', 'con', 'int', 'cha', 'luck'] as const;
const SIX_CN: Record<string, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };
const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

export interface SoulSettleResult { summary: string; delta: number; }   // delta：净魂币正负（仅供流水/吐槽判断输赢，非精确）

export function applySoulOutcome(kind: SoulStakeKind, win: boolean, opts: { amount?: number; itemId?: string; itemName?: string }): SoulSettleResult {
  const I = useItems.getState();
  const P = usePlayer.getState();

  if (kind === 'soulcoin') {
    const n = Math.max(0, Math.floor(opts.amount || 0));
    if (win) { const g = Math.round(n * (soulStake('soulcoin').payoutMul - 1)); I.adjustCurrency('灵魂钱币', g); return { summary: `🎉 赢得魂币 +${g}`, delta: g }; }
    I.adjustCurrency('灵魂钱币', -n); return { summary: `💀 魂币 −${n}，尽数没入笼中`, delta: -n };
  }
  if (kind === 'item') {
    if (win) { const g = ri(3, 6); I.adjustCurrency('灵魂钱币', g); return { summary: `🎉 保住「${opts.itemName || '本命装备'}」，另得魂币 +${g}`, delta: g }; }
    if (opts.itemId) { try { I.removeItem(opts.itemId); } catch { /* */ } }
    return { summary: `💀 「${opts.itemName || '本命装备'}」在笼火中化为灰烬`, delta: -1 };
  }
  // talent
  if (win) { const gs = ri(6, 14); I.adjustCurrency('灵魂钱币', gs); const gk = SIX[Math.floor(Math.random() * SIX.length)]; const ga = { ...(P.profile.attrs || {} as any) }; ga[gk] = (ga[gk] || 0) + 1; P.setProfile({ attrs: ga }); return { summary: `🎉 天资淬炼：魂币 +${gs}、${SIX_CN[gk]} +1`, delta: gs }; }
  const k = SIX[Math.floor(Math.random() * SIX.length)];
  const attrs = { ...(P.profile.attrs || {} as any) };
  const dec = ri(1, 2);
  attrs[k] = Math.max(1, (attrs[k] || 1) - dec);
  P.setProfile({ attrs });
  return { summary: `💀 ${SIX_CN[k]} −${dec}（天资受损）`, delta: -1 };
}
