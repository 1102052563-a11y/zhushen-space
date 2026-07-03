import { useState, useEffect } from 'react';
import { useItems } from '../store/itemStore';
import { useCasino } from '../store/casinoStore';
import { rollGachaBatch, grantGachaReward, GACHA_PITY, RARITY_COLOR, type GachaReward } from '../systems/casinoGacha';

/* 命运福袋（扭蛋）：花魂币抽奖池(装备/宝石/材料/技能书/乐园币/魂币)，纯前端确定性 +
   账号级保底(60抽必出史诗+) + 十连保底≥稀有；奖励即时进背包/钱包/档案。设计见记忆 casino-feature。
   仅主神空间可用(isHome 由 CasinoPanel 传入)。 */
export default function CasinoGacha({ isHome, onGenRewards }: { isHome: boolean; onGenRewards: (rewards: GachaReward[]) => Promise<GachaReward[]> }) {
  const soul = useItems((s) => s.currency['灵魂钱币'] ?? 0);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const cost = useCasino((s) => s.config.gachaCostSoul);
  const pity = useCasino((s) => s.gachaPity);
  const last = useCasino((s) => s.gachaLast);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);

  // 抽到结果后逐张揭示
  useEffect(() => {
    if (!last || last.length === 0) { setShown(0); return; }
    setShown(0);
    const id = setInterval(() => setShown((n) => { if (n >= last.length) { clearInterval(id); return n; } return n + 1; }), 240);
    return () => clearInterval(id);
  }, [last]);

  async function draw(count: number) {
    const total = cost * count;
    if (!isHome || soul < total || busy) return;
    setBusy(true);
    adjustCurrency('灵魂钱币', -total, `福袋扭蛋 ×${count}`);   // 先扣魂币
    const { rewards, pity: np } = rollGachaBatch(count, useCasino.getState().gachaPity);
    let final = rewards;
    try { final = await onGenRewards(rewards); } catch { /* AI 失败 → 保留确定性兜底物品 */ }
    final.forEach(grantGachaReward);
    useCasino.getState().applyGachaPull(final, np);
    setBusy(false);
  }

  const single = cost, ten = cost * 10;
  const pityLeft = Math.max(0, GACHA_PITY - pity);

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-dim/60 leading-relaxed">
        投入<span className="text-fuchsia-300">魂币</span>开启命运福袋，可能开出<span className="text-amber-300">装备 / 宝石 / 材料 / 技能书 / 乐园币 / 魂币</span>。奖励直接入背包与档案。
      </p>

      {/* 保底进度 */}
      <div className="rounded-xl border border-edge bg-panel2/30 p-2.5">
        <div className="flex justify-between text-[13px] font-mono text-dim/50 mb-1"><span>距史诗保底</span><span>{pity} / {GACHA_PITY}</span></div>
        <div className="h-1.5 rounded-full bg-void overflow-hidden"><div className="h-full bg-amber-400/70 transition-all duration-300" style={{ width: `${(pity / GACHA_PITY) * 100}%` }} /></div>
        <div className="text-[12px] font-mono text-dim/40 mt-1">{pityLeft} 抽内必出史诗+（出史诗+清零）</div>
      </div>

      {/* 抽取结果 */}
      {last && last.length > 0 && (
        <div className="rounded-xl border border-edge bg-void/40 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-mono text-dim/50">本次开出</span>
            <button onClick={() => useCasino.getState().clearGachaLast()} className="text-[13px] font-mono text-dim/50 hover:text-slate-200">收起</button>
          </div>
          <div className={`grid ${last.length > 1 ? 'grid-cols-5 max-lg:grid-cols-4' : 'grid-cols-1'} gap-1.5`}>
            {last.slice(0, shown).map((r, i) => (
              <div key={i} className={`rounded-lg border p-1.5 text-center ${RARITY_COLOR[r.rarity]}`}>
                <div className="text-[11px] font-mono opacity-70">{r.rarity}</div>
                <div className="text-[12.5px] font-bold leading-tight truncate" title={r.name}>{r.name}</div>
                <div className="text-[10.5px] font-mono opacity-50 truncate">{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 抽取按钮 */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => draw(1)} disabled={!isHome || soul < single || busy}
          className="py-3 rounded-xl bg-fuchsia-500/15 border border-fuchsia-400/50 text-fuchsia-200 font-bold disabled:opacity-30 hover:bg-fuchsia-500/25">
          {busy ? '⏳ 开袋中…' : `单抽 · ${single} 魂币`}
        </button>
        <button onClick={() => draw(10)} disabled={!isHome || soul < ten || busy}
          className="py-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-200 font-bold disabled:opacity-30 hover:bg-amber-500/25">
          {busy ? '⏳ 开袋中…' : <>十连 · {ten} 魂币<span className="block text-[12px] font-normal opacity-70">保底≥稀有</span></>}
        </button>
      </div>
      <div className="text-center text-[13px] font-mono text-dim/50">持有魂币 · 💠 {soul}</div>
      {!isHome && <div className="text-center text-[13px] text-blood/70">仅主神空间内可用</div>}
    </div>
  );
}
