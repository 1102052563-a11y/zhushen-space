import { useEffect, useRef, useState } from 'react';
import type { Gladiator, BattleRound } from '../systems/casinoEngine';

// 世界竞技场·战斗回放：逐回合动画揭示（HP 条平滑 / buff 标签 / 技能 CD / 物品消耗 / 双方 OS），
// 复用赌场角斗场的过场观感，但去掉下注/筹码——胜负已由服务端裁判钉死，这里只演绎。
// 战报（rounds/summary）由 App.genArenaWorldBattle 走赌场同款 AI 管线（含战斗写作指导世界书）生成。

const SIDE_COLOR = ['text-sky-300 border-sky-500/40', 'text-rose-300 border-rose-500/40'];
const SIDE_HP = ['bg-sky-400', 'bg-rose-400'];
const SKILL_CD = 3;

export interface ArenaBattlePayload {
  fighters: [Gladiator, Gladiator];
  winner: 0 | 1;
  rounds: BattleRound[];
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
  const rounds = data?.rounds ?? [];
  const [step, setStep] = useState(-1);       // -1=开场前；rounds.length=已播完
  const [speed, setSpeed] = useState(1);
  const logRef = useRef<HTMLDivElement>(null);

  const finished = step >= rounds.length && rounds.length > 0;

  useEffect(() => { setStep(-1); }, [data?.rounds]);

