import { useTrade, TRADE_MAX_LISTINGS, type TradeListing } from '../store/tradeStore';
import { useItems } from '../store/itemStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import type { TradeInbound, TradeOutbound, TradeRecord } from './tradeProtocol';

// 全局交易行 WebSocket 客户端（事件名照搬后端 TradeDO 协议）。
// 与聊天室共用 Discord 身份：连接带 chatToken(→后端 pid=chat:uid) + 头像/名牌(avv/ds/nc)，挂牌/还价显示同一身份。
// 心跳发字符串 "ping"。打开面板时 connect，关闭时 leave。断线自动重连（主动离开除外）。
//
// 上架托管（offline-safe）：上架即从背包扣物，存本地「托管」(localStorage·持久)；
//   listing_added 把托管对上 listingId；listing_removed(手动下架/到期)或重连 hello 对账时把物品归还背包。
//   物品全程只在本机背包↔托管间搬动，后端只存快照，故离线到期、刷新都不丢物。

const RATE_MSG = '操作太快了，稍等一下';
const ESCROW_KEY = 'drpg-trade-escrow';
const COIN_KEY = 'drpg-trade-coin-escrow';   // 出价即托管的货币（买家本地·扣款持有，成交付卖家、未成交退回）

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let manualClose = false;
let curName = '道友';
let curToken = '';

function set(p: Partial<ReturnType<typeof useTrade.getState>>) { useTrade.getState()._set(p as any); }

function stripItemSnapshot(it: any) {
  const { image, addedAt, equipped, ...rest } = it || {};
  return { ...rest };
}

// ── 托管存储 ──
type EscrowEntry = { token: string; item: any; listingId: string | null; at: number };
function loadEscrow(): Record<string, EscrowEntry> { try { return JSON.parse(localStorage.getItem(ESCROW_KEY) || '{}'); } catch { return {}; } }
function saveEscrow(m: Record<string, EscrowEntry>) { try { localStorage.setItem(ESCROW_KEY, JSON.stringify(m)); } catch {} }
// 归还：剥掉原背包 id —— 部分上架时原堆叠仍在背包，带 id 归还会命中 addItem 的「同 id 原地更新」把剩余数量覆盖丢失；
// 去 id 后按名字回堆（可堆叠类）或新建（装备），数量正确累加。
function returnItem(item: any) { try { const { id, ...rest } = item || {}; useItems.getState().addItem({ ...rest }); } catch {} }

/** 重连/进场对账：托管里已不在看板的→归还；没确认过的→补 listingId 或超时归还。 */
function reconcileEscrow(listings: TradeListing[]) {
  const ids = new Set(listings.map((L) => L.id));
  const mm = loadEscrow();
  let changed = false;
  const now = Date.now();
  for (const tok of Object.keys(mm)) {
    const e = mm[tok];
    if (e.listingId) {
      if (!ids.has(e.listingId)) { returnItem(e.item); delete mm[tok]; changed = true; }   // 挂牌已下架/过期/掉出 → 归还
    } else {
      const match = listings.find((L) => L.clientToken === tok);
      if (match) { e.listingId = match.id; changed = true; }                                // 补回确认
      else if (now - e.at > 15000) { returnItem(e.item); delete mm[tok]; changed = true; }  // 久未确认 → 视为失败归还
    }
  }
  if (changed) saveEscrow(mm);
}

// ── 成交结算（自动转移·幂等·离线对账）──
// 每端只结算自己那半：我是卖家→消费托管物(给买家·不归还)+收币；我是买家→得物+付币；旁观者只看历史。
// 按 record.id 记 applied，重连/重广播不重复结算。
const APPLIED_KEY = 'drpg-trade-applied';
function loadApplied(): string[] { try { return JSON.parse(localStorage.getItem(APPLIED_KEY) || '[]'); } catch { return []; } }
function isApplied(id: string): boolean { return loadApplied().includes(id); }
function markApplied(id: string) { try { const a = loadApplied(); if (!a.includes(id)) { a.push(id); localStorage.setItem(APPLIED_KEY, JSON.stringify(a.slice(-500))); } } catch { /* */ } }

// 交易货币名 → 钱包字段（魂币 = 灵魂钱币的短名）。未知货币返回 null（只转物品、不动钱）。
export function walletKey(currency: string): '乐园币' | '灵魂钱币' | null {
  if (currency === '乐园币') return '乐园币';
  if (currency === '魂币' || currency === '灵魂钱币' || currency === '魂钱币') return '灵魂钱币';
  return null;
}

