import { useEffect, useMemo, useState } from 'react';
import { useAssist, type AssistCard } from '../store/assistStore';
import { assistClient } from '../systems/assistClient';
import { useNpc } from '../store/npcStore';
import { buildPlayerSnapshot } from '../systems/mpSnapshot';
import { ASSIST_CATEGORIES, CATEGORY_EMOJI, inferCategory } from '../systems/assistCategory';
import { materializeAssist, dismissAssist } from '../systems/assistApply';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';
import ChatAvatar from './ChatAvatar';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatToken } from '../systems/chatIdentity';

/* 全局助战大厅：上传自己的主角面板成公开 NPC 卡 → 其他玩家「邀请助战」拉进临时队伍并强制在场。
   每被邀请一次累计 +1 → 排行榜。按职业类型分类。与聊天室共用 Discord 身份(chatToken·pid=chat:uid)。 */

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '法宝', '装备']);
function itemKind(it: any): EntityKind { return EQUIP_CATS.has(String(it?.category || it?.slot || '')) ? 'equip' : 'item'; }
function parseUid(pid?: string): number { return pid && pid.startsWith('chat:') ? (parseInt(pid.slice(5), 10) || 0) : 0; }
function uidTag(pid?: string, du?: number): string { const n = du || parseUid(pid); return n ? '#' + n : ''; }
function nameColor(c?: AssistCard) { return c?.nc || (typeof c?.hue === 'number' ? `hsl(${c.hue} 70% 72%)` : '#cbd5e1'); }
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

  const [view, setView] = useState<'board' | 'rank' | 'mine'>('board');
  const [catFilter, setCatFilter] = useState<string>('');     // '' = 全部
  const [showForm, setShowForm] = useState(false);
  const [formCat, setFormCat] = useState<string>('全能');
  const [detail, setDetail] = useState<AssistCard | null>(null);            // 卡片详情弹窗
  const [sub, setSub] = useState<{ kind: EntityKind; data: any } | null>(null); // 子项(技能/装备)详情
  const [invited, setInvited] = useState<Record<string, true>>({});         // 邀请反馈

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
  const myCard = useMemo(() => st.cards.find((c) => c.ownerId === myId) || null, [st.cards, myId]);

  // 打开上传表单：用当前主角面板自动推断默认分类
  useEffect(() => {
    if (showForm) { try { setFormCat(inferCategory(buildPlayerSnapshot() as any)); } catch { setFormCat('全能'); } }
  }, [showForm]);

  const previewSnap = useMemo(() => (showForm ? (buildPlayerSnapshot() as any) : null), [showForm]);

  const filtered = useMemo(() => {
    const list = catFilter ? st.cards.filter((c) => c.category === catFilter) : st.cards;
    return [...list].sort((a, b) => b.bumpedAt - a.bumpedAt);
  }, [st.cards, catFilter]);

  const ranked = useMemo(() => [...st.cards].sort((a, b) => (b.assists || 0) - (a.assists || 0) || b.bumpedAt - a.bumpedAt), [st.cards]);

  const myAssists = useMemo(() => Object.values(npcs).filter((r) => !!r.assistOwnerId), [npcs]);

  const doPublish = async () => {
    if (!connected) return;
    setBusy(true);
    await assistClient.publishCard(formCat);
    setBusy(false);
    setShowForm(false);
  };

  const doInvite = (card: AssistCard) => {
    if (!connected) return;
    materializeAssist(card);          // 本地物化成在场队友
    assistClient.invite(card.id);     // 排行榜 +1（自邀后端不计数）
    setInvited((m) => ({ ...m, [card.id]: true }));
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
              <span>{!entered ? '未进入' : connected ? `${st.cards.length} 张助战卡 · ${st.online} 人在线` : st.status === 'connecting' ? '连接中…' : st.status === 'closed' ? '已断开' : '未连接'}</span>
            </div>
          </div>
          {entered && (
            <button onClick={() => setShowForm((v) => !v)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">
              {showForm ? '收起' : myCard ? '✏️ 更新我的卡' : '➕ 上传助战卡'}
            </button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!entered ? (
          /* ── 门禁（与聊天室共用 Discord 身份）── */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-5xl">🆘</div>
            <div className="text-base font-bold text-slate-100">进入助战大厅</div>
            <div className="text-[12px] text-dim/60 max-w-xs leading-relaxed">把你的主角上传成<span className="text-god">助战角色卡</span>，让其他契约者「邀请助战」并肩作战——助战大厅与聊天室<span className="text-god">共用 Discord 身份</span>。</div>
            <button onClick={doLogin} disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-50 transition-colors">{busy ? '登录中…' : (loggedIn ? '进入助战大厅' : '用 Discord 登录')}</button>
            {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
          </div>
        ) : (
          <>
            {/* 视图切换 */}
            <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/40 text-[13px]">
              {([['board', '🛡 大厅'], ['rank', '🏆 排行榜'], ['mine', `🤝 我的助战${myAssists.length ? ' · ' + myAssists.length : ''}`]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg transition-colors ${view === v ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>{label}</button>
              ))}
            </div>

            {/* 上传表单 */}
            {showForm && (
              <div className="shrink-0 px-4 py-3 border-b border-edge bg-panel/30 space-y-2.5">
                {!previewSnap?.name ? (
                  <div className="text-[12px] text-amber-400/80">未检测到主角——请先创建/进入你的角色，再上传助战卡。</div>
                ) : (
                  <>
                    <div className="text-[12px] text-dim/70 leading-relaxed">
                      将上传 <span className="text-slate-100 font-semibold">{previewSnap.name}</span>
                      <span className="text-dim/50"> · {previewSnap.line || ''}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-dim/60">
                      <span>技能 {previewSnap.skills?.length || 0}</span>
                      <span>天赋 {previewSnap.traits?.length || 0}</span>
                      <span>装备 {previewSnap.equipment?.length || 0}</span>
                      <span>储存 {previewSnap.items?.length || 0}</span>
                      <span>立绘 随卡</span>{/* 主角 avatar 自动压缩带上 */}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-dim/70">分类</span>
                      <select value={formCat} onChange={(e) => setFormCat(e.target.value)} className="flex-1 bg-void border border-edge rounded-lg px-2 py-1.5 text-[13px] text-slate-100 outline-none focus:border-god/50">
                        {ASSIST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>)}
                      </select>
                      <button onClick={doPublish} disabled={!connected || busy} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{busy ? '上传中…' : myCard ? '更新' : '上传'}</button>
                    </div>
                    {myCard && <button onClick={() => { assistClient.removeCard(); setShowForm(false); }} className="text-[11px] text-blood/70 hover:text-blood transition-colors">🗑 下架我的助战卡</button>}
                  </>
                )}
              </div>
            )}

            {st.error && <div className="shrink-0 px-4 pt-2 text-[11px] font-mono text-amber-400/80">{st.error}</div>}

            {/* ── 大厅 ── */}
            {view === 'board' && (
              <>
                <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 overflow-x-auto text-[12px] border-b border-edge/50">
                  <button onClick={() => setCatFilter('')} className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${!catFilter ? 'bg-god/20 text-god border border-god/40' : 'border border-edge text-dim/60 hover:text-god'}`}>全部</button>
                  {ASSIST_CATEGORIES.map((c) => (
                    <button key={c} onClick={() => setCatFilter(c)} className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${catFilter === c ? 'bg-god/20 text-god border border-god/40' : 'border border-edge text-dim/60 hover:text-god'}`}>{CATEGORY_EMOJI[c]}{c}</button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                  {filtered.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有助战卡{catFilter ? `（${catFilter}）` : ''} · 点右上「上传助战卡」成为第一个 —</div>}
                  {filtered.map((c) => {
                    const isMine = c.ownerId === myId;
                    return (
                      <div key={c.id} className="rounded-xl border border-edge bg-panel/30 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={34} ring={c.nc} />
                          <button onClick={() => setDetail(c)} className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
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
                          {uidTag(c.ownerId, c.ownerDu) && <span className="text-god/45">{uidTag(c.ownerId, c.ownerDu)}</span>}
                          <span style={{ color: nameColor(c) }}>{c.ownerName}</span>
                          <span className="ml-auto">技{c.snapshot.skills?.length || 0}·赋{c.snapshot.traits?.length || 0}·装{c.snapshot.equipment?.length || 0}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setDetail(c)} className="px-2.5 py-1 rounded-lg text-[12px] border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">详情</button>
                          {isMine ? (
                            <span className="ml-auto text-[11px] text-dim/40 font-mono">这是你的卡</span>
                          ) : invited[c.id] ? (
                            <span className="ml-auto text-[12px] text-emerald-400/90 font-semibold">✓ 已邀请 · 已在场</span>
                          ) : (
                            <button onClick={() => doInvite(c)} disabled={!connected} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">🤝 邀请助战</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── 排行榜 ── */}
            {view === 'rank' && (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">助战次数排行 · 共 {ranked.length} 张卡</div>
                {ranked.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有助战卡 —</div>}
                {ranked.map((c, i) => {
                  const medal = i === 0 ? 'text-amber-300' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-400' : 'text-dim/40';
                  return (
                    <button key={c.id} onClick={() => setDetail(c)} className="w-full flex items-center gap-2.5 rounded-xl border border-edge bg-panel/30 p-2.5 text-left hover:border-god/30 transition-colors">
                      <span className={`w-6 text-center font-bold font-mono ${medal}`}>{i + 1}</span>
                      <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={30} ring={c.nc} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-100 truncate">{c.snapshot.name}</span><CatBadge cat={c.category} /></div>
                        <div className="text-[10px] font-mono text-dim/45 truncate">{uidTag(c.ownerId, c.ownerDu)} <span style={{ color: nameColor(c) }}>{c.ownerName}</span></div>
                      </div>
                      <div className="text-right shrink-0"><div className="text-[16px] font-bold text-amber-300 font-mono leading-none">{c.assists || 0}</div><div className="text-[9px] text-dim/40 font-mono">助战</div></div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── 我的助战（已邀请进本世界的助战 NPC）── */}
            {view === 'mine' && (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">你邀请的助战 · {myAssists.length} 名（强制在场，离开世界或点遣散即退场）</div>
                {myAssists.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有邀请助战 · 去「大厅」点「邀请助战」 —</div>}
                {myAssists.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/30 p-2.5">
                    {r.avatar ? <img src={r.avatar} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" /> : <span className="w-9 h-9 rounded-md bg-panel grid place-items-center shrink-0 text-lg">🤝</span>}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{r.name}</div>
                      <div className="text-[10px] font-mono text-dim/45 truncate">{r.realm || ''}{r.assistOwnerId ? ` · 来自 ${r.assistOwnerId.startsWith('chat:') ? '#' + r.assistOwnerId.slice(5) : ''}` : ''}</div>
                    </div>
                    <button onClick={() => dismissAssist(r.id)} className="px-3 py-1 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">遣散</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 卡片详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="w-full max-w-md max-h-[82vh] overflow-y-auto rounded-2xl border border-edge bg-void p-4 space-y-3 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
            <div className="flex items-start gap-3">
              {detail.snapshot.avatar ? <img src={detail.snapshot.avatar} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" /> : <ChatAvatar uid={parseUid(detail.ownerId)} avv={detail.avv} ds={detail.ds} size={64} ring={detail.nc} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5"><span className="text-base font-bold text-slate-100 truncate">{detail.snapshot.name}</span><CatBadge cat={detail.category} /></div>
                <div className="text-[11px] font-mono text-dim/55">{detail.snapshot.line || [detail.snapshot.tier, detail.snapshot.profession].filter(Boolean).join('·')}</div>
                <div className="text-[10px] font-mono text-dim/45 mt-0.5">{uidTag(detail.ownerId, detail.ownerDu)} <span style={{ color: nameColor(detail) }}>{detail.ownerName}</span> · 🏆 {detail.assists || 0} 次助战</div>
              </div>
            </div>
            {detail.snapshot.appearance && <div className="text-[12px] text-dim/70 leading-relaxed whitespace-pre-wrap">{detail.snapshot.appearance}</div>}
            {!!(detail.snapshot.skills?.length) && (
              <div><div className="text-[11px] font-semibold text-god/70 mb-1">技能 ({detail.snapshot.skills.length})</div>
                <div className="flex flex-wrap gap-1.5">{detail.snapshot.skills.map((s: any, i: number) => <button key={i} onClick={() => setSub({ kind: 'skill', data: s })} className="px-2 py-0.5 rounded-md text-[11px] bg-panel/60 border border-edge text-slate-200 hover:border-god/40">{s?.name || '技能'}</button>)}</div>
              </div>
            )}
            {!!(detail.snapshot.traits?.length) && (
              <div><div className="text-[11px] font-semibold text-god/70 mb-1">天赋 ({detail.snapshot.traits.length})</div>
                <div className="flex flex-wrap gap-1.5">{detail.snapshot.traits.map((t: any, i: number) => <button key={i} onClick={() => setSub({ kind: 'talent', data: t })} className="px-2 py-0.5 rounded-md text-[11px] bg-panel/60 border border-edge text-slate-200 hover:border-god/40">{t?.name || '天赋'}</button>)}</div>
              </div>
            )}
            {!!(detail.snapshot.equipment?.length) && (
              <div className="space-y-1.5"><div className="text-[11px] font-semibold text-god/70">装备 ({detail.snapshot.equipment.length})</div>
                {detail.snapshot.equipment.map((e: any, i: number) => <EntityCard key={i} kind="equip" data={e} onOpen={() => setSub({ kind: 'equip', data: e })} />)}
              </div>
            )}
            {!!(detail.snapshot.items?.length) && (
              <div className="space-y-1.5"><div className="text-[11px] font-semibold text-god/70">储存空间 ({detail.snapshot.items.length})</div>
                {detail.snapshot.items.slice(0, 30).map((it: any, i: number) => <EntityCard key={i} kind={itemKind(it)} data={it} onOpen={() => setSub({ kind: itemKind(it), data: it })} />)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              {detail.ownerId !== myId && !invited[detail.id] && <button onClick={() => { doInvite(detail); }} disabled={!connected} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">🤝 邀请助战</button>}
              {invited[detail.id] && <span className="flex-1 text-center text-[12px] text-emerald-400/90 font-semibold py-2">✓ 已邀请 · 已加入队伍并在场</span>}
              <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg text-[13px] border border-edge text-dim/70 hover:text-slate-100 transition-colors">关闭</button>
            </div>
          </div>
        </div>
      )}

      {sub && <EntityDetailModal kind={sub.kind} data={sub.data} onClose={() => setSub(null)} />}
    </div>
  );
}
