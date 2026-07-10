import { useGuild, type GuildSummary } from '../store/guildStore';
import { mpWsBase } from './mpConfig';
import { chatAvatarVer, chatDicebearSeed, chatToken } from './chatIdentity';
import { chatNameColor } from './chatCosmetics';
import type { GuildFull, GuildInbound, GuildListInbound, GuildCard } from './guildProtocol';

// 家族 WebSocket 客户端（事件名照搬 GuildListDO / GuildDO 协议）。范式同 shopClient/assistClient，但**双连接**：
//  - listWs → GuildListDO：浏览/搜索/创建/申请（未入会时的发现层）。
//  - gWs    → GuildDO(guildId)：我的家族 live 态 + 成员操作。
// 与聊天室共用 Discord 身份（chatToken→pid=chat:uid）。GuildPanel 挂载时 openList()（+我有家族则 openGuild(my.id)），卸载 leaveAll()。

const RATE = '操作太快了，稍等一下';
function set(p: Partial<ReturnType<typeof useGuild.getState>>) { useGuild.getState()._set(p as any); }
function flashErr(e: string, ms = 2500) { set({ error: e }); setTimeout(() => { if (useGuild.getState().error === e) set({ error: null }); }, ms); }

let curName = '道友', curToken = '';
function idParams() { return `&avv=${chatAvatarVer()}&ds=${encodeURIComponent(chatDicebearSeed())}&nc=${encodeURIComponent(chatNameColor())}`; }
function mpHttpBase() { return mpWsBase().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'); }

/** gameplay 自动贡献（REST·免持久 WS·非阻塞）：我有家族才发；升级则刷新 my 的 level/perks。 */
async function contributeRest(amount: number, kind: string): Promise<void> {
  const my = useGuild.getState().my; if (!my) return;
  const token = chatToken(); if (!token) return;
  const amt = Math.max(0, Math.round(amount)); if (!amt) return;
  try {
    const res = await fetch(`${mpHttpBase()}/api/guild/contribute?token=${encodeURIComponent(token)}&guildId=${encodeURIComponent(my.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amt, kind }),
    });
    const j = await res.json().catch(() => null);
    if (j && j.ok && j.summary) useGuild.getState().setMy(j.summary as GuildSummary);
  } catch { /* 非阻塞 */ }
}

// 商城 market 列表回调（GuildPanel 订阅）
let onGuildCards: ((g: GuildCard[]) => void) | null = null;

/* ───────── GuildListDO 连接（发现层）───────── */
let listWs: WebSocket | null = null; let listHb: any = null; let listRe: any = null; let listManual = false;
function openList(name: string, token: string, onCards?: (g: GuildCard[]) => void) {
  curName = (name || '').trim() || '道友'; if (token) curToken = token; if (onCards) onGuildCards = onCards;
  cleanupList(); listManual = false;
  set({ status: 'connecting', error: null });
  listWs = new WebSocket(`${mpWsBase()}/api/guild-list/ws?token=${encodeURIComponent(curToken)}&name=${encodeURIComponent(curName)}${idParams()}`);
  listWs.onopen = () => { set({ status: 'connected' }); listHb = setInterval(() => { try { listWs?.send('ping'); } catch {} }, 25000); };
  listWs.onmessage = (ev) => { if (ev.data === 'pong') return; let m: any; try { m = JSON.parse(ev.data); } catch { return; } dispatchList(m); };
  listWs.onclose = () => { if (listHb) { clearInterval(listHb); listHb = null; } if (!listManual) { set({ status: 'connecting' }); listRe = setTimeout(() => openList(curName, curToken), 2500); } };
  listWs.onerror = () => { set({ error: '连接错误' }); };
}
function dispatchList(m: GuildListInbound) {
  switch (m.type) {
    case 'guilds': onGuildCards?.(m.guilds || []); break;
    case 'created': useGuild.getState().setMy(m.summary as GuildSummary); openGuild(m.guildId, curName, curToken); break;
    case 'joined':  useGuild.getState().setMy(m.summary as GuildSummary); openGuild(m.guildId, curName, curToken); break;
    case 'error': flashErr(m.reason || '操作失败'); break;
  }
}
function cleanupList() { if (listHb) { clearInterval(listHb); listHb = null; } if (listRe) { clearTimeout(listRe); listRe = null; } if (listWs) { try { listWs.onclose = null; listWs.close(); } catch {} listWs = null; } }
function listSend(o: any) { if (listWs && listWs.readyState === 1) { listWs.send(JSON.stringify(o)); return true; } return false; }

/* ───────── GuildDO 连接（我的家族）───────── */
let gWs: WebSocket | null = null; let gHb: any = null; let gRe: any = null; let gManual = false; let gId = '';
function openGuild(guildId: string, name: string, token: string) {
  if (!guildId) return;
  curName = (name || '').trim() || '道友'; if (token) curToken = token; gId = guildId;
  cleanupGuild(); gManual = false;
  gWs = new WebSocket(`${mpWsBase()}/api/guild/ws?token=${encodeURIComponent(curToken)}&name=${encodeURIComponent(curName)}&guildId=${encodeURIComponent(guildId)}`);
  gWs.onopen = () => { gHb = setInterval(() => { try { gWs?.send('ping'); } catch {} }, 25000); };
  gWs.onmessage = (ev) => { if (ev.data === 'pong') return; let m: any; try { m = JSON.parse(ev.data); } catch { return; } dispatchGuild(m); };
  gWs.onclose = () => { if (gHb) { clearInterval(gHb); gHb = null; } if (!gManual) { gRe = setTimeout(() => openGuild(gId, curName, curToken), 2500); } };
  gWs.onerror = () => {};
}
function setFromFull(g: GuildFull) {
  const myPid = useGuild.getState().me?.playerId;
  const myMember = g.members.find((m) => m.pid === myPid);
  set({ roster: g.members || [], chest: g.chest || [], weekTasks: g.weekTasks || null, chronicle: g.chronicle || [], applicants: g.applicants || [], base: g.baseSnapshot || null, exp: g.exp || 0 });
  const my = useGuild.getState().my;
  if (my && my.id === g.id) useGuild.getState().setMy({ ...my, name: g.name, tag: g.tag, emblem: g.emblem, level: g.level, perks: g.perks || [], role: myMember ? myMember.rank : my.role });
}
function dispatchGuild(m: GuildInbound) {
  const st = useGuild.getState();
  switch (m.type) {
    case 'hello': set({ me: m.you || null, online: m.online || 0 }); if (m.guild) setFromFull(m.guild); break;
    case 'guild_synced': setFromFull(m.guild); break;
    case 'member_joined': set({ roster: [...st.roster.filter((x) => x.pid !== m.member.pid), m.member] }); break;
    case 'member_left': set({ roster: st.roster.filter((x) => x.pid !== m.pid) }); break;
    case 'rank_changed': {
      set({ roster: st.roster.map((x) => (x.pid === m.pid ? { ...x, rank: m.rank } : x)) });
      const my = st.my; if (my && st.me && m.pid === st.me.playerId) useGuild.getState().setMy({ ...my, role: m.rank });
      break;
    }
    case 'contrib_bumped': set({ exp: m.exp, roster: st.roster.map((x) => (x.pid === m.pid ? { ...x, contribTotal: m.contribTotal, contribWeek: m.contribWeek } : x)) }); break;
    case 'level_up': { const my = st.my; if (my) useGuild.getState().setMy({ ...my, level: m.level, perks: m.perks || [] }); break; }
    case 'task_progress': set({ weekTasks: m.weekTasks }); break;
    case 'chest_changed': set({ chest: m.chest || [] }); break;
    case 'chronicle_added': set({ chronicle: [m.entry, ...st.chronicle].slice(0, 100) }); break;
    case 'applicant_added': set({ applicants: [...st.applicants, m.applicant] }); break;
    case 'kicked': useGuild.getState().setMy(null); leaveGuild(); useGuild.getState().resetLive(); flashErr(m.reason === 'disband' ? '家族已解散' : m.reason === 'kicked' ? '你已被移出家族' : '你已退出家族'); break;
    case 'rate_limited': flashErr(RATE, 1500); break;
    case 'error': flashErr(m.reason || m.error || '操作失败'); break;
  }
}
function cleanupGuild() { if (gHb) { clearInterval(gHb); gHb = null; } if (gRe) { clearTimeout(gRe); gRe = null; } if (gWs) { try { gWs.onclose = null; gWs.close(); } catch {} gWs = null; } }
function leaveGuild() { gManual = true; cleanupGuild(); gId = ''; }
function gSend(o: any) { if (gWs && gWs.readyState === 1) { gWs.send(JSON.stringify(o)); return true; } return false; }

function leaveAll() { listManual = true; cleanupList(); leaveGuild(); }

export const guildClient = {
  openList, openGuild, leaveAll,
  refresh: () => listSend({ type: 'list' }),
  search: (q: string) => listSend({ type: 'search', q }),
  create: (name: string, tag: string, emblem?: string, manifesto?: string) => listSend({ type: 'create_guild', name, tag, emblem, manifesto }),
  apply: (guildId: string) => listSend({ type: 'apply', guildId }),
  // 家族操作（走 gWs）
  contribute: (kind: string, amount: number, detail?: string) => gSend({ type: 'contribute', kind, amount, detail }),
  deposit: (item: any) => gSend({ type: 'deposit', item }),
  withdraw: (index: number) => gSend({ type: 'withdraw', index }),
  edit: (patch: any) => gSend({ type: 'edit', patch }),
  setRank: (pid: string, rank: string) => gSend({ type: 'set_rank', pid, rank }),
  kick: (pid: string) => gSend({ type: 'kick', pid }),
  leave: () => gSend({ type: 'leave' }),
  disband: () => gSend({ type: 'disband' }),
  contributeRest,
  isGuildOpen: () => !!gWs && gWs.readyState === 1,
};
