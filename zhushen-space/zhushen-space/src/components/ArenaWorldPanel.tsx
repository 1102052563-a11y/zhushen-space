import { useEffect, useMemo, useRef, useState } from 'react';
import { useArenaWorld } from '../store/arenaWorldStore';
import type { ArenaCard, DuelLive } from '../store/arenaWorldStore';
import { arenaWorldClient } from '../systems/arenaWorldClient';
import { useNpc, hasRealNpcName } from '../store/npcStore';
import { useCombat } from '../store/combatStore';
import { buildPlayerSnapshot } from '../systems/mpSnapshot';
import { npcToSnapshotRaw } from '../systems/assistApply';
import { cardToGladiator, fallbackArenaBattle, ARENA_MAX_SKILLS, ARENA_MAX_ITEMS } from '../systems/arenaWorldBattle';
import type { Gladiator } from '../systems/casinoEngine';
import type { AssistSnapshot } from '../systems/arenaWorldProtocol';
import NpcCardPreview from './NpcCardPreview';
import ChatAvatar from './ChatAvatar';
import ArenaWorldBattle, { type ArenaBattlePayload } from './ArenaWorldBattle';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatToken } from '../systems/chatIdentity';

/* 世界竞技场：把主角/NPC 上传成参赛卡，形成占位排名榜（阶梯榜）。挑战比自己排名高的对手，胜负由服务端权威裁判，
   胜则顶掉对手名次、其下顺延一名。排名越高特效越足（前三：轮回主宰/乐园霸主/万族强者）。每账号最多 3 张卡，可更新/删除。
   点榜单任意角色 → 展开完整面板（只读，复用 NpcCardPreview）。与聊天室共用 Discord 身份。 */

