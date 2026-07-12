import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatRoom, type ChatMsg } from '../store/chatRoomStore';
import { chatClient } from '../systems/chatClient';
import { REACTION_EMOJIS } from '../systems/chatEmoji';
import { setMpName } from '../systems/mpConfig';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useNpc, hasRealNpcName } from '../store/npcStore';
import { fileToScaledDataUrl } from '../store/raidImageStore';
import {
  discordLoggedIn, discordLogin, localLogin, fetchChatIdentity, fullLogout, chatUid, chatDisplayUid, chatName,
  chatBound, setChatBound, chatReady, chatToken, chatAvatarVer, chatDicebearSeed, updateChatProfile,
} from '../systems/chatIdentity';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';
import NpcCardPreview from './NpcCardPreview';
import { buildNpcCardSnapshot } from '../systems/npcCard';
import ChatAvatar from './ChatAvatar';
import { AutoMessageText } from './AutoText';
import EmojiPicker from './EmojiPicker';
import StickerPicker from './StickerPicker';
import { stickerSrc, loadStickerPacks, type StickerRef } from '../systems/chatStickers';
import { DICEBEAR_STYLES, parseDicebear } from '../systems/dicebearAvatar';
import { chatNameColor, setChatNameColor, chatBubble, setChatBubble, NAME_COLORS, BUBBLE_SKINS, bubbleCls } from '../systems/chatCosmetics';
import { presenceStats, type PresenceStats } from '../systems/presence';   // 当前在玩人数(按IP·含未登录) + 累计在线时长
import { PlaytimeBoard } from './PlaytimePanel';   // 🏆 游玩时长榜·并入聊天室 view

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '法宝']);
const SHARE_TABS: { k: EntityKind; label: string }[] = [
  { k: 'skill', label: '技能' }, { k: 'talent', label: '天赋' }, { k: 'equip', label: '装备' }, { k: 'npc', label: 'NPC' },
];
// NPC 分享：带**完整面板**数据（六维/技能/天赋/称号/副职业/装备/储存/经历），让接收方看到和平时一样的大面板。
// 仅剥立绘(avatar)以控制聊天广播体积——结构化数据本身不大。
function leanNpc(n: any) {
  const snap = buildNpcCardSnapshot(n?.id);
  if (!snap) return { name: n?.name || '', avatar: '' };
  // 聊天广播进 120 条环形缓冲共一份 DO 存储，单条收敛体积：剥立绘 + 经历/储存适度封顶（仍足够"完整面板"）
  return { ...snap, avatar: '', items: (snap.items || []).slice(0, 40), deeds: (snap.deeds || []).slice(-25) };
}

/* 全局实时聊天室面板：所有在线玩家即时收发消息，与开房/进游戏解耦。
   进入需 Discord 登录 → 获得从 #1 起的专属顺序 UID（systems/chatIdentity.ts，复用云存档登录）。
   连接层 systems/chatClient.ts（带 chatToken），状态 store/chatRoomStore.ts，后端 ChatDO.js。 */

