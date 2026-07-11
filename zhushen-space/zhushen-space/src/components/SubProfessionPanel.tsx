import { useEffect, useState } from 'react';
import { useSubProfTree, isRecipeNode, subProfMastery } from '../store/subProfTreeStore';
import { usePinchPanZoom } from '../systems/usePinchPanZoom';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useCharacters, type SubProfession, type Recipe } from '../store/characterStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { SUBPROF_QUALIA_PROMPT } from '../promptRules';
import {
  canRankUp, availablePP, potentialBudget, treeProgressStats, effectiveTierName,
  nodeRank, nodeMaxRank, SKILLTREE_TUNING, coinPerPP,
} from '../systems/skillTree';
import TreeCanvas from './TreeCanvas';

/* 副职业面板（主角 B1）：径向【配方星图】——花潜能点(与技能树共用一池)点亮节点；配方节点学/钻研质变【配方】(只进配方清单、不进技能/天赋栏)。
   副职业熟练度 = 在该副职业配方树上累计耗费的潜能点(阶梯档)，越高配方熟练度涨得越快；微星=纯花点(磨练手艺)。
   顶部切「⭐配方星图 / 📋已学配方(可增删改)」两视图。 */

const TIER_CLS: Record<string, string> = {
  新手: 'text-slate-400 border-slate-500/50', 熟练: 'text-emerald-300 border-emerald-600/50',
  专家: 'text-sky-300 border-sky-600/50', 大师: 'text-violet-300 border-violet-600/50', 宗师: 'text-amber-300 border-amber-500/50',
};
const BAR_CLS: Record<string, string> = { 新手: 'bg-slate-400', 熟练: 'bg-emerald-400', 专家: 'bg-sky-400', 大师: 'bg-violet-400', 宗师: 'bg-amber-400' };
const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-god/50';

