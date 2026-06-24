import { useEffect, useRef, useState } from 'react';
import { useRaidImages, fileToScaledDataUrl } from '../store/raidImageStore';
import { useMp } from '../store/multiplayerStore';
import { mpClient } from '../systems/mpClient';
import { myMpName, setMpName } from '../systems/mpConfig';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { giveItems, shareToRoom } from '../systems/mpGift';
import { usePlayer } from '../store/playerStore';
import { generateRaidBoss, RAID_DIFFS, affixById, type RaidDifficulty } from '../systems/raidBoss';

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
  const [usePov, setUsePov] = useState(false);   // 建房：是否启用完整版双视角（主控-分支-对齐）
  const [mode, setMode] = useState<'adventure' | 'raid'>('adventure');   // 建房模式：共同冒险 / 组队讨伐

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
    useMp.getState().setPovMode(usePov);   // 本局双视角模式开关
    try {
      const id = await mpClient.createRoom({ name: roomName.trim() || `${n}的${mode === 'raid' ? '讨伐战' : '秘境'}`, hostName: n, maxSeats, mode });
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
              <div className="flex gap-1.5">
                <button onClick={() => setMode('adventure')} className={`flex-1 px-2 py-1.5 rounded-lg text-[12px] border ${mode === 'adventure' ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>🗺 共同冒险</button>
                <button onClick={() => setMode('raid')} className={`flex-1 px-2 py-1.5 rounded-lg text-[12px] border ${mode === 'raid' ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>⚔ 组队讨伐</button>
              </div>
              <div className="text-[11px] text-dim/50">{mode === 'adventure' ? '开放剧情 co-op，房主驱动世界演化。' : '整局讨伐 BOSS（多阶段 · 难度叠词缀）；进房备战。'}</div>
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
              <label className="flex items-start gap-2 text-[12px] text-dim/70 cursor-pointer leading-relaxed">
                <input type="checkbox" checked={usePov} onChange={(e) => setUsePov(e.target.checked)} className="accent-god mt-0.5" />
                <span>🎭 完整版双视角（主控-分支-对齐）：每人看到<b className="text-god/80">本人视角</b>的专属正文，由主控判定客观事实、各自渲染、再对齐冲突。每回合多次调用 AI、较慢较费；建议各玩家配好自己的正文 key（没配则由房主代渲染）。</span>
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
  const toggleSolo = () => {   // 分头行动：脱队单走 / 归队
    const next = !st.soloMode;
    if (next && !confirm('脱队单走：你将用自己的「正文生成」API 独立去跑支线，与队伍分头行动。\n期间不收主线正文、你的剧情与掉落都归你；仍可在房里互传道具支援队友。\n再点「归队」回到队伍。确定脱队？')) return;
    useMp.getState().setSoloMode(next);
    mpClient.relay('solo_toggle', { seatId: st.mySeatId || '', solo: next });
    if (!next) useMp.getState().handlers.onSoloRejoin?.();   // 归队：把支线见闻摘要送回主线（化学反应）
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 px-5 py-2.5 border-b border-edge bg-panel/50 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-slate-100 font-semibold truncate">{st.room?.name}</span>
        <button onClick={() => { navigator.clipboard?.writeText(st.room?.roomId || '').catch(() => {}); }}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god/80 hover:bg-god/10 transition-colors">复制码 {st.room?.roomId}</button>
        <div className="ml-auto flex items-center gap-2">
          {isHost && <button onClick={() => mpClient.startTurn()} className="text-[12px] px-2.5 py-1 rounded-lg bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 transition-colors">开启回合</button>}
          {isHost && <button onClick={() => useMp.getState().handlers.onGenHidden?.()} title="用 AI 编织跨玩家隐藏条件：集齐特定剧情道具（鼓励分头去支线搜集、回援汇合）触发隐藏结局。需房主配好正文 key。" className="text-[12px] px-2.5 py-1 rounded-lg border border-fuchsia-500/40 text-fuchsia-300/80 hover:bg-fuchsia-500/10 transition-colors">🔮 隐藏结局</button>}
          {st.role === 'player' && (
            <button onClick={() => useMp.getState().setGuestPovOn(!st.guestPovOn)}
              title="用你自己的正文 API 把房主正文改写成你的视角（需在「正文生成→API」配好 key；事实不变只换视角，失败自动保留原文）"
              className={`text-[12px] px-2.5 py-1 rounded-lg border transition-colors ${st.guestPovOn ? 'bg-god/15 border-god/40 text-god/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>
              ✍️ 我的视角{st.guestPovOn ? '·开' : ''}
            </button>
          )}
          {st.role === 'player' && (
            <button onClick={toggleSolo}
              title="脱队单走：用你自己的正文 API 独立去跑支线/主线，与队伍分头行动；期间不收主线正文，但仍可在房里互传道具支援。再点归队。"
              className={`text-[12px] px-2.5 py-1 rounded-lg border transition-colors ${st.soloMode ? 'bg-amber-500/15 border-amber-500/40 text-amber-300/90' : 'border-edge text-dim/70 hover:text-slate-200'}`}>
              🚶{st.soloMode ? '归队' : '脱队单走'}
            </button>
          )}
          {isHost
            ? <button onClick={() => { if (confirm('关闭房间？所有人将断开。')) mpClient.closeRoom(); }} className="text-[12px] px-2.5 py-1 rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10 transition-colors">关房</button>
            : <button onClick={() => mpClient.leave()} className="text-[12px] px-2.5 py-1 rounded-lg border border-edge text-dim/80 hover:text-slate-200 transition-colors">离开</button>}
        </div>
      </div>

      {st.povBusy && <div className="shrink-0 px-5 py-1.5 text-[12px] text-god/85 bg-god/5 border-b border-god/20 animate-pulse">{st.povBusy}（双视角模式）</div>}

      {st.soloMode && <div className="shrink-0 px-5 py-1.5 text-[12px] text-amber-300/90 bg-amber-500/5 border-b border-amber-500/20">🚶 你正在脱队单走——用自己的 key 跑支线，不收主线正文；剧情与掉落都归你、可带回主线支援。点「归队」回到队伍。</div>}

      {st.room?.mode === 'raid' && <RaidView st={st} />}

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
                {st.soloSeats?.includes(s.seatId)
                  ? <span className="text-[10px] font-mono px-1 rounded border border-amber-500/40 text-amber-300/80">🚶单走中</span>
                  : did && <span className="text-[10px] font-mono px-1 rounded border border-god/40 text-god/70">已提交</span>}
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

      {st.hiddenConditions?.length > 0 && (
        <div className="shrink-0 px-5 py-3 border-b border-edge">
          <div className="text-[12px] font-mono text-fuchsia-300/70 mb-2">🔮 隐藏结局 · 集齐剧情道具解锁（鼓励分头去支线搜集）</div>
          <div className="space-y-1.5">
            {st.hiddenConditions.map((c: any) => (
              <div key={c.id} className={`text-[12px] rounded-lg border p-2 ${c.met ? 'border-fuchsia-500/50 bg-fuchsia-500/10' : 'border-edge bg-panel/50'}`}>
                <div className="flex items-center gap-1.5">
                  <span>{c.met ? '🔓' : '🔒'}</span>
                  <span className="text-slate-100 font-semibold truncate">{c.title}</span>
                  {c.met && <span className="text-[10px] font-mono px-1 rounded border border-fuchsia-500/40 text-fuchsia-300/80 shrink-0">已解锁</span>}
                </div>
                <div className="text-[11px] text-dim/70 mt-1">集齐：{(c.requiredItems || []).map((it: string) => `【${it}】`).join(' ')}</div>
                <div className={`text-[11px] mt-0.5 ${c.met ? 'text-fuchsia-300/90' : 'text-dim/50'}`}>奖励：{c.met ? c.reward : '？？？（达成后揭晓）'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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

/* 副本 BOSS 立绘框：有图显图、无图回退 emoji；房主可 📷 导入(自动压缩)/✕ 清除。图存本机 raidImageStore(按 encId)，各客户端各自设、不碰版权素材。 */
function RaidBossFrame({ id, emoji, isHost }: { id: string; emoji: string; isHost: boolean }) {
  const img = useRaidImages((s) => s.images[id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPick = async (e: any) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const url = await fileToScaledDataUrl(f); useRaidImages.getState().setImage(id, url); } catch { /* */ }
    e.target.value = '';
  };
  return (
    <div className="relative shrink-0">
      <div className="w-11 h-11 rounded-lg border border-rose-500/30 bg-slate-900/60 overflow-hidden flex items-center justify-center">
        {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">{emoji}</span>}
      </div>
      {isHost && (
        <>
          <button onClick={() => fileRef.current?.click()} title="导入立绘" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-slate-800 border border-rose-500/40 text-[10px] flex items-center justify-center hover:bg-slate-700">📷</button>
          {img && <button onClick={() => useRaidImages.getState().clearImage(id)} title="清除立绘" className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 text-[9px] text-slate-300 flex items-center justify-center hover:text-rose-300">✕</button>}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
        </>
      )}
    </div>
  );
}

/* 组队讨伐：房主选难度→生成多阶段 BOSS→广播预览→开战；来宾看预览等开战。战斗本身复用联机战斗(CombatPanel)。 */
function RaidView({ st }: { st: any }) {
  const isHost = st.role === 'host';
  const boss = st.raidBoss;
  const dungeon = st.raidDungeon;
  const myTier = usePlayer((s) => s.profile?.tier);
  const [diff, setDiff] = useState<RaidDifficulty>('normal');
  const [theme, setTheme] = useState('');
  const partySize = (st.seats?.length || 0) + 1;

  const gen = () => {
    const b = generateRaidBoss(diff, { partySize, partyTier: myTier });
    useMp.getState()._set({ raidBoss: b });
    mpClient.relay('raid_boss', b);   // 广播给来宾预览
  };
  const start = () => { if (boss) useMp.getState().handlers.onStartRaid?.(boss); };
  const genDungeon = (kind: string) => useMp.getState().handlers.onStartDungeon?.({ difficulty: diff, kind });
  const resetDungeon = () => { useMp.getState()._set({ raidDungeon: null }); mpClient.relay('raid_dungeon', null); };

  // ── 组队副本：巴卡尔攻坚战进度面板（多场战斗串联，自选顺序打三龙→解锁龙王） ──
  if (dungeon) {
    const dragonsLeft = dungeon.encounters.filter((e: any) => e.kind === 'dragon' && e.status !== 'cleared').length;
    const cleared = dungeon.stage === 'cleared';   // 本体击破即通关（侧目标可选·不计入）
    return (
      <div className="shrink-0 px-5 py-3 border-b border-edge bg-rose-950/10">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-bold text-rose-200 truncate">🐉 {dungeon.name}</div>
          <span className="text-[11px] font-mono text-dim/60 shrink-0">【{dungeon.difficultyLabel}】</span>
        </div>
        <div className="mb-2">
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <span className="text-rose-300/80">🔥 {dungeon.dreadLabel || '恐惧之龙王槽'}（{dungeon.dreadMode === 'dot' ? '越满越痛·速清子目标' : '满则团灭·快通关'}）</span>
            <span className="font-mono text-rose-300/70">{Math.round(dungeon.dread || 0)}/{dungeon.dreadMax || 100}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-rose-600 transition-all duration-300" style={{ width: `${Math.min(100, ((dungeon.dread || 0) / (dungeon.dreadMax || 100)) * 100)}%` }} />
          </div>
        </div>
        {cleared
          ? <div className="mb-2 py-1 rounded-lg bg-amber-600/15 border border-amber-500/40 text-center text-[13px] text-amber-200 font-bold">🏆 副本通关！</div>
          : <div className="mb-2 text-[11px] text-dim/50">子目标未灭时本体锁血（剩 {dragonsLeft} 个）。{dungeon.linear ? '须按顺序逐关开打。' : '自选顺序逐个开打。'}</div>}
        <div className="space-y-1.5">
          {dungeon.encounters.map((e: any, idx: number) => {
            const bloodLocked = e.kind === 'boss' && dragonsLeft > 0;
            const linearLocked = !!dungeon.linear && idx > 0 && dungeon.encounters.slice(0, idx).some((p: any) => p.status !== 'cleared');
            const locked = bloodLocked || linearLocked;
            const done = e.status === 'cleared';
            return (
              <div key={e.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${done ? 'border-emerald-600/30 bg-emerald-950/20' : e.kind === 'boss' ? 'border-rose-500/40 bg-rose-950/25' : 'border-edge bg-panel/40'}`}>
                <RaidBossFrame id={e.id} emoji={e.emoji} isHost={isHost} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-slate-100 truncate">{e.name}{e.kind === 'boss' ? ' · 本体' : e.kind === 'side' ? ' · 可选' : ''}</div>
                  <div className="text-[11px] font-mono text-dim/50 truncate">{e.boss?.tier} · HP {Number(e.boss?.maxHp).toLocaleString()}{e.note ? ` · ${e.note}` : ''}</div>
                </div>
                {done ? <span className="text-[11px] text-emerald-300 font-medium shrink-0">✅ 已击破</span>
                  : locked ? <span className="text-[11px] text-dim/50 shrink-0">🔒 {bloodLocked ? '血锁' : '待解锁'}</span>
                  : isHost ? <button onClick={() => useMp.getState().handlers.onStartDungeonEncounter?.(e.id)} className="px-2.5 py-1 rounded-md text-[12px] bg-rose-600/25 border border-rose-500/50 text-rose-100 hover:bg-rose-600/40 shrink-0 transition-colors">{e.kind === 'boss' ? '讨伐龙王' : '开打'}</button>
                  : <span className="text-[11px] text-dim/50 shrink-0">待战</span>}
              </div>
            );
          })}
        </div>
        {isHost
          ? <div className="mt-2 flex justify-end"><button onClick={resetDungeon} className="text-[11px] text-dim/50 hover:text-rose-300 transition-colors">解散副本</button></div>
          : <div className="mt-2 text-[11px] text-dim/40 text-center">房主推进副本进度，你随房主战斗</div>}
      </div>
    );
  }

  return (
    <div className="shrink-0 px-5 py-3 border-b border-edge bg-rose-950/10">
      <div className="text-[12px] font-mono text-rose-300/70 mb-2">⚔ 组队讨伐</div>
      {boss ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{boss.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-bold text-slate-100 truncate">{boss.name}</div>
              <div className="text-[11px] font-mono text-dim/60">{boss.tier} · 【{boss.difficultyLabel}】· {boss.phases?.length} 阶段 · HP {Number(boss.maxHp).toLocaleString()}</div>
            </div>
          </div>
          {boss.affixes?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {boss.affixes.map((id: string) => { const a = affixById(id); return a ? <span key={id} title={a.desc} className="text-[11px] px-1.5 py-0.5 rounded border border-rose-600/40 text-rose-300/80">{a.emoji}{a.name}</span> : null; })}
            </div>
          )}
          <div className="text-[12px] text-dim/70 leading-relaxed">{boss.intro}</div>
        </div>
      ) : (
        <div className="text-[12px] text-dim/40 py-2 text-center">{isHost ? '选难度 → 生成 BOSS' : '等待房主生成 BOSS…'}</div>
      )}
      {isHost && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1">
            {RAID_DIFFS.map((d) => (
              <button key={d.id} onClick={() => setDiff(d.id)}
                className={`flex-1 px-1.5 py-1 rounded-md text-[12px] border ${diff === d.id ? 'bg-rose-600/20 border-rose-500/50 text-rose-200' : 'border-edge text-dim/70 hover:text-slate-200'}`}>{d.label}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="AI BOSS 主题(可选，如：堕落剑圣)"
              className="flex-1 px-2 py-1.5 rounded-lg bg-panel border border-edge text-[12px] text-slate-100 focus:border-rose-500/50 outline-none" />
            <button onClick={() => useMp.getState().handlers.onGenRaidBoss?.({ theme, difficulty: diff })}
              className="px-3 py-1.5 rounded-lg bg-fuchsia-600/20 border border-fuchsia-500/40 text-fuchsia-200 text-[13px] hover:bg-fuchsia-600/30 transition-colors">✨ AI 生成</button>
          </div>
          <div className="flex gap-2">
            <button onClick={gen} className="flex-1 px-3 py-1.5 rounded-lg bg-god/15 border border-god/40 text-god/90 text-[13px] hover:bg-god/25 transition-colors">{boss ? '↻ 重生(图鉴)' : '生成 BOSS(图鉴)'}</button>
            <button onClick={start} disabled={!boss} className="flex-1 px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/50 text-rose-200 text-[13px] hover:bg-rose-600/30 disabled:opacity-40 transition-colors">⚔ 开战</button>
          </div>
          <div className="text-[11px] text-dim/50 mb-0.5">开多场副本：</div>
          <div className="flex gap-1.5">
            <button onClick={() => genDungeon('bakal')} className="flex-1 px-2 py-1.5 rounded-lg bg-amber-600/15 border border-amber-500/40 text-amber-200 text-[12px] hover:bg-amber-600/25 transition-colors">🐉 巴卡尔</button>
            <button onClick={() => genDungeon('anton')} className="flex-1 px-2 py-1.5 rounded-lg bg-slate-600/20 border border-slate-400/40 text-slate-200 text-[12px] hover:bg-slate-600/30 transition-colors">🤖 安图恩</button>
            <button onClick={() => genDungeon('vykas')} className="flex-1 px-2 py-1.5 rounded-lg bg-pink-600/15 border border-pink-500/40 text-pink-200 text-[12px] hover:bg-pink-600/25 transition-colors">💋 比阿基斯</button>
          </div>
        </div>
      )}
    </div>
  );
}
