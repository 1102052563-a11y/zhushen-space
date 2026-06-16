import { useState, useEffect } from 'react';
import {
  useItems, gradeNameClass, gradeBadgeClass, socketsOf, gradeToNum, MAX_SOCKETS, ITEM_GRADES,
  type InventoryItem,
} from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import {
  generateGemShop, gemFromItem, itemFromGem, gemFitsSlot, isHighGem,
  applyGemsToEffect, drillCost, drillRate, synthesizeGem, stabilizerCost,
  type GeneratedGem, type SynthResult,
} from '../systems/gemEngine';
import { CAT_ICON } from './BackpackModal';

/* 宝石商店 + 镶嵌所（从强化所打开）。
   - 商店：选品级 → 刷新随机若干颗（效果各异）→ 乐园币购入背包
   - 镶嵌：识别背包宝石 → 镶进装备空孔（部位需匹配）；数值在生成时已烘焙，镶嵌只套用
   - 剥离：普通(极大概率碎裂) / 无损(乐园付费·委托里德)
   - 打孔石加孔 / 宝石合成 为后续阶段（孔位现按品级 socketsOf 自带）*/

const EQUIP_CATS = ['武器', '防具', '饰品'];
const SHATTER_CHANCE = 0.7;

function roundNice(n: number): number {
  if (n >= 10000) return Math.round(n / 100) * 100;
  if (n >= 1000) return Math.round(n / 10) * 10;
  return Math.max(1, Math.round(n));
}
/** 无损剥离价（按宝石品级，约等于一颗新宝石的 7 成）*/
const safeRemoveCost = (tier: string) => roundNice(150 * Math.pow(1.9, gradeToNum(tier)) * 0.7);