type Kind = 'player' | 'npc';
const nm = (x: any): string => String((x && (x.name || x.title)) || '').trim();
function parseUid(pid?: string): number { return pid && pid.startsWith('chat:') ? (parseInt(pid.slice(5), 10) || 0) : 0; }
function uidTag(pid?: string, du?: number): string { const n = du || parseUid(pid); return n ? '#' + n : ''; }
function nameColor(c?: ArenaCard) { return c?.nc || (typeof c?.hue === 'number' ? `hsl(${c.hue} 70% 72%)` : '#cbd5e1'); }
function rankClass(rank: number) { return rank === 1 ? 'aw-rank-1' : rank === 2 ? 'aw-rank-2' : rank === 3 ? 'aw-rank-3' : rank <= 10 ? 'aw-rank-top' : ''; }
const TOP_TITLE: Record<number, string> = { 1: '轮回主宰 👑', 2: '乐园霸主 🔱', 3: '万族强者 ⚔️' };
function rankBadge(rank: number) { return rank === 1 ? '👑' : rank === 2 ? '🔱' : rank === 3 ? '⚔️' : '#' + rank; }
function rankNumColor(rank: number) { return rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-sky-200' : rank === 3 ? 'text-orange-400' : 'text-dim/45'; }

function StatusDot({ status }: { status: string }) {
  const c = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-dim/40';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}
function OwnerTag({ c }: { c: ArenaCard }) {
  return (
    <span className="text-[10px] font-mono text-dim/45 flex items-center gap-1">
      <ChatAvatar uid={parseUid(c.ownerId)} avv={c.avv} ds={c.ds} size={14} />
      {uidTag(c.ownerId, c.ownerDu) && <span className="text-god/45">{uidTag(c.ownerId, c.ownerDu)}</span>}
      <span style={{ color: nameColor(c) }}>{c.ownerName}</span>
    </span>
  );
}

// ── 实时对战·血条 / 立绘 / 对战房（均为模块级组件：受控 textarea 若定义在父组件内会每键重挂→中文输入断字，故提到模块级）──
function DuelFace({ snapshot }: { snapshot: any }) {
  return (
    <span className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-void border border-edge flex items-center justify-center">
      {snapshot?.avatar ? <img src={snapshot.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-sm text-dim/50">{String(snapshot?.name || '?').slice(0, 1)}</span>}
    </span>
  );
}
function HpBar({ name, hp, max, side, mine }: { name: string; hp: number; max: number; side: 'A' | 'B'; mine: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  const low = pct <= 25;
  const fill = low ? 'from-blood/70 to-blood' : side === 'A' ? 'from-sky-500/70 to-sky-400' : 'from-rose-500/70 to-rose-400';
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[13px] font-bold text-slate-100 truncate">{name}{mine && <span className="text-[10px] font-normal text-god/70 ml-1">（你）</span>}</span>
        <span className={`text-[11px] font-mono shrink-0 ${low ? 'text-blood' : 'text-dim/60'}`}>{Math.max(0, Math.round(hp))}/{max}</span>
      </div>
      <div className="h-2.5 rounded-full bg-void border border-edge overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${fill} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
function DuelRoom({ duel, input, onInput, onSubmit, onForfeit, onExit }: {
  duel: DuelLive;
  input: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
  onForfeit: () => void;
  onExit: () => void;
}) {
  const me = duel.you;
  const oppSide = me === 'A' ? 'B' : 'A';
  const meSubmitted = duel.submitted[me];
  const oppSubmitted = duel.submitted[oppSide];
  const ended = duel.status === 'ended';
  const iWon = ended && duel.winner === me;
  const isDraw = ended && !duel.winner;
  const myName = me === 'A' ? duel.a.name : duel.b.name;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [duel.rounds.length, duel.judging]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-slate-100">⚔️ 实时对战</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${duel.ranked ? 'bg-amber-400/15 border border-amber-400/30 text-amber-200/90' : 'bg-god/10 border border-god/30 text-god/80'}`}>{duel.ranked ? '排位' : '友谊'}</span>
        {!ended && <span className="text-[11px] text-dim/50">第 {duel.round} 回合</span>}
      </div>

      {/* 双方血条 */}
      <div className="rounded-xl border border-edge bg-panel2/20 p-3 space-y-2">
        <div className="flex items-center gap-3"><DuelFace snapshot={duel.a.snapshot} /><HpBar name={duel.a.name} hp={duel.hpA} max={duel.maxHpA} side="A" mine={me === 'A'} /></div>
        <div className="text-center text-[10px] font-bold text-dim/40 tracking-widest">— VS —</div>
        <div className="flex items-center gap-3"><DuelFace snapshot={duel.b.snapshot} /><HpBar name={duel.b.name} hp={duel.hpB} max={duel.maxHpB} side="B" mine={me === 'B'} /></div>
      </div>

      {/* 回合日志 */}
      <div ref={logRef} className="max-h-[38vh] overflow-y-auto space-y-2 pr-0.5">
        {duel.rounds.length === 0 && !duel.judging && (
          <div className="py-6 text-center text-dim/50 text-[13px] leading-relaxed">对战开始！双方各自输入本回合行动，等两边都出招后由 AI 依双方全部信息公正裁定。</div>
        )}
        {duel.rounds.map((r) => (
          <div key={r.round} className="rounded-xl border border-edge bg-panel2/20 p-3">
            <div className="text-[11px] font-bold text-god/70 mb-1">第 {r.round} 回合</div>
            <div className="text-[13px] leading-relaxed text-slate-200/90 whitespace-pre-wrap">{r.narrative}</div>
          </div>
        ))}
        {duel.judging && <div className="py-3 text-center text-amber-200/80 text-sm animate-pulse">⚖️ 正在公正裁定本回合…</div>}
        {!duel.judging && !ended && meSubmitted && oppSubmitted && <div className="py-3 text-center text-amber-200/70 text-sm animate-pulse">⚔️ 双方已出招，等待裁定…</div>}
      </div>

      {/* 出招 / 结果 */}
      {ended ? (
        <div className="space-y-3">
          <div className={`rounded-xl border p-3 text-center ${iWon ? 'border-amber-400/60 bg-amber-400/10' : isDraw ? 'border-edge bg-panel2/20' : 'border-blood/40 bg-blood/5'}`}>
            <div className="text-base font-bold text-slate-100">{isDraw ? '同归于尽 · 平局' : `${duel.winner === 'A' ? duel.a.name : duel.b.name} 获胜 👑`}</div>
            <div className="text-[12px] text-dim/70 mt-0.5">
              {duel.endedReason === 'forfeit' ? '一方认输 · ' : duel.endedReason === 'disconnect' ? '对方掉线 · ' : ''}
              {iWon ? '你赢下了这场对决' : isDraw ? '势均力敌' : '你败下阵来'}{duel.ranked ? ' · 计入排名' : ' · 友谊战不计分'}
            </div>
          </div>
          <div className="text-center"><button onClick={onExit} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">返回榜单</button></div>
        </div>
      ) : meSubmitted ? (
        <div className="rounded-xl border border-edge bg-panel2/20 p-3 text-center space-y-2">
          <div className="text-[13px] text-emerald-300/80">✅ 你已出招，本回合等待{oppSubmitted ? '裁定' : '对方出招'}…</div>
          <button onClick={onForfeit} className="text-[12px] text-blood/70 hover:text-blood transition-colors">认输退出</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea value={input} onChange={(e) => onInput(e.target.value)} rows={3} placeholder={`第 ${duel.round} 回合 · 输入你（${myName}）本回合的行动…`} className="w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 resize-none focus:border-god/40 focus:outline-none" />
          <div className="flex items-center gap-2">
            <button onClick={onSubmit} disabled={!input.trim()} className="flex-1 px-4 py-2 rounded-lg text-[13px] font-bold bg-blood/20 border border-blood/40 text-blood/90 hover:bg-blood/30 disabled:opacity-40 transition-colors">⚔ 出招</button>
            <button onClick={onForfeit} className="px-3 py-2 rounded-lg text-[12px] text-dim/60 hover:text-blood border border-edge transition-colors">认输</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArenaWorldPanel({ onClose, onGenBattle, onSpar, onManualChallenge, onDuelJudge }: {
  onClose: () => void;
  onGenBattle: (challengerSnap: AssistSnapshot, opponentSnap: AssistSnapshot, winner: 0 | 1) => Promise<{ scenes: string[]; summary: string }>;
  onSpar: (card: ArenaCard) => void;   // 切磋：真实战斗系统对战，不计排名
  onManualChallenge: (opp: ArenaCard, myCardId: string) => void;   // 手动应战：真实战斗，胜负计入排名
  // 实时对战·发起方(评委)每回合跑一次 AI 中立裁定（据双方完整档案+本回合行动）
  onDuelJudge: (aSnap: AssistSnapshot, bSnap: AssistSnapshot, actionA: string, actionB: string, ctx: { round: number; hpA: number; hpB: number; maxHpA: number; maxHpB: number; prior: string[] }) => Promise<{ narrative: string; dmgA: number; dmgB: number; ended: boolean; winner: 'A' | 'B' | null; summary: string }>;
}) {
  const st = useArenaWorld();
  const npcs = useNpc((s) => s.npcs);

  const [entered, setEntered] = useState(false);
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [busy, setBusy] = useState(false);
  const [gateErr, setGateErr] = useState('');

  const [view, setView] = useState<'board' | 'mine'>('board');
  const [detail, setDetail] = useState<ArenaCard | null>(null);
  const [myFighterId, setMyFighterId] = useState('');
  const [challengeMode, setChallengeMode] = useState<'auto' | 'manual'>('auto');
  const combatActive = useCombat((s) => s.battle.active);

  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<Kind>('player');
  const [formNpcId, setFormNpcId] = useState('');
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [keepItems, setKeepItems] = useState<Set<string>>(new Set());

  const [battle, setBattle] = useState<ArenaBattlePayload | null>(null);
  const [battleBusy, setBattleBusy] = useState(false);

  // 实时对战：发起小窗（选排位/友谊）+ 出招输入 + 评委防重复/前几回合摘要
  const [duelTarget, setDuelTarget] = useState<ArenaCard | null>(null);
  const [duelInput, setDuelInput] = useState('');
  const judgeBusyRef = useRef<string>('');          // "duelId:round"，防同回合重复裁定
  const duelSummariesRef = useRef<string[]>([]);     // 评委本地累积各回合要点，喂下一回合上下文

  // 进场：已登录则确保身份后连接（与聊天室同一 Discord 身份）；未登录显门禁。离场断开。
  useEffect(() => {
    (async () => {
      if (!discordLoggedIn()) return;
      try {
        if (!chatReady()) await fetchChatIdentity();
        arenaWorldClient.connect(chatName() || '道友', chatToken());
        setEntered(true);
      } catch { /* 失败留门禁 */ }
    })();
    return () => arenaWorldClient.leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = async () => {
    setBusy(true); setGateErr('');
    try {
      await discordLogin();
      setLoggedIn(true);
      await fetchChatIdentity();
      arenaWorldClient.connect(chatName() || '道友', chatToken());
      setEntered(true);
    } catch (e: any) { setGateErr(e?.message || '登录失败'); }
    setBusy(false);
  };

  const connected = st.status === 'connected';
  const myId = st.me?.playerId || '';
  const myCards = useMemo(() => st.cards.filter((c) => c.ownerId === myId).sort((a, b) => a.rank - b.rank), [st.cards, myId]);
  const board = st.cards;   // 服务端已按 rank 升序下发

  // 默认出战角色 = 我排名最高的卡
  useEffect(() => {
    if (myCards.length && !myCards.some((c) => c.id === myFighterId)) setMyFighterId(myCards[0].id);
    if (!myCards.length && myFighterId) setMyFighterId('');
  }, [myCards, myFighterId]);
  const myFighter = useMemo(() => myCards.find((c) => c.id === myFighterId) || null, [myCards, myFighterId]);

  // 收到服务端裁判结果 → 生成过场战报并回放（胜负已定，AI 只演绎；失败走确定性兜底）
  useEffect(() => {
    const r = st.lastResult;
    if (!r) return;
    arenaWorldClient.clearResult();
    const fighters: [Gladiator, Gladiator] = [cardToGladiator(r.challenger.snapshot), cardToGladiator(r.opponent.snapshot)];
    const winner: 0 | 1 = r.winner === 'challenger' ? 0 : 1;
    setBattleBusy(true);
    setBattle({ fighters, winner, scenes: [], summary: '', challengerSide: 0, rankBefore: r.rankBefore, rankAfter: r.rankAfter });
    (async () => {
      let res: { scenes: string[]; summary: string };
      try { res = await onGenBattle(r.challenger.snapshot, r.opponent.snapshot, winner); }
      catch { res = fallbackArenaBattle(fighters, winner); }
      if (!res || !res.scenes?.length) res = fallbackArenaBattle(fighters, winner);
      setBattle({ fighters, winner, scenes: res.scenes, summary: res.summary, challengerSide: 0, rankBefore: r.rankBefore, rankAfter: r.rankAfter });
      setBattleBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.lastResult]);

  // 实时对战·评委端：收到 pendingJudge（仅发起方）→ 跑一次 AI 中立裁定本回合 → 回传结果给服务端广播
  useEffect(() => {
    const pj = st.pendingJudge, d = st.duel;
    if (!pj || !d || !d.isJudge || pj.duelId !== d.duelId) return;
    const key = `${pj.duelId}:${pj.round}`;
    if (judgeBusyRef.current === key) return;
    judgeBusyRef.current = key;
    (async () => {
      try {
        const res = await onDuelJudge(d.a.snapshot, d.b.snapshot, pj.actionA, pj.actionB, {
          round: pj.round, hpA: d.hpA, hpB: d.hpB, maxHpA: d.maxHpA, maxHpB: d.maxHpB, prior: duelSummariesRef.current,
        });
        duelSummariesRef.current = [...duelSummariesRef.current, res.summary || ''];
        arenaWorldClient.duelRoundResult({ duelId: pj.duelId, round: pj.round, narrative: res.narrative, dmgA: res.dmgA, dmgB: res.dmgB, ended: res.ended, winner: res.winner });
      } catch (e) { console.warn('[ArenaDuel] 裁定失败', e); judgeBusyRef.current = ''; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.pendingJudge]);

  // 新对战/新回合 → 清空出招框；换对战 → 清空评委累积摘要
  const duelId = st.duel?.duelId || '';
  const duelRound = st.duel?.round || 0;
  useEffect(() => { duelSummariesRef.current = []; judgeBusyRef.current = ''; }, [duelId]);
  useEffect(() => { setDuelInput(''); }, [duelId, duelRound]);

  const doDuelInvite = (opp: ArenaCard, ranked: boolean) => {
    if (!connected || !myFighter) return;
    arenaWorldClient.duelInvite(myFighter.id, opp.id, ranked);
    setDuelTarget(null);
  };
  const submitDuelAction = () => {
    const d = useArenaWorld.getState().duel; const t = duelInput.trim();
    if (!d || !t) return;
    arenaWorldClient.duelAction(d.duelId, d.round, t);
    setDuelInput('');
  };
  const forfeitDuel = () => { const d = useArenaWorld.getState().duel; if (d) arenaWorldClient.duelForfeit(d.duelId); };

  // 上传表单：源快照 + 可选技能/天赋/物品清单
  const srcSnap = useMemo(() => {
    if (!showForm) return null;
    try { return formKind === 'player' ? (buildPlayerSnapshot() as any) : (formNpcId ? npcToSnapshotRaw(formNpcId) : null); } catch { return null; }
  }, [showForm, formKind, formNpcId]);
  const skillNames = useMemo(() => [...((srcSnap?.skills || []) as any[]), ...((srcSnap?.traits || []) as any[])].map(nm).filter(Boolean), [srcSnap]);
  const itemNames = useMemo(() => ((srcSnap?.items || []) as any[]).map(nm).filter(Boolean), [srcSnap]);
  const eligibleNpcs = useMemo(() => Object.values(npcs).filter((r) => hasRealNpcName(r) && !r.isDead && !r.assistOwnerId), [npcs]);

  // 打开表单 / 切换来源 → 默认勾选靠前的（技能+天赋≤10、物品≤5）
  useEffect(() => {
    if (!showForm) return;
    setKeep(new Set(skillNames.slice(0, ARENA_MAX_SKILLS)));
    setKeepItems(new Set(itemNames.slice(0, ARENA_MAX_ITEMS)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, formKind, formNpcId]);

  const toggleKeep = (name: string) => setKeep((prev) => { const s = new Set(prev); if (s.has(name)) s.delete(name); else { if (s.size >= ARENA_MAX_SKILLS) return prev; s.add(name); } return s; });
  const toggleItem = (name: string) => setKeepItems((prev) => { const s = new Set(prev); if (s.has(name)) s.delete(name); else { if (s.size >= ARENA_MAX_ITEMS) return prev; s.add(name); } return s; });

  const openUpload = () => { setFormKind('player'); setFormNpcId(eligibleNpcs[0]?.id || ''); setShowForm(true); setView('mine'); };
  const openEdit = (c: ArenaCard) => { setFormKind(c.kind); setFormNpcId(c.kind === 'npc' ? (c.srcKey || '') : ''); setShowForm(true); setView('mine'); };

  const doPublish = async () => {
    if (!connected) return;
    setBusy(true);
    const srcKey = formKind === 'npc' ? formNpcId : 'B1';
    await arenaWorldClient.publishCard(formKind, srcKey, formNpcId, { keep, keepItems });
    setBusy(false); setShowForm(false);
  };
  const doDelete = (cardId: string) => arenaWorldClient.removeCard(cardId);
  const doChallenge = (opp: ArenaCard) => {
    if (!connected || !myFighter) return;
    if (challengeMode === 'manual') onManualChallenge(opp, myFighter.id);   // 手动应战：真实战斗，胜负回传占位
    else arenaWorldClient.challenge(myFighter.id, opp.id);                  // 自动结算：服务端裁判
  };

  const canUploadMore = myCards.length < 3;
  const previewSnap = (srcSnap || null) as any;

  // 手动战斗/切磋进行中：面板让位给外层 CombatPanel（保持挂载→WS 存活，可回传排名结果），战斗结束自动回来
  if (combatActive) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="relative w-full max-w-3xl h-[90vh] flex flex-col rounded-2xl border border-edge bg-panel shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-edge bg-panel/60">
          <span className="text-xl">🏆</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-100">世界竞技场</div>
            <div className="flex items-center gap-1.5 text-[11px] text-dim/60">
              <StatusDot status={entered ? st.status : 'idle'} />
              <span>{!entered ? '未进入' : connected ? `${st.cards.length} 位挑战者 · ${st.online} 人在线` : st.status === 'connecting' ? '连接中…' : st.status === 'closed' ? '已断开' : '未连接'}</span>
            </div>
          </div>
          <div className="flex-1" />
          {entered && !battle && !st.duel && (
            <button onClick={openUpload} disabled={!connected || !canUploadMore} title={canUploadMore ? '' : '每账号最多 3 个角色'} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">➕ 上传角色</button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!entered ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-5xl">🏆</div>
            <div className="text-base font-bold text-slate-100">进入世界竞技场</div>
            <div className="text-[12px] text-dim/60 max-w-xs leading-relaxed">把你的<span className="text-god">主角或 NPC</span> 上传成参赛卡，挑战其他契约者、争夺排名榜的<span className="text-god">轮回主宰</span>之位——与聊天室<span className="text-god">共用 Discord 身份</span>。</div>
            <button onClick={doLogin} disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-50 transition-colors">{busy ? '登录中…' : (loggedIn ? '进入竞技场' : '用 Discord 登录')}</button>
            {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
          </div>
        ) : st.duel ? (
          /* ── 实时对战房（双方在线·逐回合各自出招·AI 公正裁定）── */
          <div className="flex-1 overflow-y-auto p-3">
            <DuelRoom duel={st.duel} input={duelInput} onInput={setDuelInput} onSubmit={submitDuelAction} onForfeit={forfeitDuel} onExit={() => arenaWorldClient.clearDuel()} />
          </div>
        ) : battle ? (
          /* ── 战斗回放 ── */
          <div className="flex-1 overflow-y-auto p-4">
            <ArenaWorldBattle data={battle} busy={battleBusy} onClose={() => { setBattle(null); setBattleBusy(false); }} />
          </div>
        ) : st.sparResult ? (
          /* ── 手动/切磋战报（AI 读赌场战斗世界书生成·≥500字·只在此显示，绝不进正文）── */
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className={`rounded-xl border p-3 text-center ${st.sparResult.iWon ? 'border-amber-400/60 bg-amber-400/10' : 'border-edge bg-panel2/20'}`}>
              <div className="text-base font-bold text-slate-100">{st.sparResult.winnerName} 获胜 👑</div>
              <div className="text-[13px] text-slate-300/80 mt-0.5">{st.sparResult.iWon ? '你赢下了这场对决' : '你败下阵来'}{st.sparResult.ranked ? ' · 计入排名' : ' · 切磋不计分'}</div>
            </div>
            {st.sparResult.loading ? (
              <div className="py-10 text-center text-amber-200/80 text-sm animate-pulse">✍️ 正在生成战报（读取赌场战斗世界书 · 不少于 500 字）…</div>
            ) : (
              <div className="rounded-xl border border-edge bg-panel2/20 p-4 text-[14px] leading-loose text-slate-200/90 whitespace-pre-wrap">{st.sparResult.text}</div>
            )}
            <div className="text-center">
              <button onClick={() => useArenaWorld.getState()._set({ sparResult: null })} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">返回榜单</button>
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/40 text-[13px]">
              {([['board', '🏅 排名榜'], ['mine', `🎴 我的参赛（${myCards.length}/3）`]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setView(v); setShowForm(false); }} className={`px-3 py-1.5 rounded-lg transition-colors ${view === v ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>{label}</button>
              ))}
              {view === 'board' && myCards.length > 0 && (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-dim/50">出战：</span>
                  <select value={myFighterId} onChange={(e) => setMyFighterId(e.target.value)} className="bg-void border border-edge rounded-md px-2 py-1 text-[12px] text-slate-200 max-w-[140px]">
                    {myCards.map((c) => <option key={c.id} value={c.id}>#{c.rank} {c.snapshot.name}</option>)}
                  </select>
                  <span className="text-dim/50 ml-1">结算：</span>
                  <div className="flex rounded-md overflow-hidden border border-edge">
                    {(['auto', 'manual'] as const).map((m) => (
                      <button key={m} onClick={() => setChallengeMode(m)} title={m === 'auto' ? '服务端按战力+种子自动定胜负' : '亲手用战斗系统打，胜负计入排名'} className={`px-2 py-1 text-[12px] transition-colors ${challengeMode === m ? 'bg-god/25 text-god font-semibold' : 'text-dim/60 hover:text-god'}`}>{m === 'auto' ? '⚡自动' : '🎮手动'}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {st.error && <div className="shrink-0 px-4 py-1.5 text-[12px] text-amber-400/80 bg-amber-400/5 border-b border-edge">{st.error}</div>}

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {view === 'board' && (
                board.length === 0 ? (
                  <div className="py-16 text-center text-dim/50 text-sm">还没有挑战者上榜——上传你的角色，成为第一位<span className="text-god">轮回主宰</span>。</div>
                ) : board.map((c) => {
                  const mine = c.ownerId === myId;
                  const canChallenge = !mine && myFighter && c.rank < myFighter.rank;
                  return (
                    <div key={c.id} className={`rounded-xl border p-2.5 flex items-center gap-3 transition-colors ${rankClass(c.rank)} ${mine ? 'border-god/40 bg-god/5' : 'border-edge bg-panel2/20 hover:border-god/30'}`}>
                      <button onClick={() => setDetail(c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <span className={`w-10 text-center font-bold shrink-0 ${rankNumColor(c.rank)}`}>{rankBadge(c.rank)}</span>
                        <span className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-void border border-edge flex items-center justify-center">
                          {c.snapshot.avatar ? <img src={c.snapshot.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-sm text-dim/50">{c.snapshot.name.slice(0, 1)}</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 truncate">{c.snapshot.name}</span>
                            {TOP_TITLE[c.rank] && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-400/15 border border-amber-400/30 text-amber-200/90 whitespace-nowrap">{TOP_TITLE[c.rank]}</span>}
                            <span className="text-[11px] font-mono text-dim/50">{c.snapshot.tier || ''}{c.kind === 'npc' ? ' · NPC' : ''}</span>
                          </span>
                          <span className="flex items-center gap-2 mt-0.5">
                            <OwnerTag c={c} />
                            <span className="text-[10px] font-mono text-dim/40">{c.wins}胜{c.losses}负</span>
                            {!mine && st.onlineOwners.includes(c.ownerId) && <span className="text-[9px] font-mono text-emerald-400/90">● 在线</span>}
                          </span>
                        </span>
                      </button>
                      {canChallenge && (
                        <button onClick={() => doChallenge(c)} className="shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-blood/40 text-blood/90 hover:bg-blood/15 transition-colors">⚔ 挑战</button>
                      )}
                      {!mine && st.onlineOwners.includes(c.ownerId) && myFighter && (
                        <button onClick={() => setDuelTarget(c)} title="实时对战·双方各自出招，AI 逐回合公正裁定" className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border border-amber-400/40 text-amber-200/90 hover:bg-amber-400/15 transition-colors">⚔️ 实时</button>
                      )}
                      {!mine && (
                        <button onClick={() => onSpar(c)} title="切磋·真实战斗，不计排名" className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border border-god/40 text-god/80 hover:bg-god/15 transition-colors">🤺 切磋</button>
                      )}
                      {mine && <span className="shrink-0 text-[10px] font-mono text-god/60 px-2">我的</span>}
                    </div>
                  );
                })
              )}

              {view === 'mine' && (
                <>
                  {myCards.length === 0 && !showForm && (
                    <div className="py-12 text-center text-dim/50 text-sm">你还没有参赛角色。<button onClick={openUpload} className="text-god hover:underline">上传一个</button>开始征战。</div>
                  )}
                  {myCards.map((c) => (
                    <div key={c.id} className={`rounded-xl border border-edge bg-panel2/20 p-2.5 flex items-center gap-3 ${rankClass(c.rank)}`}>
                      <span className={`w-10 text-center font-bold shrink-0 ${rankNumColor(c.rank)}`}>{rankBadge(c.rank)}</span>
                      <button onClick={() => setDetail(c)} className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-bold text-slate-100 truncate">{c.snapshot.name} <span className="text-[11px] font-mono text-dim/50">{c.kind === 'npc' ? 'NPC' : '主角'} · {c.snapshot.tier || ''}</span></div>
                        <div className="text-[11px] font-mono text-dim/45">{c.wins}胜{c.losses}负 · 技{(c.snapshot.skills?.length || 0) + (c.snapshot.traits?.length || 0)}/物{c.snapshot.items?.length || 0}</div>
                      </button>
                      <button onClick={() => openEdit(c)} className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border border-god/40 text-god hover:bg-god/15 transition-colors">✏️ 更新</button>
                      <button onClick={() => doDelete(c.id)} className="shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">🗑</button>
                    </div>
                  ))}
                  {canUploadMore && !showForm && myCards.length > 0 && (
                    <button onClick={openUpload} className="w-full py-2 rounded-lg text-[13px] font-semibold border border-dashed border-god/40 text-god/80 hover:bg-god/10 transition-colors">➕ 上传新角色（{myCards.length}/3）</button>
                  )}

                  {showForm && (
                    <div className="rounded-xl border border-god/30 bg-god/5 p-3 space-y-3">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="text-dim/60">类型：</span>
                        {(['player', 'npc'] as const).map((k) => (
                          <button key={k} onClick={() => setFormKind(k)} className={`px-2.5 py-1 rounded-lg transition-colors ${formKind === k ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-edge text-dim/60 hover:text-god'}`}>{k === 'player' ? '👤 主角' : '🎭 NPC'}</button>
                        ))}
                        {formKind === 'npc' && (
                          <select value={formNpcId} onChange={(e) => setFormNpcId(e.target.value)} className="bg-void border border-edge rounded-md px-2 py-1 text-[12px] text-slate-200 flex-1 min-w-0">
                            <option value="">选择一个 NPC…</option>
                            {eligibleNpcs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        )}
                      </div>

                      {!previewSnap ? (
                        <div className="text-[12px] text-amber-400/80">{formKind === 'npc' ? '请选择一个有效的 NPC。' : '尚未创建主角。'}</div>
                      ) : (
                        <>
                          <div>
                            <div className="text-[12px] text-dim/60 mb-1">选择上场的技能 / 天赋（合计上限 {ARENA_MAX_SKILLS}，已选 <span className={keep.size >= ARENA_MAX_SKILLS ? 'text-amber-300' : 'text-god'}>{keep.size}</span>）</div>
                            <div className="flex flex-wrap gap-1">
                              {skillNames.length === 0 && <span className="text-[12px] text-dim/40">（无技能/天赋）</span>}
                              {skillNames.map((n, i) => {
                                const on = keep.has(n);
                                return <button key={i} onClick={() => toggleKeep(n)} className={`px-2 py-1 rounded-md text-[12px] border transition-colors ${on ? 'border-god/50 bg-god/20 text-god' : 'border-edge bg-void text-dim/50 hover:text-slate-300'}`}>{on ? '✓ ' : ''}{n}</button>;
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="text-[12px] text-dim/60 mb-1">选择随身物品（上限 {ARENA_MAX_ITEMS}，已选 <span className={keepItems.size >= ARENA_MAX_ITEMS ? 'text-amber-300' : 'text-god'}>{keepItems.size}</span>）· 装备不限，自动带上</div>
                            <div className="flex flex-wrap gap-1">
                              {itemNames.length === 0 && <span className="text-[12px] text-dim/40">（储存空间为空）</span>}
                              {itemNames.map((n, i) => {
                                const on = keepItems.has(n);
                                return <button key={i} onClick={() => toggleItem(n)} className={`px-2 py-1 rounded-md text-[12px] border transition-colors ${on ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-edge bg-void text-dim/50 hover:text-slate-300'}`}>{on ? '✓ ' : ''}{n}</button>;
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button onClick={doPublish} disabled={busy || !connected} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{busy ? '上传中…' : '确认上传'}</button>
                            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg text-[13px] text-dim/60 hover:text-slate-200 transition-colors">取消</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* 收到实时对战邀请 → 接受 / 拒绝 */}
        {st.incomingInvite && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-panel p-5 text-center space-y-3 shadow-2xl">
              <div className="text-3xl">⚔️</div>
              <div className="text-[13px] text-slate-100 leading-relaxed">
                <span className="font-bold text-amber-200">{st.incomingInvite.challengerCard.ownerName}</span> 用「<span className="font-bold">{st.incomingInvite.challengerCard.snapshot.name}</span>」向你发起<span className="font-bold text-amber-200">{st.incomingInvite.ranked ? '排位' : '友谊'}实时对战</span>
              </div>
              <div className="text-[12px] text-dim/60 leading-relaxed">双方逐回合各自出招，由 AI 依双方全部信息公正裁定{st.incomingInvite.ranked ? '，结果计入排名' : '，友谊战不计分'}。</div>
              <div className="flex items-center gap-2 justify-center pt-1">
                <button onClick={() => arenaWorldClient.duelRespond(st.incomingInvite!.duelId, true)} className="px-5 py-2 rounded-lg text-[13px] font-bold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">接受</button>
                <button onClick={() => arenaWorldClient.duelRespond(st.incomingInvite!.duelId, false)} className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-edge text-dim/70 hover:text-blood transition-colors">拒绝</button>
              </div>
            </div>
          </div>
        )}

        {/* 我方已发起 → 等待对方接受 */}
        {st.pendingInvite && !st.duel && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-god/40 bg-panel p-5 text-center space-y-3 shadow-2xl">
              <div className="text-3xl animate-pulse">📨</div>
              <div className="text-[13px] text-slate-100 leading-relaxed">已向「<span className="font-bold">{st.pendingInvite.opponent.snapshot.name}</span>」（{st.pendingInvite.opponent.ownerName}）发起实时对战，等待对方接受…</div>
              <button onClick={() => arenaWorldClient.cancelInvite(st.pendingInvite!.duelId)} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold border border-edge text-dim/70 hover:text-blood transition-colors">取消</button>
            </div>
          </div>
        )}

        {/* 发起实时对战 → 选排位 / 友谊 */}
        {duelTarget && myFighter && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setDuelTarget(null)}>
            <div className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-panel p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="text-center space-y-1">
                <div className="text-3xl">⚔️</div>
                <div className="text-[13px] text-slate-100">向「<span className="font-bold">{duelTarget.snapshot.name}</span>」发起实时对战</div>
                <div className="text-[11px] text-dim/50">出战：{myFighter.snapshot.name}（#{myFighter.rank}）</div>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {duelTarget.rank < myFighter.rank ? (
                  <button onClick={() => doDuelInvite(duelTarget, true)} className="w-full px-4 py-2 rounded-lg text-[13px] font-bold bg-amber-400/15 border border-amber-400/40 text-amber-200/90 hover:bg-amber-400/25 transition-colors">🏆 排位对战 · 胜则占位取代（计入排名）</button>
                ) : (
                  <div className="text-[11px] text-dim/50 text-center px-2 py-1.5 rounded-lg border border-dashed border-edge">排位对战仅可挑战排名比你高的对手</div>
                )}
                <button onClick={() => doDuelInvite(duelTarget, false)} className="w-full px-4 py-2 rounded-lg text-[13px] font-bold bg-god/15 border border-god/40 text-god hover:bg-god/25 transition-colors">🤝 友谊对战 · 不计分</button>
                <button onClick={() => setDuelTarget(null)} className="text-[12px] text-dim/60 hover:text-slate-200 transition-colors pt-0.5">取消</button>
              </div>
            </div>
          </div>
        )}

        {/* 点榜单角色 → 完整只读面板 */}
        {detail && (
          <NpcCardPreview
            data={detail.snapshot}
            mt
            onClose={() => setDetail(null)}
            previewActions={
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${rankNumColor(detail.rank)}`}>{TOP_TITLE[detail.rank] || '第 ' + detail.rank + ' 名'}</span>
                <OwnerTag c={detail} />
                <span className="text-[10px] font-mono text-dim/40">{detail.wins}胜{detail.losses}负</span>
                {detail.ownerId === myId ? (
                  <button onClick={() => { doDelete(detail.id); setDetail(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">🗑 删除我的卡</button>
                ) : (
                  <>
                    {myFighter && detail.rank < myFighter.rank && (
                      <button onClick={() => { doChallenge(detail); setDetail(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/90 hover:bg-blood/15 transition-colors">⚔ 挑战</button>
                    )}
                    <button onClick={() => { onSpar(detail); setDetail(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-god/40 text-god/80 hover:bg-god/15 transition-colors">🤺 切磋</button>
                  </>
                )}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