// ── 货币托管（出价即托管：扣买家钱、存本地；成交付卖家、未成交退回）──
type CoinEntry = { token: string; listingId: string; offerId: string | null; price: number; currency: string; at: number };
function loadCoin(): Record<string, CoinEntry> { try { return JSON.parse(localStorage.getItem(COIN_KEY) || '{}'); } catch { return {}; } }
function saveCoin(m: Record<string, CoinEntry>) { try { localStorage.setItem(COIN_KEY, JSON.stringify(m)); } catch { /* */ } }
function returnCoin(e: CoinEntry) { const k = walletKey(e.currency); if (k && e.price > 0) { try { useItems.getState().adjustCurrency(k, e.price); } catch { /* */ } } }

/** 出价即扣款入托管（导出供单测）。返回 false=余额不足、未扣未托管。 */
export function escrowCoin(token: string, listingId: string, price: number, currency: string): boolean {
  const k = walletKey(currency);
  if (k && price > 0) {
    const bal = useItems.getState().currency[k] || 0;
    if (bal < price) return false;                       // 余额不足 → 不出价
    try { useItems.getState().adjustCurrency(k, -price); } catch { /* */ }
  }
  const cm = loadCoin(); cm[token] = { token, listingId, offerId: null, price, currency, at: Date.now() }; saveCoin(cm);
  return true;
}
/** 成交（我中标）→ 消费托管的钱（已付卖家·不退）。按 offerId 精确匹配、回退 listingId+price。返回是否找到。导出供单测。 */
export function consumeCoin(offerId: string, listingId: string, price: number): boolean {
  const cm = loadCoin();
  const e = Object.values(cm).find((x) => (!!offerId && x.offerId === offerId) || (x.listingId === listingId && x.price === price));
  if (e) { delete cm[e.token]; saveCoin(cm); return true; }
  return false;
}
/** 这条挂牌上我【未成交】的出价 → 退回托管的钱（被别人买走 / 下架 / 过期）。导出供单测。 */
export function refundCoinsForListing(listingId: string) {
  const cm = loadCoin(); let changed = false;
  for (const tok of Object.keys(cm)) { if (cm[tok].listingId === listingId) { returnCoin(cm[tok]); delete cm[tok]; changed = true; } }
  if (changed) saveCoin(cm);
}
/** 重连对账货币托管：我中标的消费、挂牌没了的退、未确认的补绑 offerId 或超时退、被挤掉的出价退。 */
function reconcileCoin(listings: TradeListing[], history: TradeRecord[]) {
  const me = useTrade.getState().me?.playerId;
  const won = new Set(history.filter((r) => r.buyerId === me).map((r) => r.offerId));
  const ids = new Set(listings.map((L) => L.id));
  const cm = loadCoin(); let changed = false; const now = Date.now();
  for (const tok of Object.keys(cm)) {
    const e = cm[tok];
    if (e.offerId && won.has(e.offerId)) { delete cm[tok]; changed = true; continue; }          // 已成交→消费（applyTrade 通常已删，兜底）
    if (!ids.has(e.listingId)) { returnCoin(e); delete cm[tok]; changed = true; continue; }      // 挂牌没了且非我中标→退
    const L = listings.find((x) => x.id === e.listingId);
    if (!e.offerId) {
      const off = L?.offers?.find((o) => o.clientToken === tok);
      if (off) { e.offerId = off.id; changed = true; }                                           // 补绑 offerId
      else if (now - e.at > 15000) { returnCoin(e); delete cm[tok]; changed = true; }            // 久未确认→退
    } else if (!L?.offers?.some((o) => o.id === e.offerId)) {
      returnCoin(e); delete cm[tok]; changed = true;                                             // 出价被挤出挂牌(超 MAX_OFFERS)→退
    }
  }
  if (changed) saveCoin(cm);
}

/** 一笔成交在本端的结算（幂等）。me 未就绪时跳过，等 hello 后由 history 对账补上。导出供单测。 */
export function applyTrade(rec?: TradeRecord) {
  if (!rec || !rec.id) return;
  const me = useTrade.getState().me?.playerId;
  if (!me || (rec.sellerId !== me && rec.buyerId !== me)) return;   // 旁观者：只看历史，不结算
  if (isApplied(rec.id)) return;
  const key = walletKey(rec.currency);
  if (rec.sellerId === me) {
    const mm = loadEscrow();
    const e = Object.values(mm).find((x) => x.listingId === rec.listingId);   // 托管物消费（已给买家，不 returnItem）
    if (e) { delete mm[e.token]; saveEscrow(mm); }
    if (key) { try { useItems.getState().adjustCurrency(key, rec.price); } catch { /* */ } }   // 收币
  } else {
    try { useItems.getState().addItem({ ...rec.item, id: undefined }); } catch { /* */ }       // 买家得物（新 id / 同名堆叠）
    // 付款已在出价时托管扣除：成交 → 消费该托管(不再扣)；找不到托管才兜底现扣(理论不该走到)
    if (!consumeCoin(rec.offerId, rec.listingId, rec.price) && key) {
      try { useItems.getState().adjustCurrency(key, -rec.price); } catch { /* */ }
    }
  }
  markApplied(rec.id);
}

