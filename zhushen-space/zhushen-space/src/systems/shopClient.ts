import { useShopMarket } from '../store/shopMarketStore';
import type { ShopEntity } from '../store/shopStore';
import { useItems } from '../store/itemStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import { shrinkDataUrl } from './imageGen';
import { pushSceneNotice } from './allocNotice';
import type { PublishedShop, ShopInbound, ShopOutbound } from './shopProtocol';

// 玩家产业·商城 WebSocket 客户端（事件名照搬后端 ShopDO 协议）。
// 与聊天室共用 Discord 身份：连接带 chatToken(→后端 pid=chat:uid) + 头像/名牌(avv/ds/nc)，店卡显示同一身份。
// 心跳发字符串 "ping"。打开「逛商城」Tab 时 connect，关闭时 leave。断线自动重连（主动离开除外）。
// 范式同 systems/assistClient.ts，但对象是店铺快照——上传店 / 下架 / 光顾计数；买货物化在光顾者前端完成，不走后端结算。

const RATE_MSG = '操作太快了，稍等一下';

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let manualClose = false;
let curName = '道友';
let curToken = '';

function set(p: Partial<ReturnType<typeof useShopMarket.getState>>) { useShopMarket.getState()._set(p as any); }

function upsertShop(shops: PublishedShop[], shop: PublishedShop): PublishedShop[] {
  return [shop, ...shops.filter((c) => c.id !== shop.id)];
}

// 立绘缩略：data: 图压成缩略图；http 图直接引用；无图则空。
async function thumb(raw?: string): Promise<string> {
  try {
    if (raw && raw.startsWith('data:image/')) return await shrinkDataUrl(raw, 256, 0.7);
    if (raw && /^https?:\/\//.test(raw)) return raw;
  } catch { /* 无图就不带立绘 */ }
  return '';
}

// 组装上传快照：全部立绘缩略（店招 / 商品图 / 娼妇立绘 / 铁匠立绘），其余文本/payload 原样透传。
async function buildSnapshot(shop: ShopEntity): Promise<any> {
  // 立绘图集缩略上传·各类封顶张数限 DO 载荷（本地可存至 MAX_GALLERY，联机只带前若干张预览）
  const gallery = async (arr: string[] | undefined, cover: string | undefined, cap: number) => {
    const raw = (arr && arr.length ? arr : (cover ? [cover] : [])).slice(0, cap);
    return (await Promise.all(raw.map(thumb))).filter(Boolean);
  };
  const signs = await gallery(shop.signs, shop.sign, 12);
  const sign = signs[0] || '';   // 封面（兼容旧客户端只读 sign）
  const goods = await Promise.all((shop.goods ?? []).map(async (g) => { const images = await gallery(g.images, g.image, 4); return { ...g, image: images[0] || '', images }; }));
  const girls = await Promise.all((shop.girls ?? []).map(async (g) => { const images = await gallery(g.images, g.portrait, 6); return { ...g, portrait: images[0] || '', images }; }));
  const smith = shop.smith ? await (async () => { const portraits = await gallery(shop.smith!.portraits, shop.smith!.boss.portrait, 6); return { ...shop.smith!, portraits, boss: { ...shop.smith!.boss, portrait: portraits[0] || '' } }; })() : undefined;
  return {
    type: shop.type, name: shop.name, intro: shop.intro, tagline: shop.tagline, ownerPersona: shop.ownerPersona,
    currency: shop.currency, entryFee: shop.entryFee, world: shop.world, sign, signs, goods, girls, smith,
  };
}

function connect(name: string, token: string) {
  cleanup();
  manualClose = false;
  curName = (name || '').trim() || '道友';
  if (token) curToken = token;
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/shop/ws`
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

function dispatch(m: ShopInbound) {
  const st = useShopMarket.getState();
  switch (m.type) {
    case 'hello':
      set({ me: m.you || null, shops: m.shops || [], online: m.online || 0, revenue: m.revenue || {} });
      break;
    case 'revenue':
      set({ revenue: m.pending || {} });
      break;
    case 'revenue_collected': {
      const amts = m.amounts || {};
      const parts: string[] = [];
      for (const c of Object.keys(amts)) {
        const n = Math.round(Number(amts[c]) || 0);
        if (n > 0 && (c === '乐园币' || c === '灵魂钱币')) { useItems.getState().adjustCurrency(c, n, '产业·云端营收领取'); parts.push(`${n} ${c}`); }
      }
      if (parts.length) pushSceneNotice(`【场外·产业】领取云端营收 ${parts.join(' / ')}（他人光顾我店·已入储存空间）`);
      break;
    }
    case 'shop_added':
      if (m.shop) set({ shops: upsertShop(st.shops, m.shop) });
      break;
    case 'shop_removed':
      set({ shops: st.shops.filter((c) => c.id !== m.shopId) });
      break;
    case 'shop_visited':
      set({ shops: st.shops.map((c) => (c.id === m.shopId ? { ...c, visits: m.visits } : c)) });
      break;
    case 'rate_limited':
      set({ error: RATE_MSG });
      setTimeout(() => { if (useShopMarket.getState().error === RATE_MSG) set({ error: null }); }, 1500);
      break;
    case 'error':
      set({ error: m.reason || m.error || '操作失败' });
      setTimeout(() => { const e = useShopMarket.getState().error; if (e === (m.reason || m.error || '操作失败')) set({ error: null }); }, 2500);
      break;
    default:
      assertNever(m);
  }
}
function assertNever(_m: never): void { /* 穷尽性检查；运行时对未知 type 是 no-op */ }

// 上传/更新我的一家店（同 owner+srcId 一店；后端 upsert，更新不清零光顾计数）。
async function publishShop(shop: ShopEntity): Promise<boolean> {
  if (!shop?.name) {
    set({ error: '店铺无效' });
    setTimeout(() => { if (useShopMarket.getState().error === '店铺无效') set({ error: null }); }, 2000);
    return false;
  }
  const snapshot = await buildSnapshot(shop);
  return sendRaw({ type: 'publish_shop', srcId: shop.id, shopType: shop.type, name: shop.name, snapshot });
}

function sendRaw(obj: ShopOutbound) {
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
  useShopMarket.getState().reset();
}

export const shopClient = {
  connect,
  leave,
  publishShop,
  removeShop: (shopId: string) => sendRaw({ type: 'remove_shop', shopId }),
  visit: (shopId: string) => sendRaw({ type: 'visit', shopId }),
  reportEarn: (shopId: string, amount: number, currency: string) => sendRaw({ type: 'earn', shopId, amount, currency }),   // 在他人店消费 → 记进店主云端营收
  collectRevenue: () => sendRaw({ type: 'collect_revenue' }),
  isOpen: () => !!ws && ws.readyState === 1,
};
