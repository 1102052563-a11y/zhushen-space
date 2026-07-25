import { useState, useEffect, useRef } from 'react';
import { useItems, gradeNameClass, splitAffixEntries, ITEM_GRADES, type InventoryItem } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useEnhance, hydrateEnhancePortraits } from '../store/enhanceStore';
import { CAT_ICON } from './BackpackModal';
import {
  MAX_ENHANCE, PITY_THRESHOLD, resolveEnhance, enhanceCost, protectCost, amuletCost,
  displayRate, isDangerLevel, isRiskLevel, isEnhanceable, enhanceColorClass, enhanceFxClass,
  bumpScore, SCORE_PER_LEVEL, withEnhanceNote, enhancedCombat,
  type EnhanceOutcome,
} from '../systems/enhanceEngine';
import { loadBossManifest, pickStagePortrait, type BossManifest } from '../systems/enhanceBosses';
import { nextGradeOf, ascendCost, isAscendable, planAscendPayment, type AscendPreview } from '../systems/equipAscend';
import { formatPark, SOUL_TO_PARK } from '../systems/itemPricing';
import { useEquipCraft } from '../store/equipCraftStore';
import {
  potentialLeft, potentialMax, craftStateOf, canCraft, craftCost, planCraftPayment, isPreviewMode,
  canInfuse, expectedValue, ESSENCE_GRADE_GAP, OUTCOME_LABEL,
  type CraftPreview, type CraftProcessDef,
} from '../systems/equipCraft';
import { uploadLocal } from '../systems/workshop';
import GemPanel from './GemPanel';
import { pushSceneNotice } from '../systems/allocNotice';   // 场外强化结果 → 正文前置须知（按真实等级，勿凭货币"尝试等级"误判）

export interface EnhanceFinalizeArgs { itemId: string; startLevel: number; newLevel: number; tendency?: string; }
export interface FinalizeStatus { ok: boolean; changed: boolean; error?: string; }
export type AscendResult = { ok: true; preview: AscendPreview } | { ok: false; error: string };
export type CraftResult = { ok: true; preview: CraftPreview } | { ok: false; error: string };
export type ProcessGenResult = { ok: true; def: CraftProcessDef } | { ok: false; error: string };

/* 词缀/效果拆条复用 itemStore 的 splitAffixEntries（吃字符串/数组/对象/JSON 串，绝不吐 [object Object]），
   不再本地弱实现——旧本地版对对象只 String() → 频道交易物品在强化所也会显示 [object Object]。 */

/* 强化所：左=看板娘立绘+切换+吐槽气泡 / 中=被强化装备+特效 / 右=操作区+本轮记录。
   仅乐园内（轮回乐园/专属房间）可强化；摇率/爆装/降级/保底全在 enhanceEngine 算，不花 API。
   两个 AI 点（吐槽 onBanter / 收尾 onFinalize）由 App 提供，读 store.session 自行拼 prompt。 */
