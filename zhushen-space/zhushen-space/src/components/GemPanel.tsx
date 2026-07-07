import { useState, useEffect } from 'react';
import {
  useItems, gradeNameClass, gradeBadgeClass, socketsOf, gradeToNum, MAX_SOCKETS, ITEM_GRADES,
  type InventoryItem, type GemSlotKind,
} from '../store/itemStore';
import {
  generateGemShop, gemFromItem, itemFromGem, gemFitsSlot, isHighGem,
  applyGemsToEffect, drillCost, drillRate, synthesizeGem, stabilizerCost,
  makeCustomGem, parseGeneratedGems, GEM_GEN_PROMPT, GEM_SLOTS,
  type GeneratedGem, type SynthResult,
} from '../systems/gemEngine';
import { activeGemSets, gemSetName, setForGem, type GemSetDef } from '../systems/gemSets';
import { useEnhance } from '../store/enhanceStore';
import { useGemSets, gemAiChain } from '../store/gemSetStore';
import { apiChatFallback } from '../systems/apiChat';
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
  const dropSettings   = useEnhance((s) => s.settings);
  const setEnhanceSettings = useEnhance((s) => s.setSettings);
  const gemSetDefs     = useGemSets((s) => s.sets);
  const gsGenerating   = useGemSets((s) => s.generating);
  const gsGenError     = useGemSets((s) => s.genError);
  const gsUpsert       = useGemSets((s) => s.upsertSet);
  const gsAddBlank     = useGemSets((s) => s.addBlankSet);
  const gsRemove       = useGemSets((s) => s.removeSet);
  const gsReset        = useGemSets((s) => s.resetSets);
  const gsAddDefaults  = useGemSets((s) => s.addDefaultsBack);
  const gsGenerate     = useGemSets((s) => s.generateSet);
  const isHome = true;   // 区域限制已取消：宝石交易/镶嵌在任何世界均可进行

  const [tab, setTab]           = useState<'shop' | 'socket' | 'synth' | 'sets' | 'custom'>('shop');
  const [shopGrade, setShopGrade] = useState('紫色');
  const [shopGems, setShopGems] = useState<GeneratedGem[]>([]);
  const [selId, setSelId]       = useState<string | null>(null);
  const [toast, setToast]       = useState('');
  const [genTheme, setGenTheme] = useState('');
  // 自定义宝石：手动打造字段
  const [cgName, setCgName]   = useState('');
  const [cgGrade, setCgGrade] = useState('紫色');
  const [cgSlot, setCgSlot]   = useState<GemSlotKind>('通用');
  const [cgAttr, setCgAttr]   = useState('力量');
  const [cgEffect, setCgEffect] = useState('力量+15');
  const [cgSetKey, setCgSetKey] = useState('');   // '' = 自动按属性匹配
  // 自定义宝石：AI 按提示词生成
  const [gemPrompt, setGemPrompt] = useState('');
  const [gemGrade, setGemGrade]   = useState('紫色');
  const [gemGening, setGemGening] = useState(false);
  const [gemGenErr, setGemGenErr] = useState('');

  useEffect(() => { setShopGems(generateGemShop(shopGrade, 8)); }, [shopGrade]);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 1900); };

  const equips  = items.filter((it) => EQUIP_CATS.includes(it.category));
  const bagGems = items.filter((it) => it.category === '宝石');
  const activeSets = activeGemSets(items.filter((it) => it.equipped), gemSetDefs);   // 已装备装备上激活的套装（跨装备统计）
  // 套装编辑助手（inline·避免定义子组件破坏输入法）
  const patchSet = (key: string, patch: Partial<GemSetDef>) => { const cur = gemSetDefs.find((x) => x.key === key); if (cur) gsUpsert({ ...cur, ...patch }); };
  const patchTier = (key: string, i: number, bonus: string) => { const cur = gemSetDefs.find((x) => x.key === key); if (cur) gsUpsert({ ...cur, tiers: cur.tiers.map((t, j) => (j === i ? { ...t, bonus } : t)) }); };
  const setTierNeed = (key: string, i: number, need: number) => { const cur = gemSetDefs.find((x) => x.key === key); if (cur) gsUpsert({ ...cur, tiers: cur.tiers.map((t, j) => (j === i ? { ...t, need } : t)) }); };
  const addTier = (key: string) => { const cur = gemSetDefs.find((x) => x.key === key); if (cur && cur.tiers.length < 4) gsUpsert({ ...cur, tiers: [...cur.tiers, { need: Math.min(6, (cur.tiers.at(-1)?.need ?? 0) + 2), bonus: '' }] }); };
  const delTier = (key: string, i: number) => { const cur = gemSetDefs.find((x) => x.key === key); if (cur) gsUpsert({ ...cur, tiers: cur.tiers.filter((_, j) => j !== i) }); };

  // 自定义宝石助手
  const allMembers = Array.from(new Set(gemSetDefs.flatMap((s) => s.members ?? [])));
  const cgResolvedKey = cgSetKey || setForGem(cgAttr, gemSetDefs);
  const cgSetLive = gemSetName(cgResolvedKey, gemSetDefs) || '（不属于任何套装——可在下方指定，或到套装管理把该属性加入 members）';
  const createCustomGem = () => {
    if (!cgAttr.trim() && !cgEffect.trim()) return flash('请至少填写「归属属性」或「效果」');
    const gem = makeCustomGem({ name: cgName, grade: cgGrade, slot: cgSlot, attr: cgAttr, effect: cgEffect, setKey: cgSetKey || undefined });
    addItem(gem);
    flash(`✓ 已打造 ${gem.name}（已入背包）`);
  };
  const aiGenGem = async () => {
    if (gemGening) return;
    setGemGening(true); setGemGenErr('');
    try {
      const { content } = await apiChatFallback(gemAiChain(), [
        { role: 'system', content: GEM_GEN_PROMPT },
        { role: 'user', content: `请按要求设计宝石：「${gemPrompt.trim() || '一颗契合当前处境的宝石'}」。品级默认「${gemGrade}」。只输出 JSON 数组。` },
      ], { timeoutMs: 120000, label: '自定义宝石生成' });
      const gems = parseGeneratedGems(content, gemGrade);
      if (!gems.length) throw new Error('未能从模型输出解析出宝石（格式不符，请重试或换非流式模型）');
      gems.forEach((g) => addItem(g));
      flash(`✨ AI 打造 ${gems.length} 颗宝石（已入背包）`);
    } catch (e: any) { setGemGenErr(e?.message ?? '生成失败'); }
    finally { setGemGening(false); }
  };
  const sel = selId ? items.find((it) => it.id === selId) ?? null : null;
  useEffect(() => { if ((!selId || !equips.some((e) => e.id === selId)) && equips[0]) setSelId(equips[0].id); }, [equips, selId]);

  const buy = (g: GeneratedGem, idx: number) => {
    if (!isHome) return flash('⚠ 仅乐园内可购买');
    if (currency.乐园币 < g.price) return flash('乐园币不足');
    adjustCurrency('乐园币', -g.price, `宝石·购买 ${g.item.name}`);
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
      adjustCurrency('乐园币', -cost, `宝石·无损剥离 ${gem.name}`);
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
    adjustCurrency('乐园币', -cost, '宝石·打孔石扩孔');
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
    if (useStab) { const c = stabilizerCost(gems[0].gradeDesc); if (currency.乐园币 < c) return flash('稳定剂乐园币不足'); adjustCurrency('乐园币', -c, '宝石·合成稳定剂'); }
    const res = synthesizeGem(gems, useStab);
    gems.forEach((g) => removeItem(g.id));
    addItem(res.gem.item);
    setSynthResult(res);
    setSynthSlots([null, null, null]);
    setUseStab(false);
    flash(res.mutated ? `🎲 突变产出 ${res.gem.item.name}` : `🔒 合成 ${res.gem.item.name}`);
  };

  const TabBtn = ({ k, label }: { k: 'shop' | 'socket' | 'synth' | 'sets' | 'custom'; label: string }) => (
    <button onClick={() => setTab(k)}
      className={`px-4 py-1.5 rounded-lg text-[13px] font-bold border transition-colors ${tab === k ? 'border-god/50 bg-god/10 text-god' : 'border-edge text-dim hover:text-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl h-[86dvh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">

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
          <TabBtn k="custom" label="🔨 自定义宝石" />
          <TabBtn k="sets" label="✨ 套装管理" />
        </div>

        {/* 当前套装：已装备装备上集齐的同套装宝石激活阶梯加成（跨装备统计·实时） */}
        {activeSets.length > 0 && (
          <div className="shrink-0 px-4 py-2 border-b border-edge bg-god/5 flex flex-wrap gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-mono text-god/70 self-center">✨ 已激活套装</span>
            {activeSets.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1 text-[11.5px]"
                title={s.tiers.map((t) => `${t.active ? '✓' : '○'}${t.need}件 · ${t.bonus}`).join('\n')}>
                <span>{s.emoji}</span>
                <span className="font-bold text-god/90">{s.name}</span>
                <span className="font-mono text-amber-300/80">×{s.count}</span>
                <span className="font-mono text-emerald-300/80">
                  {s.tiers.filter((t) => t.active).map((t) => `${t.need}件`).join('/') || '—'}
                </span>
              </span>
            ))}
          </div>
        )}

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
            {/* 击杀掉落设置：正文里击败敌人，结算时按掉率掉落对应阶位宝石 */}
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-edge text-[12px]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={dropSettings.gemDropEnabled !== false}
                  onChange={(e) => setEnhanceSettings({ gemDropEnabled: e.target.checked })} />
                <span className="text-slate-200">⚔️ 击杀强敌掉落宝石</span>
              </label>
              <span className="text-dim/45">击杀强敌掉率</span>
              <input type="number" min={0} max={100} step={1}
                value={Math.round((dropSettings.gemDropRate ?? 0.16) * 100)}
                onChange={(e) => setEnhanceSettings({ gemDropRate: Math.max(0, Math.min(1, (Number(e.target.value) || 0) / 100)) })}
                className="input-base !w-16 !py-1 !px-2 text-[12px] text-center" />
              <span className="text-dim/45">%</span>
              <span className="text-[11px] font-mono text-dim/35 ml-auto">仅击杀高阶/强敌触发 · 每回合至多1颗 · boss掉率×1.8</span>
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
                      <span className="text-god/60">套·{gemSetName(it.gemSet ?? setForGem(it.gemAttr, gemSetDefs), gemSetDefs) || '—'}</span>
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
            <div className="lg:w-2/5 shrink-0 border-b lg:border-b-0 lg:border-r border-edge overflow-y-auto onscene-scroll p-2 max-h-[28dvh] lg:max-h-none">
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
                            <div className="text-[10.5px] font-mono text-dim/45 mt-0.5">{gem.gemSlot === '通用' ? '任意装备' : `仅${gem.gemSlot}`} · <span className="text-god/55">套·{gemSetName(gem.gemSet ?? setForGem(gem.gemAttr, gemSetDefs), gemSetDefs) || '—'}</span>{!fits ? ' · ✗部位不符' : ''}</div>
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

        {/* ───── 自定义宝石（AI 提示词生成 / 手动打造·套装必识别、加成必生效） ───── */}
        {tab === 'custom' && (
          <div className="flex-1 overflow-y-auto onscene-scroll p-4 space-y-4">
            {/* AI 按提示词生成 */}
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
              <div className="text-[13px] font-bold text-amber-300">✨ AI 按提示词打造宝石</div>
              <textarea value={gemPrompt} onChange={(e) => setGemPrompt(e.target.value)} rows={2}
                placeholder="描述你想要的宝石，如：一颗吸血宝石，武器用，高阶，攻击吸取生命并附带暴击"
                className="input-base w-full !py-1.5 !px-2 text-[12.5px] resize-none" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-dim/55">默认品级</span>
                <select value={gemGrade} onChange={(e) => setGemGrade(e.target.value)} className="input-base !w-auto !py-1 !px-2 text-[12px]">
                  {ITEM_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <button onClick={aiGenGem} disabled={gemGening}
                  className={`px-3 py-1.5 rounded-lg border text-[12.5px] font-bold ${gemGening ? 'border-edge text-dim/40 cursor-wait' : 'border-amber-500/50 text-amber-300 hover:bg-amber-500/10'}`}>
                  {gemGening ? '✨ 生成中…' : '✨ AI 生成宝石'}
                </button>
                {gemGenErr && <span className="text-[11px] text-blood/85 font-mono">⚠ {gemGenErr}</span>}
              </div>
            </div>

            {/* 手动打造 */}
            <div className="rounded-xl border border-edge bg-panel/50 p-3 space-y-2">
              <div className="text-[13px] font-bold text-slate-100">🔨 手动打造宝石</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-dim/55">名称（可空·自动命名）
                  <input value={cgName} onChange={(e) => setCgName(e.target.value)} placeholder="留空自动命名" className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5" /></label>
                <label className="text-[11px] text-dim/55">品级
                  <select value={cgGrade} onChange={(e) => setCgGrade(e.target.value)} className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5">{ITEM_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
                <label className="text-[11px] text-dim/55">镶嵌部位
                  <select value={cgSlot} onChange={(e) => setCgSlot(e.target.value as GemSlotKind)} className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5">{GEM_SLOTS.map((s) => <option key={s} value={s}>{s === '通用' ? '通用（任意装备）' : s}</option>)}</select></label>
                <label className="text-[11px] text-dim/55">归属属性（决定套装归属）
                  <input list="cg-attrs" value={cgAttr} onChange={(e) => setCgAttr(e.target.value)} placeholder="力量 / 暴击率 / 真实伤害…" className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5" />
                  <datalist id="cg-attrs">{allMembers.map((m) => <option key={m} value={m} />)}</datalist></label>
              </div>
              <label className="block text-[11px] text-dim/55">效果文本（token 才生效：力量+15 / 暴击率+10% / 穿透20% / 减伤10%…）
                <input value={cgEffect} onChange={(e) => setCgEffect(e.target.value)} placeholder="力量+15" className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5" /></label>
              <label className="block text-[11px] text-dim/55">归属套装
                <select value={cgSetKey} onChange={(e) => setCgSetKey(e.target.value)} className="input-base w-full !py-1 !px-2 text-[12px] mt-0.5">
                  <option value="">自动（按上面「归属属性」匹配）</option>
                  {gemSetDefs.map((s) => <option key={s.key} value={s.key}>{s.emoji} {s.name}</option>)}
                </select></label>
              <div className="text-[11.5px] text-dim/65">将归入套装：<span className={cgSetLive.includes('不属于') ? 'text-blood/80' : 'text-god/90 font-bold'}>{cgSetLive}</span></div>
              <button onClick={createCustomGem} className="px-3 py-1.5 rounded-lg border border-god/45 text-god text-[12.5px] font-bold hover:bg-god/10">➕ 打造并放入背包</button>
            </div>

            <div className="text-[11px] text-dim/45 leading-snug">
              自定义宝石带「归属属性」+「归属套装」，镶嵌后会被套装系统<b className="text-slate-300/70">自动识别</b>、集齐同套装即激活套装加成；效果文本里的 token（六维/暴击/穿透/减伤…）也像普通宝石一样进属性与战斗结算，<b className="text-slate-300/70">真实生效</b>。
            </div>
          </div>
        )}

        {/* ───── 套装管理（AI 生成 / 玩家自定义·非写死） ───── */}
        {tab === 'sets' && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 工具条 */}
            <div className="shrink-0 px-4 py-2.5 border-b border-edge flex flex-wrap items-center gap-2">
              <button onClick={gsAddBlank} className="px-3 py-1.5 rounded-lg border border-god/40 text-god text-[12.5px] font-bold hover:bg-god/10">➕ 新建套装</button>
              <input value={genTheme} onChange={(e) => setGenTheme(e.target.value)}
                placeholder="✍ 提示词：描述你想要的套装，如「吸血流·越打越猛·6件套攻击吸血40%」"
                className="input-base flex-1 min-w-[220px] !py-1.5 !px-2 text-[12px]" />
              <button onClick={() => gsGenerate(genTheme.trim() || undefined)} disabled={gsGenerating}
                className={`px-3 py-1.5 rounded-lg border text-[12.5px] font-bold ${gsGenerating ? 'border-edge text-dim/40 cursor-wait' : 'border-amber-500/50 text-amber-300 hover:bg-amber-500/10'}`}>
                {gsGenerating ? '✨ 生成中…' : '✨ AI 生成'}
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={gsAddDefaults} className="px-2.5 py-1.5 rounded-lg border border-edge text-dim/70 text-[11.5px] hover:text-slate-200" title="把删掉的内置套装补回">补回内置</button>
                <button onClick={() => { if (window.confirm('恢复为内置默认套装？会覆盖当前全部自定义套装。')) gsReset(); }} className="px-2.5 py-1.5 rounded-lg border border-blood/40 text-blood/80 text-[11.5px] hover:bg-blood/10">↺ 恢复默认</button>
              </div>
              {gsGenError && <div className="w-full text-[11.5px] text-blood/85 font-mono">⚠ {gsGenError}</div>}
            </div>
            {/* 说明 */}
            <div className="shrink-0 px-4 py-1.5 border-b border-edge text-[11px] text-dim/50 leading-snug">
              套装可 AI 生成或手动编辑。加成文本用可识别 token 才真正生效：<span className="text-slate-300/80">六维「力量+15」/ 暴击率+8% / 暴击伤害+30% / 穿透30% / 减伤12% / 造成伤害+18% / 冷却缩减1回合 / 额外1段</span>；其余为风味。归属(members)决定新宝石归哪套。
            </div>
            {/* 套装列表 */}
            <div className="flex-1 overflow-y-auto onscene-scroll p-3 space-y-3">
              {gemSetDefs.length === 0 && <div className="text-center text-dim/40 text-[13px] py-10">还没有套装，点「➕ 新建套装」或「✨ AI 生成一套」</div>}
              {gemSetDefs.map((s) => (
                <div key={s.key} className="rounded-xl border border-edge bg-panel/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input value={s.emoji} onChange={(e) => patchSet(s.key, { emoji: e.target.value })} className="input-base !w-12 !py-1 !px-1 text-center text-[15px]" />
                    <input value={s.name} onChange={(e) => patchSet(s.key, { name: e.target.value })} placeholder="套装名" className="input-base !w-36 !py-1 !px-2 text-[13px] font-bold" />
                    <input value={s.theme} onChange={(e) => patchSet(s.key, { theme: e.target.value })} placeholder="主题" className="input-base !w-20 !py-1 !px-2 text-[12px]" />
                    {s.builtin && <span className="text-[10px] font-mono text-god/50 px-1.5 py-0.5 rounded border border-god/20">内置</span>}
                    <button onClick={() => { if (window.confirm(`删除套装「${s.name}」？`)) gsRemove(s.key); }} className="ml-auto text-dim/50 hover:text-blood text-[13px]">🗑 删除</button>
                  </div>
                  <input value={s.desc} onChange={(e) => patchSet(s.key, { desc: e.target.value })} placeholder="一句话风味描述" className="input-base w-full !py-1 !px-2 text-[12px] mb-2" />
                  <div className="mb-2">
                    <div className="text-[11px] font-mono text-dim/55 mb-1">归属属性（新宝石按此归套，「、」分隔）</div>
                    <input value={(s.members ?? []).join('、')} onChange={(e) => patchSet(s.key, { members: e.target.value.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean) })}
                      placeholder="力量、暴击率、真实伤害…" className="input-base w-full !py-1 !px-2 text-[12px]" />
                  </div>
                  <div className="space-y-1.5">
                    {s.tiers.map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input type="number" min={1} max={6} value={t.need} onChange={(e) => setTierNeed(s.key, i, Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                          className="input-base !w-14 !py-1 !px-1 text-center text-[12px]" />
                        <span className="text-[11px] text-dim/50 shrink-0">件套</span>
                        <input value={t.bonus} onChange={(e) => patchTier(s.key, i, e.target.value)} placeholder="如：暴击率+8%，力量+15"
                          className="input-base flex-1 !py-1 !px-2 text-[12px]" />
                        <button onClick={() => delTier(s.key, i)} className="text-dim/40 hover:text-blood text-[13px] px-1" title="删除此档">✕</button>
                      </div>
                    ))}
                    {s.tiers.length < 4 && <button onClick={() => addTier(s.key)} className="text-[11.5px] text-god/70 hover:text-god">＋ 加一档</button>}
                  </div>
                </div>
              ))}
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
