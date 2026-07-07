import { useState, useEffect, useRef } from 'react';
import { useItems, gradeNameClass, splitAffixEntries, type InventoryItem } from '../store/itemStore';
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
import GemPanel from './GemPanel';
import { pushSceneNotice } from '../systems/allocNotice';   // 场外强化结果 → 正文前置须知（按真实等级，勿凭货币"尝试等级"误判）

export interface EnhanceFinalizeArgs { itemId: string; startLevel: number; newLevel: number; tendency?: string; }
export interface FinalizeStatus { ok: boolean; changed: boolean; error?: string; }

/* 词缀/效果拆条复用 itemStore 的 splitAffixEntries（吃字符串/数组/对象/JSON 串，绝不吐 [object Object]），
   不再本地弱实现——旧本地版对对象只 String() → 频道交易物品在强化所也会显示 [object Object]。 */

/* 强化所：左=看板娘立绘+切换+吐槽气泡 / 中=被强化装备+特效 / 右=操作区+本轮记录。
   仅乐园内（轮回乐园/专属房间）可强化；摇率/爆装/降级/保底全在 enhanceEngine 算，不花 API。
   两个 AI 点（吐槽 onBanter / 收尾 onFinalize）由 App 提供，读 store.session 自行拼 prompt。 */
export default function EnhancePanel({
  onClose, onBanter, onFinalize,
}: {
  onClose: () => void;
  onBanter: () => Promise<string>;
  onFinalize: (args: EnhanceFinalizeArgs) => Promise<FinalizeStatus | void> | void;
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
      </div>
    </div>
  );
}
