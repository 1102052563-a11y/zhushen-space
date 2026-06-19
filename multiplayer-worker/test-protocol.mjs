// 联机后端协议集成测试：本地起一份「新代码」worker（unstable_dev），
// 模拟 房主 + 2 来宾 + 中途加入者 走完整 WS 协议，断言广播/中继/补看/权限。
// 跑法：在 multiplayer-worker/ 下  ->  node test-protocol.mjs
// 仅测后端协议（建房/回合/世界快照/战斗/relay 赠予分享/补看/权限/重连），不测前端 UI。
import { unstable_dev } from 'wrangler';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(cond, label) { if (cond) { pass++; log('  PASS', label); } else { fail++; log('  FAIL', label); } }

function mkClient(WS_BASE, roomId, pid, name, want) {
  const url = `${WS_BASE}/api/multiplayer/rooms/${roomId}/ws?pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}&want=${want}`;
  const ws = new WebSocket(url);
  const msgs = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) { if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); } }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return {
    ws, msgs, ready,
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, timeout = 4000) => new Promise((resolve, reject) => {
      const hit = msgs.find(pred); if (hit) return resolve(hit);
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout: ' + pred)); }, timeout);
    }),
    close: () => { try { ws.close(); } catch {} },
  };
}
const has = (c, pred) => c.msgs.some(pred);

