import { useState, useEffect, useRef } from 'react';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { useCasino } from '../store/casinoStore';
import { TIERS, normalizeTier } from '../systems/derivedStats';
import {
  buyChipsQuote, cashOutQuote, houseEdgeLabel,
  rollSicbo, settleSicbo, type SicboBetKind, type SicboRoll,
  spinRoulette, settleRoulette, rouletteColor, type RouletteBetKind,
  ladderRoll, ladderPotAt,
  handValue, settleBlackjack, type Card,
  type GladiatorMatch, type BattleRound,
} from '../systems/casinoEngine';
import CasinoGladiator from './CasinoGladiator';
import CasinoGacha from './CasinoGacha';
import CasinoSoul from './CasinoSoul';
import { type GachaReward } from '../systems/casinoGacha';
import { DEFAULT_DEALERS, loadDealerManifest, pickDealerPortrait, fallbackBanter, type DealerManifest } from '../systems/casinoDealers';

/* 轮回赌坊：仅主神空间内营业。三玩法（骰宝/转盘/翻倍梯子）纯前端确定性结算，不花 API。
   普通厅吃乐园币→筹码；贵宾厅（≥vipMinTier 阶位）吃魂币→魂筹，限红更高。设计见记忆 casino-feature。*/
export default function CasinoPanel({ onClose, onGenMatch, onGenBattle, onGenRewards, onBanter, onGenSoul, onGenPortraits }: {
  onClose: () => void;
  onGenMatch: (kind: 'normal' | 'soul', races?: [string, string]) => Promise<GladiatorMatch | null>;
  onGenBattle: (m: GladiatorMatch, winner: 0 | 1) => Promise<{ rounds: BattleRound[]; summary: string }>;
  onGenRewards: (rewards: GachaReward[]) => Promise<GachaReward[]>;
  onBanter: (dealer: { name: string; gender: string; persona: string }, ctx: string) => Promise<string>;
  onGenSoul: (stakeLabel: string, win: boolean, dealerPersona: string) => Promise<{ narrative: string; verdict: string }>;
  onGenPortraits: (m: GladiatorMatch) => Promise<void>;
}) {
  const currency       = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const worldName      = useMisc((s) => s.worldName);
  const tier           = usePlayer((s) => s.profile.tier);

  const chips      = useCasino((s) => s.chips);
  const soulChips  = useCasino((s) => s.soulChips);
  const config     = useCasino((s) => s.config);
  const stats      = useCasino((s) => s.stats);
  const ladder     = useCasino((s) => s.ladder);
  const log        = useCasino((s) => s.log);
  const cas        = useCasino;   // 取 actions 用 getState，避免重渲染

  const isHome = true;   // 区域限制已取消：赌坊在任何世界均可营业
  const tierIdx = TIERS.indexOf(normalizeTier(tier));
  const vipUnlocked = tierIdx >= config.vipMinTier - 1;

  const [hall, setHall] = useState<'normal' | 'soul'>('normal');
  const [tab, setTab]   = useState<'sicbo' | 'roulette' | 'blackjack' | 'ladder' | 'gladiator' | 'soulduel' | 'gacha' | 'soul'>('sicbo');
  const [bet, setBet]   = useState(50);
  const [exch, setExch] = useState(100);

  // ── 荷官（立绘 + 吐槽）──
  const dealers = DEFAULT_DEALERS;
  const [dealerIdx, setDealerIdx] = useState(0);
  const dealer = dealers[dealerIdx % dealers.length];
  const [banter, setBanter] = useState('');
  const [dealerManifest, setDealerManifest] = useState<DealerManifest | null>(null);
  const [dealerPortrait, setDealerPortrait] = useState<string | null>(null);
  const lastBanterTs = useRef<number>(0);
  const banterBusy = useRef(false);

  async function askBanter(mood: 'win' | 'lose' | 'idle', ctx: string) {
    if (banterBusy.current) return;
    banterBusy.current = true;
    try { const line = await onBanter({ name: dealer.name, gender: dealer.gender, persona: dealer.persona }, ctx); setBanter(line || fallbackBanter(mood)); }
    catch { setBanter(fallbackBanter(mood)); }
    finally { banterBusy.current = false; }
  }
  // 挂载：加载荷官立绘清单 + 记住"已见到的最新流水ts"(不为旧记录吐槽) + 招呼一句
  useEffect(() => {
    loadDealerManifest().then(setDealerManifest).catch(() => {});
    lastBanterTs.current = useCasino.getState().log[0]?.ts ?? 0;
    askBanter('idle', '主角刚走到赌桌前，还没下注');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 换荷官：刷新立绘
  useEffect(() => { setDealerPortrait(pickDealerPortrait(dealerManifest, dealer.portraitFolder)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dealerManifest, dealerIdx]);
  // 新结算流水 → 据输赢吐槽
  useEffect(() => {
    const top = log[0];
    if (!top || top.ts === lastBanterTs.current) return;
    lastBanterTs.current = top.ts;
    if (top.game === 'exchange') return;
    const mood = top.delta > 0 ? 'win' : top.delta < 0 ? 'lose' : 'idle';
    const res = top.delta > 0 ? `赢了${top.delta}` : top.delta < 0 ? `输了${-top.delta}` : '—';
    askBanter(mood, `玩法/事件:${top.text}；输赢:${res}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  const kind: 'normal' | 'soul' = hall === 'soul' && vipUnlocked ? 'soul' : 'normal';
  const balance   = kind === 'soul' ? soulChips : chips;
  const coinKey   = kind === 'soul' ? '灵魂钱币' : '乐园币';
  const coinBal   = currency[coinKey] ?? 0;
  const chipName  = kind === 'soul' ? '魂筹' : '筹码';
  const coinName  = kind === 'soul' ? '魂币' : '乐园币';
  const lim       = kind === 'soul'
    ? { min: config.limits.soulMin, max: config.limits.soulMax }
    : { min: config.limits.normalMin, max: config.limits.normalMax };

  const clampedBet = Math.max(lim.min, Math.min(bet, lim.max));
  const canBet = isHome && balance >= clampedBet && clampedBet >= lim.min;

  // 兑换
  function buyChips() {
    const q = buyChipsQuote(exch, config.exchangeFeePct);
    if (q.spend <= 0 || coinBal < q.spend || q.chips <= 0) return;
    adjustCurrency(coinKey, -q.spend);
    cas.getState().addChips(kind, q.chips);
    cas.getState().logExchange(kind, `${q.spend} ${coinName} → ${q.chips} ${chipName}`);
  }
  function cashOut() {
    const q = cashOutQuote(exch, config.cashoutFeePct);
    if (q.chips <= 0 || balance < q.chips) return;
    cas.getState().addChips(kind, -q.chips);
    adjustCurrency(coinKey, q.coins);
    cas.getState().logExchange(kind, `${q.chips} ${chipName} → ${q.coins} ${coinName}`);
  }

  return (
    <div className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-5xl h-[92vh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">

        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-lg">🎰</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">轮回赌坊</div>
            <div className={`text-[14px] font-mono ${isHome ? 'text-god/60' : 'text-blood/70'}`}>{isHome ? '主神空间 · 营业中' : '⚠ 仅主神空间内可用'}</div>
          </div>
          <div className="text-right leading-tight">
            <div className="text-[13px] font-mono text-dim/50">{chipName}余额</div>
            <div className="text-base font-bold font-mono text-amber-300">🪙 {balance.toLocaleString()}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg ml-2">✕</button>
        </header>

        {/* 厅切换 + 兑换 */}
        <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel2/30 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-edge overflow-hidden text-[14px] font-bold">
            <button onClick={() => setHall('normal')} className={`px-3 py-1 ${hall === 'normal' ? 'bg-god/20 text-god' : 'text-dim hover:text-slate-200'}`}>普通厅</button>
            <button onClick={() => vipUnlocked && setHall('soul')} disabled={!vipUnlocked}
              title={vipUnlocked ? '魂币贵宾厅' : `需 ${config.vipMinTier} 阶位解锁`}
              className={`px-3 py-1 ${hall === 'soul' && vipUnlocked ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-dim/40'} ${!vipUnlocked ? 'cursor-not-allowed' : 'hover:text-fuchsia-300'}`}>
              {vipUnlocked ? '魂币贵宾厅' : '贵宾厅🔒'}
            </button>
          </div>
          <div className="text-[13px] font-mono text-dim/50">{coinName} {coinBal.toLocaleString()}</div>
          <div className="flex-1" />
          <input type="number" value={exch} min={1} onChange={(e) => setExch(Math.max(0, +e.target.value || 0))}
            className="w-20 px-2 py-1 rounded-lg bg-void border border-edge text-slate-100 text-[14px] font-mono text-right" />
          <button onClick={buyChips} className="px-2.5 py-1 rounded-lg border border-god/40 text-god text-[14px] font-bold hover:bg-god/10">买{chipName}</button>
          <button onClick={cashOut} className="px-2.5 py-1 rounded-lg border border-edge text-dim text-[14px] font-bold hover:text-slate-100">兑现</button>
          {config.exchangeFeePct > 0 && <span className="text-[12px] font-mono text-dim/40">抽水{Math.round(config.exchangeFeePct * 100)}%</span>}
        </div>

        {/* 荷官立绘 + 吐槽 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel2/20">
          <button onClick={() => setDealerIdx((i) => (i - 1 + dealers.length) % dealers.length)} className="text-dim/40 hover:text-slate-200 text-sm shrink-0" title="换荷官">‹</button>
          <button onClick={() => askBanter('idle', '主角点了点荷官，想听他说两句')} title="点荷官说两句"
            className="w-9 h-9 rounded-full border border-god/30 bg-void overflow-hidden flex items-center justify-center text-lg shrink-0 hover:border-god/60">
            {dealerPortrait ? <img src={dealerPortrait} alt={dealer.name} className="w-full h-full object-cover" /> : <span>{dealer.emoji}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-mono text-god/60 leading-none mb-0.5">荷官 · {dealer.name}</div>
            <div className="text-[14px] text-slate-300 truncate">{banter || '…'}</div>
          </div>
          <button onClick={() => setDealerIdx((i) => (i + 1) % dealers.length)} className="text-dim/40 hover:text-slate-200 text-sm shrink-0" title="换荷官">›</button>
        </div>

        {/* 玩法 tab */}
        <div className="shrink-0 flex border-b border-edge bg-panel overflow-x-auto">
          {([['sicbo', '🎲 猜大小'], ['roulette', '🎡 轮回转盘'], ['blackjack', '🃏 夺命21点'], ['ladder', '🪜 翻倍梯子'], ['gladiator', '🏟 角斗场'], ['soulduel', '⚜️ 灵魂决斗场'], ['gacha', '🎁 命运福袋'], ['soul', '🩸 魂赌']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 whitespace-nowrap px-3 py-2 text-[15px] font-bold transition-colors ${tab === k ? 'text-amber-300 border-b-2 border-amber-400 bg-amber-400/5' : 'text-dim hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!isHome && (
            <div className="rounded-xl border border-blood/40 bg-blood/5 p-4 text-center text-sm text-blood/80">
              赌坊只在主神空间（轮回乐园）内营业。回到乐园再来一掷千金。
            </div>
          )}

          {/* 公共下注额（福袋/魂赌不用下注额） */}
          {tab !== 'gacha' && tab !== 'soul' && tab !== 'gladiator' && tab !== 'soulduel' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-mono text-dim/60">下注</span>
              <input type="number" value={bet} min={lim.min} max={lim.max}
                onChange={(e) => setBet(Math.max(0, +e.target.value || 0))}
                className="w-24 px-2 py-1 rounded-lg bg-void border border-edge text-amber-200 text-sm font-mono text-right" />
              {[10, 50, 100, 500].map((d) => (
                <button key={d} onClick={() => setBet((b) => Math.min(lim.max, b + d))}
                  className="px-2 py-1 rounded-lg border border-edge text-dim text-[13px] hover:text-amber-200">+{d}</button>
              ))}
              <button onClick={() => setBet(Math.min(lim.max, balance))} className="px-2 py-1 rounded-lg border border-edge text-dim text-[13px] hover:text-amber-200">全押</button>
              <span className="text-[12px] font-mono text-dim/40">限红 {lim.min}~{lim.max}</span>
            </div>
          )}

          {tab === 'sicbo'    && <SicboGame amount={clampedBet} canBet={canBet} kind={kind} />}
          {tab === 'roulette' && <RouletteGame amount={clampedBet} canBet={canBet} kind={kind} />}
          {tab === 'blackjack' && <BlackjackGame amount={clampedBet} canBet={canBet} kind={kind} balance={balance} />}
          {tab === 'ladder'   && <LadderGame amount={clampedBet} canBet={canBet} kind={kind} ladderActive={!!ladder} />}
          {tab === 'gladiator' && <CasinoGladiator kind={kind} tierLo={1} tierHi={4} minBet={lim.min} maxBet={lim.max} onGenMatch={onGenMatch} onGenBattle={onGenBattle} onGenPortraits={onGenPortraits} />}
          {tab === 'soulduel' && <CasinoGladiator kind="soul" tierLo={5} tierHi={7} minBet={10} maxBet={config.limits.soulMax} vipOnly vipUnlocked={vipUnlocked} onGenMatch={onGenMatch} onGenBattle={onGenBattle} onGenPortraits={onGenPortraits} />}
          {tab === 'gacha' && <CasinoGacha isHome={isHome} onGenRewards={onGenRewards} />}
          {tab === 'soul' && <CasinoSoul isHome={isHome} vipUnlocked={vipUnlocked} dealerPersona={(DEFAULT_DEALERS.find((d) => d.vip) ?? DEFAULT_DEALERS[0]).persona} onGenSoul={onGenSoul} />}

          {tab !== 'gacha' && tab !== 'soul' && <div className="text-[13px] font-mono text-dim/40 text-center">庄家优势 · {houseEdgeLabel(tab === 'soulduel' ? 'gladiator' : tab, config)}</div>}

          {/* 战绩 + 流水 */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-xl border border-edge bg-panel2/30 p-3 text-[14px] font-mono space-y-1">
              <div className="text-dim/50 mb-1">战绩</div>
              <div className="flex justify-between"><span className="text-dim/60">总局数</span><span className="text-slate-200">{stats.hands}</span></div>
              <div className="flex justify-between"><span className="text-dim/60">累计赢/输</span><span><span className="text-emerald-300">{stats.won}</span> / <span className="text-blood/80">{stats.lost}</span></span></div>
              <div className="flex justify-between"><span className="text-dim/60">最大单局</span><span className="text-amber-300">{stats.biggestWin}</span></div>
              <div className="flex justify-between"><span className="text-dim/60">连胜/最佳</span><span className="text-slate-200">{stats.winStreak} / {stats.bestWinStreak}</span></div>
            </div>
            <div className="rounded-xl border border-edge bg-panel2/30 p-3 text-[13px] font-mono overflow-hidden">
              <div className="text-dim/50 mb-1">最近流水</div>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {log.length === 0 && <div className="text-dim/40">—</div>}
                {log.slice(0, 12).map((e, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="text-dim/60 truncate">{e.text}</span>
                    {e.game !== 'exchange' && <span className={e.delta >= 0 ? 'text-emerald-300' : 'text-blood/80'}>{e.delta >= 0 ? '+' : ''}{e.delta}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 破产保护 */}
          {isHome && chips <= 0 && soulChips <= 0 && !ladder && (
            <button onClick={() => cas.getState().claimBankruptcyGrant()}
              className="w-full py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/5 text-emerald-300 text-sm font-bold hover:bg-emerald-500/10">
              💸 输光了？领取破产保护 · 补发 {config.bankruptcyGrant} 普通筹码
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── 骰宝 ─────────── */
function SicboGame({ amount, canBet, kind }: { amount: number; canBet: boolean; kind: 'normal' | 'soul' }) {
  const [sel, setSel] = useState<{ kind: SicboBetKind; point?: number }>({ kind: 'big' });
  const [roll, setRoll] = useState<SicboRoll | null>(null);
  const [res, setRes] = useState<{ win: boolean; profit: number; label: string } | null>(null);

  function play() {
    if (!canBet) return;
    const r = rollSicbo();
    const out = settleSicbo({ ...sel, amount }, r);
    setRoll(r); setRes(out);
    useCasino.getState().recordResult('sicbo', kind, out.profit,
      out.profit < 0 ? -out.profit : amount,
      `骰宝 ${sel.kind === 'single' ? '点' + sel.point : sel.kind === 'big' ? '大' : sel.kind === 'small' ? '小' : '豹子'} · ${r.dice.join('-')}`);
  }

  const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {([['big', '大 (11~17) 1:1'], ['small', '小 (4~10) 1:1'], ['triple', '豹子 30:1']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSel({ kind: k })}
            className={`px-3 py-2 rounded-lg border text-[14px] font-bold ${sel.kind === k ? 'border-amber-400 bg-amber-400/10 text-amber-200' : 'border-edge text-dim hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-[13px] font-mono text-dim/50">押单点</span>
        {[1, 2, 3, 4, 5, 6].map((p) => (
          <button key={p} onClick={() => setSel({ kind: 'single', point: p })}
            className={`w-8 h-8 rounded-lg border text-lg ${sel.kind === 'single' && sel.point === p ? 'border-amber-400 bg-amber-400/10 text-amber-200' : 'border-edge text-dim hover:text-slate-200'}`}>{DICE[p - 1]}</button>
        ))}
      </div>
      {roll && (
        <div className="flex items-center justify-center gap-3 py-2">
          {roll.dice.map((d, i) => <span key={i} className="text-4xl text-slate-100">{DICE[d - 1]}</span>)}
          <span className="text-sm font-mono text-dim/60">= {roll.sum}{roll.isTriple ? ' 豹子!' : ''}</span>
        </div>
      )}
      {res && <div className={`text-center font-bold ${res.win ? 'text-emerald-300' : 'text-blood/80'}`}>{res.win ? `🎉 赢 +${res.profit}` : `💀 输 ${res.profit}`}（{res.label}）</div>}
      <button onClick={play} disabled={!canBet}
        className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">摇骰 · 押 {amount}</button>
    </div>
  );
}

/* ─────────── 轮回转盘 ─────────── */
function RouletteGame({ amount, canBet, kind }: { amount: number; canBet: boolean; kind: 'normal' | 'soul' }) {
  const [sel, setSel] = useState<{ kind: RouletteBetKind; number?: number }>({ kind: 'red' });
  const [pocket, setPocket] = useState<number | null>(null);
  const [res, setRes] = useState<{ win: boolean; profit: number; label: string } | null>(null);

  function play() {
    if (!canBet) return;
    const p = spinRoulette();
    const out = settleRoulette({ ...sel, amount }, p);
    setPocket(p); setRes(out);
    useCasino.getState().recordResult('roulette', kind, out.profit,
      out.profit < 0 ? -out.profit : amount,
      `转盘 ${sel.kind === 'straight' ? '号' + sel.number : sel.kind} · ${p}`);
  }

  const EVEN = [['red', '红 1:1'], ['black', '黑 1:1'], ['odd', '单 1:1'], ['even', '双 1:1'], ['low', '小1-18'], ['high', '大19-36']] as const;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {EVEN.map(([k, label]) => (
          <button key={k} onClick={() => setSel({ kind: k })}
            className={`px-3 py-2 rounded-lg border text-[14px] font-bold ${sel.kind === k ? 'border-amber-400 bg-amber-400/10 text-amber-200' : 'border-edge text-dim hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>
      <div className="flex gap-1 items-center flex-wrap">
        <span className="text-[13px] font-mono text-dim/50 mr-1">押单号 35:1</span>
        {Array.from({ length: 37 }, (_, n) => n).map((n) => {
          const c = rouletteColor(n);
          const active = sel.kind === 'straight' && sel.number === n;
          return (
            <button key={n} onClick={() => setSel({ kind: 'straight', number: n })}
              className={`w-7 h-7 rounded text-[13px] font-mono border ${active ? 'ring-2 ring-amber-400' : ''} ${c === 'red' ? 'bg-red-700/50 text-red-100 border-red-500/40' : c === 'black' ? 'bg-slate-800 text-slate-200 border-slate-600' : 'bg-emerald-700/50 text-emerald-100 border-emerald-500/40'}`}>{n}</button>
          );
        })}
      </div>
      {pocket !== null && (
        <div className="flex items-center justify-center gap-2 py-2">
          <span className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold border-2 ${rouletteColor(pocket) === 'red' ? 'bg-red-700/60 border-red-400 text-red-50' : rouletteColor(pocket) === 'black' ? 'bg-slate-800 border-slate-500 text-slate-100' : 'bg-emerald-700/60 border-emerald-400 text-emerald-50'}`}>{pocket}</span>
        </div>
      )}
      {res && <div className={`text-center font-bold ${res.win ? 'text-emerald-300' : 'text-blood/80'}`}>{res.win ? `🎉 赢 +${res.profit}` : `💀 输 ${res.profit}`}（落 {res.label}）</div>}
      <button onClick={play} disabled={!canBet}
        className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">转盘 · 押 {amount}</button>
    </div>
  );
}

/* ─────────── 夺命21点 ─────────── */
const BJ_RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BJ_SUIT = ['♠', '♥', '♦', '♣'];
function PlayingCard({ c, hidden }: { c?: Card; hidden?: boolean }) {
  if (hidden || !c) return <span className="inline-flex w-8 h-11 items-center justify-center rounded-md border border-edge bg-panel2 text-dim/40">🂠</span>;
  const red = c.suit === 1 || c.suit === 2;
  return (
    <span className={`inline-flex flex-col w-8 h-11 items-center justify-center rounded-md border border-edge bg-void ${red ? 'text-rose-400' : 'text-slate-100'}`}>
      <span className="text-[15px] font-bold leading-none">{BJ_RANK[c.rank]}</span>
      <span className="text-[13px] leading-none">{BJ_SUIT[c.suit]}</span>
    </span>
  );
}
const BJ_OUT = {
  blackjack: { t: '🂡 黑杰克！', c: 'text-amber-300' },
  win: { t: '🎉 你赢了', c: 'text-emerald-300' },
  push: { t: '🤝 平局', c: 'text-dim' },
  lose: { t: '💀 你输了', c: 'text-blood/80' },
  bust: { t: '💥 爆牌', c: 'text-blood/80' },
} as const;

function BlackjackGame({ amount, canBet, kind, balance }: { amount: number; canBet: boolean; kind: 'normal' | 'soul'; balance: number }) {
  const bj = useCasino((s) => s.blackjack);
  const playing = bj?.status === 'playing';
  const done = bj?.status === 'done';
  const dealerTotal = bj ? (playing ? handValue([bj.dealer[0]]).total : handValue(bj.dealer).total) : 0;
  const playerTotal = bj ? handValue(bj.player).total : 0;
  const canDouble = !!playing && !!bj && bj.player.length === 2 && balance >= amount * 2;
  const settled = done && bj ? settleBlackjack(bj.player, bj.dealer, bj.bet, bj.doubled) : null;

  if (!bj) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-dim/60 leading-relaxed">与荷官比点，越接近 <span className="text-amber-300">21</span> 越好、超过即<span className="text-blood/80">爆牌</span>。荷官停在 17；天生黑杰克(首两张=21)赔 <span className="text-amber-300">1.5×</span>，可加倍。</p>
        <button onClick={() => canBet && useCasino.getState().startBlackjack(kind, amount)} disabled={!canBet}
          className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">🃏 发牌 · 押 {amount}</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-edge bg-panel2/30 p-2.5">
        <div className="flex items-center justify-between mb-1.5"><span className="text-[14px] font-mono text-dim/60">荷官</span><span className="text-sm font-bold text-slate-200">{playing ? `${dealerTotal}+?` : dealerTotal}</span></div>
        <div className="flex gap-1.5 flex-wrap">{bj.dealer.map((c, i) => <PlayingCard key={i} c={c} hidden={playing && i > 0} />)}</div>
      </div>
      <div className={`rounded-xl border p-2.5 ${playerTotal > 21 ? 'border-blood/50 bg-blood/5' : 'border-amber-400/40 bg-amber-400/5'}`}>
        <div className="flex items-center justify-between mb-1.5"><span className="text-[14px] font-mono text-dim/60">你{bj.doubled ? ' · 已加倍' : ''}</span><span className={`text-sm font-bold ${playerTotal > 21 ? 'text-blood/80' : 'text-amber-200'}`}>{playerTotal}</span></div>
        <div className="flex gap-1.5 flex-wrap">{bj.player.map((c, i) => <PlayingCard key={i} c={c} />)}</div>
      </div>
      {playing ? (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => useCasino.getState().bjHit()} className="py-2.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold hover:bg-amber-500/25">要牌</button>
          <button onClick={() => useCasino.getState().bjStand()} className="py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/50 text-emerald-200 font-bold hover:bg-emerald-500/25">停牌</button>
          <button onClick={() => useCasino.getState().bjDouble()} disabled={!canDouble} className="py-2.5 rounded-xl border border-edge text-dim font-bold disabled:opacity-30 hover:text-slate-100">加倍 {amount * 2}</button>
        </div>
      ) : (
        <div className="space-y-2">
          {settled && bj.outcome && (
            <div className={`rounded-xl border p-3 text-center ${settled.profit > 0 ? 'border-emerald-400/50 bg-emerald-500/10' : settled.profit < 0 ? 'border-blood/50 bg-blood/5' : 'border-edge bg-panel2/30'}`}>
              <div className={`text-base font-black ${BJ_OUT[bj.outcome].c}`}>{BJ_OUT[bj.outcome].t}</div>
              <div className="text-sm font-mono text-slate-200">{settled.profit > 0 ? `+${settled.profit}` : settled.profit < 0 ? `${settled.profit}` : '±0'} · 你 {playerTotal} vs 荷官 {handValue(bj.dealer).total}</div>
            </div>
          )}
          <button onClick={() => useCasino.getState().clearBlackjack()} className="w-full py-2.5 rounded-xl border border-god/40 text-god font-bold hover:bg-god/10">再来一局</button>
        </div>
      )}
    </div>
  );
}

/* ─────────── 天命翻倍梯子 ─────────── */
function LadderGame({ amount, canBet, kind, ladderActive }: { amount: number; canBet: boolean; kind: 'normal' | 'soul'; ladderActive: boolean }) {
  const ladder = useCasino((s) => s.ladder);
  const winChance = useCasino((s) => s.config.ladderWinChance);
  const maxSteps  = useCasino((s) => s.config.ladderMaxSteps);
  const [flash, setFlash] = useState<'' | 'win' | 'lose'>('');

  function start() {
    if (!canBet) return;
    useCasino.getState().startLadder(kind, amount);
    setFlash('');
  }
  function advance() {
    if (!ladder || ladder.busted) return;
    const won = ladderRoll(winChance);
    const nextStep = ladder.step + 1;
    useCasino.getState().ladderAdvance(won, ladderPotAt(ladder.bet, nextStep), nextStep);
    setFlash(won ? 'win' : 'lose');
  }
  function cashout() { useCasino.getState().cashoutLadder(); setFlash(''); }
  function clear()   { useCasino.getState().clearLadder(); setFlash(''); }

  if (!ladderActive) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-dim/60 leading-relaxed">
          押下底注后反复开盅：每级约 {Math.round(winChance * 100)}% 翻倍，翻错血本无归。随时可<span className="text-amber-300">收手</span>落袋——见好就收，贪心者破产。最高 {maxSteps} 级（×{Math.pow(2, maxSteps)}）。
        </p>
        <button onClick={start} disabled={!canBet}
          className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">押 {amount} 上梯</button>
      </div>
    );
  }

  const l = ladder!;
  const atMax = l.step >= maxSteps;
  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-4 text-center transition-colors ${l.busted ? 'border-blood/50 bg-blood/5' : flash === 'win' ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-amber-400/40 bg-amber-400/5'}`}>
        <div className="text-[13px] font-mono text-dim/50">底注 {l.bet} · 第 {l.step} 级</div>
        <div className={`text-3xl font-bold font-mono ${l.busted ? 'text-blood/70 line-through' : 'text-amber-200'}`}>🪙 {l.busted ? 0 : l.pot}</div>
        {!l.busted && <div className="text-[13px] font-mono text-dim/50">继续→ 赢得 {l.pot * 2}（×{Math.pow(2, l.step + 1)}）</div>}
        {l.busted && <div className="text-sm font-bold text-blood/80">💀 翻车，彩池清零</div>}
      </div>
      {l.busted ? (
        <button onClick={clear} className="w-full py-3 rounded-xl border border-edge text-dim font-bold hover:text-slate-100">认栽 · 收摊</button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={advance} disabled={atMax}
            className="py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">{atMax ? '已封顶' : '继续翻倍'}</button>
          <button onClick={cashout}
            className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-400/50 text-emerald-200 font-bold hover:bg-emerald-500/25">收手 · 落袋 {l.pot}</button>
        </div>
      )}
    </div>
  );
}
