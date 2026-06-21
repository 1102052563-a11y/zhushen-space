// 聊天室「重连不掉线」回归测试：复现并验证「同一 UID 重连/多标签时被误报离开、从名单消失」的修复。
// 跑法：在 multiplayer-worker/ 下  ->  node test-chat-reconnect.mjs
// 本地 unstable_dev 无 DISCORD_CLIENT_SECRET → auth 派生用 'dev'，故可在此自签 chatToken。
import { unstable_dev } from 'wrangler';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(cond, label) { if (cond) { pass++; log('  PASS', label); } else { fail++; log('  FAIL', label); } }

// —— 复刻 auth.js 的 base64url + HMAC-SHA256 签名 ——
function bytesToB64url(bytes) {
  let s = ''; const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const strToB64url = (str) => bytesToB64url(new TextEncoder().encode(str));
async function signChatToken(payload, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('zhushen-chat-tok|' + (secret || 'dev')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = strToB64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + bytesToB64url(sig);
}
const mkToken = (cuid, name) => signChatToken({ cuid, name, exp: Date.now() + 3600_000 });

function mkChat(WS_BASE, token, name) {
  const url = `${WS_BASE}/api/chat/ws?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;
  const ws = new WebSocket(url);
  const msgs = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    if (ev.data === 'pong') return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) { if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); } }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const latestRoster = () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].roster) return msgs[i].roster; return null; };
  return {
    ws, msgs, ready,
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, timeout = 4000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout: ' + pred)); }, timeout);
    }),
    rosterLen: () => { const r = latestRoster(); return r ? r.length : -1; },
    rosterHas: (pid) => { const r = latestRoster(); return !!r && r.some((x) => x.playerId === pid); },
    close: () => { try { ws.close(); } catch {} },
  };
}

let worker;
async function main() {
  worker = await unstable_dev('src/index.js', { config: 'wrangler.toml', experimental: { disableExperimentalWarning: true, disableDevRegistry: true } });
  const WS_BASE = `ws://${worker.address}:${worker.port}`;
  log('worker up at', WS_BASE);

  const tokA = await mkToken('1', 'Carliee');   // pid = chat:1
  const tokC = await mkToken('28', '仿生人');    // pid = chat:28
  const PIDA = 'chat:1', PIDC = 'chat:28';

  // 1. A(Carliee) 连入
  const a = mkChat(WS_BASE, tokA, 'Carliee');
  await a.ready;
  const aHello = await a.waitFor((m) => m.type === 'hello');
  check(aHello.you?.playerId === PIDA, 'A hello pid=chat:1');

  // 2. C(仿生人) 连入 → A 收到「进入」，双方名单含 2 人
  const c = mkChat(WS_BASE, tokC, '仿生人');
  await c.ready;
  await c.waitFor((m) => m.type === 'hello');
  await a.waitFor((m) => m.type === 'presence' && m.join?.name === '仿生人');
  check(a.rosterLen() === 2 && a.rosterHas(PIDA) && a.rosterHas(PIDC), 'A 名单含自己+仿生人=2');
  check(c.rosterHas(PIDA) && c.rosterHas(PIDC), 'C 名单含双方');

  // 2.5 表情包（大贴纸）：A 发内置贴纸 → C 收到带 sticker 引用的 message；非法 data: 外链被服务端拒绝
  a.send({ type: 'sticker', sticker: { pack: 'mood', id: 'haha' } });
  const stk = await c.waitFor((m) => m.type === 'message' && m.message?.sticker);
  check(stk.message.sticker.pack === 'mood' && stk.message.sticker.id === 'haha', 'C 收到 A 的内置贴纸(pack=mood,id=haha)');
  await sleep(800);   // 过防刷窗口，确保下面被拒是因校验而非限速
  const stkMark = c.msgs.length;
  a.send({ type: 'sticker', sticker: { url: 'data:image/svg+xml,<svg/>' } });   // 仅允许 https 外链 → data: 必须被拒
  await sleep(400);
  check(!c.msgs.slice(stkMark).some((m) => m.type === 'message' && m.message?.sticker), '非法 data: 贴纸被服务端拒绝(不广播)');

  // 3. ★核心修复：A 同 UID 重连（第二连接 a2，模拟换标签/网络重连/改头像色触发的 connect()）
  const cBefore = a2reconnectMark(c);
  const a2 = mkChat(WS_BASE, tokA, 'Carliee');
  await a2.ready;
  const a2Hello = await a2.waitFor((m) => m.type === 'hello');
  check(a2Hello.roster?.some((r) => r.playerId === PIDA) && a2Hello.roster?.some((r) => r.playerId === PIDC),
        'A2(重连) hello 名单仍含自己+仿生人（不被自己顶掉）');
  await sleep(400);
  check(!c.msgs.slice(cBefore).some((m) => m.type === 'presence' && m.leave),
        'C 在 A 重连期间【没有】收到任何「离开」播报 ← 修复点');
  check(c.rosterHas(PIDA) && c.rosterHas(PIDC) && c.rosterLen() === 2,
        'C 名单仍是 2 人（A 没被误删）← 复现的「只剩别人在线」已修');

  // 4. 关掉旧连接 a（a2 仍在）→ 人没走：C 不应收到「离开」，A2 也不该看到自己离开
  const cMark = c.msgs.length, a2Mark = a2.msgs.length;
  a.close();
  await sleep(600);
  check(!c.msgs.slice(cMark).some((m) => m.type === 'presence' && m.leave),
        '关掉 A 旧连接后 C 仍【未】收到「离开」（人还在另一连接）');
  check(c.rosterHas(PIDA) && c.rosterLen() === 2, '关旧连接后 C 名单仍 2 人含 A');
  check(!a2.msgs.slice(a2Mark).some((m) => m.type === 'presence' && m.leave?.name === 'Carliee'),
        'A2 没收到「Carliee 离开」(不再自我踢出)');

  // 5. 关掉最后一个 A 连接 a2 → 这才是真离开：C 收到 leave，名单降到 1
  a2.close();
  const trueLeave = await c.waitFor((m) => m.type === 'presence' && m.leave?.name === 'Carliee', 4000).catch(() => null);
  check(!!trueLeave, 'A 全部连接断开后 C 才收到「Carliee 离开」');
  check(!c.rosterHas(PIDA) && c.rosterLen() === 1, 'A 真离开后 C 名单降为 1（仅仿生人）');

  c.close();
}
function a2reconnectMark(c) { return c.msgs.length; }

main()
  .then(() => log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`))
  .catch((e) => { fail++; console.error('HARNESS ERROR:', e); })
  .finally(async () => { try { await worker?.stop(); } catch {} process.exit(fail ? 1 : 0); });
