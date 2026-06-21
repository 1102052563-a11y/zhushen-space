import { useChatRoom } from '../store/chatRoomStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';

// 全局实时聊天室 WebSocket 客户端（事件名照搬后端 ChatDO 协议）。
// 心跳发字符串 "ping"（运行时自动回 pong，不唤醒 DO）。**连接持久化**：进入后即常驻，
// 关闭面板不断连、不清消息（老消息保留）；面板关闭期间的新消息计入 unread（导航红点）。
// 身份：必须带 chatToken（Discord 登录→/api/chat/me 拿到，内含顺序 UID）；后端验签后把 pid 设为 chat:<uid>。
// 有界重连：连续多次握手失败(未收 hello，通常=token 过期)即停，避免死循环刷连接。

const RATE_MSG = '发言太快了，稍等一下';
const MAX_FAILS = 3;

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let manualClose = false;
let curName = '道友';
let curToken = '';
let curChannel = 'lobby';
let failCount = 0;        // 连续「未收到 hello 就断」的次数（握手/鉴权失败）
let gotHelloThisConn = false;

function set(p: Partial<ReturnType<typeof useChatRoom.getState>>) { useChatRoom.getState()._set(p as any); }

function sysLine(text: string) {
  useChatRoom.getState().pushMessage({
    id: 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: '', at: Date.now(), system: text,
  });
}

function connect(name: string, token: string, channel = 'lobby') {
  cleanup();
  manualClose = false;
  gotHelloThisConn = false;
  curName = (name || '').trim() || '道友';
  if (token) curToken = token;
  curChannel = channel || 'lobby';
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/chat/ws`
    + `?token=${encodeURIComponent(curToken)}`
    + `&name=${encodeURIComponent(curName)}`
    + `&ch=${encodeURIComponent(curChannel)}`
    + `&avv=${chatAvatarVer()}`
    + `&ds=${encodeURIComponent(chatDicebearSeed())}`
    + `&nc=${encodeURIComponent(chatNameColor())}`;
  ws = new WebSocket(url);
  ws.onopen = () => { set({ status: 'connected', error: null }); startHb(); };   // 连上即清掉之前的「连接错误」残留
  ws.onmessage = (ev) => {
    if (ev.data === 'pong') return;          // 心跳自动响应
    let m: any; try { m = JSON.parse(ev.data); } catch { return; }
    dispatch(m);
  };
  ws.onclose = () => {
    stopHb();
    if (manualClose) { set({ status: 'closed' }); return; }
    if (!gotHelloThisConn) {                 // 没握上手（鉴权/网络）→ 累计失败，超阈值即停，避免死循环
      failCount++;
      if (failCount >= MAX_FAILS) { set({ status: 'error', error: '连接失败，请重新进入' }); return; }
    }
    set({ status: 'connecting' });
    scheduleReconnect();
  };
  ws.onerror = () => { set({ error: '连接错误' }); };
}

function dispatch(m: any) {
  switch (m.type) {
    case 'hello':
      gotHelloThisConn = true; failCount = 0;
      set({
        me: m.you || null,
        roster: m.roster || [],
        messages: (m.backlog || []).map((x: any) => ({ ...x })),
        entered: true,
      });
      break;
    case 'message':
      if (m.message) {
        const s = useChatRoom.getState();
        // 面板关闭期间、来自他人的消息 → 计入未读（导航红点）
        if (!s.open && m.message.playerId && m.message.playerId !== s.me?.playerId) set({ unread: s.unread + 1 });
        s.pushMessage(m.message);
      }
      break;
    case 'presence':
      set({ roster: m.roster || [] });
      if (m.join?.name) sysLine(`${m.join.name} 进入了聊天室`);
      else if (m.leave?.name) sysLine(`${m.leave.name} 离开了聊天室`);
      else if (m.rename) sysLine(`${m.rename.from} 改名为 ${m.rename.to}`);
      break;
    case 'reaction_update': {
      const s = useChatRoom.getState();
      set({ messages: s.messages.map((mm) => (mm.id === m.id ? { ...mm, reactions: m.reactions || {} } : mm)) });
      break;
    }
    case 'rate_limited':
      set({ error: RATE_MSG });
      setTimeout(() => { if (useChatRoom.getState().error === RATE_MSG) set({ error: null }); }, 1500);
      break;
  }
}

function sendRaw(obj: any) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function startHb() { stopHb(); hbTimer = setInterval(() => { try { ws?.send('ping'); } catch {} }, 25000); }
function stopHb() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }
function scheduleReconnect() {
  if (reconnectTimer || manualClose) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualClose) connect(curName, curToken, curChannel);
  }, 2000);
}
function cleanup() {
  stopHb();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
}

function leave() {
  manualClose = true;
  failCount = 0;
  cleanup();
  useChatRoom.getState().reset();   // entered/unread 归零（reset 保留 open）
}

// 已连/正在连则跳过，否则连接（用于后台自动连接 + 面板挂载，幂等）
function ensureConnected(name: string, token: string) {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  failCount = 0;
  connect(name, token);
}

export const chatClient = {
  connect,
  ensureConnected,
  leave,
  send: (text: string) => sendRaw({ type: 'chat', text }),
  react: (id: string, emoji: string) => sendRaw({ type: 'react', id, emoji }),
  share: (kind: 'skill' | 'talent' | 'equip' | 'item' | 'npc', data: any) => {
    const d = { ...(data || {}) };
    delete (d as any).image; delete (d as any).avatar;   // 分享卡不带大图
    return sendRaw({ type: 'share', kind, data: d });
  },
  rename: (name: string) => {
    const nn = (name || '').trim() || '道友';
    curName = nn;
    const me = useChatRoom.getState().me;
    if (me) useChatRoom.getState()._set({ me: { ...me, name: nn } });
    sendRaw({ type: 'rename', name: nn });
  },
  isOpen: () => !!ws && ws.readyState === 1,
};
