import { useState, useEffect, useRef } from 'react';
import { useCasino } from '../store/casinoStore';
import { useCosmos } from '../store/cosmosStore';
import {
  rollGladiatorWinner, settleGladiatorBet,
  type Gladiator, type GladiatorMatch, type BattleRound,
} from '../systems/casinoEngine';

/* 角斗场 / 灵魂决斗场：一次 API 生成两名同阶位角斗士(+专家评估)，赔率前端算；下注 → 据预定胜者生成数据化分回合战斗 →
   前端动画逐回合回放(HP/buff/技能CD/物品消耗)，再结算。组件自管下注额与门控。设计见记忆 casino-feature。
   角斗场: kind=厅币, tier 1~4；灵魂决斗场: kind=soul, tier 5~7, vipOnly, 最低注 10。 */
export default function CasinoGladiator({
  kind, tierLo, tierHi, minBet, maxBet, vipOnly, vipUnlocked, onGenMatch, onGenBattle, onGenPortraits,
}: {
  kind: 'normal' | 'soul';
  tierLo: number;
  tierHi: number;
  minBet: number;
  maxBet: number;
  vipOnly?: boolean;
  vipUnlocked?: boolean;
  onGenMatch: (kind: 'normal' | 'soul', races?: [string, string], tierLo?: number, tierHi?: number) => Promise<GladiatorMatch | null>;
  onGenBattle: (m: GladiatorMatch, winner: 0 | 1) => Promise<{ rounds: BattleRound[]; summary: string }>;
  onGenPortraits: (m: GladiatorMatch) => Promise<void>;
}) {
  const match = useCasino((s) => s.gladiator);
  const chips = useCasino((s) => s.chips);
  const soulChips = useCasino((s) => s.soulChips);
  const entities = useCosmos((s) => s.entities);
  const racePool = entities.filter((e) => e.category === '种族' && !e.destroyed).map((e) => e.name).filter(Boolean);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<0 | 1 | null>(null);
  const [raceA, setRaceA] = useState('');
  const [raceB, setRaceB] = useState('');
  const [bet, setBet] = useState(minBet);

  const isHome = true;   // 区域限制已取消：角斗场在任何世界均可对赌
  const balance = kind === 'soul' ? soulChips : chips;
  const chipName = kind === 'soul' ? '魂筹' : '筹码';
  const amount = Math.max(minBet, Math.min(bet, maxBet));
  const canBet = isHome && (!vipOnly || !!vipUnlocked) && balance >= amount && amount >= minBet;

  // 挂载：清掉「已下注但中断、无结果」的残局（未结算 → 退注重来，不扣筹码）
  useEffect(() => {
    const m = useCasino.getState().gladiator;
    if (m && m.status === 'fighting' && !m.result) useCasino.getState().clearGladiator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const races: [string, string] | undefined = (raceA.trim() || raceB.trim()) ? [raceA.trim(), raceB.trim()] : undefined;
      const m = await onGenMatch(kind, races, tierLo, tierHi);
      if (m) { useCasino.getState().setGladiatorMatch(m); onGenPortraits(m).catch(() => {}); }   // 立绘异步补入，不阻塞卡片
      else setErr('对战生成失败，请重试');
    } catch { setErr('对战生成失败，请重试'); }
    finally { setBusy(false); }
  }

  async function startFight(side: 0 | 1) {
    if (busy || !match || !canBet) return;
    setBusy(true); setErr('');
    const C = useCasino.getState();
    C.setGladiatorBet(side, amount);                         // 锁注（不预扣，结算时按净额走 recordResult）
    const winner = rollGladiatorWinner(match.winProb[0]);    // 前端预先掷定胜者 → AI 据此叙述
    try {
      const { rounds, summary } = await onGenBattle(match, winner);
      if (useCasino.getState().gladiator?.id !== match.id) return;   // 期间被放弃/重置 → 不结算
      C.setGladiatorResult(winner, rounds, summary);
      const { win, profit } = settleGladiatorBet(side, amount, winner, match.odds);
      C.recordResult('gladiator', kind, profit, amount, `角斗 押${side === 0 ? '①' : '②'}${match.fighters[side].name} · ${win ? '赢' : '输'}`);
    } catch { setErr('战斗生成失败，注金已退回'); C.clearGladiator(); }
    finally { setBusy(false); }
  }

  // ── 贵宾门控（灵魂决斗场仅五阶贵宾厅）──
  if (vipOnly && !vipUnlocked) {
    return <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4 text-center text-[14px] text-fuchsia-300/80">⚜ 灵魂决斗场只对<b>魂币贵宾厅</b>开放——晋升<b>五阶</b>方可入场，观赌 5~7 阶强者的生死对决。</div>;
  }

  // ── 战斗中/已出结果：回放窗 ──
  if (match && (match.status === 'fighting' || match.status === 'done') && (match.result || busy)) {
    return <GladiatorBattle match={match} busy={busy} onLeave={() => useCasino.getState().clearGladiator()} />;
  }

  // ── 未生成对战 ──
  if (!match) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-dim/60 leading-relaxed">
          两名角斗士登台厮杀，你押注谁能活到最后。系统据双方<span className="text-amber-300">战力差</span>实算赔率，可先看双方档案与<span className="text-god">专家战略评估</span>再下注。下注后开战，逐回合观战见真章。
        </p>
        {/* 自定义对战种族（留空=系统随机） */}
        <div className="rounded-xl border border-edge bg-panel2/30 p-2.5 space-y-2">
          <div className="text-[13px] font-mono text-dim/50">指定种族（可选，留空=随机匹配）</div>
          <div className="flex items-center gap-2">
            <input list="glad-races" value={raceA} onChange={(e) => setRaceA(e.target.value)} placeholder="① 一号位种族"
              className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-void border border-sky-500/40 text-sky-200 text-[14px] placeholder:text-dim/40" />
            <span className="text-[13px] font-black text-blood/60">VS</span>
            <input list="glad-races" value={raceB} onChange={(e) => setRaceB(e.target.value)} placeholder="② 二号位种族"
              className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-void border border-rose-500/40 text-rose-200 text-[14px] placeholder:text-dim/40" />
            {(raceA || raceB) && <button onClick={() => { setRaceA(''); setRaceB(''); }} className="text-dim/50 hover:text-blood text-xs shrink-0">清空</button>}
          </div>
          <datalist id="glad-races">{racePool.map((r) => <option key={r} value={r} />)}</datalist>
          {racePool.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {racePool.slice(0, 10).map((r) => (
                <button key={r} onClick={() => { if (!raceA.trim()) setRaceA(r); else if (!raceB.trim()) setRaceB(r); }}
                  className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-void border border-edge text-dim hover:text-amber-200">{r}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={generate} disabled={busy}
          className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-40 hover:bg-amber-500/25">
          {busy ? '⏳ 安排对战中…' : '⚔ 安排一场对战'}
        </button>
        {err && <div className="text-center text-[14px] text-blood/80">{err}</div>}
      </div>
    );
  }

  // ── 对战就绪：下注额 + 双方卡 ──
  const [a, b] = match.fighters;
  return (
    <div className="space-y-3">
      {/* 下注额（本场用 {chipName}） */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-mono text-dim/60">下注</span>
        <input type="number" value={bet} min={minBet} max={maxBet} onChange={(e) => setBet(Math.max(0, +e.target.value || 0))}
          className="w-24 px-2 py-1 rounded-lg bg-void border border-edge text-amber-200 text-[15px] font-mono text-right" />
        {[10, 50, 100, 500].map((d) => (
          <button key={d} onClick={() => setBet((x) => Math.min(maxBet, x + d))} className="px-2 py-1 rounded-lg border border-edge text-dim text-[12px] hover:text-amber-200">+{d}</button>
        ))}
        <button onClick={() => setBet(Math.min(maxBet, balance))} className="px-2 py-1 rounded-lg border border-edge text-dim text-[12px] hover:text-amber-200">全押</button>
        <span className="text-[12px] font-mono text-dim/40">限红 {minBet}~{maxBet} · 持有{chipName} {balance.toLocaleString()}</span>
      </div>
      <div className="flex items-stretch gap-2">
        <FighterCard g={a} odds={match.odds[0]} side={0} onDetail={() => setDetail(0)} onBet={() => startFight(0)} canBet={canBet && !busy} amount={amount} />
        <div className="flex flex-col items-center justify-center px-1 shrink-0">
          <span className="text-lg font-black text-blood/70">VS</span>
        </div>
        <FighterCard g={b} odds={match.odds[1]} side={1} onDetail={() => setDetail(1)} onBet={() => startFight(1)} canBet={canBet && !busy} amount={amount} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => useCasino.getState().clearGladiator()} disabled={busy} className="flex-1 py-2 rounded-lg border border-edge text-dim text-[14px] hover:text-slate-100 disabled:opacity-40">
          ↻ 重选（回到选种族）
        </button>
      </div>
      {!canBet && <div className="text-center text-[13px] text-blood/70">余额不足或非营业，无法下注</div>}
      {err && <div className="text-center text-[14px] text-blood/80">{err}</div>}
      {detail !== null && <FighterDetail g={match.fighters[detail]} ev={match.evals[detail]} odds={match.odds[detail]} side={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const SIDE_COLOR = ['text-sky-300 border-sky-500/40', 'text-rose-300 border-rose-500/40'];
const SIDE_HP = ['bg-sky-400', 'bg-rose-400'];

function FighterCard({ g, odds, side, onDetail, onBet, canBet, amount }: {
  g: Gladiator; odds: number; side: 0 | 1; onDetail: () => void; onBet: () => void; canBet: boolean; amount: number;
}) {
  return (
    <div className={`relative flex-1 min-w-0 rounded-xl border bg-panel2/30 p-2.5 flex flex-col gap-1.5 ${SIDE_COLOR[side]}`}>
      {g.portrait && <img src={g.portrait} alt={g.name} className="absolute top-1.5 right-1.5 w-12 h-12 rounded-lg object-cover border border-edge/70 shadow" />}
      <button onClick={onDetail} className={`text-left min-w-0 ${g.portrait ? 'pr-14' : ''}`}>
        <div className="text-[12px] font-mono opacity-60">{side === 0 ? '① 一号位' : '② 二号位'}</div>
        <div className="text-sm font-bold text-slate-100 truncate">{g.name}{g.rareProfession && <span className="ml-1 text-[11px] text-amber-300">稀有</span>}</div>
        <div className="text-[13px] font-mono text-dim/60 truncate">{g.gender} · {g.race} · {g.tier}·Lv.{g.level}</div>
        <div className="text-[13px] font-mono text-fuchsia-300/70 truncate">{g.profession} · {g.bioStrength}</div>
        <div className="text-[13px] text-amber-200/80 truncate mt-0.5">⚔ {g.style}</div>
        <div className="text-[12px] text-god/70 mt-1 underline decoration-dotted">📋 查看档案 / 专家评估</div>
      </button>
      <div className="mt-auto">
        <div className="text-center text-[13px] font-mono text-dim/50">赔率</div>
        <div className="text-center text-xl font-black text-amber-300 leading-none mb-1">{odds.toFixed(2)}×</div>
        <button onClick={onBet} disabled={!canBet}
          className="w-full py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/50 text-amber-200 text-[14px] font-bold disabled:opacity-30 hover:bg-amber-500/25">
          押 {amount} · 开战
        </button>
      </div>
    </div>
  );
}

function AttrBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] font-mono text-dim/60 w-5">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-void overflow-hidden"><div className="h-full bg-god/60" style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="text-[12px] font-mono text-slate-300 w-6 text-right">{v}</span>
    </div>
  );
}

function FighterDetail({ g, ev, odds, side, onClose }: {
  g: Gladiator; ev: { strengths: string; weaknesses: string; comment: string; verdict: string }; odds: number; side: 0 | 1; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-edge bg-void p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className={`text-[13px] font-mono ${SIDE_COLOR[side].split(' ')[0]}`}>{side === 0 ? '① 一号位' : '② 二号位'} · 赔率 {odds.toFixed(2)}×</div>
            <div className="text-base font-bold text-slate-100">{g.name}{g.rareProfession && <span className="ml-1.5 px-1 py-0.5 rounded text-[11px] bg-amber-400/20 text-amber-300 align-middle">稀有职业</span>}</div>
            <div className="text-[14px] font-mono text-dim/60">{g.gender} · {g.race} · {g.tier}·Lv.{g.level}</div>
            <div className="text-[13px] font-mono text-fuchsia-300/80">{g.profession} · 生物强度 {g.bioStrength}</div>
          </div>
          {g.portrait && <img src={g.portrait} alt={g.name} className="w-16 h-16 rounded-lg object-cover border border-edge/70 shrink-0" />}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg shrink-0">✕</button>
        </div>
        <div className="text-[14px] text-amber-200/90">⚔ 战斗风格：{g.style}</div>
        {g.appearance && <div className="text-[14px] text-dim/70 leading-relaxed">{g.appearance}</div>}

        <div className="rounded-xl border border-edge bg-panel2/30 p-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
          <AttrBar label="力" v={g.attrs.str} /><AttrBar label="敏" v={g.attrs.agi} />
          <AttrBar label="体" v={g.attrs.con} /><AttrBar label="智" v={g.attrs.int} />
          <AttrBar label="魅" v={g.attrs.cha} /><AttrBar label="运" v={g.attrs.luck} />
          <div className="col-span-2 text-[12px] font-mono text-dim/40 text-right">血量上限 {g.hpMax}</div>
        </div>

        {g.skills.length > 0 && (
          <div className="space-y-1">
            <div className="text-[13px] font-mono text-dim/50">技能 · {g.skills.length}</div>
            {g.skills.map((s, i) => (
              <div key={i} className="text-[14px]"><span className="text-god font-bold">{s.name}</span>{s.effect && <span className="text-dim/70"> · {s.effect}</span>}</div>
            ))}
          </div>
        )}

        {(g.talents ?? []).length > 0 && (
          <div className="space-y-1">
            <div className="text-[13px] font-mono text-dim/50">✦ 天赋 · {g.talents.length}</div>
            {g.talents.map((t, i) => (
              <div key={i} className="text-[14px]"><span className="text-fuchsia-300 font-bold">{t.name}</span>{t.effect && <span className="text-dim/70"> · {t.effect}</span>}</div>
            ))}
          </div>
        )}

        {g.items.length > 0 && (
          <div className="space-y-1">
            <div className="text-[13px] font-mono text-dim/50">🎒 储存空间 · {g.items.length}</div>
            {g.items.map((it, i) => (
              <div key={i} className="text-[14px]"><span className="text-amber-200 font-bold">{it.name}</span>{it.effect && <span className="text-dim/70"> · {it.effect}</span>}</div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-god/30 bg-god/5 p-3 space-y-1.5">
          <div className="text-[13px] font-mono text-god/70">🎓 专家战略评估</div>
          <div className="text-[14px]"><span className="text-emerald-300 font-bold">优点</span> · {ev.strengths}</div>
          <div className="text-[14px]"><span className="text-blood/80 font-bold">弱点</span> · {ev.weaknesses}</div>
          <div className="text-[14px] text-slate-300/90 italic">“{ev.comment}”</div>
          <div className="text-[14px] pt-1.5 border-t border-god/20"><span className="text-amber-300 font-bold">🔥 锐评</span> · <span className="text-slate-200">{ev.verdict}</span></div>
        </div>
      </div>
    </div>
  );
}

/* ─────────── 战斗动画回放 ─────────── */
function GladiatorBattle({ match, busy, onLeave }: { match: GladiatorMatch; busy: boolean; onLeave: () => void }) {
  const result = match.result;
  const rounds = result?.rounds ?? [];
  const chips = useCasino((s) => s.chips);
  const soulChips = useCasino((s) => s.soulChips);
  const [step, setStep] = useState(-1);        // 已展示到第几回合（-1=开场前；rounds.length=已播完）
  const [speed, setSpeed] = useState(1);
  const logRef = useRef<HTMLDivElement>(null);

  const finished = step >= rounds.length && rounds.length > 0;

  // 逐回合自动推进（"显示缓慢"：每回合 4~6 秒、可加速）
  useEffect(() => {
    if (!result || finished) return;
    const delay = step < 0 ? 800 : (7000 + Math.random() * 1000) / speed;
    const t = setTimeout(() => setStep((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [step, speed, result, finished]);

  // 日志自动滚到底
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [step]);

  // 当前 HP / buff：取已展示到的最后一回合的快照（未开始则满血）
  const shown = Math.max(-1, Math.min(step, rounds.length - 1));
  const cur = shown >= 0 ? rounds[shown] : null;
  const hp: [number, number] = cur ? cur.hp : [match.fighters[0].hpMax, match.fighters[1].hpMax];
  const buffs: [string[], string[]] = cur ? cur.buffs : [[], []];

  if (busy && !result) {
    return <div className="py-10 text-center text-amber-200/80 text-sm animate-pulse">⚔ 角斗士入场，激战推演中…</div>;
  }

  const winner = result?.winner;
  const bet = match.bet;
  const settled = bet && winner != null ? settleGladiatorBet(bet.side, bet.amount, winner, match.odds) : null;
  const chipName = match.kind === 'soul' ? '魂筹' : '筹码';
  const balAfter = match.kind === 'soul' ? soulChips : chips;
  const dmgDealt: [number, number] = [0, 0];
  for (const r of rounds) dmgDealt[r.actor] += r.damage;

  // 据已播回合推算双方「技能 CD / 物品消耗」——技能被点名→进CD(SKILL_CD回合)，物品被点名→标记已用
  const SKILL_CD = 3;
  const curRound = cur ? cur.round : 0;
  const played = rounds.slice(0, Math.max(0, shown + 1));
  const usage = ([0, 1] as const).map((side) => {
    const g = match.fighters[side];
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
          const g = match.fighters[i];
          const pct = Math.max(0, Math.min(100, (hp[i] / g.hpMax) * 100));
          const dead = finished && winner === (i === 0 ? 1 : 0);
          const isWinner = finished && winner === i;
          return (
            <div key={i} className={`rounded-xl border p-2.5 ${isWinner ? 'border-amber-400/70 bg-amber-400/5' : dead ? 'border-blood/40 bg-blood/5 opacity-60' : SIDE_COLOR[i]}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-bold text-slate-100 truncate">{g.name}{isWinner && ' 👑'}{dead && ' 💀'}</span>
                <span className="text-[12px] font-mono text-dim/50">{g.tier}</span>
              </div>
              <div className="text-[12px] font-mono text-dim/50 truncate mb-1">{g.race}·Lv.{g.level} · {g.profession} · {g.bioStrength}</div>
              <div className="h-2.5 rounded-full bg-void overflow-hidden">
                <div className={`h-full ${SIDE_HP[i]} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[12px] font-mono text-slate-300 text-right mt-0.5">{Math.max(0, Math.round(hp[i]))}/{g.hpMax}</div>
              <div className="flex flex-wrap gap-1 mt-1 min-h-[16px]">
                {buffs[i].map((bf, k) => (
                  <span key={k} className="px-1.5 py-0.5 rounded text-[13px] font-mono bg-void border border-edge text-amber-200/80">{bf}</span>
                ))}
              </div>

              {/* 技能栏：用后亮一下→进 CD 倒数 */}
              <div className="mt-1.5">
                <div className="text-[13px] font-mono text-dim/40 mb-0.5">技能</div>
                <div className="flex flex-wrap gap-0.5">
                  {g.skills.map((s, k) => {
                    const lu = usage[i].skillLastUsed[s.name];
                    const since = lu != null ? curRound - lu : 99;
                    const just = lu != null && lu === curRound;
                    const onCd = lu != null && since > 0 && since < SKILL_CD;
                    return (
                      <span key={k} title={s.effect}
                        className={`px-1 py-0.5 rounded text-[13px] font-mono border truncate max-w-[110px] ${just ? 'border-amber-300 bg-amber-400/25 text-amber-200 font-bold' : onCd ? 'border-edge bg-void text-dim/40' : 'border-edge/60 bg-void text-slate-300/80'}`}>
                        {s.name}{just ? ' ✦' : onCd ? ` ⏳${SKILL_CD - since}` : ''}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* 储存空间：被用到即标记消耗 */}
              <div className="mt-1">
                <div className="text-[13px] font-mono text-dim/40 mb-0.5">🎒 储存空间</div>
                <div className="flex flex-wrap gap-0.5">
                  {g.items.map((it, k) => {
                    const used = usage[i].itemsUsed.has(it.name);
                    const justItem = !!cur && cur.actor === i && !!it.name && cur.desc.includes(it.name);
                    return (
                      <span key={k} title={it.effect}
                        className={`px-1 py-0.5 rounded text-[13px] font-mono border truncate max-w-[110px] ${justItem ? 'border-emerald-300 bg-emerald-400/25 text-emerald-200 font-bold' : used ? 'border-edge bg-void text-dim/40 line-through' : 'border-edge/60 bg-void text-slate-300/80'}`}>
                        {it.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 回合战报 */}
      <div ref={logRef} className="rounded-xl border border-edge bg-panel2/20 p-3 h-44 overflow-y-auto space-y-2 text-[14px] leading-relaxed">
        {step < 0 && <div className="text-dim/50 text-center animate-pulse">裁判举旗，对决开始…</div>}
        {rounds.slice(0, Math.max(0, step + 1)).map((r, i) => (
          <div key={i} className={`${i === shown ? 'opacity-100' : 'opacity-55'} transition-opacity`}>
            <span className="font-mono text-[12px] text-dim/50">R{r.round} · {match.fighters[r.actor].name}</span>
            <span className="text-amber-200/90 font-bold"> 【{r.action}】</span>
            <span className="text-slate-300/90"> {r.desc}</span>
            {r.damage > 0 && <span className="font-mono text-blood/80"> −{r.damage}</span>}
            {r.os && (r.os[0] || r.os[1]) && (
              <div className="mt-1 pl-2 border-l-2 border-edge/50 space-y-0.5">
                {r.os[0] && <div className="text-[12.5px] italic text-sky-300/75">💭 {match.fighters[0].name}：{r.os[0]}</div>}
                {r.os[1] && <div className="text-[12.5px] italic text-rose-300/75">💭 {match.fighters[1].name}：{r.os[1]}</div>}
              </div>
            )}
          </div>
        ))}
        {finished && result?.summary && <div className="text-god/90 font-bold pt-1 border-t border-edge/50">📣 {result.summary}</div>}
      </div>

      {/* 控制 / 结算 */}
      {!finished ? (
        <div className="flex gap-2">
          <button onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))} className="px-3 py-2 rounded-lg border border-edge text-dim text-[14px] hover:text-slate-100">⏩ {speed}×</button>
          <button onClick={() => setStep(rounds.length)} className="flex-1 py-2 rounded-lg border border-edge text-dim text-[14px] hover:text-slate-100">跳到结果</button>
        </div>
      ) : (
        <div className="space-y-2">
          {settled && bet && (
            <div className={`rounded-xl border p-3 space-y-2 ${settled.win ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-blood/50 bg-blood/5'}`}>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-100">👑 {match.fighters[winner!].name} 获胜！</div>
                <div className={`text-xl font-black font-mono ${settled.win ? 'text-emerald-300' : 'text-blood/80'}`}>
                  {settled.win ? `🎉 押中 +${settled.profit}` : `💀 押错 −${bet.amount}`}
                </div>
              </div>
              {/* 具体结算 */}
              <div className="rounded-lg bg-void/50 border border-edge/60 p-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] font-mono">
                <div className="text-dim/60">下注</div><div className="text-right text-slate-200">{['①一号','②二号'][bet.side]} {match.fighters[bet.side].name}</div>
                <div className="text-dim/60">注金 / 赔率</div><div className="text-right text-slate-200">{bet.amount} · {match.odds[bet.side].toFixed(2)}×</div>
                <div className="text-dim/60">赔付</div><div className={`text-right ${settled.win ? 'text-emerald-300' : 'text-blood/80'}`}>{settled.win ? `返还 ${bet.amount + settled.profit}（本金+${settled.profit}）` : `没收 ${bet.amount}`}</div>
                <div className="text-dim/60">结算后{chipName}</div><div className="text-right text-amber-300">🪙 {balAfter.toLocaleString()}</div>
                <div className="col-span-2 border-t border-edge/40 my-0.5" />
                <div className="text-dim/60">回合数</div><div className="text-right text-slate-300">{rounds.length}</div>
                <div className="text-dim/60">造成伤害</div><div className="text-right text-slate-300">{match.fighters[0].name} {dmgDealt[0]} / {match.fighters[1].name} {dmgDealt[1]}</div>
              </div>
            </div>
          )}
          <button onClick={onLeave} className="w-full py-2.5 rounded-xl border border-god/40 text-god font-bold hover:bg-god/10">离场 · 再来一场</button>
        </div>
      )}
    </div>
  );
}