function connect(name: string, token: string) {
  cleanup();
  manualClose = false;
  curName = (name || '').trim() || '道友';
  if (token) curToken = token;
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/trade/ws`
    + `?token=${encodeURIComponent(curToken)}`
    + `&name=${encodeURIComponent(curName)}`
    + `&avv=${chatAvatarVer()}`
    + `&ds=${encodeURIComponent(chatDicebearSeed())}`
    + `&nc=${encodeURIComponent(chatNameColor())}`;
  ws = new WebSocket(url);
  ws.onopen = () => { set({ status: 'connected', error: null }); startHb(); };
  ws.onmessage = (ev) => {
    if (ev.data === 'pong') return;
    let m: any; try { m = JSON.parse(ev.data); } catch { return; }
    dispatch(m);
  };
  ws.onclose = () => {
    stopHb();
    if (manualClose) { set({ status: 'closed' }); }
    else { set({ status: 'connecting' }); scheduleReconnect(); }
  };
  ws.onerror = () => { set({ error: '连接错误' }); };
}

function dispatch(m: TradeInbound) {
  const st = useTrade.getState();
  switch (m.type) {
    case 'hello':
      set({ me: m.you || null, listings: m.listings || [], online: m.online || 0, history: m.history || [] });
      (m.history || []).forEach(applyTrade);   // 离线期间的成交→重连补结算（先于托管对账：已成交的托管物/币会被消费，不会被误归还）
      reconcileEscrow(m.listings || []);
      reconcileCoin(m.listings || [], m.history || []);
      break;
    case 'listing_added':
      if (m.listing) {
        set({ listings: [m.listing, ...st.listings].slice(0, TRADE_MAX_LISTINGS) });
        const tok = m.listing.clientToken;                              // 我的上架确认 → 托管对上 listingId
        if (tok) { const mm = loadEscrow(); if (mm[tok]) { mm[tok].listingId = m.listing.id; saveEscrow(mm); } }
      }
      break;
    case 'offer_added':
      set({
        listings: st.listings.map((L: TradeListing) =>
          L.id === m.listingId ? { ...L, offers: [...(L.offers || []), m.offer] } : L,
        ),
      });
      { const tok = m.offer.clientToken; if (tok) { const cm = loadCoin(); if (cm[tok]) { cm[tok].offerId = m.offer.id; saveCoin(cm); } } }   // 我的出价确认 → 货币托管对上 offerId
      break;
    case 'listing_removed': {
      set({ listings: st.listings.filter((L: TradeListing) => L.id !== m.listingId) });
      if (m.reason !== 'sold') {   // 'sold' 的托管物已由 applyTrade 消费（给了买家），不归还；仅 closed/expired 才归还卖家
        const mm = loadEscrow();
        const e = Object.values(mm).find((x) => x.listingId === m.listingId);   // 我的挂牌下架/过期 → 归还物品
        if (e) { returnItem(e.item); delete mm[e.token]; saveEscrow(mm); }
      }
      refundCoinsForListing(m.listingId);   // 我在这条挂牌上未成交的出价 → 退币（中标那笔已由 trade_completed 消费）
      break;
    }
    case 'trade_completed':
      set({ history: [m.record, ...st.history].slice(0, 100) });   // 一笔成交进历史（最新在前，最多 100）
      applyTrade(m.record);   // 各端结算自己那半：卖家失物得币 / 买家得物失币（旁观者只看历史）
      break;
    case 'rate_limited':
      set({ error: RATE_MSG });
      setTimeout(() => { if (useTrade.getState().error === RATE_MSG) set({ error: null }); }, 1500);
      break;
    case 'error':
      set({ error: m.reason || m.error || '操作失败' });
      setTimeout(() => { const e = useTrade.getState().error; if (e === (m.reason || m.error || '操作失败')) set({ error: null }); }, 2500);
      break;
    default:
      assertNever(m);   // 新增 TradeInbound 类型却忘了在此处理 → 编译期报错（穷尽性守卫）
  }
}
function assertNever(_m: never): void { /* 仅用于穷尽性检查；运行时对未知 type 是 no-op */ }

// qty = 上架数量（部分上架：只挂 n 件，剩余留背包）。clamp 到 1..库存。
function listItem(item: any, qty: number, price: number, currency: string, note: string) {
  if (!item) return false;
  const max = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const n = Math.min(max, Math.max(1, Math.floor(Number(qty) || 1)));
  const token = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const snap = { ...stripItemSnapshot(item), quantity: n };            // 快照只挂 n 件
  const ok = sendRaw({ type: 'list_item', item: snap, price, currency, note, clientToken: token });
  if (!ok) return false;
  try { useItems.getState().consumeItem(item.id, n); } catch {}        // 上架即从背包扣 n 件（全扣→整条移除，部分→减库存）
  const mm = loadEscrow(); mm[token] = { token, item: snap, listingId: null, at: Date.now() }; saveEscrow(mm);
  setTimeout(() => {                                                    // 8s 没收到确认 → 视为失败，归还
    const m2 = loadEscrow(); const e = m2[token];
    if (e && !e.listingId) { returnItem(e.item); delete m2[token]; saveEscrow(m2); }
  }, 8000);
  return true;
}

// 出价：先扣款入货币托管（余额不足直接拒），再发还价；发送失败/8s 未确认则退币。
function makeOffer(listingId: string, price: number, message: string, currency: string): boolean {
  const token = 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (!escrowCoin(token, listingId, price, currency)) {
    set({ error: `${currency}不足，无法出价` });
    setTimeout(() => { if ((useTrade.getState().error || '').includes('不足')) set({ error: null }); }, 2500);
    return false;
  }
  const ok = sendRaw({ type: 'make_offer', listingId, price, message, clientToken: token });
  if (!ok) { const cm = loadCoin(); const e = cm[token]; if (e) { returnCoin(e); delete cm[token]; saveCoin(cm); } return false; }   // 发送失败 → 退币
  setTimeout(() => {   // 8s 没收到 offer_added 绑定 offerId → 视为失败，退币
    const cm = loadCoin(); const e = cm[token]; if (e && !e.offerId) { returnCoin(e); delete cm[token]; saveCoin(cm); }
  }, 8000);
  return true;
}

// 立即购买：先按挂牌价扣款入货币托管（余额不足直接拒），再发买断。8s 没成交则退币。
// 成交不需卖家在线：买家收 trade_completed 即得物 + 消费托管币；卖家的托管物在其下次上线由 hello→history 对账消费。
function buyListing(listing: TradeListing): boolean {
  const price = Math.max(0, Math.floor(Number(listing.price) || 0));
  const token = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (!escrowCoin(token, listing.id, price, listing.currency)) {
    set({ error: `${listing.currency}不足，无法购买` });
    setTimeout(() => { if ((useTrade.getState().error || '').includes('不足')) set({ error: null }); }, 2500);
    return false;
  }
  const ok = sendRaw({ type: 'buy_listing', listingId: listing.id, clientToken: token });
  if (!ok) { const cm = loadCoin(); const e = cm[token]; if (e) { returnCoin(e); delete cm[token]; saveCoin(cm); } return false; }   // 发送失败 → 退币
  setTimeout(() => {   // 8s 没成交（trade_completed 会消费掉托管）→ 视为失败（已售/下架/过期），退币
    const cm = loadCoin(); const e = cm[token]; if (e) { returnCoin(e); delete cm[token]; saveCoin(cm); }
  }, 8000);
  return true;
}

function sendRaw(obj: TradeOutbound) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function startHb() { stopHb(); hbTimer = setInterval(() => { try { ws?.send('ping'); } catch {} }, 25000); }
function stopHb() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }
function scheduleReconnect() {
  if (reconnectTimer || manualClose) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!manualClose) connect(curName, curToken); }, 2000);
}
function cleanup() {
  stopHb();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
}
function leave() {
  manualClose = true;
  cleanup();
  useTrade.getState().reset();
}

export const tradeClient = {
  connect,
  leave,
  listItem,
  makeOffer,
  buyListing,
  closeListing: (listingId: string) => sendRaw({ type: 'close_listing', listingId }),
  acceptOffer: (listingId: string, offerId: string) => sendRaw({ type: 'accept_offer', listingId, offerId }),
  isOpen: () => !!ws && ws.readyState === 1,
};