export default function EnhancePanel({
  onClose, onBanter, onFinalize, onAscend, onAscendConfirm,
  onCraft, onCraftConfirm, onExtractEssence, onGenProcess,
}: {
  onClose: () => void;
  onBanter: () => Promise<string>;
  onFinalize: (args: EnhanceFinalizeArgs) => Promise<FinalizeStatus | void> | void;
  onAscend: (args: { itemId: string; tendency?: string }) => Promise<AscendResult>;
  onAscendConfirm: (preview: AscendPreview) => { ok: boolean; error?: string };
  onCraft: (args: { itemId: string; processId: string; essenceId?: string; tendency?: string }) => Promise<CraftResult>;
  onCraftConfirm: (preview: CraftPreview) => { ok: boolean; error?: string };
  onExtractEssence: (itemId: string, affixIndex: number) => { ok: boolean; error?: string; name?: string };
  onGenProcess: (prompt: string) => Promise<ProcessGenResult>;
}) {
  const items          = useItems((s) => s.items);
  const currency       = useItems((s) => s.currency);
  const updateItem     = useItems((s) => s.updateItem);
  const removeItem      = useItems((s) => s.removeItem);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const worldName      = useMisc((s) => s.worldName);

  const settings   = useEnhance((s) => s.settings);
  const pity       = useEnhance((s) => s.pity);
  const session    = useEnhance((s) => s.session);
  const selectBoss = useEnhance((s) => s.selectBoss);
  const startSession = useEnhance((s) => s.startSession);
  const applyAttempt = useEnhance((s) => s.applyAttempt);
  const endSession   = useEnhance((s) => s.endSession);

  const tables = settings.tables;
  const bosses = settings.bosses;
  const boss   = bosses.find((b) => b.id === settings.selectedBossId) ?? bosses[0];

  // 区域限制已取消：强化在任何世界均可使用
  const isHome = true;

  const [useProtect, setUseProtect] = useState(false);
  const [useAmulet, setUseAmulet]   = useState(false);
  const [fx, setFx]         = useState<EnhanceOutcome | null>(null);
  const [dying, setDying]   = useState<InventoryItem | null>(null);  // 损毁动画用的快照（物品已从 store 移除）
  const [rolling, setRolling] = useState(false);
  const [warn, setWarn]     = useState('');
  const [banter, setBanter] = useState('');
  const [banterLoading, setBanterLoading] = useState(false);
  const [manifest, setManifest] = useState<BossManifest | null>(null);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [gemsOpen, setGemsOpen] = useState(false);
  const [tab, setTab] = useState<'enhance' | 'ascend' | 'craft'>('enhance');   // ⚒ 强化 / 🔼 品级进阶 / 🔨 工艺 页签
  const [finalizing, setFinalizing] = useState(false);   // 结束强化的收尾 AI 调用中（显示"正在为您强化装备"）
  const [tendency, setTendency] = useState('');   // 玩家指定的词缀/效果生成方向（攻击类/辅助类/挖矿类…），收尾时传给 AI 按此方向生成
  const [finalizeResult, setFinalizeResult] = useState<{ status: 'ok' | 'fail'; name: string; level: number; affix: string; effect: string; error?: string; args: EnhanceFinalizeArgs } | null>(null);  // 收尾结果（成功展示词缀/效果，失败显示原因+重试）
  const fxTimer = useRef<ReturnType<typeof setTimeout>>();

  const candidates = items.filter((it) => isEnhanceable(it.category))
    .sort((a, b) => (Number(b.equipped) - Number(a.equipped)) || ((b.enhanceLevel ?? 0) - (a.enhanceLevel ?? 0)));

  const selItem = session ? items.find((x) => x.id === session.itemId) ?? null : null;
  const displayItem = dying ?? selItem;
  const level = displayItem?.enhanceLevel ?? 0;
  const isRisk   = boss ? isRiskLevel(level, tables) : false;     // ≥+7：失败有持久后果（归零/分解），保护石可用
  const isDanger = boss ? isDangerLevel(level, tables) : false;   // ≥+10：失败分解装备

  // 挂载：回填上传立绘 + 加载分阶段立绘清单 + 自动选中第一件可强化装备
  useEffect(() => {
    hydrateEnhancePortraits();
    loadBossManifest().then(setManifest).catch(() => {});
    if (!useEnhance.getState().session) {
      const c = useItems.getState().items.filter((it) => isEnhanceable(it.category))
        .sort((a, b) => (Number(b.equipped) - Number(a.equipped)) || ((b.enhanceLevel ?? 0) - (a.enhanceLevel ?? 0)));
      if (c[0]) startSession(c[0].id, c[0].name, c[0].enhanceLevel ?? 0, Math.max(c[0].enhanceLevel ?? 0, c[0].maxEnhanceLevel ?? 0));
    }
    return () => clearTimeout(fxTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 立绘：有文件夹则按当前强化等级取对应阶段的随机一张（每次等级变化/换老板都重新随机），否则回退上传立绘
  useEffect(() => {
    if (!boss) { setPortraitUrl(null); return; }
    const fromFolder = pickStagePortrait(manifest, boss.portraitFolder, level);
    setPortraitUrl(fromFolder ?? boss.portrait ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, boss?.id, level]);

  /* 词缀按「历史最高强化等级」生成。基线 base = 持久化的 affixLevel（已 AI 结算到的等级），所以**退出重开待结算依然在**；
     待结算 = floor(峰值/3) > floor(base/3)，跨几档就该生成/升级几次。降级/归零不掉词缀（只降攻防/评分），爬回旧峰不重复生成。 */
  const peakGain = (sess: { itemId: string; startMax: number; curLevel: number; destroyed: boolean }) => {
    const it = useItems.getState().items.find((x) => x.id === sess.itemId);
    const base = it?.affixLevel ?? sess.startMax;                          // 已结算到的等级（持久化）；缺省回退本轮起始峰值
    const newMax = Math.max(base, it?.maxEnhanceLevel ?? sess.curLevel);   // 历史最高峰值
    const gained = !sess.destroyed && Math.floor(newMax / 3) > Math.floor(base / 3);
    return { base, newMax, gained };
  };
  const finalizeIfGained = () => {
    const sess = useEnhance.getState().session;
    if (!sess) return;
    const { base, newMax, gained } = peakGain(sess);
    if (gained) onFinalize({ itemId: sess.itemId, startLevel: base, newLevel: newMax, tendency: tendency.trim() || undefined });
  };

  const pickItem = (id: string) => {
    if (session?.itemId === id) return;
    finalizeIfGained();
    endSession();
    const it = items.find((x) => x.id === id);
    if (it) startSession(it.id, it.name, it.enhanceLevel ?? 0, Math.max(it.enhanceLevel ?? 0, it.maxEnhanceLevel ?? 0));
    setBanter(''); setWarn(''); setUseProtect(false); setUseAmulet(false); setTendency('');
  };

  const handleClose = () => { if (finalizing) return; finalizeIfGained(); endSession(); onClose(); };

  // 调一次收尾 AI，把结果（成功/失败/无改动）整理成结果面板数据（加载遮罩由 finalizing 控制）
  const runFinalize = async (args: EnhanceFinalizeArgs) => {
    setFinalizing(true);
    const r = await Promise.resolve(onFinalize(args)).catch((e: any) => ({ ok: false, changed: false, error: String(e?.message ?? e).slice(0, 80) }));
    setFinalizing(false);
    const upd = useItems.getState().items.find((x) => x.id === args.itemId);
    const st = (r ?? { ok: false, changed: false }) as FinalizeStatus;
    const okChanged = st.ok && st.changed;
    setFinalizeResult({
      status: okChanged ? 'ok' : 'fail',
      name: upd?.name ?? '', level: args.newLevel,
      affix: upd?.affix ?? '', effect: upd?.effect ?? '',
      error: okChanged ? undefined : (st.error ?? '收尾未生效'),
      args,
    });
  };
  // 结束强化：本轮峰值跨入新档 → 调收尾 AI（加载遮罩→结果面板），否则直接结束本轮
  const endEnhance = async () => {
    const sess = useEnhance.getState().session;
    if (!sess || finalizing) return;
    const { base, newMax, gained } = peakGain(sess);
    if (gained) { await runFinalize({ itemId: sess.itemId, startLevel: base, newLevel: newMax, tendency: tendency.trim() || undefined }); return; }
    endSession();
    setBanter(''); setWarn(''); setUseProtect(false); setUseAmulet(false); setTendency('');
  };
  // 失败后「重新强化」：用同样的参数再调一次收尾 AI
  const retryFinalize = () => { if (finalizeResult && !finalizing) runFinalize({ ...finalizeResult.args, tendency: tendency.trim() || finalizeResult.args.tendency }); };
  // 关闭强化结果面板 → 真正结束本轮
  const closeResult = () => {
    setFinalizeResult(null);
    endSession();
    setBanter(''); setWarn(''); setUseProtect(false); setUseAmulet(false); setTendency('');
  };

  const cycleBoss = (dir: 1 | -1) => {
    if (bosses.length < 2) return;
    const i = Math.max(0, bosses.findIndex((b) => b.id === boss?.id));
    selectBoss(bosses[(i + dir + bosses.length) % bosses.length].id);
    setBanter('');
  };

  const askBanter = async () => {
    if (banterLoading || !boss) return;
    setBanterLoading(true);
    try { const t = await onBanter(); if (t) setBanter(t.trim()); }
    catch { /* ignore */ }
    finally { setBanterLoading(false); }
  };

  // 费用（含勾选的保护石/强化符）
  const baseCost    = selItem && boss ? enhanceCost(level, boss, selItem.gradeDesc, selItem.score, tables) : 0;
  const pCost       = useProtect && isRisk ? protectCost(level, tables) : 0;
  const aCost       = useAmulet ? amuletCost(level, tables) : 0;
  const totalCost   = baseCost + pCost + aCost;
  const dispRate    = selItem && boss ? displayRate(level, boss, useAmulet, tables) : 0;
  const pityReady   = pity >= PITY_THRESHOLD;
  const atMax       = level >= MAX_ENHANCE;
  const canEnhance  = isHome && settings.enabled && !!selItem && !atMax && !rolling && currency.乐园币 >= totalCost && !!boss;

  const doEnhance = () => {
    if (!canEnhance || !selItem || !boss) return;
    const it = useItems.getState().items.find((x) => x.id === selItem.id);
    if (!it) return;
    const lv = it.enhanceLevel ?? 0;
    const risk = isRiskLevel(lv, tables);
    const cost = enhanceCost(lv, boss, it.gradeDesc, it.score, tables) + (useProtect && risk ? protectCost(lv, tables) : 0) + (useAmulet ? amuletCost(lv, tables) : 0);
    if (useItems.getState().currency.乐园币 < cost) { setWarn('乐园币不足'); return; }
    setWarn('');
    setRolling(true);
    adjustCurrency('乐园币', -cost, `装备强化·${it.name}（+${lv}→+${lv + 1}）`);

    const result = resolveEnhance(lv, boss, { useProtect: useProtect && risk, useAmulet, pity: useEnhance.getState().pity }, tables);

    if (result.outcome === 'destroy') { setDying(it); removeItem(it.id); }
    else if (result.toLevel !== lv) {
      updateItem(it.id, {
        enhanceLevel: result.toLevel,
        maxEnhanceLevel: Math.max(it.maxEnhanceLevel ?? lv, result.toLevel),   // 高水位只升不降：降级保留峰值供词缀判定
        affixLevel: it.affixLevel ?? lv,   // 首次强化时把"已结算基线"钉在强化前等级（持久化）；之后不变，待结算只看峰值是否超过它，退出重开仍在
        score: bumpScore(it.score, (result.toLevel - lv) * SCORE_PER_LEVEL),
        intro: withEnhanceNote(it.intro, result.toLevel, 'intro'),
        appearance: withEnhanceNote(it.appearance, result.toLevel, 'appearance'),
      });   // 词缀/效果由 AI 收尾按高水位生成；攻防/评分/外观随当前等级（降级即降）
    }
    applyAttempt(result, cost, useProtect && risk, useAmulet);
    // 场外通报：强化「实际结果」（成功/失败/降级/炸裂）→ 让正文按真实等级知晓，勿凭货币里的"尝试等级"误判
    try {
      const outTxt = OUTCOME_TEXT[result.outcome] ?? String(result.outcome);
      const stateTxt = result.outcome === 'destroy' ? '装备已炸裂损毁' : `现为 +${result.toLevel}`;
      pushSceneNotice(`【场外·强化】玩家在强化所对「${it.name}」强化（+${lv}→尝试 +${lv + 1}）：${outTxt}，${stateTxt}。该装备当前强化状态以此为准，勿重复播报或另行结算。`);
    } catch { /* 通报失败不阻断 */ }

    setFx(result.outcome);
    clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => {
      setFx(null);
      setRolling(false);
      if (result.outcome === 'destroy') { setDying(null); endSession(); }
    }, result.outcome === 'destroy' ? 900 : 760);
  };

  const OUTCOME_TEXT: Record<EnhanceOutcome, string> = {
    success: '强化成功', crit: '★ 暴击！跳级', guaranteed: '保底·必成', fail: '强化失败', downgrade: '失败·降 1 级', reset: '强化归零！', destroy: '装备分解！',
  };
  const OUTCOME_CLS: Record<EnhanceOutcome, string> = {
    success: 'text-emerald-300', crit: 'text-fuchsia-300', guaranteed: 'text-cyan-300', fail: 'text-dim/55', downgrade: 'text-orange-300', reset: 'text-rose-400', destroy: 'text-blood',
  };

  return (
    <div className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="relative w-full max-w-5xl h-[88dvh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">

        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-lg">⚒</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">装备强化所</div>
            <div className={`text-[12px] font-mono ${isHome ? 'text-god/60' : 'text-blood/70'}`}>{isHome ? '乐园 · 营业中' : '⚠ 仅乐园内可用'}</div>
          </div>
          {/* 页签：⚒ 强化 / 🔼 品级进阶 */}
          <div className="flex items-center gap-1">
            <button onClick={() => setTab('enhance')}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold transition-colors ${tab === 'enhance' ? 'border-god/60 bg-god/15 text-god' : 'border-edge text-dim hover:text-slate-200 hover:border-god/30'}`}>⚒ 强化</button>
            <button onClick={() => setTab('ascend')}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold transition-colors ${tab === 'ascend' ? 'border-purple-400/60 bg-purple-500/15 text-purple-200' : 'border-edge text-dim hover:text-slate-200 hover:border-purple-400/40'}`}>🔼 品级进阶</button>
            <button onClick={() => setTab('craft')}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold transition-colors ${tab === 'craft' ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-edge text-dim hover:text-slate-200 hover:border-sky-400/40'}`}>🔨 工艺</button>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono text-dim/50">垫子计数 · 爆装攒保底</div>
            <div className={`text-sm font-bold font-mono ${pityReady ? 'text-emerald-300' : 'text-amber-300'}`}>{Math.min(pity, PITY_THRESHOLD)} / {PITY_THRESHOLD}{pityReady ? ' ★必成' : ''}</div>
          </div>
          <button onClick={() => setGemsOpen(true)} className="px-2.5 py-1 rounded-lg border border-god/40 text-god text-[12px] font-bold hover:bg-god/10 ml-1" title="宝石商店 / 镶嵌">💎 宝石</button>
          <button onClick={handleClose} className="text-dim/50 hover:text-blood text-lg ml-2">✕</button>
        </header>

        {gemsOpen && <GemPanel onClose={() => setGemsOpen(false)} />}

        {/* 收尾 AI 调用中：正在为您强化装备 */}
        {finalizing && (
          <div className="absolute inset-0 z-[60] bg-void/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-god/30 border-t-god animate-spin" />
            <div className="text-base font-bold text-god god-glow">✨ 正在为您强化装备…</div>
            <div className="text-[12px] font-mono text-dim/50">AI 正在刷新装备词缀与效果，请稍候</div>
          </div>
        )}

        {/* 收尾结果：成功→展示词缀/效果（分条）；失败/无改动→显示原因 + 重新强化 */}
        {finalizeResult && (() => {
          const fr = finalizeResult;
          const ok = fr.status === 'ok';
          const affixList = splitAffixEntries(fr.affix);
          const effectList = splitAffixEntries(fr.effect);
          return (
            <div className="absolute inset-0 z-[61] bg-void/90 backdrop-blur-sm flex items-center justify-center p-5"
                 onClick={(e) => { if (e.target === e.currentTarget) closeResult(); }}>
              <div className={`w-full max-w-md rounded-2xl border bg-panel overflow-hidden ${ok ? 'border-amber-400/40 shadow-[0_0_50px_rgba(251,191,36,0.18)]' : 'border-blood/50 shadow-[0_0_50px_rgba(239,68,68,0.18)]'}`}>
                <div className={`px-4 py-3 border-b border-edge text-center ${ok ? 'bg-amber-400/10' : 'bg-blood/10'}`}>
                  <div className={`text-base font-bold god-glow ${ok ? 'text-amber-200' : 'text-blood'}`}>{ok ? '✨ 强化完成' : '⚠ 强化收尾失败'}</div>
                  <div className="text-[13px] font-bold text-slate-100 mt-0.5">{fr.name} <span className={enhanceColorClass(fr.level)}>+{fr.level}</span></div>
                </div>
                <div className="p-4 space-y-3 max-h-[52dvh] overflow-y-auto onscene-scroll">
                  {!ok && (
                    <div className="rounded-lg border border-blood/40 bg-blood/5 px-3 py-2 text-[12.5px] text-blood/90 leading-snug">
                      收尾未生效：{fr.error}
                      <div className="text-dim/50 text-[11.5px] mt-1">强化等级已保留；点「🔄 重新强化」再调一次 AI，或「确定」先保留当前词缀。</div>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-mono text-dim/40 mb-1">⚔ 词缀 affix</div>
                    {affixList.length
                      ? <div className="space-y-1.5">{affixList.map((a, i) => <div key={i} className="text-[13px] leading-relaxed text-amber-200/90 border-l-2 border-amber-400/30 pl-2">{a}</div>)}</div>
                      : <span className="text-[13px] text-dim/40">（无）</span>}
                  </div>
                  <div>
                    <div className="text-[11px] font-mono text-dim/40 mb-1">✦ 效果 effect</div>
                    {effectList.length
                      ? <div className="space-y-1.5">{effectList.map((a, i) => <div key={i} className="text-[13px] leading-relaxed text-slate-200/90 border-l-2 border-god/30 pl-2">{a}</div>)}</div>
                      : <span className="text-[13px] text-dim/40">（无）</span>}
                  </div>
                </div>
                <div className="p-3 border-t border-edge flex gap-2">
                  {!ok && (
                    <button onClick={retryFinalize} disabled={finalizing}
                      className="flex-1 py-2 rounded-xl text-sm font-bold border border-amber-400/50 text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 disabled:opacity-40">
                      {finalizing ? '重试中…' : '🔄 重新强化'}
                    </button>
                  )}
                  <button onClick={closeResult} className={`${ok ? 'w-full' : 'flex-1'} py-2 rounded-xl text-sm font-bold border border-god/50 text-god bg-god/10 hover:bg-god/20`}>确定</button>
                </div>
              </div>
            </div>
          );
        })()}

        {tab === 'ascend' && <AscendView onAscend={onAscend} onAscendConfirm={onAscendConfirm} />}
        {tab === 'craft' && <CraftView onCraft={onCraft} onCraftConfirm={onCraftConfirm} onExtractEssence={onExtractEssence} onGenProcess={onGenProcess} />}

        {tab === 'enhance' && (
        <div className="flex-1 flex flex-col overflow-hidden max-lg:overflow-y-auto">

          {/* ── 上：看板娘立绘（整宽，占上方约 58% 高，给横图立绘更多纵向空间）── */}
          <div className="h-[58%] max-lg:h-[42dvh] shrink-0 border-b border-edge bg-panel2/30 p-3 flex flex-col min-h-0">
            <div className="flex items-center justify-center gap-4 mb-2 shrink-0">
              <button onClick={() => cycleBoss(-1)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-slate-100 hover:border-god/40 shrink-0">‹</button>
              <div className="text-center min-w-0">
                <div className="text-sm font-bold text-slate-100 truncate">{boss?.name ?? '—'}</div>
                <div className="text-[11px] font-mono text-dim/50">{boss?.gender === '女' ? '♀ ' : boss?.gender === '男' ? '♂ ' : ''}强化师</div>
              </div>
              <button onClick={() => cycleBoss(1)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-slate-100 hover:border-god/40 shrink-0">›</button>
            </div>

            {/* 立绘按 1216×832 比例显示：占满上半可用高度、居中，整张铺满该比例框（不裁不变形）*/}
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <button onClick={askBanter} disabled={!boss || banterLoading} title="点击老板，听他说两句"
                className="relative h-full max-h-full aspect-[1216/832] max-w-full rounded-xl border border-edge bg-void overflow-hidden group">
                {portraitUrl
                  ? <img src={portraitUrl} alt={boss?.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-dim/30">
                      <span className="text-6xl">{boss?.gender === '女' ? '🙎‍♀️' : '🧔'}</span>
                      <span className="text-[11px] font-mono">（未设置立绘）</span>
                    </div>}
                <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-black/55 text-[10px] font-mono text-slate-300/80 opacity-0 group-hover:opacity-100 transition-opacity text-center">
                  {banterLoading ? '老板正在开口…' : '点我说句话'}
                </div>
              </button>
            </div>

            <div className="mt-2 shrink-0 min-h-[34px] max-h-[52px] overflow-y-auto rounded-xl border border-god/20 bg-god/5 px-3 py-1 text-[13px] text-slate-200 leading-snug">
              {banterLoading ? <span className="text-dim/40 font-mono">……</span>
                : banter ? `「${banter}」`
                : <span className="text-dim/30">点击立绘，听{boss?.name ?? '老板'}说两句</span>}
            </div>
          </div>

          {/* ── 下：强化(左) + 操作(右)，各占下方约 42% 的一半 ── */}
          <div className="h-[42%] max-lg:h-auto flex flex-col lg:flex-row min-h-0">

          {/* 下左：被强化装备 + 特效 */}
          <div className="flex-1 lg:w-1/2 shrink-0 border-b lg:border-b-0 lg:border-r border-edge flex flex-col items-center justify-center p-4 relative overflow-y-auto min-h-0 max-lg:overflow-visible max-lg:flex-none max-lg:min-h-[32dvh]">
            {fx && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`w-52 h-52 rounded-full enh-flash ${fx === 'destroy' ? 'bg-red-500/40' : fx === 'reset' ? 'bg-rose-500/30' : fx === 'crit' ? 'bg-fuchsia-400/40' : fx === 'success' || fx === 'guaranteed' ? 'bg-amber-300/40' : 'bg-slate-500/15'}`} />
              </div>
            )}
            {displayItem ? (
              <>
                <div className={`relative ${fx ? `enh-${fx}` : ''}`}>
                  {displayItem.image
                    ? <img src={displayItem.image} alt={displayItem.name} className="w-44 h-44 object-cover rounded-2xl border-2 border-edge" />
                    : <div className="w-44 h-44 rounded-2xl border-2 border-edge bg-panel flex items-center justify-center text-7xl">{CAT_ICON[displayItem.category] ?? '◆'}</div>}
                  {level > 0 && <span className={`absolute -top-3 -right-3 text-2xl font-extrabold ${enhanceFxClass(level)}`}>+{level}</span>}
                </div>
                <div className={`mt-5 text-lg font-bold text-center ${gradeNameClass(displayItem.gradeDesc)}`}>{displayItem.name}</div>
                <div className="text-[12px] font-mono text-dim/50 mt-0.5 text-center px-4">
                  {displayItem.gradeDesc || '—'} · {displayItem.category}{displayItem.combatStat ? ` · ${enhancedCombat(displayItem.combatStat, level)?.enhanced ?? displayItem.combatStat}` : ''}
                </div>
                {(displayItem.affix || displayItem.effect) && (
                  <div className="mt-2 w-full max-w-[94%] max-h-[26%] overflow-y-auto onscene-scroll space-y-1.5 text-left">
                    {displayItem.affix && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-mono text-dim/35">词缀</div>
                        {splitAffixEntries(displayItem.affix).map((a, i) => <div key={i} className="text-[11.5px] leading-snug text-amber-200/85 border-l-2 border-amber-400/25 pl-1.5">{a}</div>)}
                      </div>
                    )}
                    {displayItem.effect && (
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-mono text-dim/35">效果</div>
                        {splitAffixEntries(displayItem.effect).map((a, i) => <div key={i} className="text-[11.5px] leading-snug text-slate-300/80 border-l-2 border-god/25 pl-1.5">{a}</div>)}
                      </div>
                    )}
                  </div>
                )}
                {fx && <div className={`mt-3 text-base font-bold ${OUTCOME_CLS[fx]}`}>{OUTCOME_TEXT[fx]}</div>}
                {!fx && isDanger && (
                  <div className="mt-3 text-[12px] font-mono text-blood/80 text-center">⚠ 分解区：强化失败将直接分解（消失）装备{useProtect ? '（已上保护石防护）' : ''}</div>
                )}
                {!fx && !isDanger && isRisk && (
                  <div className="mt-3 text-[12px] font-mono text-rose-400/80 text-center">⚠ 归零区：强化失败将清零回 +0{useProtect ? '（已上保护石防护）' : ''}</div>
                )}
              </>
            ) : (
              <div className="text-center text-dim/40">
                <div className="text-6xl mb-3">⚒</div>
                <div className="text-sm">从右侧选择一件装备开始强化</div>
              </div>
            )}
          </div>

          {/* 下右：操作区（上半滚动 + 底部常驻操作条）*/}
          <div className="flex-1 lg:w-1/2 shrink-0 bg-panel2/30 flex flex-col min-h-0 max-lg:flex-none max-lg:h-auto">
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0 max-lg:flex-none max-lg:overflow-visible">
            {!isHome && (
              <div className="rounded-xl border border-blood/40 bg-blood/10 px-3 py-2 text-[12px] text-blood/90 leading-snug">
                强化所只在轮回乐园 / 专属房间内营业。当前世界「{worldName || '未知'}」无法强化。
              </div>
            )}

            {/* 选择装备 */}
            <div className="rounded-xl border border-edge bg-void p-2">
              <div className="text-[11px] font-mono text-dim/50 mb-1.5 px-1">选择装备（{candidates.length}）</div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {candidates.length === 0
                  ? <div className="text-[12px] text-dim/30 px-1 py-2">背包/身上没有可强化的装备</div>
                  : candidates.map((it) => (
                    <button key={it.id} onClick={() => pickItem(it.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${it.id === session?.itemId ? 'border-god/50 bg-god/10' : 'border-edge/50 hover:bg-panel2'}`}>
                      <span className="text-base shrink-0">{CAT_ICON[it.category] ?? '◆'}</span>
                      <span className={`flex-1 min-w-0 text-[13px] truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                      {(it.enhanceLevel ?? 0) > 0 && <span className={`text-[12px] font-bold shrink-0 ${enhanceColorClass(it.enhanceLevel!)}`}>+{it.enhanceLevel}</span>}
                      {it.equipped && <span className="text-[10px] font-mono text-god/55 shrink-0">装备中</span>}
                    </button>
                  ))}
              </div>
            </div>

            {/* 率/费用/道具 */}
            {selItem && (
              <div className="rounded-xl border border-edge bg-void p-3 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-dim/60">强化等级</span>
                  <span className="font-mono">
                    <span className={enhanceColorClass(level)}>+{level}</span>
                    <span className="text-dim/40"> → </span>
                    <span className={enhanceColorClass(Math.min(level + 1, MAX_ENHANCE))}>+{Math.min(level + 1, MAX_ENHANCE)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-dim/60">成功率{pityReady ? '' : ''}</span>
                  <span className="font-mono text-emerald-300">{pityReady ? '保底 100%' : `${Math.round(dispRate * 100)}%`}</span>
                </div>

                <label className={`flex items-center justify-between gap-2 text-[13px] ${isRisk ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
                  <span className="flex items-center gap-1.5">
                    <input type="checkbox" checked={useProtect && isRisk} disabled={!isRisk} onChange={(e) => setUseProtect(e.target.checked)} className="accent-god" />
                    强化保护石{isRisk ? '（防归零/分解）' : '（+7 起可用）'}
                  </span>
                  <span className="font-mono text-amber-300/80">{protectCost(level, tables).toLocaleString()} 🪙</span>
                </label>
                <label className="flex items-center justify-between gap-2 text-[13px] cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <input type="checkbox" checked={useAmulet} onChange={(e) => setUseAmulet(e.target.checked)} className="accent-god" />
                    强化符 +{Math.round(tables.amuletRateAdd * 100)}%
                  </span>
                  <span className="font-mono text-amber-300/80">{amuletCost(level, tables).toLocaleString()} 🪙</span>
                </label>

                <div className="flex items-center justify-between text-sm border-t border-edge/40 pt-2">
                  <span className="font-mono text-dim/60">本次花费</span>
                  <span className="font-mono text-amber-300 font-bold">{totalCost.toLocaleString()} 🪙</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-mono text-dim/40">乐园币余额</span>
                  <span className={`font-mono ${currency.乐园币 >= totalCost ? 'text-dim/55' : 'text-blood/80'}`}>{currency.乐园币.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* 本轮记录 */}
            {session && session.log.length > 0 && (
              <div className="rounded-xl border border-edge bg-void p-2 flex flex-col min-h-0">
                <div className="text-[11px] font-mono text-dim/50 mb-1 px-1 flex items-center justify-between gap-2">
                  <span>本轮记录</span>
                  <span className="text-dim/40 truncate">成{session.success}·降{session.downgrade}·零{session.reset}·爆{session.destroy}·{session.spent.toLocaleString()}🪙</span>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-0.5 text-[12px] font-mono px-1">
                  {session.log.map((l, i) => (
                    <div key={i} className={OUTCOME_CLS[l.outcome]}>
                      {OUTCOME_TEXT[l.outcome]}{l.level >= 0 ? ` → +${l.level}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>{/* /上半滚动区 */}

            {/* 底部常驻操作条：强化 + 结束强化（永远可见，不被上方内容挤进滚动区）*/}
            {selItem && (
              <div className="shrink-0 border-t border-edge/40 bg-panel2/60 p-3 space-y-2">
                <button onClick={doEnhance} disabled={!canEnhance || finalizing}
                  className={`w-full py-2.5 rounded-xl text-base font-bold transition-all ${canEnhance && !finalizing ? (pityReady ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30' : 'bg-god/20 border border-god/50 text-god hover:bg-god/30') : 'bg-void border border-edge/40 text-dim/30 cursor-not-allowed'}`}>
                  {rolling ? '强化中…' : atMax ? '已满级 +16' : pityReady ? '★ 保底·必成强化 ★' : `⚒ 强化 · ${totalCost.toLocaleString()} 🪙`}
                </button>
                {/* 词缀/效果生成方向（选填）：玩家指定倾向，结束强化时 AI 按此方向生成 */}
                <input
                  type="text" value={tendency} onChange={(e) => setTendency(e.target.value)} disabled={finalizing}
                  placeholder="✎ 词缀/效果方向（选填）：如 攻击类 / 辅助类 / 挖矿类 / 隐匿类"
                  title="结束强化时 AI 会按这个方向生成词缀与效果；留空则结合装备本身自动判定"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-void border border-edge/50 text-[12px] text-slate-200 placeholder:text-dim/35 focus:outline-none focus:border-god/50"
                />
                {(() => {
                  const base = session ? (selItem?.affixLevel ?? session.startMax) : 0;   // 已结算基线（持久化）
                  const peak = session ? Math.max(base, selItem?.maxEnhanceLevel ?? session.curLevel) : 0;
                  const gained = !!session && !session.destroyed && Math.floor(peak / 3) > Math.floor(base / 3);
                  return (
                    <button onClick={endEnhance} disabled={rolling || finalizing}
                      className="w-full py-2.5 rounded-xl text-sm font-bold border border-amber-400/50 text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      {finalizing ? '✨ 正在为您强化装备…' : gained ? `✓ 结束强化 · AI 刷新「${session!.itemName}」+${peak} 词缀` : '✓ 结束强化（退出本轮）'}
                    </button>
                  );
                })()}
                {warn && <div className="text-[12px] font-mono text-blood/80 text-center">{warn}</div>}
              </div>
            )}
          </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/* ── 品级进阶页签（模块级组件：内含受控输入，遵守"受控输入面板别内联子组件"铁则防拼音断字）──
   选装备 → 前端锁定 当前品级→下一档（nextGradeOf）+ 费用（ascendCost）→ 玩家输提示词 →
   AI 生成进阶形态预览（onAscend＝App.runEquipAscendPhase）→ 确认才扣费落库（onAscendConfirm）。 */
function AscendView({ onAscend, onAscendConfirm }: {
  onAscend: (args: { itemId: string; tendency?: string }) => Promise<AscendResult>;
  onAscendConfirm: (preview: AscendPreview) => { ok: boolean; error?: string };
}) {
  const items = useItems((s) => s.items);
  const currency = useItems((s) => s.currency);
  const [selId, setSelId] = useState('');
  const [tendency, setTendency] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AscendPreview | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const candidates = items.filter((it) => isEnhanceable(it.category))
    .sort((a, b) => (Number(b.equipped) - Number(a.equipped)) || ((b.ascendLv ?? 0) - (a.ascendLv ?? 0)));
  const sel = items.find((x) => x.id === selId) ?? null;
  const step = sel ? nextGradeOf(sel.gradeDesc) : null;
  const cost = step ? ascendCost(step.toNum, sel?.category) : 0;
  const wallet = { park: currency.乐园币, soul: currency.灵魂钱币 };
  const pay = step ? planAscendPayment(cost, wallet) : null;   // 乐园币不足时按 1:150000 用魂币补
  const affordable = !!pay;
  const canGo = !!sel && !!step && !busy && affordable;

  async function doAscend(regen = false) {
    if (!sel || !step || busy) return;
    setBusy(true); setErr(''); setDone('');
    if (!regen) setPreview(null);
    try {
      const r = await onAscend({ itemId: sel.id, tendency: tendency.trim() || undefined });
      if (r.ok) setPreview(r.preview);
      else setErr(r.error);
    } finally { setBusy(false); }
  }
  function doConfirm() {
    if (!preview || busy) return;
    const r = onAscendConfirm(preview);
    if (r.ok) { setDone(`✓ 「${preview.name}」已进阶至 ${preview.to}`); setPreview(null); setErr(''); setTendency(''); }
    else setErr(r.error ?? '确认失败');
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
      {/* 选择装备 */}
      <div className="rounded-xl border border-edge bg-void p-2">
        <div className="text-[11px] font-mono text-dim/50 mb-1.5 px-1">选择要进阶的装备（{candidates.length}）</div>
        <div className="max-h-44 overflow-y-auto space-y-1">
          {candidates.length === 0
            ? <div className="text-[12px] text-dim/30 px-1 py-2">背包/身上没有装备</div>
            : candidates.map((it) => (
              <button key={it.id} onClick={() => { setSelId(it.id); setPreview(null); setErr(''); setDone(''); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${it.id === selId ? 'border-purple-400/50 bg-purple-500/10' : 'border-edge/50 hover:bg-panel2'}`}>
                <span className="text-base shrink-0">{CAT_ICON[it.category] ?? '◆'}</span>
                <span className={`flex-1 min-w-0 text-[13px] truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                {(it.ascendLv ?? 0) > 0 && <span className="text-[10px] font-mono text-purple-300/70 shrink-0">进阶×{it.ascendLv}</span>}
                <span className="text-[10px] text-dim/50 shrink-0">{it.gradeDesc || '—'}</span>
                {!isAscendable(it) && <span className="text-[10px] font-mono text-amber-300/60 shrink-0">已顶格</span>}
                {it.equipped && <span className="text-[10px] font-mono text-god/55 shrink-0">装备中</span>}
              </button>
            ))}
        </div>
      </div>

      {/* 费用卡：当前品级 → 下一品级 */}
      {sel && step && (
        <div className="rounded-xl border border-edge bg-void p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-mono text-dim/60">品级</span>
            <span className="font-mono">
              <span className={gradeNameClass(step.from)}>{step.from}</span>
              <span className="text-dim/40"> → </span>
              <span className={gradeNameClass(step.to)}>{step.to}</span>
            </span>
          </div>
          <div className="flex items-start justify-between text-sm gap-2">
            <span className="font-mono text-dim/60 shrink-0">进阶费用</span>
            <span className="font-mono text-amber-300 font-bold text-right">{formatPark(cost)}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-mono text-dim/40">余额</span>
            <span className={`font-mono ${affordable ? 'text-dim/55' : 'text-blood/80'}`}>
              {currency.乐园币.toLocaleString()} 🪙{currency.灵魂钱币 > 0 ? ` · ${currency.灵魂钱币.toLocaleString()} 魂币` : ''}
            </span>
          </div>
          {pay && pay.soulDelta < 0 && (
            <div className="text-[11px] font-mono text-amber-300/60">乐园币不足，将自动动用 {(-pay.soulDelta).toLocaleString()} 魂币（1 魂币 = {SOUL_TO_PARK.toLocaleString()} 乐园币，找零退回乐园币）</div>
          )}
          <div className="text-[10.5px] text-dim/40 leading-snug">费用按该品级装备的公允价差定档（约差价的一半）——同品级装备打满 +16 也需其市价的 25~60%，且进阶必成、无爆装风险。</div>
        </div>
      )}
      {sel && !step && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200/80">「{sel.name}」已是最高品级（创世），无法再进阶。</div>
      )}

      {/* 提示词 + 开始进阶 */}
      <input type="text" value={tendency} onChange={(e) => setTendency(e.target.value)} disabled={busy}
        placeholder="✎ 进阶方向提示词（选填）：如 火焰淬炼 / 深化吸血词缀 / 更名为「XX」…只导方向、不导档次"
        title="AI 会按这个方向写进阶后的形态；留空则按装备本源自然升华；点名「改名/更名」才会改名"
        className="w-full px-2.5 py-1.5 rounded-lg bg-void border border-edge/50 text-[12px] text-slate-200 placeholder:text-dim/35 focus:outline-none focus:border-purple-400/50" />
      <button onClick={() => doAscend(false)} disabled={!canGo}
        className="w-full py-2.5 rounded-xl text-base font-bold border border-purple-400/50 text-purple-200 bg-purple-500/10 hover:bg-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
        {busy ? '🔥 进阶炉炼化中…' : !step ? '🔼 品级进阶（先选一件装备）' : !affordable ? `资金不足 · 需 ${formatPark(cost)}` : `🔼 品级进阶 ${step.from} → ${step.to} · ${formatPark(cost)}`}
      </button>
      <div className="text-[10px] text-dim/40 text-center">先出预览，确认才扣费落库；品级/评分由系统锁定一次+1档，AI 只写进阶后的形态</div>
      {err && <div className="text-[12px] font-mono text-blood/80 text-center">{err}</div>}
      {done && <div className="text-[12px] font-mono text-emerald-300/90 text-center">{done}</div>}

      {/* 进阶预览：确认 / 重新生成 / 取消 */}
      {preview && (
        <div className="rounded-xl border border-purple-400/40 bg-purple-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[15px] font-bold ${gradeNameClass(preview.to)}`}>{preview.name}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded border border-purple-400/40 text-purple-300/90">{preview.from} → {preview.to}</span>
            {preview.renamed && <span className="text-[10px] text-amber-300/70">已更名</span>}
          </div>
          {preview.combatStat && <div className="text-[12px] text-orange-300/90">⚔ {preview.combatStat}</div>}
          {preview.attrBonus && <div className="text-[12px] text-emerald-300/90">✦ {preview.attrBonus}</div>}
          {preview.affix && <div className="text-[12px] text-purple-300/90 space-y-0.5">{splitAffixEntries(preview.affix).map((a, j) => <div key={j} className="border-l-2 border-purple-400/30 pl-1.5">{a}</div>)}</div>}
          {preview.effect && <div className="text-[12px] text-sky-300/80 space-y-0.5">{splitAffixEntries(preview.effect).map((a, j) => <div key={j} className="border-l-2 border-sky-400/30 pl-1.5">{a}</div>)}</div>}
          {preview.intro && <div className="text-[12px] text-dim/70 italic">{preview.intro}</div>}
          {preview.appearance && <div className="text-[11px] text-dim/50">外观：{preview.appearance}</div>}
          {preview.notice && <div className="text-[11px] text-dim/55 border-t border-edge/40 pt-1.5">📜 {preview.notice}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={doConfirm} disabled={busy || !planAscendPayment(preview.cost, wallet)}
              className="flex-1 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 font-semibold text-[13px] hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">✅ 确认进阶 · {formatPark(preview.cost)}</button>
            <button onClick={() => doAscend(true)} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-god/40 text-god/90 text-[13px] hover:bg-god/10 disabled:opacity-40 transition-colors">🔄 重新生成</button>
            <button onClick={() => { setPreview(null); setErr(''); }} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-edge text-dim hover:text-slate-200 text-[13px] disabled:opacity-40 transition-colors">↩ 取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 🔨 工艺页签（模块级组件·同 AscendView 的防拼音断字铁则）─────────────────────
   与「⚒ 强化」正交：强化赌等级、工艺改词条。三条内置工艺线 + 玩家 AI 自创。
   前端摇定结果与全部数值（systems/equipCraft.ts），AI 只补写那一条词缀文本。
   · 确定性工艺（结果唯一）→ 预览 → 确认才扣费
   · 赌博工艺（多结果）→ 一次摇定即时落库，无反悔窗口 */
function CraftView({ onCraft, onCraftConfirm, onExtractEssence, onGenProcess }: {
  onCraft: (args: { itemId: string; processId: string; essenceId?: string; tendency?: string }) => Promise<CraftResult>;
  onCraftConfirm: (preview: CraftPreview) => { ok: boolean; error?: string };
  onExtractEssence: (itemId: string, affixIndex: number) => { ok: boolean; error?: string; name?: string };
  onGenProcess: (prompt: string) => Promise<ProcessGenResult>;
}) {
  const items     = useItems((s) => s.items);
  const currency  = useItems((s) => s.currency);
  const processes = useEquipCraft((s) => s.settings.processes);
  const essences  = useEquipCraft((s) => s.essences);
  const removeProcess = useEquipCraft((s) => s.removeProcess);

  const [procId, setProcId]   = useState('forge');
  const [selId, setSelId]     = useState('');
  const [essId, setEssId]     = useState('');
  const [tendency, setTendency] = useState('');
  const [busy, setBusy]       = useState(false);
  const [preview, setPreview] = useState<CraftPreview | null>(null);
  const [err, setErr]         = useState('');
  const [done, setDone]       = useState('');
  const [genOpen, setGenOpen] = useState(false);
  const [genText, setGenText] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [upBusy, setUpBusy]   = useState('');
  const [extractOpen, setExtractOpen] = useState(false);

  const proc = processes.find((p) => p.id === procId) ?? processes[0] ?? null;
  const sel  = items.find((x) => x.id === selId) ?? null;
  const candidates = items.filter((it) => isEnhanceable(it.category))
    .sort((a, b) => (Number(b.equipped) - Number(a.equipped)) || (potentialLeft(b) - potentialLeft(a)));

  const feas = sel && proc ? canCraft(sel, proc) : { ok: false, reason: '' };
  const cost = sel && proc ? craftCost(proc, sel) : 0;
  const wallet = { park: currency.乐园币, soul: currency.灵魂钱币 };
  const pay = planCraftPayment(cost, wallet);
  const needEssence = proc?.base === 'essence';
  const essence = essences.find((e) => e.id === essId) ?? null;
  const essenceOk = !needEssence || (!!essence && !!sel && canInfuse(essence, sel));
  const gamble = proc ? !isPreviewMode(proc) : false;
  const canGo = !!sel && !!proc && feas.ok && !!pay && essenceOk && !busy;

  const totalWeight = proc ? proc.outcomes.reduce((s, o) => s + o.weight, 0) : 0;
  const ev = proc ? expectedValue(proc.outcomes) : 0;

  async function doCraft() {
    if (!sel || !proc || busy) return;
    setBusy(true); setErr(''); setDone(''); setPreview(null);
    try {
      const r = await onCraft({ itemId: sel.id, processId: proc.id, essenceId: needEssence ? essId : undefined, tendency: tendency.trim() || undefined });
      if (r.ok) {
        setPreview(r.preview);
        if (r.preview.instant) setDone(`${r.preview.processEmoji} ${OUTCOME_LABEL[r.preview.res.outcome]} —— 已落定`);
      } else setErr(r.error);
    } finally { setBusy(false); }
  }
  function doConfirm() {
    if (!preview || busy) return;
    const r = onCraftConfirm(preview);
    if (r.ok) { setDone(`✓ 「${preview.itemName}」${OUTCOME_LABEL[preview.res.outcome]}`); setPreview(null); setErr(''); setTendency(''); }
    else setErr(r.error ?? '确认失败');
  }
  async function doGen() {
    if (!genText.trim() || genBusy) return;
    setGenBusy(true); setErr('');
    try {
      const r = await onGenProcess(genText.trim());
      if (r.ok) { setProcId(r.def.id); setGenOpen(false); setGenText(''); setDone(`✨ 已创制工艺「${r.def.emoji}${r.def.name}」`); }
      else setErr(r.error);
    } finally { setGenBusy(false); }
  }
  async function doUpload(p: CraftProcessDef) {
    if (upBusy) return;
    setUpBusy(p.id); setErr(''); setDone('');
    try {
      await uploadLocal('craftProcess', p.id, { name: p.name, summary: p.desc });
      setDone(`📤 「${p.name}」已上传创意工坊`);
    } catch (e: any) {
      setErr(e?.message ?? '上传失败');
    } finally { setUpBusy(''); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2.5">

      {/* ── 工艺库：内置 + 自创 ── */}
      <div className="rounded-xl border border-edge bg-void p-2">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[11px] font-mono text-dim/50">工艺（{processes.length}）</span>
          <button onClick={() => { setGenOpen((v) => !v); setErr(''); }}
            className="px-2 py-0.5 rounded-lg border border-sky-400/45 text-sky-200 text-[11px] font-bold hover:bg-sky-500/10">
            {genOpen ? '✕ 收起' : '✨ 自创工艺'}
          </button>
        </div>

        {/* 自创工艺：写构想 → AI 填受限参数 → 入库即出现在上面的列表 */}
        {genOpen && (
          <div className="mb-2 rounded-lg border border-sky-400/30 bg-sky-500/5 p-2 space-y-1.5">
            <textarea value={genText} onChange={(e) => setGenText(e.target.value)} disabled={genBusy} rows={3}
              placeholder="✎ 描述你想要的工艺：如「用位面裂隙的碎片打磨，能稳定加一条防御词缀，但很费潜力」／「赌命重铸：小概率跃升品级，大概率崩毁」"
              className="w-full px-2 py-1.5 rounded-lg bg-void border border-edge/50 text-[12px] text-slate-200 placeholder:text-dim/35 focus:outline-none focus:border-sky-400/50 resize-none" />
            <div className="flex items-center gap-2">
              <button onClick={doGen} disabled={genBusy || !genText.trim()}
                className="flex-1 py-1.5 rounded-lg border border-sky-400/50 bg-sky-500/10 text-sky-200 text-[12px] font-bold hover:bg-sky-500/20 disabled:opacity-40">
                {genBusy ? '🔥 设计中…' : '✨ 生成工艺'}
              </button>
            </div>
            <div className="text-[10px] text-dim/40 leading-snug">
              AI 只能填【受限参数】：潜力消耗、费用比例、结果赔率表。数值会被系统夹取，且**净得利越高自动越贵**——
              想写"稳赚"的工艺可以，但它会贵到不划算。生成后即出现在工艺列表，可上传创意工坊分享。
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-1.5">
          {processes.map((p) => {
            const on = p.id === proc?.id;
            return (
              <button key={p.id} onClick={() => { setProcId(p.id); setPreview(null); setErr(''); setDone(''); }}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${on ? 'border-sky-400/50 bg-sky-500/10' : 'border-edge/50 hover:bg-panel2'}`}>
                <span className="text-base shrink-0 leading-tight">{p.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`text-[13px] font-bold truncate ${on ? 'text-sky-200' : 'text-slate-200'}`}>{p.name}</span>
                    {!p.builtin && <span className="text-[9.5px] font-mono text-amber-300/60 shrink-0">自创</span>}
                    {!isPreviewMode(p) && <span className="text-[9.5px] font-mono text-blood/70 shrink-0">赌</span>}
                  </span>
                  <span className="block text-[10.5px] text-dim/50 leading-snug line-clamp-2">{p.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 选中工艺详情：风味 + 消耗 + 赔率表 ── */}
      {proc && (
        <div className="rounded-xl border border-edge bg-void p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-sky-200">{proc.emoji} {proc.name}</span>
            <span className={`text-[10.5px] px-1.5 py-0.5 rounded border ${gamble ? 'border-blood/45 text-blood/85' : 'border-emerald-500/45 text-emerald-300/85'}`}>
              {gamble ? '赌博工艺 · 一次摇定不可撤销' : '确定性工艺 · 先预览后确认'}
            </span>
            {!proc.builtin && (
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => doUpload(proc)} disabled={!!upBusy}
                  className="px-1.5 py-0.5 rounded border border-god/40 text-god/85 text-[10.5px] hover:bg-god/10 disabled:opacity-40">
                  {upBusy === proc.id ? '上传中…' : '📤 上传工坊'}
                </button>
                <button onClick={() => { if (confirm(`删除自创工艺「${proc.name}」？`)) { removeProcess(proc.id); setProcId('forge'); } }}
                  className="px-1.5 py-0.5 rounded border border-edge text-dim/60 text-[10.5px] hover:text-blood hover:border-blood/40">🗑</button>
              </span>
            )}
          </div>
          {proc.flavor && <div className="text-[11.5px] text-dim/60 leading-relaxed italic border-l-2 border-sky-400/25 pl-2">{proc.flavor}</div>}

          <div className="flex items-center gap-3 flex-wrap text-[12px] font-mono">
            <span className="text-dim/55">潜力消耗 <span className="text-sky-300 font-bold">{proc.potCost}</span></span>
            <span className="text-dim/55">费用 <span className="text-amber-300 font-bold">{sel ? formatPark(cost) : `该档公允价 ×${proc.costRatio}`}</span></span>
            {proc.gradeMin && <span className="text-dim/55">门槛 <span className="text-purple-300">{ITEM_GRADES[proc.gradeMin - 1]}+</span></span>}
            {!proc.builtin && <span className={`${ev > 0.5 ? 'text-amber-300/70' : 'text-dim/40'}`}>期望 {ev > 0 ? '+' : ''}{ev.toFixed(1)}{ev > 0.5 ? '（已按净得利加价）' : ''}</span>}
          </div>

          {/* 赔率表：多结果才显示（确定性工艺只有一种结果，没什么可看的）*/}
          {gamble && (
            <div className="space-y-1 pt-0.5">
              {[...proc.outcomes].sort((a, b) => b.weight - a.weight).map((o) => {
                const pct = totalWeight > 0 ? (o.weight / totalWeight) * 100 : 0;
                const good = ['gradeUp', 'addAffix', 'upgradeAffix', 'combatUp'].includes(o.kind);
                const bad = ['brick', 'gradeDown', 'removeAffix', 'combatDown'].includes(o.kind);
                return (
                  <div key={o.kind} className="flex items-center gap-2">
                    <span className={`text-[11px] w-24 shrink-0 ${good ? 'text-emerald-300/85' : bad ? 'text-blood/80' : 'text-dim/50'}`}>{OUTCOME_LABEL[o.kind]}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-panel2 overflow-hidden">
                      <span className={`block h-full rounded-full ${good ? 'bg-emerald-400/60' : bad ? 'bg-blood/60' : 'bg-dim/30'}`} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[10.5px] font-mono text-dim/45 w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 选装备 + 锻造潜力 ── */}
      <div className="rounded-xl border border-edge bg-void p-2">
        <div className="text-[11px] font-mono text-dim/50 mb-1.5 px-1">选择装备（{candidates.length}）· 条=剩余锻造潜力</div>
        <div className="max-h-40 overflow-y-auto space-y-1">
          {candidates.length === 0
            ? <div className="text-[12px] text-dim/30 px-1 py-2">背包/身上没有装备</div>
            : candidates.map((it) => {
              const left = potentialLeft(it); const max = potentialMax(it);
              const st = craftStateOf(it);
              return (
                <button key={it.id} onClick={() => { setSelId(it.id); setPreview(null); setErr(''); setDone(''); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${it.id === selId ? 'border-sky-400/50 bg-sky-500/10' : 'border-edge/50 hover:bg-panel2'}`}>
                  <span className="text-base shrink-0">{CAT_ICON[it.category] ?? '◆'}</span>
                  <span className={`flex-1 min-w-0 text-[13px] truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                  {st.corrupted && <span className="text-[10px] font-mono text-blood/70 shrink-0">{st.bricked ? '☠残骸' : '☠已腐蚀'}</span>}
                  <span className="w-16 h-1.5 rounded-full bg-panel2 overflow-hidden shrink-0" title={`锻造潜力 ${left}/${max}`}>
                    <span className={`block h-full rounded-full ${left === 0 ? 'bg-blood/50' : left <= max * 0.3 ? 'bg-amber-400/60' : 'bg-sky-400/60'}`} style={{ width: `${(left / max) * 100}%` }} />
                  </span>
                  <span className="text-[10px] font-mono text-dim/45 w-9 text-right shrink-0">{left}/{max}</span>
                  {it.equipped && <span className="text-[10px] font-mono text-god/55 shrink-0">装备中</span>}
                </button>
              );
            })}
        </div>
        {sel && craftStateOf(sel).history?.length ? (
          <div className="mt-1.5 pt-1.5 border-t border-edge/40 text-[10.5px] font-mono text-dim/40 leading-snug">
            履历：{craftStateOf(sel).history!.slice(0, 4).join(' ／ ')}
          </div>
        ) : null}
      </div>

      {/* ── 精髓图鉴：提取（拆解装备）+ 灌注选择 ── */}
      <div className="rounded-xl border border-edge bg-void p-2">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[11px] font-mono text-dim/50">🧪 精髓图鉴（{essences.length}）· 永久留存、可反复灌注</span>
          <button onClick={() => { setExtractOpen((v) => !v); setErr(''); }}
            className="px-2 py-0.5 rounded-lg border border-purple-400/45 text-purple-200 text-[11px] font-bold hover:bg-purple-500/10">
            {extractOpen ? '✕ 收起' : '⚗ 提取精髓'}
          </button>
        </div>

        {/* 提取：选中装备的每条词缀一个按钮，点了就拆解装备并录入图鉴 */}
        {extractOpen && (
          <div className="mb-2 rounded-lg border border-purple-400/30 bg-purple-500/5 p-2 space-y-1.5">
            {!sel ? (
              <div className="text-[12px] text-dim/45">先在上面选一件装备，再挑要抽出的词缀。</div>
            ) : splitAffixEntries(sel.affix).length === 0 ? (
              <div className="text-[12px] text-dim/45">「{sel.name}」没有词缀可提取。</div>
            ) : (
              <>
                <div className="text-[11px] text-amber-300/70 leading-snug">⚠ 提取会**消耗掉「{sel.name}」本体**，只把选中的那一条词缀永久录入图鉴。</div>
                {splitAffixEntries(sel.affix).map((a, i) => (
                  <button key={i} onClick={() => {
                    if (!confirm(`拆解「${sel.name}」，把这条词缀录入精髓图鉴？\n\n${a}\n\n装备本体将被消耗，此操作不可撤销。`)) return;
                    const r = onExtractEssence(sel.id, i);
                    if (r.ok) { setDone(`⚗ 已录入精髓【${r.name}】`); setSelId(''); setErr(''); }
                    else setErr(r.error ?? '提取失败');
                  }}
                    className="w-full text-left px-2 py-1.5 rounded-lg border border-edge/50 hover:border-purple-400/50 hover:bg-purple-500/10 text-[12px] text-amber-200/85 leading-snug transition-colors">
                    ⚗ {a}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {essences.length === 0 ? (
          <div className="text-[12px] text-dim/30 px-1 py-1">图鉴还是空的 —— 拆解一件带词缀的装备即可录入第一条精髓。</div>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-1">
            {essences.map((e) => {
              const on = e.id === essId;
              const blocked = !!sel && !canInfuse(e, sel);
              return (
                <button key={e.id} onClick={() => { setEssId(on ? '' : e.id); setErr(''); }}
                  className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${on ? 'border-purple-400/50 bg-purple-500/10' : 'border-edge/50 hover:bg-panel2'} ${blocked ? 'opacity-45' : ''}`}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12px] text-amber-200/85 leading-snug line-clamp-2">{e.text}</span>
                    <span className="block text-[10px] font-mono text-dim/40 mt-0.5">
                      出自「{e.fromItem}」· <span className={gradeNameClass(e.fromGrade)}>{e.fromGrade}</span>
                      {blocked && <span className="text-blood/70"> · 目标品级低太多（最多差 {ESSENCE_GRADE_GAP} 档）</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {needEssence && !essence && <div className="mt-1.5 text-[11px] font-mono text-amber-300/70 px-1">↑「{proc?.name}」需要先选一条要灌注的精髓</div>}
      </div>

      {/* ── 倾向 + 执行 ── */}
      <input type="text" value={tendency} onChange={(e) => setTendency(e.target.value)} disabled={busy}
        placeholder="✎ 词缀方向提示词（选填）：如 偏向防御 / 呼应火焰 / 采集向…只导方向、不导强度"
        className="w-full px-2.5 py-1.5 rounded-lg bg-void border border-edge/50 text-[12px] text-slate-200 placeholder:text-dim/35 focus:outline-none focus:border-sky-400/50" />
      <button onClick={doCraft} disabled={!canGo}
        className={`w-full py-2.5 rounded-xl text-base font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${gamble ? 'border-blood/50 text-blood/90 bg-blood/10 hover:bg-blood/20' : 'border-sky-400/50 text-sky-200 bg-sky-500/10 hover:bg-sky-500/20'}`}>
        {busy ? '🔥 工台施艺中…'
          : !sel ? '🔨 施加工艺（先选一件装备）'
          : !feas.ok ? (feas.reason ?? '无法施加')
          : !pay ? `资金不足 · 需 ${formatPark(cost)}`
          : !essenceOk ? '请先选一条可灌注的精髓'
          : `${proc?.emoji} ${proc?.name} · 潜力-${proc?.potCost} · ${formatPark(cost)}`}
      </button>
      <div className="text-[10px] text-dim/40 text-center leading-snug">
        {gamble
          ? '⚠ 赌博工艺：点下即摇定并扣费，结果不可撤销、无预览'
          : '确定性工艺：先出预览，确认才扣费落库'}
        {' · '}潜力耗尽后这件装备再不能施艺（品级进阶会抬高潜力上限）
      </div>
      {err && <div className="text-[12px] font-mono text-blood/80 text-center">{err}</div>}
      {done && <div className="text-[12px] font-mono text-emerald-300/90 text-center">{done}</div>}

      {/* ── 结果卡：确定性工艺=待确认预览；赌博工艺=已落定的战报 ── */}
      {preview && (
        <div className={`rounded-xl border p-3 space-y-2 ${preview.res.outcome === 'brick' ? 'border-blood/50 bg-blood/5' : 'border-sky-400/40 bg-sky-500/5'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-slate-100">{preview.processEmoji} {preview.itemName}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
              ['gradeUp', 'addAffix', 'upgradeAffix', 'combatUp'].includes(preview.res.outcome) ? 'border-emerald-500/45 text-emerald-300/90'
              : ['brick', 'gradeDown', 'removeAffix', 'combatDown'].includes(preview.res.outcome) ? 'border-blood/45 text-blood/90'
              : 'border-edge text-dim/60'}`}>
              {OUTCOME_LABEL[preview.res.outcome]}
            </span>
            {preview.instant && <span className="text-[10px] font-mono text-dim/45">已落定</span>}
          </div>

          {preview.res.gradeFrom && preview.res.gradeTo && (
            <div className="text-[12.5px] font-mono">
              <span className={gradeNameClass(preview.res.gradeFrom)}>{preview.res.gradeFrom}</span>
              <span className="text-dim/40"> → </span>
              <span className={gradeNameClass(preview.res.gradeTo)}>{preview.res.gradeTo}</span>
            </div>
          )}
          {preview.res.combatPct != null && (
            <div className={`text-[12.5px] font-mono ${preview.res.combatPct > 0 ? 'text-orange-300/90' : 'text-blood/80'}`}>
              ⚔ 攻防基础值 {preview.res.combatPct > 0 ? '+' : ''}{preview.res.combatPct}%
            </div>
          )}
          {preview.res.affixTarget && preview.res.outcome === 'removeAffix' && (
            <div className="text-[12px] text-blood/70 line-through leading-snug border-l-2 border-blood/30 pl-2">{preview.res.affixTarget}</div>
          )}
          {preview.res.affixTarget && preview.res.outcome !== 'removeAffix' && (
            <div className="text-[11px] text-dim/40 leading-snug border-l-2 border-edge pl-2">原：{preview.res.affixTarget}</div>
          )}
          {preview.aiAffix && (
            <div className="text-[13px] text-amber-200/90 leading-relaxed border-l-2 border-amber-400/35 pl-2">{preview.aiAffix}</div>
          )}
          {preview.res.outcome === 'brick' && (
            <div className="text-[12px] text-blood/85 leading-snug">☠ 这件装备已崩毁成残骸：此后无法再施加任何工艺（强化仍可进行）。</div>
          )}
          {preview.res.outcome === 'nothing' && <div className="text-[12px] text-dim/50">工台空转，什么也没有发生 —— 费用与潜力照收。</div>}
          {preview.notice && <div className="text-[11px] text-dim/55 border-t border-edge/40 pt-1.5">📜 {preview.notice}</div>}

          <div className="flex gap-2 pt-1">
            {preview.instant ? (
              <button onClick={() => { setPreview(null); setErr(''); }}
                className="w-full py-2 rounded-lg border border-god/50 text-god bg-god/10 text-[13px] font-semibold hover:bg-god/20 transition-colors">确定</button>
            ) : (
              <>
                <button onClick={doConfirm} disabled={busy || !planCraftPayment(preview.res.cost, wallet)}
                  className="flex-1 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 font-semibold text-[13px] hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">✅ 落定 · {formatPark(preview.res.cost)}</button>
                <button onClick={doCraft} disabled={busy}
                  className="flex-1 py-2 rounded-lg border border-god/40 text-god/90 text-[13px] hover:bg-god/10 disabled:opacity-40 transition-colors">🔄 重写词缀</button>
                <button onClick={() => { setPreview(null); setErr(''); }} disabled={busy}
                  className="flex-1 py-2 rounded-lg border border-edge text-dim hover:text-slate-200 text-[13px] disabled:opacity-40 transition-colors">↩ 取消</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
