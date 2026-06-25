import { useAssist } from '../store/assistStore';
import { usePlayer } from '../store/playerStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import { buildPlayerSnapshot } from './mpSnapshot';
import { shrinkDataUrl } from './imageGen';
import { npcToSnapshotRaw } from './assistApply';
import type { AssistCard, AssistInbound, AssistKind, AssistOutbound, AssistSnapshot } from './assistProtocol';

// 全局助战大厅 WebSocket 客户端（事件名照搬后端 AssistDO 协议）。
// 与聊天室共用 Discord 身份：连接带 chatToken(→后端 pid=chat:uid) + 头像/名牌(avv/ds/nc)，卡片显示同一身份。
// 心跳发字符串 "ping"。打开面板时 connect，关闭时 leave。断线自动重连（主动离开除外）。
// 范式同 systems/tradeClient.ts，但无托管/无成交结算——只上传卡 / 下架 / 邀请计数。

const RATE_MSG = '操作太快了，稍等一下';

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let manualClose = false;
let curName = '道友';
let curToken = '';

function set(p: Partial<ReturnType<typeof useAssist.getState>>) { useAssist.getState()._set(p as any); }

// upsert 一张卡（按卡 id：后端对同 owner+kind+srcKey 复用同一 id，故按 id 替换=更新，新 id=新增）
function upsertCard(cards: AssistCard[], card: AssistCard): AssistCard[] {
  return [card, ...cards.filter((c) => c.id !== card.id)];
}

// 立绘压缩：data: 图压成缩略图；http 图直接引用；无图则空
async function shrinkAvatar(raw: string): Promise<string> {
  try {
    if (raw.startsWith('data:image/')) return await shrinkDataUrl(raw, 256, 0.7);
    if (/^https?:\/\//.test(raw)) return raw;
  } catch { /* 无图就不带立绘 */ }
  return '';
}

// 组装某类型助战卡快照 + 压缩立绘。player=主角面板；npc=本玩家的某个 NPC。失败/无源返回 null。
async function buildSnapshotForKind(kind: AssistKind, npcId?: string): Promise<AssistSnapshot | null> {
  if (kind === 'npc') {
    if (!npcId) return null;
    const raw = npcToSnapshotRaw(npcId);
    if (!raw) return null;
    return { ...raw, avatar: await shrinkAvatar(raw.avatar || '') };
  }
  const snap = buildPlayerSnapshot() as AssistSnapshot;
  return { ...snap, avatar: await shrinkAvatar(usePlayer.getState().profile?.avatar || '') };
}

function connect(name: string, token: string) {
  cleanup();
  manualClose = false;
  curName = (name || '').trim() || '道友';
  if (token) curToken = token;
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/assist/ws`
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

function dispatch(m: AssistInbound) {
  const st = useAssist.getState();
  switch (m.type) {
    case 'hello':
      set({ me: m.you || null, cards: m.cards || [], online: m.online || 0 });
      break;
    case 'card_added':
      if (m.card) set({ cards: upsertCard(st.cards, m.card) });
      break;
    case 'card_removed':
      set({ cards: st.cards.filter((c) => c.id !== m.cardId) });
      break;
    case 'assist_bumped':
      set({ cards: st.cards.map((c) => (c.id === m.cardId ? { ...c, assists: m.assists } : c)) });
      break;
    case 'rate_limited':
      set({ error: RATE_MSG });
      setTimeout(() => { if (useAssist.getState().error === RATE_MSG) set({ error: null }); }, 1500);
      break;
    case 'error':
      set({ error: m.reason || m.error || '操作失败' });
      setTimeout(() => { const e = useAssist.getState().error; if (e === (m.reason || m.error || '操作失败')) set({ error: null }); }, 2500);
      break;
    default:
      assertNever(m);   // 新增 AssistInbound 类型却忘了在此处理 → 编译期报错（穷尽性守卫）
  }
}
function assertNever(_m: never): void { /* 仅用于穷尽性检查；运行时对未知 type 是 no-op */ }

// 上传/更新我的助战卡（同 owner 同 kind 一卡；后端 upsert，更新不清零助战次数）。
async function publishCard(kind: AssistKind, category: string, npcId?: string): Promise<boolean> {
  const snapshot = await buildSnapshotForKind(kind, npcId);
  if (!snapshot || !snapshot.name) {
    const msg = kind === 'npc' ? '请选择一个有效的 NPC' : '请先创建主角再上传助战卡';
    set({ error: msg });
    setTimeout(() => { if (useAssist.getState().error === msg) set({ error: null }); }, 2500);
    return false;
  }
  return sendRaw({ type: 'publish_card', kind, category, snapshot, srcKey: kind === 'npc' ? (npcId || '') : '' });
}

function sendRaw(obj: AssistOutbound) {
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
  useAssist.getState().reset();
}

export const assistClient = {
  connect,
  leave,
  publishCard,
  removeCard: (cardId: string) => sendRaw({ type: 'remove_card', cardId }),
  invite: (cardId: string) => sendRaw({ type: 'invite', cardId }),
  isOpen: () => !!ws && ws.readyState === 1,
};
