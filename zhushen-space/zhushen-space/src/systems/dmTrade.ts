import { useItems, ITEM_CATEGORIES, type ItemCategory, type CurrencyWallet, type InventoryItem } from '../store/itemStore';
import { useNpc, type NpcOwnedItem } from '../store/npcStore';
import type { DmDeal, DmDealItem, DmThread } from '../store/dmStore';

/* 私信交易·确定性结算：玩家点「成交」→ 代码扣货币/物品、给货币/物品、对方收到的物品入其储存空间。AI 不参与转账。*/

export function normCur(c?: string): keyof CurrencyWallet {
  const s = (c || '').trim();
  if (/魂|灵魂|soul/i.test(s)) return '灵魂钱币';
  return '乐园币';
}
function normCat(c?: string): ItemCategory {
  const s = (c || '').trim();
  return (ITEM_CATEGORIES as readonly string[]).includes(s) ? (s as ItemCategory) : '其他物品';
}

/* 物品名模糊匹配玩家背包（与 stateParser.fuzzyFindItem 同思路：精确→包含→反向包含，取最短）*/
function findPlayerItem(items: InventoryItem[], name: string): InventoryItem | undefined {
  const q = (name || '').replace(/\s+/g, '').toLowerCase();
  if (!q) return undefined;
  const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
  let exact = items.find((it) => norm(it.name) === q);
  if (exact) return exact;
  const subs = items.filter((it) => norm(it.name).includes(q) || q.includes(norm(it.name)));
  subs.sort((a, b) => a.name.length - b.name.length);
  return subs[0];
}

function infoFields(o: DmDealItem) {
  return {
    origin: o.origin || undefined, subType: o.subType || undefined,
    combatStat: o.combatStat || undefined, durability: o.durability || undefined,
    requirement: o.requirement || undefined, affix: o.affix || undefined,
    score: o.score != null && o.score !== '' ? String(o.score) : undefined,
    appearance: o.appearance || undefined, intro: o.intro || undefined,
  };
}

/* 把玩家交出的物品放进对方（NPC）的储存空间 */
function addToNpcBag(npcId: string, item: DmDealItem, fromPlayerName: string) {
  const npc = useNpc.getState();
  const rec = npc.npcs[npcId];
  const existing = npc.npcs[npcId]?.items ?? [];
  const owned: NpcOwnedItem = {
    id: `I_${npcId}_${(existing.length + 1).toString().padStart(2, '0')}_${Math.random().toString(36).slice(2, 5)}`,
    name: item.name, category: item.category || '其他物品', gradeDesc: item.gradeDesc || '',
    effect: item.effect || '', quantity: Math.max(1, item.qty || 1), equipped: false,
    acquisition: `主角私下赠予/交易（来自 ${fromPlayerName || '主角'}）`,
    tags: item.tags ?? ['私下交易'],
    origin: item.origin, subType: item.subType, combatStat: item.combatStat, durability: item.durability,
    requirement: item.requirement, affix: item.affix, score: item.score, intro: item.intro, appearance: item.appearance,
    addedAt: Date.now(),
  };
  if (rec) npc.addNpcItem(npcId, owned);
}

export interface DmSettleResult { ok: boolean; error?: string; npcId?: string; summary?: string }

/* 结算一笔已敲定的私信交易。
   - 若交易涉及"对方收到物品"且对方尚未建档，会就地建一个离场契约者档案（让物品有归属），返回其 C-id。*/
export function settleDmDeal(thread: DmThread, deal: DmDeal): DmSettleResult {
  if (deal.status === 'done') return { ok: false, error: '该交易已完成' };
  const items = useItems.getState();

  // ① 校验：玩家支付的货币是否足够
  if (deal.giveCurrency && deal.giveCurrency.amount > 0) {
    const cur = normCur(deal.giveCurrency.type);
    const have = items.currency[cur] ?? 0;
    if (have < deal.giveCurrency.amount) return { ok: false, error: `${cur}不足：需 ${deal.giveCurrency.amount}，现有 ${have}` };
  }
  // ② 校验：玩家交出的物品是否在背包、未装备、数量够
  let consume: { id: string; qty: number } | undefined;
  if (deal.giveItem) {
    const it = findPlayerItem(items.items, deal.giveItem.name);
    if (!it) return { ok: false, error: `你的储存空间里找不到「${deal.giveItem.name}」` };
    if (it.equipped) return { ok: false, error: `「${it.name}」正装备中，请先卸下再交易` };
    const need = Math.max(1, deal.giveItem.qty || 1);
    if ((it.quantity || 1) < need) return { ok: false, error: `「${it.name}」数量不足：需 ${need}，现有 ${it.quantity}` };
    consume = { id: it.id, qty: need };
  }

  // ③ 若对方将收到物品但尚未建档 → 就地建离场契约者档案
  let npcId = thread.targetId;
  if (deal.giveItem && !npcId) {
    npcId = useNpc.getState().createArchivedContractor({
      name: thread.targetName, tier: thread.targetTier, job: thread.targetJob,
      persona: thread.targetPersona, strength: thread.targetStrength, tag: thread.targetTag,
    });
  }

  // ④ 执行转账（确定性）
  if (deal.giveCurrency && deal.giveCurrency.amount > 0) items.adjustCurrency(normCur(deal.giveCurrency.type), -deal.giveCurrency.amount);
  if (deal.getCurrency && deal.getCurrency.amount > 0) items.adjustCurrency(normCur(deal.getCurrency.type), deal.getCurrency.amount);
  if (consume && deal.giveItem) {
    items.consumeItem(consume.id, consume.qty);
    if (npcId) addToNpcBag(npcId, deal.giveItem, '主角');
  }
  if (deal.getItem) {
    items.addItem({
      name: deal.getItem.name, category: normCat(deal.getItem.category), gradeDesc: deal.getItem.gradeDesc || '',
      effect: deal.getItem.effect || '', quantity: Math.max(1, deal.getItem.qty || 1), equipped: false,
      tags: deal.getItem.tags ?? ['私下交易'],
      acquisition: `私信·向 ${thread.targetName} ${deal.kind === 'request' ? '索取' : deal.kind === 'barter' ? '换得' : '购得'}`,
      ...infoFields(deal.getItem),
    });
  }

  return { ok: true, npcId, summary: dealSummary(deal, thread.targetName) };
}

/* 交易摘要（成交后写一条系统消息）*/
export function dealSummary(deal: DmDeal, npcName: string): string {
  const gives: string[] = [];
  const gets: string[] = [];
  if (deal.giveItem) gives.push(`${deal.giveItem.name}${(deal.giveItem.qty ?? 1) > 1 ? `×${deal.giveItem.qty}` : ''}`);
  if (deal.giveCurrency && deal.giveCurrency.amount > 0) gives.push(`${deal.giveCurrency.amount} ${normCur(deal.giveCurrency.type)}`);
  if (deal.getItem) gets.push(`${deal.getItem.name}${(deal.getItem.qty ?? 1) > 1 ? `×${deal.getItem.qty}` : ''}`);
  if (deal.getCurrency && deal.getCurrency.amount > 0) gets.push(`${deal.getCurrency.amount} ${normCur(deal.getCurrency.type)}`);
  const giveStr = gives.length ? gives.join(' + ') : '（无）';
  const getStr = gets.length ? gets.join(' + ') : '（无）';
  return `已与 ${npcName} 成交：你交出 ${giveStr}，获得 ${getStr}。`;
}
