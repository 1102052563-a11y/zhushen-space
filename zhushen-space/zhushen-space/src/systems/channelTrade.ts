import { useItems, ITEM_CATEGORIES, splitAffixEntries, type ItemCategory, type CurrencyWallet, type InventoryItem } from '../store/itemStore';
import { useChannel, type ChannelMessage, type ChannelQuote } from '../store/channelStore';

/* 公共频道·交易确定性结算：点「购买」→ 代码扣货币 + 入背包 + 标记成交。AI 不参与金额。*/

export function normChannelCurrency(c?: string): keyof CurrencyWallet {
  const s = (c || '').trim();
  if (/魂|灵魂|soul/i.test(s)) return '灵魂钱币';
  return '乐园币';
}

export function parseChannelPrice(p?: string | number): number {
  if (typeof p === 'number') return Math.max(0, Math.round(p));
  const n = parseInt(String(p ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function normCategory(c?: string): ItemCategory {
  const s = (c || '').trim();
  return (ITEM_CATEGORIES as readonly string[]).includes(s) ? (s as ItemCategory) : '其他物品';
}

/* 从 offer/quote 提取「固定格式」字段，拼成 addItem 可接受的扩展字段（购买入背包时一并带入）*/
function infoFields(o: any) {
  return {
    origin: o?.origin || undefined, subType: o?.subType || undefined,
    combatStat: o?.combatStat || undefined, durability: o?.durability || undefined,
    requirement: o?.requirement || undefined,
    // affix 归一成干净字符串再入库：AI 常把词缀写成对象/数组(如三分 {name,effect:{...}})，裸存会让详情显示成 [object Object]，
    // 且喂给强化/对账 AI 的 `${item.affix}` 也会变 [object Object]。splitAffixEntries 已能吃任意形态 → join 成多行文本。
    affix: o?.affix != null && o.affix !== '' ? (splitAffixEntries(o.affix).join('\n') || undefined) : undefined,
    score: o?.score != null && o.score !== '' ? String(o.score) : undefined,
    appearance: o?.appearance || undefined,
    killCount: o?.killCount != null && o.killCount !== '' ? String(o.killCount) : undefined,
  };
}

/* 该帖是否可一键购买（交易频道·出售帖·有明确正价·未成交）*/
export function isBuyable(msg: ChannelMessage): boolean {
  return msg.channel === 'trade' && msg.kind === 'sell' && !!msg.offer
    && !msg.traded && parseChannelPrice(msg.offer.price) > 0;
}

export interface BuyResult { ok: boolean; error?: string; price?: number; currency?: keyof CurrencyWallet }

export function buyFromListing(msg: ChannelMessage): BuyResult {
  if (!msg.offer || msg.channel !== 'trade' || msg.kind !== 'sell') return { ok: false, error: '该帖子不是可购买的出售帖' };
  if (msg.traded) return { ok: false, error: '该商品已成交' };
  const price = parseChannelPrice(msg.offer.price);
  const currency = normChannelCurrency(msg.offer.currency);
  if (price <= 0) return { ok: false, error: '此帖无明确售价（可能面议/以物换物），暂不支持一键购买' };

  const items = useItems.getState();
  const have = items.currency[currency] ?? 0;
  if (have < price) return { ok: false, error: `${currency}不足：需 ${price}，现有 ${have}`, price, currency };

  const qty = Math.max(1, Number(msg.offer.qty) || 1);
  // ① 扣货币（确定性，AI 不报金额）
  items.adjustCurrency(currency, -price, `频道交易·购买 ${msg.offer.itemName || '物品'}`);
  // ② 入背包（带入完整固定格式字段）
  items.addItem({
    name: msg.offer.itemName || '频道购得物品',
    category: normCategory(msg.offer.category),
    gradeDesc: msg.offer.gradeDesc || '',
    effect: msg.offer.effect || '',
    quantity: qty,
    equipped: false,
    tags: Array.isArray(msg.offer.tags) ? msg.offer.tags : ['频道交易'],
    acquisition: `公共频道·向 ${msg.authorName} 购买（${price} ${currency}）`,
    intro: msg.offer.intro || msg.content,
    ...infoFields(msg.offer),
  });
  // ③ 标记成交
  useChannel.getState().markTraded(msg.id);
  return { ok: true, price, currency };
}

/* ════════════ 玩家发帖：求购 / 出售 ════════════ */

/* 玩家发【求购帖】：求 itemName，预算 budget。等契约者报价后点成交。*/
export function postWantToBuy(p: {
  itemName: string; category?: string; gradeDesc?: string; qty?: number;
  budget?: number; currency?: keyof CurrencyWallet; note?: string; gameTime?: string;
}): string {
  const budgetStr = p.budget ? String(p.budget) : '';
  const content = `【求购】${p.itemName}${p.gradeDesc ? `（${p.gradeDesc}）` : ''}${p.qty && p.qty > 1 ? ` ×${p.qty}` : ''}` +
    `${p.budget ? `，预算 ${p.budget} ${p.currency ?? '乐园币'}` : '，价格面议'}` +
    `${p.note ? `。${p.note}` : '。有货的滴我。'}`;
  return useChannel.getState().addPlayerPost({
    channel: 'trade', kind: 'buy', authorName: '我',
    content,
    offer: { itemName: p.itemName, category: p.category, gradeDesc: p.gradeDesc, qty: p.qty ?? 1, price: budgetStr, currency: p.currency ?? '乐园币', note: p.note },
    gameTime: p.gameTime,
  });
}

/* 玩家发【出售帖】：卖背包里的某件物品 invItem，期望售价 askPrice。等契约者出价后点成交。*/
export function postSellItem(invItem: InventoryItem, p: {
  qty?: number; askPrice?: number; currency?: keyof CurrencyWallet; note?: string; gameTime?: string;
}): string {
  const qty = Math.max(1, Math.min(Number(p.qty) || 1, invItem.quantity || 1));
  const content = `【出售】${invItem.name}${invItem.gradeDesc ? `（${invItem.gradeDesc}）` : ''}${qty > 1 ? ` ×${qty}` : ''}` +
    `${p.askPrice ? `，期望 ${p.askPrice} ${p.currency ?? '乐园币'}` : '，价格面议'}` +
    `${p.note ? `。${p.note}` : '。有意者出价。'}`;
  return useChannel.getState().addPlayerPost({
    channel: 'trade', kind: 'sell', authorName: '我',
    content,
    offer: {
      itemId: invItem.id, itemName: invItem.name, category: invItem.category, gradeDesc: invItem.gradeDesc,
      qty, price: p.askPrice ? String(p.askPrice) : '', currency: p.currency ?? '乐园币', note: p.note,
      // 带上背包物品的完整固定格式字段，供频道详情展示
      origin: invItem.origin, subType: invItem.subType, combatStat: invItem.combatStat, durability: invItem.durability,
      requirement: invItem.requirement, affix: invItem.affix, score: invItem.score, intro: invItem.intro,
      appearance: invItem.appearance, effect: invItem.effect, killCount: invItem.killCount, tags: invItem.tags,
    },
    gameTime: p.gameTime,
  });
}

/* 该出售帖报价是否为「以物换物」：买家拿出 itemName 那件物品来换。
   判定：仅出售帖；有 itemName；且（显式 barter 标记 或 提供的物品名与玩家出售物不同名）。*/
export function isBarterQuote(post: ChannelMessage, quote: ChannelQuote): boolean {
  if (post.kind !== 'sell') return false;
  const offered = (quote.itemName || '').trim();
  if (!offered) return false;
  const playerItem = (post.offer?.itemName || '').trim();
  return quote.barter === true || offered !== playerItem;
}

/* 接受某条报价/出价 → 确定性结算。
   - 玩家求购帖(kind=buy)：接受卖家报价 → 扣 quote.price，得 quote 物品。
   - 玩家出售帖(kind=sell)：接受买家出价 → 扣自己 offer.itemId 物品，得 quote.price（纯现金）
       或「以物换物」→ 扣自己物品，收下买家的 quote 物品 + 额外找补现金 price。*/
export function acceptQuote(post: ChannelMessage, quote: ChannelQuote): BuyResult {
  if (!post.byPlayer || post.fulfilled) return { ok: false, error: '该帖不可成交或已成交' };
  const items = useItems.getState();
  const price = parseChannelPrice(quote.price);
  const currency = normChannelCurrency(quote.currency);
  const barter = isBarterQuote(post, quote);
  if (price <= 0 && !barter) return { ok: false, error: '该报价无有效金额' };

  if (post.kind === 'buy') {
    // 玩家求购 → 向卖家买：扣钱、入背包
    const have = items.currency[currency] ?? 0;
    if (have < price) return { ok: false, error: `${currency}不足：需 ${price}，现有 ${have}`, price, currency };
    const qty = Math.max(1, Number(quote.qty ?? post.offer?.qty) || 1);
    const src: any = { ...(post.offer ?? {}), ...quote };   // 报价覆盖求购帖（卖家提供的实际物品）
    items.adjustCurrency(currency, -price, `频道交易·求购成交（${quote.itemName || post.offer?.itemName || '物品'}）`);
    items.addItem({
      name: quote.itemName || post.offer?.itemName || '频道购得物品',
      category: normCategory(quote.category || post.offer?.category),
      gradeDesc: quote.gradeDesc || post.offer?.gradeDesc || '',
      effect: src.effect || '', quantity: qty, equipped: false,
      tags: Array.isArray(src.tags) ? src.tags : ['频道交易'],
      acquisition: `公共频道·求购成交，向 ${quote.fromName} 购买（${price} ${currency}）`,
      intro: src.intro || quote.note || post.content,
      ...infoFields(src),
    });
  } else if (post.kind === 'sell') {
    // 玩家出售 → 卖给买家：扣物品、收钱
    const itemId = post.offer?.itemId;
    const sellQty = Math.max(1, Number(post.offer?.qty) || 1);
    const owned = itemId ? items.items.find((it) => it.id === itemId) : undefined;
    if (!owned) return { ok: false, error: '你已不再持有该出售物品（可能已用掉/卖掉）' };
    if (owned.equipped) return { ok: false, error: '该物品正装备中，请先卸下再出售' };
    if ((owned.quantity || 1) < sellQty) return { ok: false, error: `持有数量不足：需 ${sellQty}，现有 ${owned.quantity}` };
    items.consumeItem(itemId!, sellQty);
    if (barter) {
      // 以物换物：收下买家拿来交换的物品（带完整固定格式字段）；price>0 视为买家额外找补的现金
      items.addItem({
        name: (quote.itemName || '换购物品').trim(),
        category: normCategory(quote.category),
        gradeDesc: quote.gradeDesc || '',
        effect: quote.effect || '',
        quantity: Math.max(1, Number(quote.qty) || 1),
        equipped: false,
        tags: Array.isArray(quote.tags) ? quote.tags : ['频道交易', '以物换物'],
        acquisition: `公共频道·以物换物，与 ${quote.fromName} 互换（付出「${owned.name}」${price > 0 ? `+对方找补 ${price} ${currency}` : '·平换'}）`,
        intro: quote.intro || quote.note,
        ...infoFields(quote),
      });
    }
    if (price > 0) items.adjustCurrency(currency, price, `频道交易·出售 ${owned.name}`);
  } else {
    return { ok: false, error: '未知帖子类型' };
  }
  useChannel.getState().markFulfilled(post.id);
  return { ok: true, price, currency };
}
