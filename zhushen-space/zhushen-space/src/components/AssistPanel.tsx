import { useEffect, useMemo, useState } from 'react';
import { useAssist, type AssistCard } from '../store/assistStore';
import { assistClient } from '../systems/assistClient';
import { useNpc, hasRealNpcName } from '../store/npcStore';
import { buildPlayerSnapshot } from '../systems/mpSnapshot';
import { ASSIST_CATEGORIES, CATEGORY_EMOJI, inferCategory } from '../systems/assistCategory';
import { materializeAssist, dismissAssist, npcToSnapshotRaw } from '../systems/assistApply';
import NpcCardPreview from './NpcCardPreview';
import ChatAvatar from './ChatAvatar';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatToken } from '../systems/chatIdentity';

/* 全局助战大厅：上传公开 NPC 助战卡 → 其他玩家「邀请助战」拉进临时队伍并强制在场。每被邀请一次累计 +1 → 排行榜。
   分两块：👤 主角助战（上传你的主角）/ 🎭 NPC 助战（上传你名下的某个 NPC），各自独立排名（排名越高特效越足）。
   与聊天室共用 Discord 身份(chatToken·pid=chat:uid)。可随时删除自己上传的卡。 */

type Kind = 'player' | 'npc';
function parseUid(pid?: string): number { return pid && pid.startsWith('chat:') ? (parseInt(pid.slice(5), 10) || 0) : 0; }
function uidTag(pid?: string, du?: number): string { const n = du || parseUid(pid); return n ? '#' + n : ''; }
function nameColor(c?: AssistCard) { return c?.nc || (typeof c?.hue === 'number' ? `hsl(${c.hue} 70% 72%)` : '#cbd5e1'); }
function rankClass(i: number) { return i === 0 ? 'assist-rank-1' : i === 1 ? 'assist-rank-2' : i === 2 ? 'assist-rank-3' : i < 10 ? 'assist-rank-top' : ''; }
function rankMedal(i: number) { return i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1); }
function rankNumColor(i: number) { return i === 0 ? 'text-amber-300' : i === 1 ? 'text-slate-200' : i === 2 ? 'text-orange-400' : 'text-dim/45'; }
function StatusDot({ status }: { status: string }) {
  const c = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-dim/40';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}
function CatBadge({ cat }: { cat: string }) {
  return <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-god/15 border border-god/30 text-god/90 whitespace-nowrap">{CATEGORY_EMOJI[cat] || '✨'}{cat}</span>;
}

export default function AssistPanel({ onClose }: { onClose: () => void }) {
  const st = useAssist();
  const npcs = useNpc((s) => s.npcs);

  const [entered, setEntered] = useState(false);
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [busy, setBusy] = useState(false);
  const [gateErr, setGateErr] = useState('');

  const [kindTab, setKindTab] = useState<Kind | 'mine'>('player');
  const [subView, setSubView] = useState<'board' | 'rank'>('board');
  const [catFilter, setCatFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [formCat, setFormCat] = useState<string>('全能');
  const [formNpcId, setFormNpcId] = useState<string>('');
  const [detail, setDetail] = useState<AssistCard | null>(null);
  const [invited, setInvited] = useState<Record<string, true>>({});

  // 进场：已登录则确保身份后连接（与聊天室同一 Discord 身份）；未登录显门禁。离场断开。
  useEffect(() => {
    (async () => {
      if (!discordLoggedIn()) return;
      try {
        if (!chatReady()) await fetchChatIdentity();
        assistClient.connect(chatName() || '道友', chatToken());
        setEntered(true);
      } catch { /* 失败留在门禁 */ }
    })();
    return () => assistClient.leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = async () => {
    setBusy(true); setGateErr('');
    try {
      await discordLogin();
      setLoggedIn(true);
      await fetchChatIdentity();
      assistClient.connect(chatName() || '道友', chatToken());
      setEntered(true);
    } catch (e: any) { setGateErr(e?.message || '登录失败'); }
    setBusy(false);
  };

  const connected = st.status === 'connected';
  const myId = st.me?.playerId || '';
  const activeKind: Kind = kindTab === 'npc' ? 'npc' : 'player';

  const kindCards = useMemo(() => st.cards.filter((c) => c.kind === activeKind), [st.cards, activeKind]);
  const ranked = useMemo(() => [...kindCards].sort((a, b) => (b.assists || 0) - (a.assists || 0) || b.bumpedAt - a.bumpedAt), [kindCards]);
  const rankMap = useMemo(() => new Map(ranked.map((c, i) => [c.id, i])), [ranked]);
  const board = useMemo(() => (catFilter ? kindCards.filter((c) => c.category === catFilter) : kindCards).slice().sort((a, b) => b.bumpedAt - a.bumpedAt), [kindCards, catFilter]);
  const myPlayerCard = useMemo(() => st.cards.find((c) => c.ownerId === myId && c.kind === 'player') || null, [st.cards, myId]);
  const myNpcCards = useMemo(() => st.cards.filter((c) => c.ownerId === myId && c.kind === 'npc'), [st.cards, myId]);
  const myNpcSrcKeys = useMemo(() => new Set(myNpcCards.map((c) => c.srcKey || '')), [myNpcCards]);
  const myNpcCardForSel = useMemo(() => myNpcCards.find((c) => (c.srcKey || '') === formNpcId) || null, [myNpcCards, formNpcId]);
  const myAssists = useMemo(() => Object.values(npcs).filter((r) => !!r.assistOwnerId), [npcs]);
  const eligibleNpcs = useMemo(() => Object.values(npcs).filter((r) => hasRealNpcName(r) && !r.isDead && !r.assistOwnerId), [npcs]);

  // 打开表单时给默认分类（主角=按主角面板推断；NPC=默认选第一个可上传 NPC）
  useEffect(() => {
    if (!showForm) return;
    if (activeKind === 'player') { try { setFormCat(inferCategory(buildPlayerSnapshot() as any)); } catch { setFormCat('全能'); } }
    else setFormNpcId((cur) => cur || (eligibleNpcs[0]?.id || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, activeKind]);
  // NPC 选择变化 → 重新推断分类
  useEffect(() => {
    if (activeKind === 'npc' && showForm && formNpcId) { try { setFormCat(inferCategory(npcToSnapshotRaw(formNpcId) as any)); } catch { setFormCat('全能'); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formNpcId]);

  const playerPreview = showForm && activeKind === 'player' ? (buildPlayerSnapshot() as any) : null;
  const npcPreview = showForm && activeKind === 'npc' && formNpcId ? npcToSnapshotRaw(formNpcId) : null;

  const switchTab = (v: Kind | 'mine') => { setKindTab(v); setShowForm(false); setSubView('board'); setCatFilter(''); };

  const doPublish = async () => {
    if (!connected) return;
    setBusy(true);
    if (activeKind === 'npc') await assistClient.publishCard('npc', formCat, formNpcId);
    else await assistClient.publishCard('player', formCat);
    setBusy(false);
    setShowForm(false);
  };
  const doDelete = (cardId: string) => { assistClient.removeCard(cardId); };
  const doInvite = (card: AssistCard) => {
    if (!connected) return;
    materializeAssist(card);          // 本地物化成在场队友
    assistClient.invite(card.id);     // 排行榜 +1（自邀后端不计数）
    setInvited((m) => ({ ...m, [card.id]: true }));
  };

  // ── 单张卡片行（大厅）──
  const renderCardRow = (c: AssistCard) => {
    const isMine = c.ownerId === myId;
    const r = rankMap.get(c.id) ?? 99;
    return (
      <div key={c.id} className="rounded-xl border border-edge bg-panel/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          {c.snapshot.avatar ? <img src={c.snapshot.avatar} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" /> : <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={34} ring={c.nc} />}
          <button onClick={() => setDetail(c)} className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              {r < 3 && <span className="text-sm leading-none">{rankMedal(r)}</span>}
              <span className="font-semibold text-slate-100 truncate">{c.snapshot.name}</span>
              <CatBadge cat={c.category} />
            </div>
            <div className="text-[11px] font-mono text-dim/55 truncate">{c.snapshot.line || [c.snapshot.tier, c.snapshot.profession].filter(Boolean).join('·')}</div>
          </button>
          <div className="text-right shrink-0">
            <div className="text-[15px] font-bold text-amber-300 font-mono leading-none">{c.assists || 0}</div>
            <div className="text-[9px] text-dim/40 font-mono">助战</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-dim/45">
          <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={14} />
          <span className="text-dim/40">上传者</span>
          {uidTag(c.ownerId, c.ownerDu) && <span className="text-god/45">{uidTag(c.ownerId, c.ownerDu)}</span>}
          <span style={{ color: nameColor(c) }}>{c.ownerName}</span>
          <span className="ml-auto">技{c.snapshot.skills?.length || 0}·赋{c.snapshot.traits?.length || 0}·装{c.snapshot.equipment?.length || 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDetail(c)} className="px-2.5 py-1 rounded-lg text-[12px] border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">详情</button>
          {isMine ? (
            <button onClick={() => doDelete(c.id)} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">🗑 删除我的卡</button>
          ) : invited[c.id] ? (
            <span className="ml-auto text-[12px] text-emerald-400/90 font-semibold">✓ 已邀请 · 已在场</span>
          ) : (
            <button onClick={() => doInvite(c)} disabled={!connected} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">🤝 邀请助战</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[85vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🆘</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">助战大厅</div>
            <div className="text-[11px] font-mono text-dim/60 flex items-center gap-1.5">
              <StatusDot status={entered ? st.status : 'idle'} />
              <span>{!entered ? '未进入' : connected ? `${st.cards.length} 张卡 · ${st.online} 人在线` : st.status === 'connecting' ? '连接中…' : st.status === 'closed' ? '已断开' : '未连接'}</span>
            </div>
          </div>
          {entered && kindTab !== 'mine' && (
            <button onClick={() => setShowForm((v) => !v)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">
              {showForm ? '收起' : activeKind === 'player' ? (myPlayerCard ? '✏️ 更新' : '➕ 上传') : '➕ 上传 NPC'}
            </button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!entered ? (
          /* ── 门禁（与聊天室共用 Discord 身份）── */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-5xl">🆘</div>
            <div className="text-base font-bold text-slate-100">进入助战大厅</div>
            <div className="text-[12px] text-dim/60 max-w-xs leading-relaxed">把你的<span className="text-god">主角或 NPC</span> 上传成助战角色卡，让其他契约者「邀请助战」并肩作战——助战大厅与聊天室<span className="text-god">共用 Discord 身份</span>。</div>
            <button onClick={doLogin} disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-50 transition-colors">{busy ? '登录中…' : (loggedIn ? '进入助战大厅' : '用 Discord 登录')}</button>
            {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
          </div>
        ) : (
          <>
            {/* 顶层分块：主角助战 / NPC助战 / 我的助战 */}
            <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/40 text-[13px]">
              {([['player', '👤 主角助战'], ['npc', '🎭 NPC助战'], ['mine', `🤝 我的助战${myAssists.length ? ' · ' + myAssists.length : ''}`]] as const).map(([v, label]) => (
                <button key={v} onClick={() => switchTab(v)} className={`px-3 py-1.5 rounded-lg transition-colors ${kindTab === v ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>{label}</button>
              ))}
            </div>

            {/* 上传表单（contextual：主角 or NPC）*/}
            {showForm && kindTab !== 'mine' && (
              <div className="shrink-0 px-4 py-3 border-b border-edge bg-panel/30 space-y-2.5">
                {activeKind === 'player' ? (
                  !playerPreview?.name ? (
                    <div className="text-[12px] text-amber-400/80">未检测到主角——请先创建/进入你的角色，再上传助战卡。</div>
                  ) : (
                    <>
                      <div className="text-[12px] text-dim/70 leading-relaxed">将上传 <span className="text-slate-100 font-semibold">{playerPreview.name}</span><span className="text-dim/50"> · {playerPreview.line || ''}</span></div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-dim/60">
                        <span>技能 {playerPreview.skills?.length || 0}</span><span>天赋 {playerPreview.traits?.length || 0}</span><span>装备 {playerPreview.equipment?.length || 0}</span><span>储存 {playerPreview.items?.length || 0}</span><span>立绘 随卡</span>
                      </div>
                    </>
                  )
                ) : eligibleNpcs.length === 0 ? (
                  <div className="text-[12px] text-amber-400/80">名下暂无可上传的 NPC——先在游戏里结识/建立有名字的 NPC。</div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-dim/70 shrink-0">选 NPC</span>
                      <select value={formNpcId} onChange={(e) => setFormNpcId(e.target.value)} className="flex-1 bg-void border border-edge rounded-lg px-2 py-1.5 text-[13px] text-slate-100 outline-none focus:border-god/50">
                        {eligibleNpcs.map((r) => <option key={r.id} value={r.id}>{r.name}{r.realm ? `·${r.realm.split('|')[0]}` : ''}{myNpcSrcKeys.has(r.id) ? '（已上传）' : ''}</option>)}
                      </select>
                    </div>
                    {npcPreview && (
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-dim/60">
                        <span className="text-slate-100">{npcPreview.line || ''}</span>
                        <span>技能 {npcPreview.skills?.length || 0}</span><span>天赋 {npcPreview.traits?.length || 0}</span><span>装备 {npcPreview.equipment?.length || 0}</span><span>储存 {npcPreview.items?.length || 0}</span><span>立绘 {npcPreview.avatar ? '随卡' : '无'}</span>
                      </div>
                    )}
                  </>
                )}
                {((activeKind === 'player' && playerPreview?.name) || (activeKind === 'npc' && npcPreview)) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-dim/70">分类</span>
                    <select value={formCat} onChange={(e) => setFormCat(e.target.value)} className="flex-1 bg-void border border-edge rounded-lg px-2 py-1.5 text-[13px] text-slate-100 outline-none focus:border-god/50">
                      {ASSIST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>)}
                    </select>
                    <button onClick={doPublish} disabled={!connected || busy} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{busy ? '上传中…' : (activeKind === 'player' ? (myPlayerCard ? '更新' : '上传') : (myNpcCardForSel ? '更新' : '上传'))}</button>
                  </div>
                )}
                {activeKind === 'npc' && <div className="text-[10px] font-mono text-dim/40">你已上传 {myNpcCards.length}/30 张 NPC 卡（同一 NPC 再传=更新）</div>}
                {(() => { const mine = activeKind === 'player' ? myPlayerCard : myNpcCardForSel; return mine ? <button onClick={() => { doDelete(mine.id); setShowForm(false); }} className="text-[11px] text-blood/70 hover:text-blood transition-colors">🗑 删除这张{activeKind === 'npc' ? ' NPC ' : '主角'}卡</button> : null; })()}
              </div>
            )}

            {st.error && <div className="shrink-0 px-4 pt-2 text-[11px] font-mono text-amber-400/80">{st.error}</div>}

            {/* ── 我的助战（已邀请进本世界的助战 NPC）── */}
            {kindTab === 'mine' ? (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">你邀请的助战 · {myAssists.length} 名（强制在场，离开世界或点遣散即退场）</div>
                {myAssists.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有邀请助战 · 去「主角助战 / NPC助战」点「邀请助战」 —</div>}
                {myAssists.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/30 p-2.5">
                    {r.avatar ? <img src={r.avatar} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" /> : <span className="w-9 h-9 rounded-md bg-panel grid place-items-center shrink-0 text-lg">🤝</span>}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{r.name}</div>
                      <div className="text-[10px] font-mono text-dim/45 truncate">{r.realm || ''}{r.assistOwnerId?.startsWith('chat:') ? ` · 来自 #${r.assistOwnerId.slice(5)}` : ''}</div>
                    </div>
                    <button onClick={() => dismissAssist(r.id)} className="px-3 py-1 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">遣散</button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* 大厅 / 排行榜 切换 */}
                <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge/50 text-[12px]">
                  <button onClick={() => setSubView('board')} className={`px-3 py-1.5 rounded-lg transition-colors ${subView === 'board' ? 'bg-god/15 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>🛡 大厅</button>
                  <button onClick={() => setSubView('rank')} className={`px-3 py-1.5 rounded-lg transition-colors ${subView === 'rank' ? 'bg-god/15 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>🏆 排行榜</button>
                  <span className="ml-auto text-[11px] font-mono text-dim/40">{activeKind === 'npc' ? 'NPC 助战' : '主角助战'} · {kindCards.length} 张</span>
                </div>

                {subView === 'board' ? (
                  <>
                    <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 overflow-x-auto text-[12px] border-b border-edge/50">
                      <button onClick={() => setCatFilter('')} className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${!catFilter ? 'bg-god/20 text-god border border-god/40' : 'border border-edge text-dim/60 hover:text-god'}`}>全部</button>
                      {ASSIST_CATEGORIES.map((c) => (
                        <button key={c} onClick={() => setCatFilter(c)} className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${catFilter === c ? 'bg-god/20 text-god border border-god/40' : 'border border-edge text-dim/60 hover:text-god'}`}>{CATEGORY_EMOJI[c]}{c}</button>
                      ))}
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                      {board.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有{activeKind === 'npc' ? ' NPC ' : '主角'}助战卡{catFilter ? `（${catFilter}）` : ''} · 点右上「上传」成为第一个 —</div>}
                      {board.map(renderCardRow)}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                    <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">{activeKind === 'npc' ? 'NPC 助战' : '主角助战'}排行 · 共 {ranked.length} 张卡 · 排名越高特效越足</div>
                    {ranked.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有助战卡 —</div>}
                    {ranked.map((c, i) => (
                      <button key={c.id} onClick={() => setDetail(c)} className={`w-full flex items-center gap-2.5 rounded-xl border border-edge bg-panel/30 p-2.5 text-left transition-colors hover:border-god/30 ${rankClass(i)}`}>
                        <span className={`w-7 text-center text-base font-bold font-mono ${rankNumColor(i)}`}>{rankMedal(i)}</span>
                        {c.snapshot.avatar ? <img src={c.snapshot.avatar} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" /> : <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={30} ring={c.nc} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-100 truncate">{c.snapshot.name}</span><CatBadge cat={c.category} /></div>
                          <div className="text-[10px] font-mono text-dim/45 truncate">上传者 {uidTag(c.ownerId, c.ownerDu)} <span style={{ color: nameColor(c) }}>{c.ownerName}</span></div>
                        </div>
                        <div className="text-right shrink-0"><div className="text-[16px] font-bold text-amber-300 font-mono leading-none">{c.assists || 0}</div><div className="text-[9px] text-dim/40 font-mono">助战</div></div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* 卡片详情：完整 NPC 大面板（只读·复用平时的 NpcDetail）；上传者归属 + 邀请/删除放头部操作位 */}
      {detail && (
        <NpcCardPreview
          data={detail.snapshot}
          onClose={() => setDetail(null)}
          previewActions={
            <div className="flex items-center gap-2 flex-wrap">
              <CatBadge cat={detail.category} />
              <span className="text-[10px] font-mono text-dim/45 flex items-center gap-1">
                <ChatAvatar uid={parseUid(detail.ownerId)} avv={detail.avv} ds={detail.ds} size={14} />
                {uidTag(detail.ownerId, detail.ownerDu) && <span className="text-god/45">{uidTag(detail.ownerId, detail.ownerDu)}</span>}
                <span style={{ color: nameColor(detail) }}>{detail.ownerName}</span>
                <span>· 🏆 {detail.assists || 0}</span>
              </span>
              {detail.ownerId === myId ? (
                <button onClick={() => { doDelete(detail.id); setDetail(null); }} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">🗑 删除我的卡</button>
              ) : invited[detail.id] ? (
                <span className="text-[12px] text-emerald-400/90 font-semibold">✓ 已邀请·在场</span>
              ) : (
                <button onClick={() => doInvite(detail)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">🤝 邀请助战</button>
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
