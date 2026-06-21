import { useTrade, TRADE_MAX_LISTINGS, type TradeListing } from '../store/tradeStore';
import { useItems } from '../store/itemStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import type { TradeInbound, TradeOutbound } from './tradeProtocol';

// 全局交易行 WebSocket 客户端（事件名照搬后端 TradeDO 协议）。
// 与聊天室共用 Discord 身份：连接带 chatToken(→后端 pid=chat:uid) + 头像/名牌(avv/ds/nc)，挂牌/还价显示同一身份。
// 心跳发字符串 "ping"。打开面板时 connect，关闭时 leave。断线自动重连（主动离开除外）。
//
// 上架托管（offline-safe）：上架即从背包扣物，存本地「托管」(localStorage·持久)；
//   listing_added 把托管对上 listingId；listing_removed(手动下架/到期)或重连 hello 对账时把物品归还背包。
//   物品全程只在本机背包↔托管间搬动，后端只存快照，故离线到期、刷新都不丢物。

const RATE_MSG = '操作太快了，稍等一下';
const ESCROW_KEY = 'drpg-trade-escrow';

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
function returnItem(item: any) { try { useItems.getState().addItem({ ...item }); } catch {} }

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
      set({ me: m.you || null, listings: m.listings || [], online: m.online || 0 });
      reconcileEscrow(m.listings || []);
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
      break;
    case 'listing_removed': {
      set({ listings: st.listings.filter((L: TradeListing) => L.id !== m.listingId) });
      const mm = loadEscrow();
      const e = Object.values(mm).find((x) => x.listingId === m.listingId);   // 我的挂牌被下架/过期 → 归还物品
      if (e) { returnItem(e.item); delete mm[e.token]; saveEscrow(mm); }
      break;
    }
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

function listItem(item: any, price: number, currency: string, note: string) {
  if (!item) return false;
  const token = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const snap = stripItemSnapshot(item);
  const ok = sendRaw({ type: 'list_item', item: snap, price, currency, note, clientToken: token });
  if (!ok) return false;
  try { useItems.getState().removeItem(item.id); } catch {}            // 上架即从背包扣物
  const mm = loadEscrow(); mm[token] = { token, item: snap, listingId: null, at: Date.now() }; saveEscrow(mm);
  setTimeout(() => {                                                    // 8s 没收到确认 → 视为失败，归还
    const m2 = loadEscrow(); const e = m2[token];
    if (e && !e.listingId) { returnItem(e.item); delete m2[token]; saveEscrow(m2); }
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
  makeOffer: (listingId: string, price: number, message: string) =>
    sendRaw({ type: 'make_offer', listingId, price, message }),
  closeListing: (listingId: string) => sendRaw({ type: 'close_listing', listingId }),
  isOpen: () => !!ws && ws.readyState === 1,
};
