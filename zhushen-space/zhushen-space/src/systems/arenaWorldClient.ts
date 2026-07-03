import { useArenaWorld } from '../store/arenaWorldStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import { buildPlayerSnapshot } from './mpSnapshot';
import { shrinkDataUrl } from './imageGen';
import { npcToSnapshotRaw } from './assistApply';
import { trimForUpload } from './arenaWorldBattle';
import type { ArenaCard, ArenaInbound, ArenaKind, ArenaOutbound, AssistSnapshot } from './arenaWorldProtocol';

// 世界竞技场 WebSocket 客户端（事件名照搬后端 ArenaWorldDO 协议）。
// 与聊天室共用 Discord 身份：连接带 chatToken(→后端 pid=chat:uid) + 头像/名牌(avv/ds/nc)。
// 心跳发字符串 "ping"。打开面板时 connect，关闭时 leave。断线自动重连（主动离开除外）。范式同 systems/assistClient.ts。

const RATE_MSG = '操作太快了，稍等一下';

let ws: WebSocket | null = null;
let hbTimer: any = null;
let reconnectTimer: any = null;
let manualClose = false;
let curName = '道友';
let curToken = '';

function set(p: Partial<ReturnType<typeof useArenaWorld.getState>>) { useArenaWorld.getState()._set(p as any); }

async function shrinkAvatar(raw: string): Promise<string> {
  try {
    if (raw.startsWith('data:image/')) return await shrinkDataUrl(raw, 256, 0.7);
    if (/^https?:\/\//.test(raw)) return raw;
  } catch { /* 无图就不带立绘 */ }
  return '';
}

// 组装参赛卡快照 + 压缩立绘 + 挑选裁剪（技能+天赋≤10 / 物品≤5）。失败/无源返回 null。
async function buildSnapshotForKind(kind: ArenaKind, npcId: string, sel?: { keep?: Set<string>; keepItems?: Set<string> }): Promise<AssistSnapshot | null> {
  let raw: AssistSnapshot | null;
  if (kind === 'npc') {
    if (!npcId) return null;
    raw = npcToSnapshotRaw(npcId);
    if (!raw) return null;
    raw = { ...raw, avatar: await shrinkAvatar(raw.avatar || '') };
  } else {
    const snap = buildPlayerSnapshot() as AssistSnapshot;
    // 竞技场要**完整**装备/储存空间：buildPlayerSnapshot 的 equipment 是联机精简版（只 5 字段），且 items 已含全字段——
    // 这里直接从背包重取全字段（仅剥大图），保证上传卡里装备的词缀/评分/介绍/外观等一个不缺。
    const allItems = (useItems.getState().items || []) as any[];
    const stripImg = (it: any) => { const { image, ...rest } = it; return rest; };
    raw = {
      ...snap,
      equipment: allItems.filter((it) => it.equipped).map(stripImg),
      items: allItems.filter((it) => !it.equipped).map(stripImg),
      avatar: await shrinkAvatar(usePlayer.getState().profile?.avatar || ''),
    };
  }
  return trimForUpload(raw, sel);
}

function connect(name: string, token: string) {
  cleanup();
  manualClose = false;
  curName = (name || '').trim() || '道友';
  if (token) curToken = token;
  set({ status: 'connecting', error: null });
  const url = `${mpWsBase()}/api/arena-world/ws`
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

function dispatch(m: ArenaInbound) {
  const st = useArenaWorld.getState();
  switch (m.type) {
    case 'hello':
      set({ me: m.you || null, cards: m.cards || [], online: m.online || 0 });
      break;
    case 'ladder':
      set({ cards: m.cards || [] });
      break;
    case 'challenge_result':
      set({ lastResult: m });
      break;
    case 'rate_limited':
      set({ error: RATE_MSG });
      setTimeout(() => { if (useArenaWorld.getState().error === RATE_MSG) set({ error: null }); }, 1500);
      break;
    case 'error':
      set({ error: m.reason || m.error || '操作失败' });
      setTimeout(() => { const e = useArenaWorld.getState().error; if (e === (m.reason || m.error || '操作失败')) set({ error: null }); }, 2500);
      break;
    default:
      assertNever(m);   // 新增 ArenaInbound 类型却忘处理 → 编译期报错（穷尽性守卫）
  }
  void st;
}
function assertNever(_m: never): void { /* 穷尽性检查；运行时对未知 type 是 no-op */ }

// 上传/更新我的参赛卡（同 owner 同 srcKey 一卡；后端 upsert，更新保名次/战绩）。
async function publishCard(kind: ArenaKind, srcKey: string, npcId: string, sel?: { keep?: Set<string>; keepItems?: Set<string> }): Promise<boolean> {
  const snapshot = await buildSnapshotForKind(kind, npcId, sel);
  if (!snapshot || !snapshot.name) {
    const msg = kind === 'npc' ? '请选择一个有效的 NPC' : '请先创建主角再上传';
    set({ error: msg });
    setTimeout(() => { if (useArenaWorld.getState().error === msg) set({ error: null }); }, 2500);
    return false;
  }
  return sendRaw({ type: 'publish_card', kind, snapshot, srcKey: srcKey || (kind === 'npc' ? npcId : 'B1') });
}

function sendRaw(obj: ArenaOutbound) {
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
  useArenaWorld.getState().reset();
}

export type { ArenaCard };
export const arenaWorldClient = {
  connect,
  leave,
  publishCard,
  removeCard: (cardId: string) => sendRaw({ type: 'remove_card', cardId }),
  challenge: (myCardId: string, opponentCardId: string) => sendRaw({ type: 'challenge', myCardId, opponentCardId }),
  reportChallenge: (myCardId: string, opponentCardId: string, win: boolean) => sendRaw({ type: 'report_result', myCardId, opponentCardId, win }),
  clearResult: () => useArenaWorld.getState()._set({ lastResult: null }),
  isOpen: () => !!ws && ws.readyState === 1,
};
