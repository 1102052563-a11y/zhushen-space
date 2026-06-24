// 聊天室「自定义 UID（靓号）」后端冒烟：unstable_dev，自签云会话令牌打 /api/chat/me。
// 跑法：在 multiplayer-worker/ 下 -> node test-chat-uid.mjs
import { unstable_dev } from 'wrangler';

let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(c, l) { if (c) { pass++; log('  PASS', l); } else { fail++; log('  FAIL', l); } }

function b64u(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const strB64u = (s) => b64u(new TextEncoder().encode(s));
function b64uToStr(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return new TextDecoder().decode(Uint8Array.from(atob(s + pad), (c) => c.charCodeAt(0))); }
async function sign(payload, purpose) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(purpose + '|dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = strB64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64u(sig);
}
const cloudTok = (uid) => sign({ uid, name: 'X', exp: Date.now() + 3600_000 }, 'zhushen-cloud-sess');
const decodeDu = (chatToken) => JSON.parse(b64uToStr(chatToken.split('.')[0])).du;

let worker;
async function main() {
  worker = await unstable_dev('src/index.js', { config: 'wrangler.toml', experimental: { disableExperimentalWarning: true, disableDevRegistry: true } });
  const BASE = `http://${worker.address}:${worker.port}`;
  log('up', BASE);
  const me = async (cloud, body) => (await fetch(`${BASE}/api/chat/me`, { method: 'POST', headers: { Authorization: 'Bearer ' + cloud, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

  const A = await cloudTok('discord_A');
  let a = await me(A, {});
  check(a.uid >= 1, '用户A 分配顺序 uid=' + a.uid);
  check(a.displayUid === a.uid && a.customUid == null, '初始 displayUid=uid·无自定义');
  const aUid = a.uid;

  a = await me(A, { customUid: 888 });
  check(a.displayUid === 888 && a.customUid === 888 && !a.uidLocked, 'A 设自定义 #888 成功');
  check(decodeDu(a.chatToken) === 888, 'chatToken 里 du=888（显示号进签名令牌·权威）');

  a = await me(A, { customUid: 999 });
  check(a.uidLocked && a.displayUid === 888, 'A 2 天内再改被冷却锁·仍 #888');

  const B = await cloudTok('discord_B');
  let b = await me(B, {});
  check(b.uid !== aUid, 'B 另一顺序 uid=' + b.uid);
  b = await me(B, { customUid: 888 });
  check(b.uidLocked && /占用/.test(b.uidLockMsg || ''), 'B 抢已占用的 #888 被拒');
  b = await me(B, { customUid: 666 });
  check(b.displayUid === 666 && !b.uidLocked, 'B 设没占用的 #666 成功');

  // B 不能抢 A 的「内部顺序 uid」(防冒充原始号)
  const B2 = await cloudTok('discord_B');
  const bGrabSeq = await me(B2, { customUid: aUid });
  check(bGrabSeq.uidLocked, 'B 抢 A 的原始顺序号 #' + aUid + ' 也被拒');

  // WS：A 的显示号经令牌注入 → roster/hello.you.du=888（权威·非客户端伪造）
  const aChat = (await me(A, {})).chatToken;
  const WS = `ws://${worker.address}:${worker.port}`;
  const ws = new WebSocket(`${WS}/api/chat/ws?token=${encodeURIComponent(aChat)}&name=X`);
  const hello = await new Promise((res, rej) => {
    ws.addEventListener('message', (ev) => { if (ev.data === 'pong') return; try { res(JSON.parse(ev.data)); } catch { /* */ } });
    ws.addEventListener('error', rej); setTimeout(() => rej(new Error('timeout')), 4000);
  });
  check(hello.you?.du === 888, 'WS hello.you.du=888（ChatDO 用令牌注入的显示号）');
  ws.close();
}

main()
  .then(() => log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`))
  .catch((e) => { fail++; console.error('HARNESS ERROR:', e); })
  .finally(async () => { try { await worker?.stop(); } catch {} process.exit(fail ? 1 : 0); });