function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('、');
  if (typeof v === 'object') return Object.values(v).map(asText).filter(Boolean).join('、');
  return String(v);
}
function Bar({ value, cls }: { value: number; cls: string }) {
  return (
    <div className="h-1.5 bg-void rounded-full overflow-hidden border border-edge/40">
      <div className={`h-full ${cls} transition-all`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* 抠 JSON：优先代码块 → 末尾配平括号 → 兜底首{到末} */
function extractJson(text: string): string {
  let s = String(text ?? '');
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let k = fences.length - 1; k >= 0; k--) { const blk = fences[k][1].trim(); if (blk.includes('{')) { s = blk; break; } }
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  const end = s.lastIndexOf('}');
  if (end >= 0) { let depth = 0; for (let k = end; k >= 0; k--) { const c = s[k]; if (c === '}') depth++; else if (c === '{') { depth--; if (depth === 0) return s.slice(k, end + 1); } } }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  return (i >= 0 && j > i) ? s.slice(i, j + 1) : s;
}

export default function SubProfessionPanel({ onClose }: { onClose: () => void }) {
  const trees = useSubProfTree((s) => s.trees);
  const prog = useSubProfTree((s) => s.progress['B1']);
  const setActiveTree = useSubProfTree((s) => s.setActiveTree);
  const profile = usePlayer((s) => s.profile);
  const parkCoin = useItems((s) => s.currency['乐园币'] ?? 0);
  const subProfs = useCharacters((s) => s.characters['B1']?.subProfessions ?? []);

  const [view, setView] = useState<'tree' | 'recipes'>('tree');
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const { scrollRef, zoom, grabbing, bind, zoomBy, reset } = usePinchPanZoom();   // 画布平移+缩放（桌面滚轮/拖动 · 手机双指捏合/单指拖）
  const [, force] = useState(0);
  const [msg, setMsg] = useState('');
  const [qualiaBusy, setQualiaBusy] = useState<string | undefined>(undefined);   // 正在质变的节点 id
  const [confirmQid, setConfirmQid] = useState<string | undefined>(undefined);

  const treeList = Object.values(trees);
  const activeId = prog?.activeTreeId;
  const tree = activeId ? trees[activeId] : undefined;

  useEffect(() => {
    if (activeId && trees[activeId]) return;
    if (!treeList.length) return;
    const match = treeList.find((t) => subProfs.some((sp) => sp.name === t.profession));
    setActiveTree('B1', (match ?? treeList[0]).id);
  }, [activeId, treeList.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = { level: profile.level, tier: profile.tier, charId: 'B1', ignoreTierGate: true };   // 副职业树取消阶位限制
  const ranks = prog?.ranks ?? {};
  const availableIds = new Set((tree?.nodes ?? []).filter((n) => canRankUp(tree, n.id, prog, ctx).ok).map((n) => n.id));
  const avail = availablePP(prog, ctx);
  const budget = potentialBudget(profile.level, profile.tier);
  const stats = treeProgressStats(tree, prog);
  const effTier = effectiveTierName(profile.tier, profile.level);
  const recipeLabel = tree?.recipeLabel || '配方';
  const mastery = tree ? subProfMastery(tree.profession, 'B1') : undefined;   // 当前副职业熟练度档

  const exBase = coinPerPP(profile.tier, profile.level);
  const exBought = prog?.exchangedPP ?? 0;
  const exPrice = Math.max(1, Math.round(exBase * Math.pow(SKILLTREE_TUNING.ppCoinStep, exBought)));
  let exAffordable = 0, _acc = 0;
  while (exAffordable < 999) {
    const p = Math.max(1, Math.round(exBase * Math.pow(SKILLTREE_TUNING.ppCoinStep, exBought + exAffordable)));
    if (_acc + p > parkCoin) break;
    _acc += p; exAffordable++;
  }

  const selNode = tree?.nodes.find((n) => n.id === selId);
  const selChk = selNode && tree ? canRankUp(tree, selNode.id, prog, ctx) : undefined;
  const selRank = selNode ? nodeRank(prog, selNode.id) : 0;
  const selMaxR = selNode ? nodeMaxRank(selNode) : 0;
  const selIsRecipe = isRecipeNode(selNode);
  const selRecipe = selNode?.grants?.recipe;
  const selIsQualia = selIsRecipe && selRank >= 1;   // 配方已学、再投点 = AI 质变

  // AI 质变当前配方（rank≥1 再投点）：输入当前配方 → 升级版（提产出/品质/效果/加新效果）
  const aiQualia = async () => {
    if (!selNode || !selRecipe) return;
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('subproftree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { setMsg('未配置 AI 接口（设置→副职业设置 / 综合设置）'); setTimeout(() => setMsg(''), 3000); return; }
    const cur = (useCharacters.getState().characters['B1']?.subProfessions ?? []).find((sp) => sp.name === tree!.profession)?.recipes?.find((r) => r.name === selRecipe.name) ?? selRecipe;
    setConfirmQid(undefined); setQualiaBusy(selNode.id); setMsg('配方质变中…（AI 升级产出/品质/效果）');
    try {
      const once = (extra?: Record<string, unknown>) => apiChatFallback(chain, [
        { role: 'system', content: SUBPROF_QUALIA_PROMPT },
        { role: 'user', content: `当前配方（质变前·完整信息）：\n${JSON.stringify({ name: cur.name, tier: cur.tier, materials: cur.materials, output: cur.output, desc: cur.desc })}\n\n请据【质变铁则】把它质变升级，只输出升级后的 JSON。` },
      ], { timeoutMs: 150000, extra });
      let content: string;
      try { ({ content } = await once({ tools: [{ google_search: {} }] })); } catch { ({ content } = await once(undefined)); }
      const raw: any = lenientJsonParse(extractJson(content));
      if (raw && typeof raw === 'object' && (raw.output || raw.tier || raw.materials)) {
        const ok = useSubProfTree.getState().applyRecipeUpgrade('B1', selNode.id, { tier: raw.tier, materials: raw.materials, output: raw.output, desc: raw.desc });
        setMsg(ok ? '✓ 配方质变完成！产出更强、熟练度+' : '质变失败');
      } else setMsg('质变失败（未返回有效内容）');
    } catch (e: any) { setMsg('质变失败：' + (e?.message || String(e))); }
    finally { setQualiaBusy(undefined); setTimeout(() => setMsg(''), 3500); }
  };

  const doRankUp = () => {
    if (!selNode) return;
    if (selIsQualia) { setConfirmQid(selNode.id); return; }   // 质变需二次确认（调 AI·计费）
    if (!canRankUp(tree, selNode.id, prog, ctx).ok) return;
    const ok = useSubProfTree.getState().rankUpNode('B1', selNode.id);
    if (ok) { setMsg(selIsRecipe ? `✓ 学会${recipeLabel}：${selRecipe?.name ?? selNode.name}` : '✓ 基本功精进（副职业熟练度+）'); setTimeout(() => setMsg(''), 2800); }
    setSelId(selNode.id);
  };
  const doExchange = (n: number) => { if (useSubProfTree.getState().exchangePP('B1', n) > 0) force((x) => x + 1); };
  const totalRecipes = subProfs.reduce((a, sp) => a + (sp.recipes?.length ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-[95vw] max-h-[94dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg">🛠</span>
              <h2 className="text-base font-bold text-slate-100">副职业</h2>
              {tree && view === 'tree' && <span className="text-[13px] font-mono text-dim/50">已点 {stats.unlocked}/{stats.total} 节点</span>}
              {mastery && view === 'tree' && <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${TIER_CLS[mastery.tier] ?? TIER_CLS['新手']}`}>副职业熟练度·{mastery.tier}</span>}
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">花<span className="text-lime-300">潜能点</span>（与技能树共用一池）：<span className="text-slate-300">{recipeLabel}</span>节点首点学配方、再投点 AI 质变；微星纯磨练手艺。副职业熟练度=树上累计潜能点（档越高配方熟练度涨越快·{mastery ? `当前×${mastery.growthMul}` : ''}）。有效阶位 <span className="text-slate-300">{effTier}</span>。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-[11px] text-dim/50 font-mono">可用潜能(共享)</div>
              <div className="text-lg font-bold text-lime-300 leading-none">{avail}</div>
              <div className="text-[10px] text-dim/40 font-mono">升级{budget}·额外{prog?.aiBonusPP ?? 0}·本树已用{prog?.spent ?? 0}</div>
            </div>
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono ml-1">✕</button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 max-lg:gap-y-2 px-4 py-2 border-b border-edge/60 shrink-0">
          <div className="flex items-center rounded-lg border border-edge overflow-hidden">
            <button onClick={() => setView('tree')} className={`px-3 py-1 text-[12px] font-mono ${view === 'tree' ? 'bg-god/15 text-god' : 'text-dim hover:text-slate-200'}`}>⭐ 配方星图</button>
            <button onClick={() => setView('recipes')} className={`px-3 py-1 text-[12px] font-mono border-l border-edge ${view === 'recipes' ? 'bg-god/15 text-god' : 'text-dim hover:text-slate-200'}`}>📋 已学配方 {totalRecipes}</button>
          </div>
          {view === 'tree' && <>
            <span className="text-[12px] text-dim/60 font-mono ml-1">副职业树</span>
            <select value={activeId ?? ''} onChange={(e) => { setActiveTree('B1', e.target.value); setSelId(undefined); }}
              className="bg-panel2 border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50">
              {!treeList.length && <option value="">（暂无·去设置→副职业设置创建）</option>}
              {treeList.map((t) => <option key={t.id} value={t.id}>{t.title || t.profession}</option>)}
            </select>
            {tree && mastery && (
              <span className="flex items-center gap-1.5 text-[11px] text-dim/60">
                <span className="font-mono">熟练度</span>
                <span className="w-28"><Bar value={mastery.pct} cls={BAR_CLS[mastery.tier] ?? BAR_CLS['新手']} /></span>
                <span className="font-mono">{mastery.spent}{mastery.nextMin != null ? `/${mastery.nextMin}` : '·满'}点</span>
              </span>
            )}
            {tree && (
              <div className="ml-auto flex flex-wrap items-center gap-3 max-lg:ml-0 max-lg:w-full max-lg:justify-end">
                <div className="flex items-center gap-1">
                  <button onClick={() => zoomBy(-0.2)} aria-label="缩小" className="w-7 h-7 max-lg:w-9 max-lg:h-9 rounded border border-edge text-dim hover:text-slate-200 font-mono">－</button>
                  <button onClick={reset} className="px-2 h-7 max-lg:h-9 rounded border border-edge text-[11px] font-mono text-dim hover:text-slate-200" title="重置缩放（手机可双指捏合缩放）">{Math.round(zoom * 100)}%</button>
                  <button onClick={() => zoomBy(0.2)} aria-label="放大" className="w-7 h-7 max-lg:w-9 max-lg:h-9 rounded border border-edge text-dim hover:text-slate-200 font-mono">＋</button>
                </div>
                <button onClick={() => doExchange(1)} disabled={exAffordable < 1} title={`兑换下一点 = ${exPrice.toLocaleString()} 乐园币`}
                  className="text-[12px] font-mono text-amber-300/90 hover:text-amber-200 border border-amber-600/40 rounded px-2 py-1 disabled:opacity-40">
                  ⇄ 兑换潜能点<span className="text-[10px] text-dim/50 ml-1">可兑{exAffordable}</span>
                </button>
              </div>
            )}
          </>}
        </div>

        {view === 'tree' ? (
          <>
            <div ref={scrollRef}
              className={`flex-1 overflow-auto p-3 touch-none ${tree ? (grabbing ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              {...(tree ? bind : {})}>
              {!tree && <div className="text-center text-dim/40 text-sm py-16">还没有副职业树。到「设置 → 变量管理 → 副职业设置」里创建或 AI 生成一套，或从内置炼金术/锻造开始。</div>}
              {tree && <TreeCanvas tree={tree} ranks={ranks} availableIds={availableIds} mode="play" selectedId={selId} onNodeClick={setSelId} zoom={zoom} heightVh={76} />}
            </div>

            {selNode && (
              <div className="border-t border-edge p-4 shrink-0 max-h-[40dvh] overflow-y-auto bg-panel2/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-100">{asText(selNode.name)}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-dim/70">
                        {selIsRecipe ? (selNode.kind === 'capstone' ? `宗师级${recipeLabel}` : selNode.kind === 'major' ? `招牌${recipeLabel}` : `${recipeLabel}`) : '基本功'}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-sky-600/50 text-sky-300 font-mono">点数 {selRank}/{selMaxR}</span>
                      {selNode.tierGate && <span className="text-[11px] px-1.5 py-0.5 rounded border border-violet-600/50 text-violet-300 font-mono">需 {selNode.tierGate}</span>}
                      {!!selNode.spentGate && <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-amber-300/80 font-mono">需累计 {selNode.spentGate} 点</span>}
                    </div>
                    {selNode.desc && <p className="text-[13px] text-dim/70 mt-1 leading-relaxed">{asText(selNode.desc)}</p>}
                  </div>
                  <button onClick={doRankUp} disabled={!selChk?.ok || !!qualiaBusy}
                    className={`shrink-0 px-4 py-1.5 rounded text-[13px] font-mono transition-colors ${(selChk?.ok && !qualiaBusy)
                      ? (selIsQualia ? 'border border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-500/10 hover:bg-fuchsia-500/20' : 'border border-lime-500/50 text-lime-300 bg-lime-500/10 hover:bg-lime-500/20')
                      : 'border border-edge text-dim/40 cursor-not-allowed'}`}>
                    {qualiaBusy === selNode.id ? '质变中…' : selIsQualia ? '⬆ 钻研·质变' : selIsRecipe ? `学会${recipeLabel}` : selRank === 0 ? '研习' : '＋练一次'} <span className="text-[11px] opacity-70">潜能 {selNode.cost}</span>
                  </button>
                </div>
                {!selChk?.ok && selChk?.reason && <p className="text-[12px] text-amber-400/80 mt-1.5">⚠ {selChk.reason}</p>}
                {confirmQid === selNode.id && selIsQualia && qualiaBusy !== selNode.id && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[12px] text-fuchsia-300">确认钻研质变此配方？将调用 AI（计费）升级产出/品质/效果。</span>
                    <button onClick={aiQualia} className="px-3 py-1 rounded border border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-[12px] font-mono">确认（调用 AI）</button>
                    <button onClick={() => setConfirmQid(undefined)} className="px-2 py-1 rounded border border-edge text-dim text-[12px] font-mono">取消</button>
                  </div>
                )}
                {selIsQualia && confirmQid !== selNode.id && qualiaBusy !== selNode.id && !msg && (
                  <p className="text-[12px] text-fuchsia-300/70 mt-1.5">↑ 已学会此配方，再投一点将调用 AI【质变】它（提产出/品质/效果·加新效果），配方熟练度同步上涨。</p>
                )}
                {msg && <p className="text-[12px] text-fuchsia-300 mt-1.5">{msg}</p>}
                {selRecipe && (
                  <div className="mt-3 rounded-lg border border-emerald-700/40 bg-emerald-950/15 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-emerald-200">📜 {asText(selRecipe.name)}</span>
                      {selRecipe.tier && <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-600/40 text-emerald-300/90">{asText(selRecipe.tier)}</span>}
                    </div>
                    {selRecipe.materials && <div className="text-[12px] text-slate-300/85"><span className="text-dim/45">材料·</span>{asText(selRecipe.materials)}</div>}
                    {selRecipe.output && <div className="text-[12px] text-slate-300/85"><span className="text-dim/45">产物·</span>{asText(selRecipe.output)}</div>}
                    {selRecipe.desc && <div className="text-[12px] text-dim/55 italic">{asText(selRecipe.desc)}</div>}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {subProfs.length === 0 && <div className="text-center text-dim/40 text-sm py-12">还没有副职业。在「配方星图」里点亮配方节点习得（副职业只能经配方树获得，不会从正文凭空添加）。</div>}
            {subProfs.map((sp) => <SubProfCard key={sp.name} sp={sp} mastery={subProfMastery(sp.name, 'B1')} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SubProfCard({ sp, mastery }: { sp: SubProfession; mastery: ReturnType<typeof subProfMastery> }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const addRecipe = useCharacters((s) => s.addRecipe);
  const removeRecipe = useCharacters((s) => s.removeRecipe);
  const tcls = TIER_CLS[mastery.tier] ?? TIER_CLS['新手'];
  const bcls = BAR_CLS[mastery.tier] ?? BAR_CLS['新手'];
  const recipes = sp.recipes ?? [];
  const label = sp.recipeLabel || '配方';
  return (
    <div className={`rounded-xl border p-3 space-y-2 bg-panel ${tcls}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{sp.name}</span>
        {sp.category && <span className="text-[11px] font-mono text-dim/50">{sp.category}</span>}
        <span className={`text-[12px] font-mono font-bold ${tcls.split(' ')[0]}`}>{mastery.tier}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-dim/50 shrink-0">副职业熟练度</span>
        <div className="flex-1"><Bar value={mastery.pct} cls={bcls} /></div>
        <span className="text-[11px] font-mono text-dim/60 shrink-0 w-16 text-right">{mastery.spent}{mastery.nextMin != null ? `/${mastery.nextMin}` : '·满'}点</span>
      </div>
      <div className="text-[11px] text-dim/45">熟练度 = 在该副职业配方树上累计耗费的潜能点；升档时名下全部配方质变。</div>

      <div className="flex items-center justify-between pt-0.5">
        <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-mono text-god/70 hover:text-god transition-colors">{open ? '收起' : `${label}（${recipes.length}）▾`}</button>
        <button onClick={() => setAdding((a) => !a)} className="text-[11px] font-mono text-emerald-300/80 hover:text-emerald-200">＋ 手动加{label}</button>
      </div>

      {adding && <RecipeForm label={label} onCancel={() => setAdding(false)} onSubmit={(r) => { addRecipe('B1', sp.name, { id: `RM_${Date.now()}_${Math.floor(Math.random() * 1000)}`, ...r }); setAdding(false); }} />}

      {open && recipes.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-edge/40">
          {recipes.map((r) => <RecipeRow key={r.id || r.name} r={r} label={label}
            onSave={(patch) => addRecipe('B1', sp.name, { id: r.id, name: patch.name ?? r.name, tier: patch.tier, materials: patch.materials, output: patch.output, desc: patch.desc, progress: r.progress })}
            onDelete={() => removeRecipe('B1', sp.name, r.name)} />)}
        </div>
      )}
      {open && recipes.length === 0 && !adding && <div className="text-[12px] text-dim/40 pt-1 border-t border-edge/40">暂无{label}（去配方星图点亮，或点上方「手动加{label}」）</div>}
    </div>
  );
}

function RecipeRow({ r, label, onSave, onDelete }: { r: Recipe; label: string; onSave: (patch: Partial<Recipe>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  if (editing) return <div className="rounded-lg border border-fuchsia-600/40 bg-void/40 px-2.5 py-2"><RecipeForm label={label} init={r} onCancel={() => setEditing(false)} onSubmit={(patch) => { onSave(patch); setEditing(false); }} /></div>;
  return (
    <div className="rounded-lg border border-edge/50 bg-void/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span className="flex-1 text-[13px] text-slate-200 truncate">{r.name}</span>
        {r.tier && <span className="text-[11px] font-mono text-dim/50">{r.tier}</span>}
        <span className="text-[11px] font-mono text-dim/60 w-9 text-right">{r.progress ?? 0}%</span>
      </div>
      <div className="mt-1"><Bar value={r.progress ?? 0} cls="bg-god/70" /></div>
      {open && (
        <div className="mt-1.5 space-y-0.5 text-[12px] text-dim/70 leading-relaxed">
          {r.materials && <div><span className="text-dim/45">材料·</span>{r.materials}</div>}
          {r.output && <div><span className="text-dim/45">产物·</span>{r.output}</div>}
          {r.desc && <div className="italic text-dim/55">{r.desc}</div>}
          <div className="flex justify-end gap-3 pt-0.5">
            <button onClick={() => setEditing(true)} className="text-[11px] text-god/70 hover:text-god">编辑</button>
            <button onClick={onDelete} className="text-[11px] text-blood/50 hover:text-blood">删除</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecipeForm({ label, init, onCancel, onSubmit }: { label: string; init?: Recipe; onCancel: () => void; onSubmit: (r: { name: string; tier?: string; materials?: string; output?: string; desc?: string }) => void }) {
  const [name, setName] = useState(init?.name ?? '');
  const [tier, setTier] = useState(init?.tier ?? '');
  const [materials, setMaterials] = useState(init?.materials ?? '');
  const [output, setOutput] = useState(init?.output ?? '');
  const [desc, setDesc] = useState(init?.desc ?? '');
  return (
    <div className="space-y-1.5 pt-1">
      <input className={inputCls} placeholder={`${label}名`} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-1.5">
        <input className={inputCls} placeholder="档位(新手/熟练/专家/大师/宗师)" value={tier} onChange={(e) => setTier(e.target.value)} />
        <input className={inputCls} placeholder="材料" value={materials} onChange={(e) => setMaterials(e.target.value)} />
      </div>
      <textarea rows={2} className={inputCls + ' resize-y'} placeholder="产物：成品名 + 效果" value={output} onChange={(e) => setOutput(e.target.value)} />
      <input className={inputCls} placeholder="点评/背景（选填）" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-2 py-1 rounded border border-edge text-dim text-[11px] font-mono">取消</button>
        <button onClick={() => { if (name.trim()) onSubmit({ name: name.trim(), tier: tier.trim() || undefined, materials: materials.trim() || undefined, output: output.trim() || undefined, desc: desc.trim() || undefined }); }}
          className="px-3 py-1 rounded border border-emerald-500/50 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-mono">保存</button>
      </div>
    </div>
  );
}