export default function GemPanel({ onClose }: { onClose: () => void }) {
  const items          = useItems((s) => s.items);
  const currency       = useItems((s) => s.currency);
  const addItem        = useItems((s) => s.addItem);
  const removeItem     = useItems((s) => s.removeItem);
  const updateItem     = useItems((s) => s.updateItem);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const worldName      = useMisc((s) => s.worldName);
  const isHome = /轮回乐园|专属房间|主神空间/.test(worldName ?? '');

  const [tab, setTab]           = useState<'shop' | 'socket' | 'synth'>('shop');
  const [shopGrade, setShopGrade] = useState('紫色');
  const [shopGems, setShopGems] = useState<GeneratedGem[]>([]);
  const [selId, setSelId]       = useState<string | null>(null);
  const [toast, setToast]       = useState('');

  useEffect(() => { setShopGems(generateGemShop(shopGrade, 8)); }, [shopGrade]);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 1900); };

  const equips  = items.filter((it) => EQUIP_CATS.includes(it.category));
  const bagGems = items.filter((it) => it.category === '宝石');
  const sel = selId ? items.find((it) => it.id === selId) ?? null : null;
  useEffect(() => { if ((!selId || !equips.some((e) => e.id === selId)) && equips[0]) setSelId(equips[0].id); }, [equips, selId]);

  const buy = (g: GeneratedGem, idx: number) => {
    if (!isHome) return flash('⚠ 仅乐园内可购买');
    if (currency.乐园币 < g.price) return flash('乐园币不足');
    adjustCurrency('乐园币', -g.price);
    addItem(g.item);
    setShopGems((arr) => arr.filter((_, i) => i !== idx));
    flash(`已购入 ${g.item.name}`);
  };

  const socket = (equip: InventoryItem, gem: InventoryItem) => {
    if (!isHome) return flash('⚠ 仅乐园内可镶嵌');
    const max = socketsOf(equip);
    const cur = equip.gems ?? [];
    if (cur.length >= max) return flash(max === 0 ? '该装备无镶嵌孔' : '孔位已满（需打孔石扩孔）');
    if (!gemFitsSlot(equip.category, gem.gemSlot)) return flash(`✗ 该宝石仅可镶嵌于「${gem.gemSlot}」`);
    const newGems = [...cur, gemFromItem(gem)];
    updateItem(equip.id, { gems: newGems, effect: applyGemsToEffect(equip.effect, newGems) });
    removeItem(gem.id);
    flash(`✓ 已镶嵌 ${gem.name}`);
  };

  const unsocket = (equip: InventoryItem, idx: number, safe: boolean) => {
    if (!isHome) return flash('⚠ 仅乐园内可剥离');
    const gems = equip.gems ?? [];
    const gem = gems[idx];
    if (!gem) return;
    const newGems = gems.filter((_, i) => i !== idx);
    const patch = { gems: newGems, effect: applyGemsToEffect(equip.effect, newGems) };
    if (safe) {
      const cost = safeRemoveCost(gem.tier);
      if (currency.乐园币 < cost) return flash(`无损剥离需 ${cost.toLocaleString()} 乐园币`);
      adjustCurrency('乐园币', -cost);
      updateItem(equip.id, patch);
      addItem(itemFromGem(gem));
      flash(`里德为你无损取出了 ${gem.name}`);
    } else {
      const shatter = Math.random() < SHATTER_CHANCE;
      updateItem(equip.id, patch);
      if (shatter) flash(`💥 ${gem.name} 在剥离中碎裂了！`);
      else { addItem(itemFromGem(gem)); flash(`侥幸！${gem.name} 完好取出`); }
    }
  };

  const drill = (equip: InventoryItem) => {
    if (!isHome) return flash('⚠ 仅乐园内可打孔');
    const cur = socketsOf(equip);
    if (cur >= MAX_SOCKETS) return flash(`已达孔位上限 ${MAX_SOCKETS}`);
    const cost = drillCost(cur);
    if (currency.乐园币 < cost) return flash(`打孔石需 ${cost.toLocaleString()} 乐园币`);
    adjustCurrency('乐园币', -cost);
    if (Math.random() < drillRate(cur)) { updateItem(equip.id, { sockets: cur + 1 }); flash(`✓ 打孔成功！+1 孔（共 ${cur + 1}）`); }
    else flash('💥 打孔失败，打孔石损耗，孔位不变');
  };

  // ── 合成「赌狗深渊」──
  const [synthSlots, setSynthSlots] = useState<(InventoryItem | null)[]>([null, null, null]);
  const [useStab, setUseStab]       = useState(false);
  const [synthResult, setSynthResult] = useState<SynthResult | null>(null);
  const synthFilled = synthSlots.filter(Boolean) as InventoryItem[];
  const synthTier = synthFilled[0]?.gradeDesc ?? null;
  const synthPlacedIds = new Set(synthFilled.map((g) => g.id));
  const synthBag = bagGems.filter((g) => !synthPlacedIds.has(g.id));
  const synthReady = isHome && synthFilled.length === 3 && (!useStab || !synthTier || currency.乐园币 >= stabilizerCost(synthTier));

  const placeSynth = (gem: InventoryItem) => {
    if (synthTier && gem.gradeDesc !== synthTier) return flash('需同品级宝石');
    const idx = synthSlots.findIndex((x) => !x);
    if (idx < 0) return flash('已放满 3 颗');
    setSynthSlots((s) => s.map((x, j) => (j === idx ? gem : x)));
    setSynthResult(null);
  };
  const doSynth = () => {
    if (!isHome) return flash('⚠ 仅乐园内可合成');
    const gems = synthSlots.filter(Boolean) as InventoryItem[];
    if (gems.length !== 3) return flash('需 3 颗宝石');
    if (!gems.every((g) => g.gradeDesc === gems[0].gradeDesc)) return flash('3 颗必须同品级');
    if (useStab) { const c = stabilizerCost(gems[0].gradeDesc); if (currency.乐园币 < c) return flash('稳定剂乐园币不足'); adjustCurrency('乐园币', -c); }
    const res = synthesizeGem(gems, useStab);
    gems.forEach((g) => removeItem(g.id));
    addItem(res.gem.item);
    setSynthResult(res);
    setSynthSlots([null, null, null]);
    setUseStab(false);
    flash(res.mutated ? `🎲 突变产出 ${res.gem.item.name}` : `🔒 合成 ${res.gem.item.name}`);
  };

  const TabBtn = ({ k, label }: { k: 'shop' | 'socket' | 'synth'; label: string }) => (
    <button onClick={() => setTab(k)}
      className={`px-4 py-1.5 rounded-lg text-[13px] font-bold border transition-colors ${tab === k ? 'border-god/50 bg-god/10 text-god' : 'border-edge text-dim hover:text-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl h-[86vh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">

        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-lg">💎</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">宝石 · 镶嵌所</div>
            <div className={`text-[12px] font-mono ${isHome ? 'text-god/60' : 'text-blood/70'}`}>{isHome ? '乐园 · 营业中' : '⚠ 仅乐园内可交易/镶嵌'}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono text-dim/50">乐园币</div>
            <div className="text-sm font-bold font-mono text-amber-300">{currency.乐园币.toLocaleString()}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg ml-2">✕</button>
        </header>

        {/* Tab 切换 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel2/30">
          <TabBtn k="shop" label="🛒 宝石商店" />
          <TabBtn k="socket" label="💎 镶嵌打孔" />
          <TabBtn k="synth" label="🔥 宝石合成" />
        </div>

        {/* ───── 商店 ───── */}
        {tab === 'shop' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-edge">
              <span className="text-[12px] font-mono text-dim/60">品级</span>
              <select value={shopGrade} onChange={(e) => setShopGrade(e.target.value)} className="input-base !w-auto !py-1.5 !px-2 text-[13px]">
                {ITEM_GRADES.map((g) => <option key={g} value={g}>{g}{gradeToNum(g) >= 9 ? ' · 高阶' : ''}</option>)}
              </select>
              <button onClick={() => setShopGems(generateGemShop(shopGrade, 8))}
                className="px-3 py-1.5 rounded-lg border border-god/40 text-god text-[13px] font-bold hover:bg-god/10">🔄 刷新货架</button>
              <span className="text-[11px] font-mono text-dim/40 ml-auto">{gradeToNum(shopGrade) >= 9 ? '高阶宝石：质变战斗属性' : '基础宝石：面板加成'}</span>
            </div>

            <div className="flex-1 overflow-y-auto onscene-scroll p-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
              {shopGems.map((g, i) => {
                const it = g.item;
                const high = isHighGem(it.gradeDesc);
                const afford = currency.乐园币 >= g.price;
                return (
                  <div key={i} className={`rounded-xl border p-3 flex flex-col gap-1.5 ${high ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge bg-panel/60'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">💎</span>
                      <span className={`text-[14px] font-bold truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span className={gradeBadgeClass(it.gradeDesc)}>{it.gradeDesc}</span>
                      <span className="text-dim/45">{it.gemSlot === '通用' ? '任意装备' : `仅${it.gemSlot}`}</span>
                    </div>
                    <div className={`text-[12.5px] leading-snug flex-1 ${high ? 'text-amber-200/90' : 'text-slate-200/90'}`}>{it.effect}</div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[13px] font-mono text-amber-300">{g.price.toLocaleString()} <span className="text-[10px] text-dim/50">乐园币</span></span>
                      <button onClick={() => buy(g, i)} disabled={!isHome || !afford}
                        className={`px-3 py-1 rounded-lg text-[12px] font-bold border ${(!isHome || !afford) ? 'border-edge text-dim/30 cursor-not-allowed' : 'border-god/40 text-god hover:bg-god/10'}`}>
                        购买
                      </button>
                    </div>
                  </div>
                );
              })}
              {shopGems.length === 0 && <div className="col-span-full text-center text-dim/40 text-[13px] py-10">货架已空，点「刷新货架」</div>}
            </div>
          </div>
        )}

        {/* ───── 镶嵌 ───── */}
        {tab === 'socket' && (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            {/* 左：装备列表 */}
            <div className="lg:w-2/5 shrink-0 border-b lg:border-b-0 lg:border-r border-edge overflow-y-auto onscene-scroll p-2 max-h-[28vh] lg:max-h-none">
              <div className="text-[11px] font-mono text-dim/50 px-2 py-1">选择装备（孔位 ●满 ○空）</div>
              {equips.length === 0 && <div className="text-center text-dim/40 text-[12px] py-8">背包无装备</div>}
              {equips.map((it) => {
                const max = socketsOf(it);
                const used = (it.gems ?? []).length;
                return (
                  <button key={it.id} onClick={() => setSelId(it.id)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 mb-1 border flex items-center gap-2 ${selId === it.id ? 'border-god/50 bg-god/10' : 'border-edge hover:border-edge/80 hover:bg-panel/50'}`}>
                    <span className="text-lg shrink-0">{CAT_ICON[it.category] ?? '◆'}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[13px] font-bold truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}{(it.enhanceLevel ?? 0) > 0 ? ` +${it.enhanceLevel}` : ''}</div>
                      <div className="text-[11px] font-mono text-dim/45">{it.category} · {max > 0 ? '●'.repeat(used) + '○'.repeat(Math.max(0, max - used)) : '无孔'}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 右：选中装备的孔位 + 背包宝石 */}
            <div className="flex-1 flex flex-col min-h-0">
              {sel ? (
                <>
                  <div className="shrink-0 px-3 py-2 border-b border-edge">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className={`text-[14px] font-bold truncate ${gradeNameClass(sel.gradeDesc)}`}>{sel.name}{(sel.enhanceLevel ?? 0) > 0 ? ` +${sel.enhanceLevel}` : ''}</div>
                        <div className="text-[11px] font-mono text-dim/45">{sel.gradeDesc} · {sel.category} · 孔位 {(sel.gems ?? []).length}/{socketsOf(sel)}</div>
                      </div>
                      {socketsOf(sel) < MAX_SOCKETS ? (
                        <button onClick={() => drill(sel)} disabled={!isHome || currency.乐园币 < drillCost(socketsOf(sel))}
                          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 text-[11.5px] font-bold hover:bg-amber-500/10 disabled:opacity-40 leading-tight text-center"
                          title="消耗打孔石新增 1 个镶嵌孔（孔位越多越贵越难）">
                          🕳️ 打孔 +1<br /><span className="text-[10px] font-mono opacity-80">{drillCost(socketsOf(sel)).toLocaleString()}币 · {Math.round(drillRate(socketsOf(sel)) * 100)}%</span>
                        </button>
                      ) : (
                        <span className="shrink-0 text-[10.5px] font-mono text-dim/40">孔位已满 {MAX_SOCKETS}</span>
                      )}
                    </div>
                  </div>

                  {/* 孔位 */}
                  <div className="shrink-0 p-2.5 space-y-1.5 border-b border-edge">
                    {Array.from({ length: socketsOf(sel) }).map((_, i) => {
                      const gem = (sel.gems ?? [])[i];
                      return gem ? (
                        <div key={i} className={`rounded-lg border p-2 flex items-center gap-2 ${gem.high ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge bg-panel/50'}`}>
                          <span className="text-base shrink-0">💎</span>
                          <div className="min-w-0 flex-1">
                            <div className={`text-[12.5px] font-bold truncate ${gradeNameClass(gem.tier)}`}>{gem.name}</div>
                            <div className={`text-[11.5px] leading-snug ${gem.high ? 'text-amber-200/85' : 'text-slate-200/80'}`}>{gem.statText}</div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => unsocket(sel, i, false)} disabled={!isHome}
                              className="px-2 py-0.5 rounded text-[10.5px] border border-blood/40 text-blood/80 hover:bg-blood/10 disabled:opacity-30" title={`约${Math.round(SHATTER_CHANCE*100)}%几率碎裂`}>剥离</button>
                            <button onClick={() => unsocket(sel, i, true)} disabled={!isHome}
                              className="px-2 py-0.5 rounded text-[10.5px] border border-god/30 text-god/80 hover:bg-god/10 disabled:opacity-30" title={`委托里德无损取出 · ${safeRemoveCost(gem.tier).toLocaleString()} 乐园币`}>无损</button>
                          </div>
                        </div>
                      ) : (
                        <div key={i} className="rounded-lg border border-dashed border-edge/70 p-2 text-center text-[11px] font-mono text-dim/35">○ 空孔 · 从下方选宝石镶入</div>
                      );
                    })}
                    {socketsOf(sel) === 0 && <div className="text-center text-[11.5px] text-dim/40 py-2">该装备暂无镶嵌孔（高品级装备自带更多孔；打孔石扩孔为后续功能）</div>}
                  </div>

                  {/* 背包宝石 */}
                  <div className="flex-1 overflow-y-auto onscene-scroll p-2.5">
                    <div className="text-[11px] font-mono text-dim/50 mb-1.5">背包宝石（点击镶入空孔）</div>
                    {bagGems.length === 0 && <div className="text-center text-dim/40 text-[12px] py-6">背包暂无宝石，去「宝石商店」购买</div>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {bagGems.map((gem) => {
                        const fits = gemFitsSlot(sel.category, gem.gemSlot);
                        const full = (sel.gems ?? []).length >= socketsOf(sel);
                        const high = isHighGem(gem.gradeDesc);
                        const ok = isHome && fits && !full;
                        return (
                          <button key={gem.id} onClick={() => socket(sel, gem)} disabled={!ok}
                            className={`text-left rounded-lg border p-2 ${ok ? (high ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' : 'border-edge hover:bg-panel/50') : 'border-edge/60 opacity-45 cursor-not-allowed'}`}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-base">💎</span>
                              <span className={`text-[12.5px] font-bold truncate ${gradeNameClass(gem.gradeDesc)}`}>{gem.name}</span>
                            </div>
                            <div className={`text-[11.5px] leading-snug mt-0.5 ${high ? 'text-amber-200/85' : 'text-slate-200/80'}`}>{gem.effect}</div>
                            <div className="text-[10.5px] font-mono text-dim/45 mt-0.5">{gem.gemSlot === '通用' ? '任意装备' : `仅${gem.gemSlot}`}{!fits ? ' · ✗部位不符' : ''}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-dim/40 text-[13px]">← 先选一件装备</div>
              )}
            </div>
          </div>
        )}

        {/* ───── 合成「赌狗深渊」───── */}
        {tab === 'synth' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 px-4 py-2.5 border-b border-edge text-[12px] text-dim/65 leading-snug">
              🎰 3 颗<b className="text-slate-200">同品级</b>宝石 → 1 颗<b className="text-amber-300">高一阶</b>。三颗<b className="text-emerald-300">同属性</b>必锁定方向；属性不同则<b className="text-rose-400">随机突变</b>（可能产出毫不相干的废属性）——除非投入<b className="text-god">融合稳定剂</b>锁定。
            </div>
            {/* 3 槽 → 产物 */}
            <div className="shrink-0 px-3 py-3 flex items-center justify-center gap-1.5 flex-wrap">
              {[0, 1, 2].map((i) => {
                const g = synthSlots[i];
                return (
                  <button key={i} onClick={() => { if (g) { setSynthSlots((s) => s.map((x, j) => (j === i ? null : x))); setSynthResult(null); } }}
                    className={`w-[78px] h-[78px] rounded-xl border flex flex-col items-center justify-center text-center p-1 ${g ? 'border-god/40 bg-god/5' : 'border-dashed border-edge/70'}`}>
                    {g ? <><span className="text-xl">💎</span><span className={`text-[10px] font-bold leading-tight ${gradeNameClass(g.gradeDesc)}`}>{g.name}</span></> : <span className="text-dim/30 text-[11px]">空槽{i + 1}</span>}
                  </button>
                );
              })}
              <span className="text-xl text-dim/40 px-1">→</span>
              <div className="w-[78px] h-[78px] rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center text-center p-1">
                {synthResult ? <><span className="text-xl">💎</span><span className={`text-[10px] font-bold leading-tight ${gradeNameClass(synthResult.gem.item.gradeDesc)}`}>{synthResult.gem.item.name}</span></> : <span className="text-dim/30 text-[11px]">产物</span>}
              </div>
            </div>
            {/* 稳定剂 + 合成 */}
            <div className="shrink-0 px-4 pb-2 flex flex-wrap items-center justify-center gap-3">
              <label className={`flex items-center gap-1.5 text-[12px] ${synthTier ? 'text-slate-200' : 'text-dim/30'}`}>
                <input type="checkbox" checked={useStab} disabled={!synthTier} onChange={(e) => setUseStab(e.target.checked)} />
                融合稳定剂（锁定属性{synthTier ? ` · ${stabilizerCost(synthTier).toLocaleString()}币` : ''}）
              </label>
              <button onClick={doSynth} disabled={!synthReady}
                className={`px-5 py-1.5 rounded-lg text-[13px] font-bold border ${synthReady ? 'border-amber-500/50 text-amber-300 hover:bg-amber-500/10' : 'border-edge text-dim/30 cursor-not-allowed'}`}>
                🔥 合成
              </button>
            </div>
            {/* 结果 */}
            {synthResult && (
              <div className={`shrink-0 mx-4 mb-2 rounded-lg border p-2.5 ${synthResult.mutated ? 'border-rose-500/30 bg-rose-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
                <div className="text-[12.5px] font-bold">{synthResult.mutated ? '🎲 随机突变！' : '🔒 属性锁定'} → <span className={gradeNameClass(synthResult.gem.item.gradeDesc)}>{synthResult.gem.item.name}</span></div>
                <div className="text-[12px] text-slate-200/85 mt-0.5">{synthResult.gem.item.effect}</div>
                <div className="text-[10.5px] text-dim/45 mt-0.5">已放入背包</div>
              </div>
            )}
            {/* 背包宝石选择 */}
            <div className="flex-1 overflow-y-auto onscene-scroll px-3 pb-3">
              <div className="text-[11px] font-mono text-dim/50 mb-1.5">背包宝石（点击放入空槽{synthTier ? ` · 仅 ${synthTier} 级` : ''}）</div>
              {synthBag.length === 0 && <div className="text-center text-dim/40 text-[12px] py-6">背包暂无可合成宝石</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {synthBag.map((gem) => {
                  const high = isHighGem(gem.gradeDesc);
                  const can = isHome && (!synthTier || gem.gradeDesc === synthTier) && synthFilled.length < 3;
                  return (
                    <button key={gem.id} onClick={() => placeSynth(gem)} disabled={!can}
                      className={`text-left rounded-lg border p-2 ${can ? (high ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' : 'border-edge hover:bg-panel/50') : 'border-edge/60 opacity-45 cursor-not-allowed'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">💎</span>
                        <span className={`text-[12.5px] font-bold truncate ${gradeNameClass(gem.gradeDesc)}`}>{gem.name}</span>
                      </div>
                      <div className={`text-[11.5px] leading-snug mt-0.5 ${high ? 'text-amber-200/85' : 'text-slate-200/80'}`}>{gem.effect}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 提示条 */}
        {toast && (
          <div className="shrink-0 px-4 py-2 border-t border-edge bg-panel text-center text-[12.5px] font-mono text-god/90">{toast}</div>
        )}
      </div>
    </div>
  );
}
