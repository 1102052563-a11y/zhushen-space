import { useMp } from '../store/multiplayerStore';
import { mpBase, mpWsBase, myPlayerId } from './mpConfig';
import { restoreWorldBackup } from './mpSnapshot';

// 联机 WebSocket 客户端（事件名照搬后端协议）。心跳发字符串 "ping"（运行时自动回 pong，不唤醒 DO）。
// 断线自动重连（房主关房 / 主动离开除外）。所有状态写进 multiplayerStore，UI 订阅。

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let curRoom: string | null = null;
let curName = '道友';
let curWant: 'play' | 'watch' = 'play';
let manualClose = false;

function set(p: any) { useMp.getState()._set(p); }

async function createRoom(opts: { name: string; hostName: string; maxSeats?: number; visibility?: string }) {
  const r = await fetch(`${mpBase()}/api/multiplayer/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId: myPlayerId(),
      hostName: opts.hostName,
      name: opts.name,
      maxSeats: opts.maxSeats,
      visibility: opts.visibility,
    }),
  });
  if (!r.ok) throw new Error('建房失败 ' + r.status);
  const data = await r.json();
  return data.roomId as string;
}

async function listRooms() {
  const r = await fetch(`${mpBase()}/api/multiplayer/rooms`);
  if (!r.ok) throw new Error('大厅获取失败 ' + r.status);
  const d = await r.json();
  return (d.rooms || []) as any[];
}

function connect(roomId: string, opts: { name: string; want: 'play' | 'watch' }) {
  cleanupSocket();
  manualClose = false;
  curRoom = roomId; curName = opts.name; curWant = opts.want;
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/multiplayer/rooms/${roomId}/ws`
    + `?pid=${encodeURIComponent(myPlayerId())}`
    + `&name=${encodeURIComponent(opts.name)}`
    + `&want=${opts.want}`;
  ws = new WebSocket(url);
  ws.onopen = () => { set({ status: 'connected' }); startHb(); };
  ws.onmessage = (ev) => {
    if (ev.data === 'pong') return;            // 心跳自动响应
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

function sendRaw(obj: any) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}

function startHb() { stopHb(); hbTimer = setInterval(() => { try { ws?.send('ping'); } catch {} }, 25000); }
function stopHb() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }
function scheduleReconnect() {
  if (reconnectTimer || manualClose || !curRoom) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualClose && curRoom) connect(curRoom, { name: curName, want: curWant });
  }, 2000);
}
function cleanupSocket() {
  stopHb();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
}

function leave() {
  manualClose = true;
  sendRaw({ type: 'leave_room' });
  cleanupSocket();
  curRoom = null;
  restoreWorldBackup();   // 还原来宾自己的世界（房主无备份则 no-op）
  useMp.getState().reset();
}

function dispatch(m: any) {
  const st = useMp.getState();
  switch (m.type) {
    case 'room_state':
      set({
        room: m.room ? { ...m.room } : null,
        seats: m.room?.seats || [],
        turn: m.room?.turn || null,
        role: m.you?.role ?? st.role,
        mySeatId: m.you?.seatId ?? st.mySeatId,
      });
      break;
    case 'seats_updated': set({ seats: m.seats || [] }); break;
    case 'player_snapshots': set({ cards: m.seats || [] }); break;
    case 'turn_started': set({ turn: m.turn || null }); st.handlers.onTurnStarted?.(m.turn || null); break;
    case 'turn_updated': set({ turn: m.turn || null }); break;
    case 'turn_resolved': set({ turn: m.turn || null }); st.handlers.onTurnResolved?.(m.turn || null); break;
    case 'world_snapshot': set({ worldSnapshot: m.payload, lastWorldAt: Date.now() }); st.handlers.onWorld?.(m.payload); break;
    case 'combat_snapshot': set({ combatSnapshot: m.payload }); st.handlers.onCombat?.(m.payload); break;
    case 'room_comment':
      if (m.backlog) set({ comments: m.backlog });
      else if (m.comment) set({ comments: [...useMp.getState().comments, m.comment].slice(-100) });
      break;
    case 'room_closed': set({ status: 'closed', error: '房间已被房主关闭' }); cleanupSocket(); restoreWorldBackup(); break;
    case 'error': set({ error: m.reason || m.error || '未知错误' }); break;
  }
}

export const mpClient = {
  createRoom,
  listRooms,
  connect,
  leave,
  startTurn: () => sendRaw({ type: 'start_turn' }),
  submitInput: (text: string, snapshot?: any) => sendRaw({ type: 'submit_input', text, snapshot }),
  publishWorld: (payload: any) => sendRaw({ type: 'publish_world_snapshot', payload }),
  publishCombat: (payload: any) => sendRaw({ type: 'publish_combat_snapshot', payload }),
  comment: (text: string) => sendRaw({ type: 'send_room_comment', text }),
  closeRoom: () => sendRaw({ type: 'close_room' }),
  send: sendRaw,
};
