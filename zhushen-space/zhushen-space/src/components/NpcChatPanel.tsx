import { useState, useEffect, useRef } from 'react';
import { useNpcChat } from '../store/npcChatStore';
import { sendNpcChat } from '../systems/npcChat';
import { generateJoinedTeam } from '../systems/adventureTeamGen';
import { useTeam } from '../store/adventureTeamStore';
import type { NpcRecord } from '../store/npcStore';

/* 与单个 NPC 的私聊：上=对话区(聊天气泡+输入) / 下=交互描述窗(第三人称旁白·可NSFW)。
   一次 API 同时产出对白+交互描述；缓存随存档(npcChatStore)，离开保留、再来续聊。 */
export default function NpcChatPanel({ npc, onClose }: { npc: NpcRecord; onClose: () => void }) {
  const turns = useNpcChat((s) => s.chats[npc.id]) ?? [];
  const resetChat = useNpcChat((s) => s.resetChat);
  const teamName = useTeam((s) => s.name);
  const teamEstablished = useTeam((s) => s.established);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dismissedOfferId, setDismissedOfferId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns.length, sending]);

  // 最近一条交互描述（当下场景）
  const lastScene = (() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'npc' && turns[i].scene) return turns[i].scene; return ''; })();

  // 加入冒险团信号：仅当【最后一条】是带 joinOffer 的 npc 回合、未被本次忽略、且尚未加入该团时弹窗
  const lastTurn = turns[turns.length - 1];
  const offerTeam = (lastTurn?.role === 'npc' && lastTurn.joinOffer && lastTurn.id !== dismissedOfferId
    && !(teamEstablished && teamName === lastTurn.joinOffer)) ? lastTurn.joinOffer : '';
  const showJoinPopup = !!offerTeam && !joining && joinResult === null;

  const confirmJoin = async () => {
    if (!offerTeam) return;
    setJoining(true);
    try {
      const r = await generateJoinedTeam(npc);
      setJoinResult(r.ok ? `✓ 已加入「${r.teamName || offerTeam}」——可在右侧导航「🛡 冒险团」查看全部信息。` : `⚠ 加入失败：${r.error || '生成出错'}`);
      if (lastTurn) setDismissedOfferId(lastTurn.id);
    } finally { setJoining(false); }
  };
  const declineJoin = () => { if (lastTurn) setDismissedOfferId(lastTurn.id); };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try { await sendNpcChat(npc, text); }
    finally { setSending(false); }
  };

  const genderEmoji = npc.gender === '女' ? '🙎‍♀️' : npc.gender === '男' ? '🧑' : '👤';

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[90dvh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">

        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-edge bg-panel">
          <div className="w-9 h-9 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
            {npc.avatar ? <img src={npc.avatar} alt={npc.name} className="w-full h-full object-cover" /> : <span className="text-lg">{genderEmoji}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{npc.name || npc.id}</div>
            <div className="text-[11px] font-mono text-dim/50 truncate">
              {npc.realm || npc.npcTag || '—'}
              {typeof npc.favor === 'number' && <span className={`ml-2 ${npc.favor >= 0 ? 'text-rose-300/70' : 'text-sky-300/70'}`}>❤好感 {npc.favor}</span>}
              {npc.affiliatedTeam && <span className="ml-2 text-amber-300/70">🛡{npc.affiliatedTeam}</span>}
            </div>
          </div>
          <button
            onClick={() => { if (confirmReset) { resetChat(npc.id); setConfirmReset(false); } else setConfirmReset(true); }}
            onMouseLeave={() => setConfirmReset(false)}
            title="清空与该 NPC 的聊天记录与交互状态"
            className={`text-[12px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${confirmReset ? 'border-blood bg-blood/15 text-blood' : 'border-edge text-dim/60 hover:text-blood hover:border-blood/40'}`}>
            {confirmReset ? '确认重置？' : '↺ 重置'}
          </button>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>

        {/* 上：对话区（聊天 + 输入）*/}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
            {turns.length === 0 && (
              <div className="text-center text-dim/35 text-[13px] py-8">
                与「{npc.name}」单独相处……开口说点什么吧。<br />
                <span className="text-[11px] font-mono text-dim/30">（每句对话都会同时生成下方的「交互描述」）</span>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={`flex ${t.role === 'player' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  t.role === 'player'
                    ? 'bg-god/20 border border-god/40 text-slate-100 rounded-br-sm'
                    : 'bg-panel border border-edge text-slate-200 rounded-bl-sm'}`}>
                  {t.text}
                </div>
              </div>
            ))}
            {sending && <div className="flex justify-start"><div className="px-3 py-2 rounded-2xl bg-panel border border-edge text-dim/50 text-[13px] font-mono">{npc.name}正在回应…</div></div>}
            <div ref={chatEndRef} />
          </div>
          <div className="shrink-0 border-t border-edge bg-panel2/40 p-2.5 flex items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`对${npc.name}说……（Enter 发送 / Shift+Enter 换行）`}
              className="flex-1 resize-none bg-void border border-edge rounded-xl px-3 py-2 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-god/50 max-h-28" />
            <button onClick={send} disabled={!input.trim() || sending}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${input.trim() && !sending ? 'bg-god/25 border border-god/50 text-god hover:bg-god/35' : 'bg-void border border-edge/40 text-dim/30 cursor-not-allowed'}`}>
              {sending ? '…' : '发送'}
            </button>
          </div>
        </div>

        {/* 下：交互描述窗 */}
        <div className="shrink-0 h-[34%] border-t border-god/20 bg-panel2/30 flex flex-col min-h-0">
          <div className="shrink-0 px-3 py-1.5 text-[11px] font-mono text-god/55 border-b border-edge/40 flex items-center gap-2">
            🎬 此刻交互描述<span className="text-dim/30">（旁白 · 随每轮对话生成）</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {lastScene
              ? <div className="text-[13px] text-slate-300/90 leading-relaxed whitespace-pre-wrap">{lastScene}</div>
              : <div className="text-[12px] text-dim/30 italic">开始对话后，这里会浮现她与你此刻的交互画面……</div>}
          </div>
        </div>
      </div>

      {/* 加入冒险团·确认弹窗 */}
      {showJoinPopup && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-void shadow-[0_0_50px_rgba(0,0,0,0.9)] p-5 space-y-3">
            <div className="text-base font-bold text-amber-200 flex items-center gap-2">🛡 加入冒险团</div>
            <div className="text-[13px] text-slate-200 leading-relaxed">
              <b className="text-slate-100">{npc.name || npc.id}</b> 同意引荐你加入冒险团
              <b className="text-amber-300">「{offerTeam}」</b>。是否加入？
            </div>
            <div className="text-[12px] text-dim/60 leading-relaxed">
              加入后将由「冒险团」API 生成这支冒险团的全部信息（你为普通成员、非团长）。
              {teamEstablished && teamName && teamName !== offerTeam && (
                <span className="block mt-1 text-amber-400/80">⚠ 你当前已属于冒险团【{teamName}】，加入新团将<b>替换</b>它。</span>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={confirmJoin}
                className="flex-1 px-3 py-2 rounded-xl text-sm font-bold border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors">
                加入
              </button>
              <button onClick={declineJoin}
                className="px-4 py-2 rounded-xl text-sm border border-edge text-dim/70 hover:text-slate-200 transition-colors">
                暂不
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 生成中遮罩 */}
      {joining && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-2xl border border-amber-500/40 bg-void px-6 py-4 text-amber-200 text-sm font-mono animate-pulse">
            🛡 正在组建冒险团信息…
          </div>
        </div>
      )}

      {/* 加入结果提示 */}
      {joinResult !== null && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.9)] p-5 space-y-3">
            <div className="text-[13px] text-slate-200 leading-relaxed">{joinResult}</div>
            <button onClick={() => setJoinResult(null)}
              className="w-full px-3 py-2 rounded-xl text-sm font-bold border border-god/50 bg-god/10 text-god hover:bg-god/20 transition-colors">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