  useEffect(() => {
    if (!data || finished) return;
    const delay = step < 0 ? 800 : (6500 + Math.random() * 1200) / speed;
    const t = setTimeout(() => setStep((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [step, speed, data, finished]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [step]);

  if (busy && !data) {
    return (
      <div className="py-12 text-center text-amber-200/80 text-sm animate-pulse">⚔ 双方入场，激战推演中…</div>
    );
  }
  if (!data) return null;

  const fighters = data.fighters;
  const shown = Math.max(-1, Math.min(step, rounds.length - 1));
  const cur = shown >= 0 ? rounds[shown] : null;
  const hp: [number, number] = cur ? cur.hp : [fighters[0].hpMax, fighters[1].hpMax];
  const buffs: [string[], string[]] = cur ? cur.buffs : [[], []];
  const winner = data.winner;
  const curRound = cur ? cur.round : 0;
  const played = rounds.slice(0, Math.max(0, shown + 1));
  const iWon = finished && winner === data.challengerSide;

  const usage = ([0, 1] as const).map((side) => {
    const g = fighters[side];
    const skillLastUsed: Record<string, number> = {};
    const itemsUsed = new Set<string>();
    for (const r of played) {
      if (r.actor !== side) continue;
      for (const s of g.skills) if (s.name && (r.action === s.name || r.desc.includes(s.name))) skillLastUsed[s.name] = r.round;
      for (const it of g.items) if (it.name && r.desc.includes(it.name)) itemsUsed.add(it.name);
    }
    return { skillLastUsed, itemsUsed };
  });

  return (
    <div className="space-y-3">
      {/* 双方战况 */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((i) => {
          const g = fighters[i];
          const pct = Math.max(0, Math.min(100, (hp[i] / g.hpMax) * 100));
          const dead = finished && winner === (i === 0 ? 1 : 0);
          const isWinner = finished && winner === i;
          const isMe = i === data.challengerSide;
          return (
            <div key={i} className={`rounded-xl border p-2.5 ${isWinner ? 'border-amber-400/70 bg-amber-400/5' : dead ? 'border-blood/40 bg-blood/5 opacity-60' : SIDE_COLOR[i]}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-bold text-slate-100 truncate">{g.name}{isWinner && ' 👑'}{dead && ' 💀'}</span>
                <span className="text-[11px] font-mono text-dim/50">{isMe ? '我方' : '对手'}</span>
              </div>
              <div className="text-[12px] font-mono text-dim/50 truncate mb-1">{g.race}·{g.tier} · {g.profession}</div>
              <div className="h-2.5 rounded-full bg-void overflow-hidden">
                <div className={`h-full ${SIDE_HP[i]} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[12px] font-mono text-slate-300 text-right mt-0.5">{Math.max(0, Math.round(hp[i]))}/{g.hpMax}</div>
              <div className="flex flex-wrap gap-1 mt-1 min-h-[16px]">
                {buffs[i].map((bf, k) => (
                  <span key={k} className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-void border border-edge text-amber-200/80">{bf}</span>
                ))}
              </div>
              {/* 技能栏：用后亮一下→进 CD 倒数 */}
              <div className="mt-1.5">
                <div className="text-[12px] font-mono text-dim/40 mb-0.5">技能</div>
                <div className="flex flex-wrap gap-0.5">
                  {g.skills.map((s, k) => {
                    const lu = usage[i].skillLastUsed[s.name];
                    const since = lu != null ? curRound - lu : 99;
                    const just = lu != null && lu === curRound;
                    const onCd = lu != null && since > 0 && since < SKILL_CD;
                    return (
                      <span key={k} title={s.effect}
                        className={`px-1 py-0.5 rounded text-[12px] font-mono border truncate max-w-[110px] ${just ? 'border-amber-300 bg-amber-400/25 text-amber-200 font-bold' : onCd ? 'border-edge bg-void text-dim/40' : 'border-edge/60 bg-void text-slate-300/80'}`}>
                        {s.name}{just ? ' ✦' : onCd ? ` ⏳${SKILL_CD - since}` : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
              {/* 储存空间：被用到即标记消耗 */}
              {g.items.length > 0 && (
                <div className="mt-1">
                  <div className="text-[12px] font-mono text-dim/40 mb-0.5">🎒 储存空间</div>
                  <div className="flex flex-wrap gap-0.5">
                    {g.items.map((it, k) => {
                      const used = usage[i].itemsUsed.has(it.name);
                      const justItem = !!cur && cur.actor === i && !!it.name && cur.desc.includes(it.name);
                      return (
                        <span key={k} title={it.effect}
                          className={`px-1 py-0.5 rounded text-[12px] font-mono border truncate max-w-[110px] ${justItem ? 'border-emerald-300 bg-emerald-400/25 text-emerald-200 font-bold' : used ? 'border-edge bg-void text-dim/40 line-through' : 'border-edge/60 bg-void text-slate-300/80'}`}>
                          {it.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 回合战报 */}
      <div ref={logRef} className="rounded-xl border border-edge bg-panel2/20 p-3 h-44 overflow-y-auto space-y-2 text-[14px] leading-relaxed">
        {step < 0 && <div className="text-dim/50 text-center animate-pulse">裁判举旗，对决开始…</div>}
        {rounds.slice(0, Math.max(0, step + 1)).map((r, i) => (
          <div key={i} className={`${i === shown ? 'opacity-100' : 'opacity-55'} transition-opacity`}>
            <div>
              <span className="font-mono text-[12px] text-dim/50">R{r.round} · {fighters[r.actor].name}</span>
              <span className="text-amber-200/90 font-bold"> 【{r.action}】</span>
              <span className="text-slate-300/90"> {r.desc}</span>
            </div>
            {(r.os?.[0] || r.os?.[1]) && (
              <div className="mt-0.5 pl-2 text-[12px] text-dim/60 space-y-0.5">
                {r.os?.[0] && <div>💭① {r.os[0]}</div>}
                {r.os?.[1] && <div>💭② {r.os[1]}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 结算 */}
      {finished && (
        <div className={`rounded-xl border p-3 text-center space-y-1.5 ${iWon ? 'border-amber-400/60 bg-amber-400/10' : 'border-edge bg-panel2/20'}`}>
          <div className="text-base font-bold text-slate-100">{fighters[winner].name} 获胜 👑</div>
          {data.summary && <div className="text-[13px] text-slate-300/90 leading-relaxed">{data.summary}</div>}
          <div className="text-[13px] font-mono text-god/90">
            {iWon
              ? `占位成功：你的排名 ${data.rankBefore} → ${data.rankAfter} 名`
              : `惜败，排名不变（第 ${data.rankBefore} 名）`}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {!finished && ([1, 2, 4] as const).map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-1 rounded text-[12px] font-mono border transition-colors ${speed === s ? 'border-god/50 bg-god/15 text-god' : 'border-edge text-dim/60 hover:text-god'}`}>{s}×</button>
          ))}
          {!finished && <button onClick={() => setStep(rounds.length)} className="px-2 py-1 rounded text-[12px] font-mono border border-edge text-dim/60 hover:text-god transition-colors">⏭ 跳过</button>}
        </div>
        <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">{finished ? '返回榜单' : '离场'}</button>
      </div>
    </div>
  );
}
