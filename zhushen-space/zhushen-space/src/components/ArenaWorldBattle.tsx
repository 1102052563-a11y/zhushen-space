import { useEffect, useRef, useState } from 'react';
import type { Gladiator } from '../systems/casinoEngine';

// 世界竞技场·自动对战回放：AI 据两名参赛者【完整档案】输出一整段散文战报 → `splitScenes` 拆成"战斗场景"，
// 这里逐段揭示（每段 ~2.5 秒淡入，可跳过）。胜负由服务端裁判钉死，前端只演绎。

const SIDE_COLOR = ['text-sky-300 border-sky-500/40', 'text-rose-300 border-rose-500/40'];

export interface ArenaBattlePayload {
  fighters: [Gladiator, Gladiator];
  winner: 0 | 1;
  scenes: string[];        // 拆好的战斗场景（逐段揭示）
  summary: string;
  challengerSide: 0 | 1;
  rankBefore: number;
  rankAfter: number;
}

export default function ArenaWorldBattle({ data, busy, onClose }: {
  data: ArenaBattlePayload | null;
  busy: boolean;
  onClose: () => void;
}) {
  const scenes = data?.scenes ?? [];
  const [shown, setShown] = useState(0);        // 已揭示到第几个场景（0..scenes.length）
  const logRef = useRef<HTMLDivElement>(null);
  const finished = shown >= scenes.length && scenes.length > 0;

  useEffect(() => { setShown(0); }, [data?.scenes]);
  useEffect(() => {
    if (!data || finished) return;
    const t = setTimeout(() => setShown((s) => s + 1), 2400 + Math.random() * 900);
    return () => clearTimeout(t);
  }, [shown, data, finished]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [shown]);

  if (busy && !data) {
    return <div className="py-12 text-center text-amber-200/80 text-sm animate-pulse">⚔ 双方入场，激战推演中…</div>;
  }
  if (!data) return null;

  const fighters = data.fighters;
  const winner = data.winner;
  const iWon = finished && winner === data.challengerSide;

  return (
    <div className="space-y-3">
      {/* 双方 */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((i) => {
          const g = fighters[i];
          const isMe = i === data.challengerSide;
          const isWinner = finished && winner === i;
          const dead = finished && winner === (i === 0 ? 1 : 0);
          return (
            <div key={i} className={`rounded-xl border p-2.5 ${isWinner ? 'border-amber-400/70 bg-amber-400/5' : dead ? 'border-blood/40 bg-blood/5 opacity-70' : SIDE_COLOR[i]}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-bold text-slate-100 truncate">{g.name}{isWinner && ' 👑'}{dead && ' 💀'}</span>
                <span className="text-[11px] font-mono text-dim/50">{isMe ? '我方' : '对手'}</span>
              </div>
              <div className="text-[12px] font-mono text-dim/50 truncate">{g.race}·{g.tier} · {g.profession}</div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {g.skills.slice(0, 6).map((s, k) => (
                  <span key={k} title={s.effect} className="px-1 py-0.5 rounded text-[11px] font-mono border border-edge/60 bg-void text-slate-300/70 truncate max-w-[110px]">{s.name}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 战斗场景（逐段揭示）*/}
      <div ref={logRef} className="rounded-xl border border-edge bg-panel2/20 p-3.5 h-64 overflow-y-auto space-y-3 text-[14px] leading-loose text-slate-200/90">
        {shown === 0 && !finished && <div className="text-dim/50 text-center animate-pulse">裁判举旗，对决开始…</div>}
        {scenes.slice(0, shown).map((sc, i) => (
          <p key={i} className={`${i === shown - 1 ? 'opacity-100' : 'opacity-70'} transition-opacity duration-500 whitespace-pre-wrap`}>{sc}</p>
        ))}
      </div>

      {/* 结算 */}
      {finished && (
        <div className={`rounded-xl border p-3 text-center space-y-1.5 ${iWon ? 'border-amber-400/60 bg-amber-400/10' : 'border-edge bg-panel2/20'}`}>
          <div className="text-base font-bold text-slate-100">{fighters[winner].name} 获胜 👑</div>
          {data.summary && <div className="text-[13px] text-slate-300/90">{data.summary}</div>}
          <div className="text-[13px] font-mono text-god/90">
            {iWon
              ? (data.rankAfter < data.rankBefore ? `占位成功：排名 ${data.rankBefore} → ${data.rankAfter} 名` : `胜！当前第 ${data.rankAfter} 名`)
              : (data.rankAfter > data.rankBefore ? `惜败，排名下降：${data.rankBefore} → ${data.rankAfter} 名` : `惜败，排名不变（第 ${data.rankBefore} 名）`)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {!finished
          ? <button onClick={() => setShown(scenes.length)} className="px-2.5 py-1 rounded text-[12px] font-mono border border-edge text-dim/60 hover:text-god transition-colors">⏭ 跳过</button>
          : <span />}
        <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">{finished ? '返回榜单' : '离场'}</button>
      </div>
    </div>
  );
}