function nameColor(hue?: number) { return typeof hue === 'number' ? `hsl(${hue} 70% 72%)` : '#cbd5e1'; }
function parseUid(playerId?: string): number { return playerId && playerId.startsWith('chat:') ? (parseInt(playerId.slice(5), 10) || 0) : 0; }
function fmtTime(at: number) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function StatusDot({ status }: { status: string }) {
  const c = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-dim/40';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}

/** 累计在线时长的紧凑格式（天/时/分）。 */
function fmtShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}
/** 2 位国家码 → 旗帜 emoji（区域指示符）。非法/未知 → 🌐。 */
function countryFlag(code: string): string {
  const cc = (code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
const CN_NAME: Record<string, string> = {
  CN: '中国', JP: '日本', US: '美国', HK: '香港', TW: '台湾', KR: '韩国', SG: '新加坡', MO: '澳门',
  GB: '英国', DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', RU: '俄罗斯', NL: '荷兰',
  MY: '马来西亚', TH: '泰国', VN: '越南', ID: '印尼', PH: '菲律宾', IN: '印度', BR: '巴西',
};
/** 2 位国家码 → 中文名（缺省回退码本身；空/XX → 未知）。 */
function countryName(code: string): string {
  const cc = (code || '').toUpperCase();
  return CN_NAME[cc] || (cc && cc !== 'XX' ? cc : '未知');
}

export default function ChatRoomPanel({ onClose }: { onClose: () => void }) {
  const st = useChatRoom();
  // 当前在玩人数 + 累计在线时长：进面板即轮询（每 30s·只读·不登记自己·登记由 App 的在玩心跳负责）
  const [pres, setPres] = useState<PresenceStats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { void presenceStats().then((p) => { if (alive && p) setPres(p); }); };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // ── 门禁（Discord 登录 + 起名 + UID）──
  const entered = st.entered;   // 会话级：是否已进入(连过)——由 chatClient/后台连接驱动
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [uid, setUid] = useState(() => chatUid());
  const [dispUid, setDispUid] = useState(() => chatDisplayUid());   // 显示号(自定义靓号·缺省=内部 uid)
  const [customUidInput, setCustomUidInput] = useState(() => String(chatDisplayUid() || ''));
  const [busy, setBusy] = useState(false);
  const [gateErr, setGateErr] = useState('');
  const [name, setName] = useState(() => chatName() || '道友');
  const [bindConfirm, setBindConfirm] = useState(false);   // 进入后弹「绑定到此存档？」
  const bindAskedRef = useRef(false);                       // 本会话只问一次

  // ── 个人设置（头像/改名）──
  const [view, setView] = useState<'chat' | 'settings' | 'playtime'>('chat');
  const [profBusy, setProfBusy] = useState(false);
  const [profMsg, setProfMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbStyle, setDbStyle] = useState(() => parseDicebear(chatDicebearSeed()).style);          // DiceBear 样式
  const [dbSeed, setDbSeed] = useState(() => parseDicebear(chatDicebearSeed()).seed || ('p' + (chatUid() || 1)));   // DiceBear 预览种子
  const myAvv = st.me?.avv ?? chatAvatarVer();
  const avvOf = (pid?: string): number => {
    if (!pid) return 0;
    if (pid === st.me?.playerId) return st.me?.avv ?? chatAvatarVer();
    return st.roster.find((r) => r.playerId === pid)?.avv ?? 0;
  };
  // 名牌颜色（他人可见）+ 气泡皮肤（本地）
  const [bubble, setBubble] = useState(() => chatBubble());
  const ncOf = (pid?: string): string => {
    if (!pid) return '';
    if (pid === st.me?.playerId) return st.me?.nc || chatNameColor();
    return st.roster.find((r) => r.playerId === pid)?.nc || '';
  };
  const pickNameColor = (c: string) => {
    setChatNameColor(c);
    setProfMsg(c ? '✓ 名牌颜色已更新' : '✓ 已恢复默认颜色');
    chatClient.connect(chatName() || name, chatToken());   // 重连把新名牌色广播给在场所有人
  };
  const pickBubble = (id: string) => { setChatBubble(id); setBubble(id); };
  // 头像来源：DiceBear 种子（他人可见，随 roster 广播）
  const myDs = st.me?.ds || chatDicebearSeed();
  const dsOf = (pid?: string): string => {
    if (!pid) return '';
    if (pid === st.me?.playerId) return st.me?.ds || chatDicebearSeed();
    return st.roster.find((r) => r.playerId === pid)?.ds || '';
  };
  // 显示号(自定义靓号)：自己用 dispUid、他人从名单取 du，缺省回退内部 uid（头像仍按内部 uid，互不影响）
  const duOf = (pid?: string): number => {
    if (!pid) return 0;
    if (pid === st.me?.playerId) return st.me?.du || dispUid || parseUid(pid);
    return st.roster.find((r) => r.playerId === pid)?.du || parseUid(pid);
  };
  const duTag = (pid?: string): string => { const n = duOf(pid); return n ? '#' + n : ''; };
  const avatarMode: 'pal' | 'upload' | 'dicebear' = myDs ? 'dicebear' : (myAvv > 0 ? 'upload' : 'pal');

  // ── 聊天态 ──
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState('');
  const [showRoster, setShowRoster] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // ── 分享（技能/天赋/装备/NPC）──
  const skills = useCharacters((s) => s.characters['B1']?.skills || []);
  const traits = useCharacters((s) => s.characters['B1']?.traits || []);
  const allItems = useItems((s) => s.items);
  const npcRecords = useNpc((s) => s.npcs);
  const equips = useMemo(() => (allItems || []).filter((it: any) => EQUIP_CATS.has(String(it.category || ''))), [allItems]);
  const npcs = useMemo(() => Object.values(npcRecords || {}).filter((n: any) => hasRealNpcName(n)), [npcRecords]);
  const [sharePick, setSharePick] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [, setStickersV] = useState(0);   // 文件夹直投的表情包 manifest 异步加载完后，bump 一下让消息流里的贴纸重新解析
  const sendSticker = (ref: StickerRef) => {
    chatClient.sticker(ref);   // 内置/文件={pack,id}；云端上传={hash}。sendRaw 自身在未连接时是 no-op
    setStickerOpen(false);
    atBottomRef.current = true;
  };
  const [shareTab, setShareTab] = useState<EntityKind>('skill');
  const [shareSel, setShareSel] = useState('');
  const [detail, setDetail] = useState<{ kind: EntityKind; data: any } | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);   // 哪条消息正在选回应表情

  const shareList: any[] = shareTab === 'skill' ? skills : shareTab === 'talent' ? traits : shareTab === 'npc' ? npcs : equips;
  const shareData = shareList.find((x) => (x.id || x.name) === shareSel) || null;
  const doShare = () => {
    if (!shareData) return;
    chatClient.share(shareTab, shareTab === 'npc' ? leanNpc(shareData) : shareData);
    setSharePick(false); setShareSel('');
    atBottomRef.current = true;
  };

  // 进场：标记面板打开 + 清未读；已登录则预取 UID；已绑定则兜底确保连接（后台没连上时）。
  // 离场：仅标记关闭——不断连、不清消息（老消息保留，关闭期间新消息走未读红点）。
  useEffect(() => {
    useChatRoom.getState()._set({ open: true, unread: 0 });
    try { localStorage.removeItem('drpg-chat-mutes'); } catch { /* 屏蔽功能已移除：清掉旧屏蔽名单，让之前误屏蔽全员的人自动恢复 */ }
    loadStickerPacks().then(() => setStickersV((v) => v + 1));   // 拉文件夹直投的表情包，加载完重渲染让消息流里的贴纸出图
    if (discordLoggedIn()) {
      setLoggedIn(true);
      if (chatName()) setName(chatName());
      if (chatBound() && chatReady() && !useChatRoom.getState().entered) {
        chatClient.ensureConnected(chatName() || '道友', chatToken());
      }
      fetchChatIdentity().then((id) => { setUid(id.uid); setDispUid(id.displayUid ?? id.uid); setCustomUidInput(String(id.displayUid ?? id.uid)); }).catch(() => {});
    }
    return () => { useChatRoom.getState()._set({ open: false }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新消息自动滚到底（仅当本来贴底）
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [st.messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const connected = st.status === 'connected';

  // ── 门禁动作 ──
  const doLogin = async () => {
    setBusy(true); setGateErr('');
    try {
      await discordLogin();
      setLoggedIn(true);
      try { const id = await fetchChatIdentity(); setUid(id.uid); setDispUid(id.displayUid ?? id.uid); setCustomUidInput(String(id.displayUid ?? id.uid)); if (!name.trim() || name === '道友') setName(id.name || name); } catch { /* */ }
    } catch (e: any) { setGateErr(e?.message || '登录失败'); }
    setBusy(false);
  };
  // 免 Discord 的本地登录（受限网络）：换取会话后照常拉专属 UID，流程与 Discord 登录一致
  const doLocalLogin = async () => {
    setBusy(true); setGateErr('');
    try {
      await localLogin(name);
      setLoggedIn(true);
      try { const id = await fetchChatIdentity(); setUid(id.uid); setDispUid(id.displayUid ?? id.uid); setCustomUidInput(String(id.displayUid ?? id.uid)); if (!name.trim() || name === '道友') setName(id.name || name); } catch { /* */ }
    } catch (e: any) { setGateErr(e?.message || '本地登录失败'); }
    setBusy(false);
  };
  const doEnter = async () => {
    const n = (name || '').trim() || '道友';
    setBusy(true); setGateErr('');
    try {
      const id = await fetchChatIdentity(n);
      setUid(id.uid); setDispUid(id.displayUid ?? id.uid); setCustomUidInput(String(id.displayUid ?? id.uid)); setMpName(n);
      chatClient.connect(n, id.chatToken);   // entered 由 hello 置真 → 面板转聊天
      if (!chatBound() && !bindAskedRef.current) { bindAskedRef.current = true; setBindConfirm(true); }   // 进入后弹一次绑定确认
    } catch (e: any) { setGateErr(e?.message || '进入失败'); }
    setBusy(false);
  };
  const confirmBind = (yes: boolean) => { if (yes) setChatBound(true); setBindConfirm(false); };
  const doLogout = () => { chatClient.leave(); fullLogout(); setLoggedIn(false); setUid(0); setDispUid(0); setCustomUidInput(''); setGateErr(''); };
  const doExit = () => { chatClient.leave(); setChatBound(false); };   // 退出：断开+解绑→回门禁（保留 Discord 登录）

  // ── 聊天动作 ──
  const send = () => {
    const t = draft.trim();
    if (!t || !connected) return;
    if (chatClient.send(t)) { setDraft(''); atBottomRef.current = true; }
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const applyName = () => {
    const n = (name || '').trim() || '道友';
    setName(n); setMpName(n); chatClient.rename(n); setEditingName(false);
    fetchChatIdentity(n).catch(() => {});   // 同步改名到 D1（不阻塞）
  };

  // ── 个人设置动作 ──
  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setProfBusy(true); setProfMsg('');
    try {
      const dataUrl = await fileToScaledDataUrl(f, 96);
      const id = await updateChatProfile({ avatar: dataUrl });
      chatClient.connect(chatName() || name, id.chatToken);   // 重连把新头像版本广播给在场所有人（自己也即时更新）
      setProfMsg('✓ 头像已更新');
    } catch (err: any) { setProfMsg(err?.message || '头像上传失败'); }
    setProfBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const onChangeName = async () => {
    const n = (name || '').trim() || '道友';
    setProfBusy(true); setProfMsg('');
    try {
      const id = await updateChatProfile({ name: n });
      setName(id.name);
      if (id.nameLocked) { setProfMsg('⚠ ' + (id.nameLockMsg || '昵称暂时无法更改')); }
      else { setMpName(id.name); chatClient.rename(id.name); setProfMsg('✓ 昵称已更新'); }
    } catch (err: any) { setProfMsg(err?.message || '改名失败'); }
    setProfBusy(false);
  };
  const onChangeUid = async () => {
    const want = parseInt((customUidInput || '').replace(/\D/g, ''), 10) || 0;
    if (!want) { setProfMsg('⚠ 请输入有效编号（纯数字）'); return; }
    setProfBusy(true); setProfMsg('');
    try {
      const id = await updateChatProfile({ customUid: want });
      if (id.uidLocked) { setProfMsg('⚠ ' + (id.uidLockMsg || 'UID 暂时无法更改')); }
      else if (want !== id.uid && id.customUid !== want) {   // 后端没把自定义号应用上 → 多半 worker 还没部署最新版（旧 /api/chat/me 忽略 customUid，返回原 uid）
        setProfMsg('⚠ 没生效：后端还没更新（请在 multiplayer-worker 里跑 npm run deploy 部署）');
      } else {
        const du = id.displayUid ?? id.uid;
        setDispUid(du); setCustomUidInput(String(du));
        chatClient.connect(chatName() || name, id.chatToken);   // 重连：把新显示号(令牌里的 du)广播给在场所有人
        setProfMsg('✓ 编号已更新为 #' + du);
      }
    } catch (err: any) { setProfMsg(err?.message || '更改失败'); }
    setProfBusy(false);
  };
  // 头像来源切换（DiceBear / 像素动物），切完重连广播给在场所有人
  const applyDicebear = async (seed: string) => {
    setProfBusy(true); setProfMsg('');
    try { const id = await updateChatProfile({ dicebearSeed: seed }); chatClient.connect(chatName() || name, id.chatToken); setProfMsg('✓ 已用 DiceBear 头像'); }
    catch (err: any) { setProfMsg(err?.message || '切换失败'); }
    setProfBusy(false);
  };
  const rerollDicebear = () => setDbSeed('p' + (uid || 1) + '-' + Math.random().toString(36).slice(2, 7));
  const usesPixelPal = async () => {
    setProfBusy(true); setProfMsg('');
    try { const id = await updateChatProfile({ avatarMode: 'pal' }); chatClient.connect(chatName() || name, id.chatToken); setProfMsg('✓ 已切回像素动物'); }
    catch (err: any) { setProfMsg(err?.message || '切换失败'); }
    setProfBusy(false);
  };

  // 消息表情回应行（聚合计数·自己点过高亮·再点取消；＋ 展开快捷表情条）
  const reactionsRow = (m: ChatMsg) => {
    const rx = m.reactions || {};
    const entries = Object.entries(rx).filter(([, arr]) => arr.length);
    const myPid = st.me?.playerId;
    const picking = reactingId === m.id;
    if (!entries.length && !picking) {
      return <button onClick={() => setReactingId(m.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-dim/35 hover:text-god transition-opacity">＋表情</button>;
    }
    return (
      <div className="flex items-center gap-1 flex-wrap mt-0.5">
        {entries.map(([emoji, arr]) => {
          const mine = !!myPid && arr.includes(myPid);
          return <button key={emoji} onClick={() => chatClient.react(m.id, emoji)} className={`text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${mine ? 'border-god/50 bg-god/15 text-god' : 'border-edge text-dim/70 hover:bg-panel2'}`}>{emoji} {arr.length}</button>;
        })}
        <button onClick={() => setReactingId(picking ? null : m.id)} className="text-[12px] px-1 text-dim/40 hover:text-god transition-colors">＋</button>
        {picking && (
          <span className="flex items-center gap-0.5 ml-0.5 rounded-lg border border-edge bg-void/80 px-1 py-0.5">
            {REACTION_EMOJIS.map((e) => <button key={e} onClick={() => { chatClient.react(m.id, e); setReactingId(null); }} className="text-base leading-none p-0.5 rounded hover:bg-panel2">{e}</button>)}
          </span>
        )}
      </div>
    );
  };

  const visible = st.messages;   // 屏蔽功能已移除（点名字误屏蔽的坑），全部显示

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">💬</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">聊天室 · 实时 {entered && uid > 0 && <span className="text-[12px] font-mono text-god/60">#{dispUid || uid}</span>}</div>
            <div className="text-[11px] font-mono text-dim/60 flex items-center gap-1.5 flex-wrap">
              <StatusDot status={entered ? st.status : 'idle'} />
              <span title="当前在「聊天室」里的人（进了聊天室的连接数）——与右边「在玩」不是一回事，两者都不是累计总数（累计看 🏆 时长榜）">{!entered ? '未进入' : connected ? `${st.roster.length} 在聊天室` : st.status === 'connecting' ? '连接中…' : st.status === 'closed' ? '已断开' : '未连接'}</span>
              {pres && (
                <>
                  <span className="text-dim/25">·</span>
                  <span className="text-emerald-300/80" title="当前在玩人数：按 IP 去重的当前在玩者，含没登录 Discord 的人（约每分钟刷新）">🟢 {pres.online} 在玩</span>
                  <span className="text-dim/25">·</span>
                  <span className="text-god/70" title="全服累计在线时长（所有登录者的游玩时长之和）">⏱ 累计在线 {fmtShort(pres.total)}</span>
                </>
              )}
            </div>
            {pres?.byCountry && pres.byCountry.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <span className="text-[10px] font-mono text-dim/40 shrink-0">🌍 在玩分布</span>
                {pres.byCountry.map((c) => (
                  <span key={c.country} title={`${countryName(c.country)}：${c.n} 人在玩`}
                    className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border border-god/20 bg-god/[0.06] text-[10.5px] font-mono leading-none">
                    <span className="text-[11px]">{countryFlag(c.country)}</span>
                    <span className="text-slate-300/85">{countryName(c.country)}</span>
                    <span className="min-w-[15px] text-center rounded-full bg-emerald-400/15 text-emerald-300/90 font-bold px-1 py-px">{c.n}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setView((v) => (v === 'playtime' ? 'chat' : 'playtime'))} title="游玩时长 · 排行榜（全服）" className={`text-[13px] px-2 py-1 rounded border border-edge transition-colors ${view === 'playtime' ? 'text-god border-god/40' : 'text-dim/60 hover:text-slate-200'}`}>🏆</button>
          {entered && <button onClick={() => setView((v) => (v === 'settings' ? 'chat' : 'settings'))} title="个人设置" className={`text-[13px] px-2 py-1 rounded border border-edge transition-colors ${view === 'settings' ? 'text-god border-god/40' : 'text-dim/60 hover:text-slate-200'}`}>⚙</button>}
          {entered && view === 'chat' && <button onClick={() => setShowRoster((v) => !v)} className="hidden sm:inline-block text-dim/60 hover:text-slate-200 text-[11px] font-mono px-2 py-1 rounded border border-edge transition-colors">{showRoster ? '隐藏在线' : '在线名单'}</button>}
          {entered && <button onClick={doExit} title="断开连接并停止自动进入（保留 Discord 登录）" className="text-dim/50 hover:text-blood text-[11px] font-mono px-2 py-1 rounded border border-edge transition-colors">退出</button>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 🏆 时长榜（并入聊天室·公开榜·进不进聊天室都能看）→ 门禁 / 聊天 / 设置 */}
        {view === 'playtime' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 py-2 border-b border-edge/60">
              <button onClick={() => setView('chat')} className="text-[12px] text-god/70 hover:text-god font-mono">← 返回聊天</button>
            </div>
            <PlaytimeBoard />
          </div>
        ) : !entered ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {!loggedIn ? (
              <>
                <div className="text-5xl">💬</div>
                <div className="text-base font-bold text-slate-100">进入聊天室</div>
                <div className="text-[12px] text-dim/60 max-w-xs leading-relaxed">需要登录以获取你的<span className="text-god">专属编号</span>（从 #1 开始，同一账号永久不变）。</div>
                <button onClick={doLogin} disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-50 transition-colors">{busy ? '登录中…' : '用 Discord 登录'}</button>
                <button onClick={doLocalLogin} disabled={busy} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-slate-500/10 border border-edge text-slate-300 hover:bg-slate-500/20 disabled:opacity-50 transition-colors">{busy ? '登录中…' : '本地登录（免 Discord）'}</button>
                <div className="text-[11px] text-dim/45 max-w-xs leading-relaxed">连不上 Discord？用本地身份码进入，功能一致。身份码请到<span className="text-dim/70">「存档」页</span>备份——丢失即丢号。</div>
                {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
              </>
            ) : (
              <>
                <div className="text-3xl">✦</div>
                {uid > 0
                  ? <div className="text-sm text-slate-200">你的专属编号 <span className="text-god font-bold text-lg font-mono">#{dispUid || uid}</span></div>
                  : <div className="text-[12px] text-dim/50">正在分配编号…</div>}
                <div className="text-[12px] text-dim/60">起个名字，进入聊天室</div>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter') doEnter(); }} placeholder="你的昵称" autoFocus
                  className="w-48 text-center bg-void border border-edge rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-god/40" />
                <div className="flex items-center gap-2">
                  <button onClick={doEnter} disabled={busy || !name.trim()} className="px-5 py-2 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{busy ? '进入中…' : '进入聊天室'}</button>
                  <button onClick={doLogout} className="px-3 py-2 rounded-lg text-[12px] border border-edge text-dim/60 hover:text-slate-200 transition-colors">退出登录</button>
                </div>
                {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
              </>
            )}
          </div>
        ) : view === 'settings' ? (
          /* ── 个人设置 ── */
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="flex items-center gap-3">
              <ChatAvatar uid={uid} avv={myAvv} ds={myDs} size={56} ring="#5fd3bc" />
              <div>
                <div className="text-sm font-bold text-slate-100">{(name || '道友').trim() || '道友'} <span className="font-mono text-god/60 text-xs">#{dispUid || uid}</span></div>
                <div className="text-[11px] text-dim/50">你的专属编号永久不变</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[12px] font-semibold text-slate-200">头像来源 <span className="text-[10px] text-dim/40 font-normal">· 聊天里其他人也能看到</span></div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
              <div className="flex flex-wrap gap-1.5">
                <button onClick={usesPixelPal} disabled={profBusy} className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${avatarMode === 'pal' ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>🐾 像素动物</button>
                <button onClick={() => { if (avatarMode !== 'dicebear') applyDicebear(`${dbStyle}~${dbSeed}`); }} disabled={profBusy} className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${avatarMode === 'dicebear' ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>🎲 DiceBear</button>
                <button onClick={() => fileRef.current?.click()} disabled={profBusy} className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${avatarMode === 'upload' ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>📷 上传</button>
              </div>
              {avatarMode === 'dicebear' && (
                <div className="space-y-2 pt-0.5">
                  <div className="flex flex-wrap gap-1.5">
                    {DICEBEAR_STYLES.map((s) => (
                      <button key={s.id} onClick={() => setDbStyle(s.id)} title={s.label}
                        className={`flex flex-col items-center gap-0.5 p-1 rounded-lg border transition-colors ${dbStyle === s.id ? 'border-god/50 bg-god/10' : 'border-edge hover:bg-panel2'}`}>
                        <ChatAvatar uid={uid} avv={0} ds={`${s.id}~${dbSeed}`} size={28} />
                        <span className="text-[9px] text-dim/55">{s.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <ChatAvatar uid={uid} avv={0} ds={`${dbStyle}~${dbSeed}`} size={40} ring="#5fd3bc" />
                    <button onClick={rerollDicebear} className="px-2.5 py-1 rounded-lg text-[12px] border border-edge text-dim/70 hover:text-slate-200 transition-colors">🎲 换一个</button>
                    <button onClick={() => applyDicebear(`${dbStyle}~${dbSeed}`)} disabled={profBusy} className="px-2.5 py-1 rounded-lg text-[12px] bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 disabled:opacity-40 transition-colors">用这个</button>
                  </div>
                </div>
              )}
              <div className="text-[11px] text-dim/40 leading-relaxed">DiceBear 开源头像：多数 CC0；fun-emoji 为 CC-BY（作者 Davis Uche）。按样式+种子在本地生成、无外部请求。</div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-slate-200">昵称 <span className="text-[10px] text-amber-400/70 font-normal">· 改一次后 2 天内不能再改</span></div>
              <div className="flex items-center gap-2 max-w-sm">
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} className="flex-1 bg-void border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-god/40" />
                <button onClick={onChangeName} disabled={profBusy} className="px-3 py-1.5 rounded-lg text-[13px] bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 disabled:opacity-40 transition-colors">{profBusy ? '…' : '更改'}</button>
              </div>
            </div>

            {/* 自定义编号（靓号·全局唯一·2 天冷却）*/}
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-slate-200">自定义编号 <span className="text-[10px] text-amber-400/70 font-normal">· 靓号·全局唯一·改一次后 2 天内不能再改</span></div>
              <div className="flex items-center gap-2 max-w-sm">
                <span className="text-god font-mono text-sm">#</span>
                <input value={customUidInput} onChange={(e) => setCustomUidInput(e.target.value.replace(/\D/g, '').slice(0, 7))} inputMode="numeric" placeholder="纯数字编号" className="flex-1 bg-void border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-god/40" />
                <button onClick={onChangeUid} disabled={profBusy} className="px-3 py-1.5 rounded-lg text-[13px] bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 disabled:opacity-40 transition-colors">{profBusy ? '…' : '更改'}</button>
              </div>
              <div className="text-[10px] text-dim/40">只能改成没被占用的编号；改后聊天里别人看到的就是这个号（身份不变）。</div>
            </div>

            {/* 名牌颜色（他人可见）*/}
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-slate-200">名牌颜色 <span className="text-[10px] text-dim/40 font-normal">· 你名字的颜色，聊天里其他人也能看到</span></div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => pickNameColor('')} title="默认（按编号配色）" className={`w-6 h-6 rounded-md border text-[10px] flex items-center justify-center ${!(st.me?.nc || chatNameColor()) ? 'border-god text-god' : 'border-edge text-dim/50'}`}>默</button>
                {NAME_COLORS.map((c) => {
                  const cur = (st.me?.nc || chatNameColor()) === c;
                  return <button key={c} onClick={() => pickNameColor(c)} title={c} className={`w-6 h-6 rounded-md border-2 transition-transform hover:scale-110 ${cur ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />;
                })}
              </div>
            </div>

            {/* 气泡皮肤（本地视图）*/}
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-slate-200">气泡皮肤 <span className="text-[10px] text-dim/40 font-normal">· 你看到的消息气泡样式（仅本地）</span></div>
              <div className="flex flex-wrap gap-1.5">
                {BUBBLE_SKINS.map((b) => (
                  <button key={b.id} onClick={() => pickBubble(b.id)} className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${bubble === b.id ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>{b.label}</button>
                ))}
              </div>
            </div>

            {profMsg && <div className="text-[12px] text-amber-300/80">{profMsg}</div>}

            <div className="pt-3 border-t border-edge/60 text-[11px] text-dim/40 leading-relaxed">更多个性化（专属称号 / 入场特效…）陆续加入。名牌配色取自开源 Open Color（MIT）。</div>

            <button onClick={() => setView('chat')} className="text-[12px] text-god/70 hover:text-god">← 返回聊天</button>
          </div>
        ) : (
          /* ── 聊天主体 ── */
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                {visible.length === 0 && (
                  <div className="text-center text-dim/40 text-xs font-mono py-10">{connected ? '— 还没有消息，打个招呼吧 —' : '— 连接中… —'}</div>
                )}
                {visible.map((m) => {
                  if (m.system) return <div key={m.id} className="text-center text-[10px] font-mono text-dim/40 py-0.5">— {m.system} —</div>;
                  const isMe = m.playerId && m.playerId === st.me?.playerId;
                  const uidTag = duTag(m.playerId);   // 显示号优先用自定义靓号(名单 du)，回退内部 uid
                  const nc = ncOf(m.playerId) || nameColor(m.hue);   // 名牌颜色：自定义优先，否则按编号确定性配色
                  if (m.sticker) {
                    const src = stickerSrc(m.sticker);
                    return (
                      <div key={m.id} className="group flex gap-2 items-start text-sm break-words">
                        <span className="shrink-0 mt-0.5"><ChatAvatar uid={parseUid(m.playerId)} avv={avvOf(m.playerId)} ds={dsOf(m.playerId)} size={24} ring={nc} /></span>
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-[11px] text-dim/35 mr-1.5">{fmtTime(m.at)}</span>
                          {uidTag && <span className="font-mono text-[10px] text-god/45 mr-1">{uidTag}</span>}
                          <span className="font-semibold" style={{ color: nc }}>{m.name}{isMe ? ' (你)' : ''}</span>
                          <div className="mt-1">
                            {src
                              ? <img src={src} alt="贴纸" loading="lazy" className="w-[116px] h-[116px] rounded-xl object-contain bg-panel/40 border border-edge" draggable={false} />
                              : <span className="text-dim/40 text-[12px]">[表情包]</span>}
                          </div>
                          {reactionsRow(m)}
                        </div>
                      </div>
                    );
                  }
                  if (m.share) return (
                    <div key={m.id} className="group flex gap-2 items-start text-sm break-words">
                      <span className="shrink-0 mt-0.5"><ChatAvatar uid={parseUid(m.playerId)} avv={avvOf(m.playerId)} ds={dsOf(m.playerId)} size={24} ring={nc} /></span>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[11px] text-dim/35 mr-1.5">{fmtTime(m.at)}</span>
                        {uidTag && <span className="font-mono text-[10px] text-god/45 mr-1">{uidTag}</span>}
                        <span className="font-semibold" style={{ color: nc }}>{m.name}{isMe ? ' (你)' : ''}</span>
                        <span className="text-dim/50"> 分享了{m.share.kind === 'skill' ? '技能' : m.share.kind === 'talent' ? '天赋' : m.share.kind === 'npc' ? 'NPC' : '装备'}</span>
                        <div className="mt-1"><EntityCard kind={m.share.kind as EntityKind} data={m.share.data} onOpen={() => setDetail({ kind: m.share!.kind as EntityKind, data: m.share!.data })} mt /></div>
                        {reactionsRow(m)}
                      </div>
                    </div>
                  );
                  return (
                    <div key={m.id} className="group flex gap-2 items-start text-sm break-words">
                      <span className="shrink-0 mt-0.5"><ChatAvatar uid={parseUid(m.playerId)} avv={avvOf(m.playerId)} ds={dsOf(m.playerId)} size={24} ring={nc} /></span>
                      <div className="min-w-0 flex-1 leading-relaxed">
                        <span className="font-mono text-[11px] text-dim/35 mr-1.5">{fmtTime(m.at)}</span>
                        {uidTag && <span className="font-mono text-[10px] text-god/45 mr-1">{uidTag}</span>}
                        <span className="font-semibold mr-1.5" style={{ color: nc }}>{m.name}{isMe ? ' (你)' : ''}</span>
                        <span className={`text-slate-200 ${bubbleCls(bubble)}`}><AutoMessageText text={m.text} /></span>
                        {reactionsRow(m)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 输入区 */}
              <div className="shrink-0 border-t border-edge bg-panel/60 p-3 relative">
                {emojiOpen && <EmojiPicker onPick={(e) => setDraft((d) => (d + e).slice(0, 500))} onClose={() => setEmojiOpen(false)} />}
                {stickerOpen && <StickerPicker onPick={sendSticker} onClose={() => setStickerOpen(false)} />}
                {sharePick && (
                  <div className="mb-2 rounded-lg border border-edge bg-void/60 p-2 space-y-2">
                    <div className="flex gap-1 flex-wrap">
                      {SHARE_TABS.map((t) => (
                        <button key={t.k} onClick={() => { setShareTab(t.k); setShareSel(''); }}
                          className={`px-2.5 py-1 rounded-md text-[12px] border ${shareTab === t.k ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>{t.label}</button>
                      ))}
                    </div>
                    <select value={shareSel} onChange={(e) => setShareSel(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-panel border border-edge text-sm text-slate-100 outline-none focus:border-god/40">
                      <option value="">— 选择{SHARE_TABS.find((t) => t.k === shareTab)?.label} —</option>
                      {shareList.map((x, i) => <option key={x.id || i} value={x.id || x.name}>{x.name}{x.gradeDesc ? ` · ${x.gradeDesc}` : x.rarity ? ` · ${x.rarity}` : x.bioStrength ? ` · ${x.bioStrength}` : x.realm ? ` · ${String(x.realm).split(/[|｜]/)[0]}` : x.level ? ` · ${x.level}` : ''}</option>)}
                    </select>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-dim/40">{shareList.length === 0 ? `你还没有可分享的${SHARE_TABS.find((t) => t.k === shareTab)?.label}` : ''}</span>
                      <button onClick={doShare} disabled={!shareData} className="shrink-0 px-3 py-1.5 rounded-lg bg-god/15 border border-god/40 text-god/90 text-[13px] hover:bg-god/25 disabled:opacity-40 transition-colors">📢 分享到聊天室</button>
                    </div>
                  </div>
                )}
                {st.error && <div className="text-[11px] font-mono text-amber-400/80 mb-1.5">{st.error}</div>}
                <div className="flex items-end gap-2">
                  <button onClick={() => { setSharePick((v) => !v); setEmojiOpen(false); setStickerOpen(false); }} disabled={!connected} title="分享 技能 / 天赋 / 装备 / NPC" className="shrink-0 px-2.5 py-2 rounded-lg text-sm border border-edge text-dim/70 hover:text-god hover:border-god/40 disabled:opacity-40 transition-colors">📢</button>
                  <button onClick={() => { setStickerOpen((v) => !v); setEmojiOpen(false); setSharePick(false); }} disabled={!connected} title="表情包（大贴纸）" className="shrink-0 px-2.5 py-2 rounded-lg text-sm border border-edge text-dim/70 hover:text-god hover:border-god/40 disabled:opacity-40 transition-colors">🖼</button>
                  <button onClick={() => { setEmojiOpen((v) => !v); setSharePick(false); setStickerOpen(false); }} disabled={!connected} title="表情" className="shrink-0 px-2.5 py-2 rounded-lg text-sm border border-edge text-dim/70 hover:text-god hover:border-god/40 disabled:opacity-40 transition-colors">😀</button>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 500))} onKeyDown={onKey} rows={1}
                    placeholder={connected ? '说点什么…（Enter 发送，Shift+Enter 换行）' : '连接中…'} disabled={!connected}
                    className="flex-1 resize-none rounded-lg bg-void border border-edge px-3 py-2 text-sm text-slate-100 placeholder:text-dim/40 focus:outline-none focus:border-god/40 max-h-32 disabled:opacity-50" />
                  <button onClick={send} disabled={!connected || !draft.trim()} className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">发送</button>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-dim/40">
                  <span>{draft.length}/500</span>
                  <span className="flex items-center gap-1">
                    {uid > 0 && <span className="text-god/50">#{dispUid || uid}</span>}
                    以
                    {editingName ? (
                      <>
                        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} onKeyDown={(e) => { if (e.key === 'Enter') applyName(); }} autoFocus
                          className="w-24 bg-void border border-edge rounded px-1.5 py-0.5 text-slate-100 focus:outline-none focus:border-god/40" />
                        <button onClick={applyName} className="text-god/80 hover:text-god">✓</button>
                      </>
                    ) : (
                      <button onClick={() => setEditingName(true)} className="text-god/70 hover:text-god underline">{(name || '道友').trim() || '道友'}</button>
                    )}
                    发言
                  </span>
                </div>
              </div>
            </div>

            {/* 在线名单 */}
            {showRoster && (
              <aside className="shrink-0 w-40 border-l border-edge bg-panel/40 overflow-y-auto py-2 hidden sm:block">
                <div className="px-3 pb-1 text-[10px] font-mono text-dim/40 uppercase tracking-wide">在线 {st.roster.length}</div>
                {st.roster.length === 0 && <div className="px-3 py-1 text-[11px] text-dim/30">—</div>}
                {st.roster.map((p) => (
                  <div key={p.playerId} className="w-full flex items-center gap-1.5 px-3 py-1 text-xs">
                    <ChatAvatar uid={parseUid(p.playerId)} avv={p.avv ?? 0} ds={p.ds ?? ''} size={18} />
                    <span className="flex items-center gap-1 min-w-0" style={{ color: ncOf(p.playerId) || nameColor(p.hue) }}>
                      {duTag(p.playerId) && <span className="font-mono text-[10px] text-god/40 shrink-0">{duTag(p.playerId)}</span>}
                      <span className="truncate">{p.name}{p.playerId === st.me?.playerId ? ' (你)' : ''}</span>
                    </span>
                  </div>
                ))}
              </aside>
            )}
          </div>
        )}
      </div>

      {detail && (detail.kind === 'npc'
        ? <NpcCardPreview data={detail.data} onClose={() => setDetail(null)} mt />
        : <EntityDetailModal kind={detail.kind} data={detail.data} onClose={() => setDetail(null)} mt />)}

      {/* 绑定确认（进入后弹一次）*/}
      {bindConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) confirmBind(false); }}>
          <div className="w-full max-w-sm rounded-2xl border border-god/40 bg-void p-5 shadow-[0_0_60px_rgba(0,0,0,0.85)] text-center space-y-3">
            <div className="text-2xl">🔗</div>
            <div className="text-sm font-bold text-slate-100">绑定到此存档？</div>
            <div className="text-[12px] text-dim/60 leading-relaxed">把聊天身份 <span className="text-god font-mono">#{dispUid || uid}</span>「{(name || '道友').trim() || '道友'}」绑定到此存档。<br />以后进聊天室<span className="text-god">免登录直接进</span>，不用每次重来。</div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => confirmBind(true)} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">绑定</button>
              <button onClick={() => confirmBind(false)} className="flex-1 px-3 py-2 rounded-lg text-sm border border-edge text-dim/70 hover:text-slate-200 transition-colors">暂不</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
