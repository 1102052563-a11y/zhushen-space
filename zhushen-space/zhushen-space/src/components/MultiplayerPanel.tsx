import { useEffect, useState } from 'react';
import { useMp } from '../store/multiplayerStore';
import { mpClient } from '../systems/mpClient';
import { myMpName, setMpName } from '../systems/mpConfig';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { giveItems, shareToRoom } from '../systems/mpGift';

/* 联机面板：大厅（建房/邀请码加入/公共房间列表）+ 房内（队伍/回合状态/弹幕聊天）。
   连接层在 systems/mpClient.ts，状态在 store/multiplayerStore.ts。
   注：把行动接进主聊天 + 房主算完广播正文 = Phase 1 第二步（深度接入 App.tsx），此面板先打通连接与房间。 */

function statusLabel(s: string) {
  return s === 'connected' ? '已连接' : s === 'connecting' ? '连接中…' : s === 'closed' ? '已断开' : s === 'error' ? '错误' : '未连接';
}
function roleLabel(r: string) {
  return r === 'host' ? '房主' : r === 'player' ? '玩家' : '旁观';
}
function StatusDot({ status }: { status: string }) {
  const c = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-dim/40';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}

export default function MultiplayerPanel({ onClose }: { onClose: () => void }) {
  const st = useMp();
  const inRoom = (st.status === 'connecting' || st.status === 'connected') && !!st.room;

  const [name, setName] = useState(() => myMpName());
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [maxSeats, setMaxSeats] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [usePreset, setUsePreset] = useState(true);   // 建房：是否启用联机专用正文规则

  const refreshList = async () => {
    setLoadingList(true);
    try { setRooms(await mpClient.listRooms()); } catch {}
    setLoadingList(false);
  };
  useEffect(() => { if (!inRoom) refreshList(); /* eslint-disable-next-line */ }, [inRoom]);

  const ensureName = () => { const n = (name || '').trim() || '道友'; setMpName(n); return n; };
  const doCreate = async () => {
    const n = ensureName(); setBusy(true);
    useMp.getState().setMpPresetOn(usePreset);   // 本局联机正文规则开关
    try {
      const id = await mpClient.createRoom({ name: roomName.trim() || `${n}的秘境`, hostName: n, maxSeats });
      mpClient.connect(id, { name: n, want: 'play' });
    } catch (e: any) { alert('建房失败：' + (e?.message || e)); }
    setBusy(false);
  };
  const doJoin = (code: string, want: 'play' | 'watch') => {
    if (!code.trim()) return;
    mpClient.connect(code.trim().toUpperCase(), { name: ensureName(), want });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg h-[82vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🌐</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">联机 · 组队 {inRoom && <span className="text-[12px] font-mono text-god/60">{st.room?.roomId}</span>}</div>
            <div className="text-[12px] font-mono text-dim/60 truncate flex items-center gap-1.5">
              <StatusDot status={st.status} />{statusLabel(st.status)}{st.role ? ` · ${roleLabel(st.role)}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {st.error && <div className="shrink-0 px-5 py-2 text-[12px] text-blood/80 bg-blood/5 border-b border-blood/20">{st.error}</div>}

        {!inRoom ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div>
              <label className="text-[12px] font-mono text-dim/70">你的称呼</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="道友"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-panel border border-edge text-sm text-slate-100 focus:border-god/50 outline-none" />
            </div>

            <div className="rounded-xl border border-edge bg-panel/50 p-3 space-y-2.5">
              <div className="text-[13px] font-semibold text-god/80">开新房间</div>
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="房间名（留空自动取名）"
                className="w-full px-3 py-2 rounded-lg bg-panel border border-edge text-sm text-slate-100 focus:border-god/50 outline-none" />
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-mono text-dim/70">座位</span>
                <select value={maxSeats} onChange={(e) => setMaxSeats(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg bg-panel border border-edge text-sm text-slate-100 outline-none">
                  {[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} 人</option>)}
                </select>
                <button disabled={busy} onClick={doCreate}
                  className="ml-auto px-4 py-1.5 rounded-lg bg-god/15 border border-god/40 text-god/90 text-sm hover:bg-god/25 disabled:opacity-50 transition-colors">建房并进入</button>
              </div>
              <label className="flex items-start gap-2 text-[12px] text-dim/70 cursor-pointer leading-relaxed">
                <input type="checkbox" checked={usePreset} onChange={(e) => setUsePreset(e.target.checked)} className="accent-god mt-0.5" />
                <span>使用联机专用正文规则（推荐：让 AI 准确刻画队友、不把真人当 NPC、每回合分别回应每个人）</span>
              </label>
            </div>

            <div className="rounded-xl border border-edge bg-panel/50 p-3 space-y-2.5">
              <div className="text-[13px] font-semibold text-god/80">用邀请码加入</div>
              <div className="flex items-center gap-2">
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="6 位邀请码" maxLength={6}
                  className="flex-1 px-3 py-2 rounded-lg bg-panel border border-edge text-sm text-slate-100 font-mono tracking-widest uppercase focus:border-god/50 outline-none" />
                <button onClick={() => doJoin(joinCode, 'play')} className="px-3 py-2 rounded-lg bg-god/15 border border-god/40 text-god/90 text-sm hover:bg-god/25 transition-colors">加入</button>
                <button onClick={() => doJoin(joinCode, 'watch')} title="只旁观" className="px-3 py-2 rounded-lg border border-edge text-dim/80 text-sm hover:text-slate-200 hover:bg-panel transition-colors">旁观</button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-[13px] font-semibold text-dim/80">公共房间 <span className="font-mono text-dim/50">{rooms.length}</span></div>
                <button onClick={refreshList} className="ml-auto text-[12px] text-dim/60 hover:text-god/80 transition-colors">{loadingList ? '刷新中…' : '⟳ 刷新'}</button>
              </div>
              {rooms.length === 0 && <div className="text-[12px] text-dim/40 py-4 text-center">暂无公开房间，开一个吧</div>}
              {rooms.map((r) => (
                <div key={r.roomId} className="flex items-center gap-2 p-2.5 rounded-xl border border-edge bg-panel/70 hover:border-god/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-slate-100 truncate">{r.name}</div>
                    <div className="text-[11px] font-mono text-dim/50 truncate">{r.hostName} · {r.players}/{r.maxSeats} 人 · <span className="text-god/60">{r.roomId}</span></div>
                  </div>
                  <button onClick={() => doJoin(r.roomId, 'play')} disabled={r.players >= r.maxSeats}
                    className="px-3 py-1.5 rounded-lg bg-god/15 border border-god/40 text-god/90 text-[13px] hover:bg-god/25 disabled:opacity-40 transition-colors">{r.players >= r.maxSeats ? '满' : '加入'}</button>
                  <button onClick={() => doJoin(r.roomId, 'watch')} className="px-2.5 py-1.5 rounded-lg border border-edge text-dim/70 text-[13px] hover:text-slate-200 transition-colors">旁观</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <RoomView st={st} comment={comment} setComment={setComment} />
        )}
      </div>
    </div>
  );
}

function RoomView({ st, comment, setComment }: { st: any; comment: string; setComment: (s: string) => void }) {
  const isHost = st.role === 'host';
  const cardBy = (seatId: string) => st.cards.find((c: any) => c.seatId === seatId);
  const submitted: string[] = st.turn?.inputs ? Object.keys(st.turn.inputs) : [];
  const hostSeated = st.seats.some((s: any) => s.playerId === st.room?.hostId);
  const sendComment = () => { const t = comment.trim(); if (!t) return; mpClient.comment(t); setComment(''); };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 px-5 py-2.5 border-b border-edge bg-panel/50 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-slate-100 font-semibold truncate">{st.room?.name}</span>
        <button onClick={() => { navigator.clipboard?.writeText(st.room?.roomId || '').catch(() => {}); }}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god/80 hover:bg-god/10 transition-colors">复制码 {st.room?.roomId}</button>
        <div className="ml-auto flex items-center gap-2">
          {isHost && <button onClick={() => mpClient.startTurn()} className="text-[12px] px-2.5 py-1 rounded-lg bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 transition-colors">开启回合</button>}
          {isHost
            ? <button onClick={() => { if (confirm('关闭房间？所有人将断开。')) mpClient.closeRoom(); }} className="text-[12px] px-2.5 py-1 rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10 transition-colors">关房</button>
            : <button onClick={() => mpClient.leave()} className="text-[12px] px-2.5 py-1 rounded-lg border border-edge text-dim/80 hover:text-slate-200 transition-colors">离开</button>}
        </div>
      </div>

      <div className="shrink-0 px-5 py-3 border-b border-edge">
        <div className="text-[12px] font-mono text-dim/60 mb-2">队伍 {st.seats.length}/{st.room?.maxSeats}</div>
        <div className="space-y-1.5">
          {!hostSeated && (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="w-2 h-2 rounded-full bg-amber-400/70 shrink-0" />
              <span className="text-slate-100 truncate">{st.room?.hostName}</span>
              <span className="text-[10px] font-mono px-1 rounded border border-amber-600/40 text-amber-300/70">房主</span>
            </div>
          )}
          {st.seats.map((s: any) => {
            const card = cardBy(s.seatId)?.snapshot;
            const isHostSeat = s.playerId === st.room?.hostId;
            const did = submitted.includes(s.seatId);
            return (
              <div key={s.seatId} className="flex items-center gap-2 text-[13px]">
                <span className="w-2 h-2 rounded-full bg-emerald-400/70 shrink-0" />
                <span className="text-slate-100 truncate">{s.name}</span>
                {isHostSeat && <span className="text-[10px] font-mono px-1 rounded border border-amber-600/40 text-amber-300/70">房主</span>}
                {did && <span className="text-[10px] font-mono px-1 rounded border border-god/40 text-god/70">已提交</span>}
                {card?.line && <span className="text-[11px] font-mono text-dim/50 truncate">{card.line}</span>}
              </div>
            );
          })}
        </div>
        {st.turn && (
          <div className="mt-2 text-[11px] font-mono text-dim/50">
            回合 #{st.turn.turnId} · {st.turn.phase === 'collecting' ? `收集行动中（${submitted.length}/${st.seats.length}）` : st.turn.phase === 'resolved' ? '已结算' : st.turn.phase}
          </div>
        )}
      </div>

      <ShareGift seats={st.seats} mySeatId={st.mySeatId} />

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
        {st.comments.length === 0 && <div className="text-[12px] text-dim/40 text-center py-6">房间内聊天 · 旁观弹幕 · 分享都在这里</div>}
        {st.comments.map((c: any) => (
          c.share ? (
            <div key={c.id} className="text-[13px]">
              <span className="text-dim/50 text-[11px]">{c.name} 分享了{c.share.kind === 'item' ? '物品' : c.share.kind === 'skill' ? '技能' : '天赋'}</span>
              <div className="mt-0.5 rounded-lg border border-god/30 bg-god/5 p-2">
                <div className="text-[13px] text-slate-100">{c.share.data?.name || '（无名）'}{c.share.data?.gradeDesc ? <span className="text-[11px] text-amber-300/70"> · {c.share.data.gradeDesc}</span> : c.share.data?.level ? <span className="text-[11px] text-cyan-300/70"> · {c.share.data.level}</span> : null}</div>
                {(c.share.data?.effect || c.share.data?.desc) && <div className="text-[12px] text-dim/70 mt-0.5 leading-relaxed">{String(c.share.data.effect || c.share.data.desc).slice(0, 120)}</div>}
              </div>
            </div>
          ) : (
            <div key={c.id} className="text-[13px] leading-relaxed">
              <span className={`font-semibold ${c.role === 'host' ? 'text-amber-300/80' : c.role === 'spectator' ? 'text-dim/60' : 'text-god/80'}`}>{c.name}</span>
              <span className="text-dim/40 text-[11px]">{c.role === 'spectator' ? ' (旁观)' : ''}：</span>
              <span className="text-slate-200">{c.text}</span>
            </div>
          )
        ))}
      </div>

      <div className="shrink-0 px-5 py-3 border-t border-edge bg-panel/50 flex items-center gap-2">
        <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendComment(); }}
          placeholder="说点什么…" className="flex-1 px-3 py-2 rounded-lg bg-panel border border-edge text-sm text-slate-100 focus:border-god/50 outline-none" />
        <button onClick={sendComment} className="px-4 py-2 rounded-lg bg-god/15 border border-god/40 text-god/90 text-sm hover:bg-god/25 transition-colors">发送</button>
      </div>
    </div>
  );
}

/* 赠予/分享：从自己物品/技能/天赋里选一个 → 分享到房间聊天，或（物品）赠予某位在座成员 */
function ShareGift({ seats, mySeatId }: { seats: any[]; mySeatId: string | null }) {
  const items = useItems((s) => s.items);
  const skills = useCharacters((s) => s.characters['B1']?.skills || []);
  const traits = useCharacters((s) => s.characters['B1']?.traits || []);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'item' | 'skill' | 'talent'>('item');
  const [sel, setSel] = useState('');
  const [recipient, setRecipient] = useState('');
  const others = (seats || []).filter((s) => s.seatId !== mySeatId);
  const list: any[] = tab === 'item' ? items : tab === 'skill' ? skills : traits;
  const selData = list.find((x) => (x.id || x.name) === sel) || null;

  const doShare = () => { if (selData) shareToRoom(tab, selData); };
  const doGift = () => {
    const it = items.find((x) => (x.id || x.name) === sel);
    const to = others.find((s) => s.seatId === recipient);
    if (it && to) { giveItems(to.playerId, [it]); setSel(''); setRecipient(''); }
  };

  return (
    <div className="shrink-0 border-b border-edge">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-2 text-left text-[12px] font-mono text-dim/70 hover:text-god/80 transition-colors">
        {open ? '▾' : '▸'} 🎁 赠予 / 📢 分享
      </button>
      {open && (
        <div className="px-5 pb-3 space-y-2">
          <div className="flex gap-1">
            {(['item', 'skill', 'talent'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setSel(''); }}
                className={`px-2.5 py-1 rounded-md text-[12px] border ${tab === t ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>
                {t === 'item' ? '物品' : t === 'skill' ? '技能' : '天赋'}
              </button>
            ))}
          </div>
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-panel border border-edge text-sm text-slate-100 outline-none">
            <option value="">— 选择{tab === 'item' ? '物品' : tab === 'skill' ? '技能' : '天赋'} —</option>
            {list.map((x, i) => <option key={x.id || i} value={x.id || x.name}>{x.name}{x.quantity > 1 ? ` ×${x.quantity}` : ''}{x.gradeDesc ? ` · ${x.gradeDesc}` : x.level ? ` · ${x.level}` : ''}</option>)}
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={doShare} disabled={!selData} className="px-3 py-1.5 rounded-lg bg-god/15 border border-god/40 text-god/90 text-[13px] hover:bg-god/25 disabled:opacity-40 transition-colors">📢 分享到房间</button>
            {tab === 'item' && (
              <>
                <select value={recipient} onChange={(e) => setRecipient(e.target.value)} className="px-2 py-1.5 rounded-lg bg-panel border border-edge text-[13px] text-slate-100 outline-none">
                  <option value="">— 赠予给 —</option>
                  {others.map((s) => <option key={s.seatId} value={s.seatId}>{s.name}</option>)}
                </select>
                <button onClick={doGift} disabled={!sel || !recipient} className="px-3 py-1.5 rounded-lg border border-amber-600/40 text-amber-300/80 text-[13px] hover:bg-amber-600/10 disabled:opacity-40 transition-colors">🎁 赠予</button>
              </>
            )}
          </div>
          {tab === 'item' && <div className="text-[11px] text-dim/40">赠予的物品会从你背包暂扣，对方收下才转移；拒收/超时自动退回。</div>}
        </div>
      )}
    </div>
  );
}
