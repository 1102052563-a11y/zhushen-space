// 云端表情包后端冒烟：本地 unstable_dev（R2 CLOUD_BUCKET + D1 DB 均为本地模拟）跑完整 上传→取图→列出→去重→隔离→删除→404。
// 跑法：在 multiplayer-worker/ 下  ->  node test-chat-sticker-cloud.mjs
import { unstable_dev } from 'wrangler';

let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(c, l) { if (c) { pass++; log('  PASS', l); } else { fail++; log('  FAIL', l); } }

// —— 自签 chatToken（本地无 DISCORD_CLIENT_SECRET → auth 派生用 'dev'）——
function bytesToB64url(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const strToB64url = (str) => bytesToB64url(new TextEncoder().encode(str));
async function signChatToken(payload, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('zhushen-chat-tok|' + (secret || 'dev')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = strToB64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + bytesToB64url(sig);
}

let worker;
async function main() {
  worker = await unstable_dev('src/index.js', { config: 'wrangler.toml', experimental: { disableExperimentalWarning: true, disableDevRegistry: true } });
  const BASE = `http://${worker.address}:${worker.port}`;
  log('worker up at', BASE);
  const tok = await signChatToken({ cuid: 1, name: 'Carliee', exp: Date.now() + 3600_000 });
  const AUTH = { Authorization: 'Bearer ' + tok };
  const body = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);   // 任意字节；类型由 Content-Type 决定

  check((await fetch(`${BASE}/api/multiplayer/diagnostics`).then((r) => r.json())).ok, 'diagnostics ok');

  // 鉴权 / 类型校验
  const noAuth = await fetch(`${BASE}/api/chat/sticker?name=x`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body });
  check(noAuth.status === 401, '未登录上传 → 401');
  const badType = await fetch(`${BASE}/api/chat/sticker?name=x`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'text/plain' }, body: 'hi' });
  check(badType.status === 415, '非图片类型 → 415');

  // 上传
  const up = await fetch(`${BASE}/api/chat/sticker?name=${encodeURIComponent('开心')}`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'image/png' }, body });
  const upj = await up.json();
  check(up.ok && !!upj.hash && upj.name === '开心' && upj.ct === 'image/png', '上传成功返回 hash/name(中文)/ct');
  const hash = upj.hash;

  // 公开取图（无需鉴权）+ 字节一致 + 长缓存
  const get = await fetch(`${BASE}/api/chat/sticker/${hash}`);
  const buf = new Uint8Array(await get.arrayBuffer());
  check(get.status === 200 && get.headers.get('content-type') === 'image/png', '公开取图 200 + content-type image/png');
  check(buf.length === body.length && buf[0] === 137, '取回字节与上传一致');
  check((get.headers.get('cache-control') || '').includes('immutable'), '取图带不可变长缓存');

  // 列出「我的」
  const list = await fetch(`${BASE}/api/chat/stickers`, { headers: AUTH }).then((r) => r.json());
  check(list.stickers?.some((s) => s.hash === hash && s.name === '开心'), '「我的」列表含刚上传');

  // 内容寻址去重：同图重传 → 同 hash，且不在「我的」里重复
  const up2 = await fetch(`${BASE}/api/chat/sticker?name=${encodeURIComponent('又传一次')}`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'image/png' }, body });
  const up2j = await up2.json();
  check(up2.ok && up2j.hash === hash, '同图重传 → 同 hash（内容寻址）');
  const list2 = await fetch(`${BASE}/api/chat/stickers`, { headers: AUTH }).then((r) => r.json());
  check(list2.stickers.filter((s) => s.hash === hash).length === 1, '同 uid 同图不重复（INSERT OR IGNORE）');

  // 隔离：他人(cuid=2)的「我的」不含我的贴纸
  const tok2 = await signChatToken({ cuid: 2, name: 'B', exp: Date.now() + 3600_000 });
  const list3 = await fetch(`${BASE}/api/chat/stickers`, { headers: { Authorization: 'Bearer ' + tok2 } }).then((r) => r.json());
  check(!(list3.stickers || []).some((s) => s.hash === hash), '他人「我的」按 uid 隔离（不含）');
  // 但他人仍能公开取到该图（发到聊天大家都看得见）
  check((await fetch(`${BASE}/api/chat/sticker/${hash}`)).status === 200, '他人也能公开取到该图（聊天可见）');

  // 公共池「大家的」：所有人上传的都能被大家浏览取用（无需鉴权）
  const pub1 = await fetch(`${BASE}/api/chat/stickers?scope=public`).then((r) => r.json());
  check(pub1.stickers?.some((s) => s.hash === hash), '公共池含 cuid=1 上传的（无需鉴权）');
  const body2 = new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21, 34]);
  const up3 = await fetch(`${BASE}/api/chat/sticker?name=${encodeURIComponent('B的图')}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'image/webp' }, body: body2 });
  const up3j = await up3.json();
  check(up3.ok && up3j.hash !== hash, 'cuid=2 上传另一张（不同 hash）');
  const pub2 = await fetch(`${BASE}/api/chat/stickers?scope=public`).then((r) => r.json());
  check(pub2.stickers.some((s) => s.hash === hash) && pub2.stickers.some((s) => s.hash === up3j.hash), '公共池含两人各自上传');
  // 同图多人传 → 公共池按 hash 去重为一条
  await fetch(`${BASE}/api/chat/sticker?name=x`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'image/png' }, body });   // cuid2 传 cuid1 同图
  const pub3 = await fetch(`${BASE}/api/chat/stickers?scope=public`).then((r) => r.json());
  check(pub3.stickers.filter((s) => s.hash === hash).length === 1, '同图多人传 → 公共池去重为一条');

  // 删除
  check((await fetch(`${BASE}/api/chat/sticker/${hash}`, { method: 'DELETE', headers: AUTH })).ok, '删除 200');
  const list4 = await fetch(`${BASE}/api/chat/stickers`, { headers: AUTH }).then((r) => r.json());
  check(!(list4.stickers || []).some((s) => s.hash === hash), '删除后「我的」不含');

  // 不存在的 hash → 404
  check((await fetch(`${BASE}/api/chat/sticker/${'0'.repeat(64)}`)).status === 404, '取不存在 hash → 404');
}

main()
  .then(() => log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`))
  .catch((e) => { fail++; console.error('HARNESS ERROR:', e); })
  .finally(async () => { try { await worker?.stop(); } catch {} process.exit(fail ? 1 : 0); });