let worker;
async function main() {
  worker = await unstable_dev('src/index.js', {
    config: 'wrangler.toml',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  });
  const BASE = `http://${worker.address}:${worker.port}`;
  const WS_BASE = `ws://${worker.address}:${worker.port}`;
  log('worker up at', BASE);

  // 0. 健康检查
  const diag = await fetch(`${BASE}/api/multiplayer/diagnostics`).then((r) => r.json());
  check(diag.ok === true, '诊断 diagnostics ok');

  // 1. 建房（组队讨伐 raid 模式）
  const hostId = 'host-' + Math.random().toString(36).slice(2, 8);
  const created = await fetch(`${BASE}/api/multiplayer/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, hostName: '房主阿强', name: '讨伐测试房', maxSeats: 4, mode: 'raid' }),
  }).then((r) => r.json());
  const roomId = created.roomId;
  check(!!roomId, '建房成功 roomId=' + roomId);
  check(created.room?.mode === 'raid', '房间 mode=raid 已持久化（新后端字段）');

  // 2. GET 房间信息带 mode
  const info = await fetch(`${BASE}/api/multiplayer/rooms/${roomId}`).then((r) => r.json());
  check(info.room?.mode === 'raid', 'GET 房间信息 mode=raid');

  // 3. 房主连入
  const host = mkClient(WS_BASE, roomId, hostId, '房主阿强', 'play');
  await host.ready;
  const hrs = await host.waitFor((m) => m.type === 'room_state');
  check(hrs.you?.role === 'host', '房主 role=host');

  // 4. 两个来宾连入并入座
  const g1id = 'g1-' + Math.random().toString(36).slice(2, 8);
  const g2id = 'g2-' + Math.random().toString(36).slice(2, 8);
  const g1 = mkClient(WS_BASE, roomId, g1id, '小红', 'play');
  const g2 = mkClient(WS_BASE, roomId, g2id, '小明', 'play');
  await g1.ready; await g2.ready;
  const g1rs = await g1.waitFor((m) => m.type === 'room_state');
  const g2rs = await g2.waitFor((m) => m.type === 'room_state');
  check(g1rs.you?.role === 'player' && !!g1rs.you?.seatId, '来宾1 入座为 player');
  check(g2rs.you?.role === 'player' && !!g2rs.you?.seatId, '来宾2 入座为 player');
  const seat1 = g1rs.you.seatId, seat2 = g2rs.you.seatId;
  await sleep(250);
  check(has(host, (m) => m.type === 'seats_updated'), '房主收到 seats_updated（有人入座）');

  // 5. 房主开回合 → 来宾收到 turn_started
  host.send({ type: 'start_turn' });
  const ts1 = await g1.waitFor((m) => m.type === 'turn_started');
  check(ts1.turn?.phase === 'collecting', '来宾1 收到 turn_started(collecting)');

  // 6. 来宾提交行动+角色卡 → 房主收到 turn_updated + player_snapshots(带卡)
  g1.send({ type: 'submit_input', text: '我挥剑斩向BOSS', snapshot: { name: '小红', attrs: { str: 30 }, skills: [{ id: 's1', name: '斩击' }], items: [{ name: '回血丹' }] } });
  g2.send({ type: 'submit_input', text: '我放火球', snapshot: { name: '小明', attrs: { int: 40 }, skills: [], items: [] } });
  const tu = await host.waitFor((m) => m.type === 'turn_updated' && m.turn?.inputs && Object.keys(m.turn.inputs).length >= 1);
  check(!!tu, '房主收到 turn_updated（含来宾行动文本）');
  const ps = await host.waitFor((m) => m.type === 'player_snapshots' && m.seats?.some((s) => s.snapshot?.name === '小红'));
  check(!!ps, 'player_snapshots 携带来宾角色卡（房主据此组装 MP_ 战斗角色）');

  // 7. 房主广播世界快照（含正文）→ 来宾收到 world_snapshot + turn_resolved；transcript 累积
  host.send({ type: 'publish_world_snapshot', payload: { narrative: 'BOSS被你们打得节节败退……', turnUser: '【全队行动】小红斩击 / 小明火球', world: { npc: {}, faction: {}, misc: {} } } });
  const ws1 = await g1.waitFor((m) => m.type === 'world_snapshot' && !m.replay);
  check(ws1.payload?.narrative?.includes('节节败退'), '来宾1 收到本回合正文 world_snapshot');
  const tr1 = await g1.waitFor((m) => m.type === 'turn_resolved');
  check(tr1.turn?.phase === 'resolved', '来宾1 收到 turn_resolved');

  // 8. 房主广播战斗快照 → 来宾收到 combat_snapshot（观战）
  host.send({ type: 'publish_combat_snapshot', payload: { battle: { active: true, round: 1, order: ['B1', 'MP_' + seat1, 'BOSS'] } } });
  const cs1 = await g1.waitFor((m) => m.type === 'combat_snapshot');
  check(cs1.payload?.battle?.round === 1, '来宾1 收到 combat_snapshot');

  // 9. 来宾提交战斗出手 → 房主收到 combat_action_updated（带 seatId 用于结算）
  g1.send({ type: 'submit_combat_action', payload: { kind: 'attack', targetIds: ['BOSS'] } });
  const cau = await host.waitFor((m) => m.type === 'combat_action_updated' && m.seatId === seat1);
  check(cau.payload?.kind === 'attack', '房主收到来宾1 的 combat_action_updated');

  // 10. relay：房主广播 raid_boss → 来宾收到 relayed(from=host)
  host.send({ type: 'relay', event: 'raid_boss', payload: { name: '噬渊魔龙', difficulty: 'nightmare' } });
  const rb = await g1.waitFor((m) => m.type === 'relayed' && m.event === 'raid_boss');
  check(rb.payload?.name === '噬渊魔龙' && rb.from?.role === 'host', '来宾1 收到 relayed raid_boss（from 房主）');

  // 11. relay：来宾1 赠予来宾2 → relayed 带发送者座位信息
  g1.send({ type: 'relay', event: 'gift_offer', payload: { toPlayerId: g2id, items: [{ name: '回血丹' }] } });
  const gift = await g2.waitFor((m) => m.type === 'relayed' && m.event === 'gift_offer');
  check(gift.from?.seatId === seat1 && gift.payload?.toPlayerId === g2id, '来宾2 收到 relayed gift_offer（from 来宾1）');

  // 12. 房间聊天弹幕 → 全员收到 room_comment
  g2.send({ type: 'send_room_comment', text: '稳住能赢！' });
  const cm = await g1.waitFor((m) => m.type === 'room_comment' && m.comment);
  check(cm.comment?.text === '稳住能赢！', '来宾1 收到 room_comment');

  // 13. 权限：来宾尝试 start_turn → 被拒 forbidden
  g1.send({ type: 'start_turn' });
  const den = await g1.waitFor((m) => m.type === 'error' && m.error === 'forbidden');
  check(!!den, '来宾 start_turn 被拒（仅房主）');

  // 14. 中途加入：一次性补全 room_state + world(replay) + narrative_log + combat + comments backlog
  const lateId = 'late-' + Math.random().toString(36).slice(2, 8);
  const late = mkClient(WS_BASE, roomId, lateId, '迟到道友', 'play');
  await late.ready;
  await late.waitFor((m) => m.type === 'room_state');
  const lw = await late.waitFor((m) => m.type === 'world_snapshot' && m.replay === true);
  check(!!lw, '中途加入者收到 world_snapshot(replay=true)');
  const ln = await late.waitFor((m) => m.type === 'narrative_log');
  check(ln.entries?.length >= 1 && ln.entries.some((e) => String(e.content).includes('节节败退')), '中途加入者收到 narrative_log 补看正文');
  const lc = await late.waitFor((m) => m.type === 'combat_snapshot');
  check(!!lc, '中途加入者收到 combat_snapshot');
  const lb = await late.waitFor((m) => m.type === 'room_comment' && m.backlog);
  check(lb.backlog?.length >= 1, '中途加入者收到弹幕 backlog');

  // 15. 同 pid 重连 → 踢掉旧连接
  const g1b = mkClient(WS_BASE, roomId, g1id, '小红', 'play');
  await g1b.ready;
  await sleep(400);
  check(g1.ws.readyState === WebSocket.CLOSED || g1.ws.readyState === WebSocket.CLOSING, '来宾1 旧连接在同 pid 重连时被踢');

  // 16. 房主关房 → 其他人收到 room_closed
  host.send({ type: 'close_room' });
  const rc = await g2.waitFor((m) => m.type === 'room_closed');
  check(!!rc, '来宾2 收到 room_closed');

  await sleep(200);
  [host, g1, g1b, g2, late].forEach((c) => c.close());
}

main()
  .then(() => log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`))
  .catch((e) => { fail++; console.error('HARNESS ERROR:', e); })
  .finally(async () => { try { await worker?.stop(); } catch {} process.exit(fail ? 1 : 0); });
