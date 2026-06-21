// 交易行「历史成交」后端冒烟：unstable_dev（D1/R2 不涉及，纯 TradeDO 内存+storage）跑
// 上架→还价→(非卖家拒)→卖家接受=成交→trade_completed+listing_removed→新连接 hello.history 含记录。
// 跑法：在 multiplayer-worker/ 下  ->  node test-trade-history.mjs
import { unstable_dev } from 'wrangler';

let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(c, l) { if (c) { pass++; log('  PASS', l); } else { fail++; log('  FAIL', l); } }

// 自签 chatToken（本地无 DISCORD_CLIENT_SECRET → 派生用 'dev'；/api/trade/ws 验签后 pid=chat:<cuid>）
function b64u(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const strB64u = (s) => b64u(new TextEncoder().encode(s));
async function mkToken(cuid, name) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('zhushen-chat-tok|dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = strB64u(JSON.stringify({ cuid, name, exp: Date.now() + 3600_000 }));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64u(sig);
}

function mkClient(WS_BASE, token, name) {
  const url = `${WS_BASE}/api/trade/ws?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;
  const ws = new WebSocket(url);
  const msgs = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    if (ev.data === 'pong') return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return {
    ws, msgs, ready,
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, t = 4000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout: ' + pred)); }, t);
    }),
    close: () => { try { ws.close(); } catch {} },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let worker;
async function main() {
  worker = await unstable_dev('src/index.js', { config: 'wrangler.toml', experimental: { disableExperimentalWarning: true, disableDevRegistry: true } });
  const WS_BASE = `ws://${worker.address}:${worker.port}`;
  log('worker up at', WS_BASE);
  const tSeller = await mkToken(1, '卖家甲');
  const tBuyer = await mkToken(2, '买家乙');

  // 1. 卖家上架
  const seller = mkClient(WS_BASE, tSeller, '卖家甲');
  await seller.ready; await seller.waitFor((m) => m.type === 'hello');
  seller.send({ type: 'list_item', item: { name: '九转还魂丹', gradeDesc: '极品' }, price: 100, currency: '乐园币', note: '清仓', clientToken: 'tk1' });
  const added = await seller.waitFor((m) => m.type === 'listing_added');
  const listingId = added.listing.id;
  check(!!listingId && added.listing.item.name === '九转还魂丹', '卖家上架成功');

  // 2. 买家还价
  const buyer = mkClient(WS_BASE, tBuyer, '买家乙');
  await buyer.ready; await buyer.waitFor((m) => m.type === 'hello');
  buyer.send({ type: 'make_offer', listingId, price: 80, message: '80 收' });
  const offerMsg = await seller.waitFor((m) => m.type === 'offer_added' && m.listingId === listingId);
  const offerId = offerMsg.offer.id;
  check(!!offerId && offerMsg.offer.buyerName === '买家乙' && offerMsg.offer.price === 80, '买家还价 80 卖家可见');

  // 3. 非卖家（买家自己）尝试接受 → forbidden（先等过买家刚还价的防刷窗口 MIN_INTERVAL，否则会先被 rate_limited 拦下）
  await sleep(1300);
  buyer.send({ type: 'accept_offer', listingId, offerId });
  const denied = await buyer.waitFor((m) => m.type === 'error', 3000).catch(() => null);
  check(denied && denied.error === 'forbidden', '非卖家接受还价 → forbidden');
  await sleep(300);
  check(seller.msgs.every((m) => m.type !== 'trade_completed'), '非卖家接受未产生成交');

  // 4. 卖家接受 → 成交：trade_completed + listing_removed
  await sleep(1300);   // 过防刷窗口(MIN_INTERVAL=1200)
  seller.send({ type: 'accept_offer', listingId, offerId });
  const done = await seller.waitFor((m) => m.type === 'trade_completed');
  const r = done.record;
  check(!!r && r.item.name === '九转还魂丹', '成交记录含物品');
  check(r.sellerName === '卖家甲' && r.buyerName === '买家乙', '成交记录含买卖双方');
  check(r.price === 80 && r.currency === '乐园币', '成交记录含价格(=还价80)+货币');
  check(r.sellerId === 'chat:1' && r.buyerId === 'chat:2', '成交记录买卖方 UID 正确');
  const removed = await seller.waitFor((m) => m.type === 'listing_removed' && m.listingId === listingId);
  check(removed.reason === 'sold', '成交后挂牌下架(reason=sold)');

  // 5. 买家也收到这两条广播（全员公开）
  check(buyer.msgs.some((m) => m.type === 'trade_completed' && m.record.id === r.id), '买家也收到 trade_completed(公开)');

  // 6. 新连接 hello.history 含这笔（持久化）
  const late = mkClient(WS_BASE, await mkToken(3, '路人丙'), '路人丙');
  await late.ready;
  const lateHello = await late.waitFor((m) => m.type === 'hello');
  check(Array.isArray(lateHello.history) && lateHello.history.some((x) => x.id === r.id), '新连接 hello.history 含该成交(持久)');
  check(lateHello.listings.every((L) => L.id !== listingId), '新连接看不到已成交的挂牌');

  [seller, buyer, late].forEach((c) => c.close());
}

main()
  .then(() => log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`))
  .catch((e) => { fail++; console.error('HARNESS ERROR:', e); })
  .finally(async () => { try { await worker?.stop(); } catch {} process.exit(fail ? 1 : 0); });
