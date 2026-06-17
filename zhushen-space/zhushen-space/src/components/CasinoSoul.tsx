import { useState } from 'react';
import { useItems } from '../store/itemStore';
import { useCasino } from '../store/casinoStore';
import { SOUL_STAKES, soulStake, rollSoulWin, type SoulStakeKind } from '../systems/casinoEngine';
import { applySoulOutcome } from '../systems/casinoSoul';

/* 魂赌剧情局：魂币贵宾厅·魔笼主持。押魂币/本命装备/天资 → 前端掷定胜负(公平) →
   AI 据预定结果叙述命运对赌剧情 → 前端确定性发放奖惩。仅五阶贵宾资格可入。设计见记忆 casino-feature。*/
const FALLBACK_WIN = '笼中幽火骤然萎缩，魔笼发出一声不甘的低吼——这一局，命运站在了你这边。';
const FALLBACK_LOSE = '笼火暴涨，吞没了你押上的一切，魔笼的笑声在铁条间幽幽回荡——你输了。';

export default function CasinoSoul({ isHome, vipUnlocked, dealerPersona, onGenSoul }: {
  isHome: boolean; vipUnlocked: boolean; dealerPersona: string;
  onGenSoul: (stakeLabel: string, win: boolean, dealerPersona: string) => Promise<{ narrative: string; verdict: string }>;
}) {
  const soul = useItems((s) => s.currency['灵魂钱币'] ?? 0);
  const items = useItems((s) => s.items);
  const [kind, setKind] = useState<SoulStakeKind>('soulcoin');
  const [amount, setAmount] = useState(1);
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ win: boolean; narrative: string; verdict: string; summary: string } | null>(null);

  const def = soulStake(kind);
  const equips = items.filter((it) => /武器|防具|饰品|法宝/.test(it.category));
  const selItem = equips.find((it) => it.id === itemId);

  const canStake = isHome && vipUnlocked && !busy && (
    kind === 'soulcoin' ? soul >= amount && amount > 0
    : kind === 'item' ? !!selItem
    : true);

  async function gamble() {
    if (!canStake) return;
    setBusy(true); setResult(null);
    const win = rollSoulWin(def.winChance);
    const stakeLabel = kind === 'soulcoin' ? `${amount} 魂币`
      : kind === 'item' ? `本命装备「${selItem!.name}」（${selItem!.gradeDesc}）`
      : '自身的一分天资';
    let narrative = '', verdict = '';
    try { const r = await onGenSoul(stakeLabel, win, dealerPersona); narrative = r.narrative; verdict = r.verdict; } catch { /* fallback below */ }
    const settle = applySoulOutcome(kind, win, { amount, itemId, itemName: selItem?.name });
    useCasino.getState().logSoul(`魂赌·${def.label} ${win ? '赢' : '输'}`, settle.delta);
    if (kind === 'item' && !win) setItemId('');
    setResult({ win, narrative: narrative || (win ? FALLBACK_WIN : FALLBACK_LOSE), verdict, summary: settle.summary });
    setBusy(false);
  }

  if (!vipUnlocked) {
    return <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4 text-center text-sm text-fuchsia-300/80">🩸 魂赌只对<b>魂币贵宾厅</b>开放——晋升<b>五阶</b>、踏入贵宾厅，方有资格与命运对赌。</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 text-[14px] text-fuchsia-200/80 leading-relaxed">
        🩸 <b>魂赌</b>：贵宾厅深处，一具古老赌笼【魔笼】主持的命运对赌。押上珍贵之物，赢则厚报、输则真损（魂币没收 / 装备销毁 / 六维受损）。<b className="text-fuchsia-300">高风险高回报，慎入。</b>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {SOUL_STAKES.map((s) => (
          <button key={s.kind} onClick={() => { setKind(s.kind); setResult(null); }}
            className={`px-2 py-2 rounded-lg border text-[14px] font-bold text-center ${kind === s.kind ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-200' : 'border-edge text-dim hover:text-slate-200'}`}>
            <div className="text-base leading-none mb-0.5">{s.emoji}</div>{s.label}
          </button>
        ))}
      </div>
      <div className="text-[13px] text-dim/60">{def.desc} · 胜率 {Math.round(def.winChance * 100)}%</div>

      {def.needsAmount && (
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-dim/60">押上</span>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, +e.target.value || 1))}
            className="w-24 px-2 py-1 rounded-lg bg-void border border-edge text-fuchsia-200 text-sm font-mono text-right" />
          <span className="text-[13px] font-mono text-dim/50">{def.label}（持有 {soul}）</span>
        </div>
      )}
      {def.needsItem && (
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-void border border-edge text-slate-200 text-[14px]">
          <option value="">— 选择要押上的装备 —</option>
          {equips.map((it) => <option key={it.id} value={it.id}>{it.name}（{it.gradeDesc}）</option>)}
        </select>
      )}

      {result && (
        <div className={`rounded-xl border p-3 space-y-2 ${result.win ? 'border-amber-400/50 bg-amber-400/5' : 'border-blood/50 bg-blood/5'}`}>
          <div className="text-[14px] text-slate-300/90 leading-relaxed whitespace-pre-wrap">{result.narrative}</div>
          {result.verdict && <div className="text-[14px] text-fuchsia-300/90 italic">魔笼：「{result.verdict}」</div>}
          <div className={`text-sm font-bold ${result.win ? 'text-amber-300' : 'text-blood/80'}`}>{result.summary}</div>
        </div>
      )}

      <button onClick={gamble} disabled={!canStake}
        className="w-full py-3 rounded-xl bg-fuchsia-600/20 border border-fuchsia-400/50 text-fuchsia-200 font-bold disabled:opacity-30 hover:bg-fuchsia-600/30">
        {busy ? '⏳ 命运落定中…' : '🩸 入局 · 与命运对赌'}
      </button>
      {!isHome && <div className="text-center text-[13px] text-blood/70">仅主神空间内可用</div>}
    </div>
  );
}
