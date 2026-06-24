import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSubProfTree, isRecipeNode } from '../store/subProfTreeStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useCharacters, type SubProfession, type Recipe } from '../store/characterStore';
import {
  canRankUp, availablePP, potentialBudget, treeProgressStats, effectiveTierName,
  nodeRank, nodeMaxRank, SKILLTREE_TUNING, coinPerPP,
} from '../systems/skillTree';
import TreeCanvas from './TreeCanvas';

/* 副职业面板（主角 B1）：径向【配方星图】——花潜能点(与技能树共用一池)逐点点节点，
   配方节点学/精进【配方】(图纸/药方…)，配方只进本面板的配方清单、绝不进技能/天赋栏；微星=磨练基本功(加总熟练度·不给属性)。
   顶部可切「⭐配方星图 / 📋已学配方」两视图。 */

const TIER_CLS: Record<string, string> = {
  新手: 'text-slate-400 border-slate-500/50', 熟练: 'text-emerald-300 border-emerald-600/50',
  专家: 'text-sky-300 border-sky-600/50', 大师: 'text-violet-300 border-violet-600/50', 宗师: 'text-amber-300 border-amber-500/50',
};
const BAR_CLS: Record<string, string> = { 新手: 'bg-slate-400', 熟练: 'bg-emerald-400', 专家: 'bg-sky-400', 大师: 'bg-violet-400', 宗师: 'bg-amber-400' };

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

export default function SubProfessionPanel({ onClose }: { onClose: () => void }) {
  const trees = useSubProfTree((s) => s.trees);
  const prog = useSubProfTree((s) => s.progress['B1']);
  const setActiveTree = useSubProfTree((s) => s.setActiveTree);
  const profile = usePlayer((s) => s.profile);
  const parkCoin = useItems((s) => s.currency['乐园币'] ?? 0);
  const subProfs = useCharacters((s) => s.characters['B1']?.subProfessions ?? []);

  const [view, setView] = useState<'tree' | 'recipes'>('tree');
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [, force] = useState(0);
  const [msg, setMsg] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ cx: number; cy: number; sl: number; st: number } | null>(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const zoomAnchor = useRef<{ sl: number; st: number; cx: number; cy: number; f: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const treeList = Object.values(trees);
  const activeId = prog?.activeTreeId;
  const tree = activeId ? trees[activeId] : undefined;

  // 首次进入未选树：自动挑第一棵（或与主角某副职业同名的）
  useEffect(() => {
    if (activeId && trees[activeId]) return;
    if (!treeList.length) return;
    const match = treeList.find((t) => subProfs.some((sp) => sp.name === t.profession));
    setActiveTree('B1', (match ?? treeList[0]).id);
  }, [activeId, treeList.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 滚轮缩放（光标锚定）
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const nz = Math.min(3, Math.max(0.5, +(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
      if (nz === z) return;
      const rect = el.getBoundingClientRect();
      zoomAnchor.current = { sl: el.scrollLeft, st: el.scrollTop, cx: e.clientX - rect.left, cy: e.clientY - rect.top, f: nz / z };
      zoomRef.current = nz; setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view]);
  useLayoutEffect(() => {
    const el = scrollRef.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.sl + a.cx) * a.f - a.cx;
    el.scrollTop = (a.st + a.cy) * a.f - a.cy;
    zoomAnchor.current = null;
  }, [zoom]);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element)?.closest?.('[data-node]')) return;
    const el = scrollRef.current; if (!el) return;
    panRef.current = { cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setGrabbing(true);
    try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件忽略 */ }
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current, el = scrollRef.current;
    if (!p || !el) return;
    el.scrollLeft = p.sl - (e.clientX - p.cx);
    el.scrollTop = p.st - (e.clientY - p.cy);
  };
  const endPan = (e: React.PointerEvent) => {
    if (!panRef.current) return;
    panRef.current = null; setGrabbing(false);
    try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
  };

  const ctx = { level: profile.level, tier: profile.tier, charId: 'B1' };   // 共享潜能池
  const ranks = prog?.ranks ?? {};
  const availableIds = new Set((tree?.nodes ?? []).filter((n) => canRankUp(tree, n.id, prog, ctx).ok).map((n) => n.id));
  const avail = availablePP(prog, ctx);
  const budget = potentialBudget(profile.level, profile.tier);
  const stats = treeProgressStats(tree, prog);
  const effTier = effectiveTierName(profile.tier, profile.level);
  const recipeLabel = tree?.recipeLabel || '配方';

  // 乐园币兑换潜能点（与技能树同价、同一池）
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

  const doRankUp = () => {
    if (!selNode) return;
    if (!canRankUp(tree, selNode.id, prog, ctx).ok) return;
    const ok = useSubProfTree.getState().rankUpNode('B1', selNode.id);
    if (ok) {
      setMsg(selIsRecipe ? (selRank === 0 ? `✓ 学会${recipeLabel}：${selRecipe?.name ?? selNode.name}` : `✓ 钻研精进：${selRecipe?.name ?? selNode.name}`) : '✓ 基本功精进，副职业总熟练度提升');
      setTimeout(() => setMsg(''), 2800);
    }
    setSelId(selNode.id);
  };
  const doExchange = (n: number) => { if (useSubProfTree.getState().exchangePP('B1', n) > 0) force((x) => x + 1); };

  const totalRecipes = subProfs.reduce((a, sp) => a + (sp.recipes?.length ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-[95vw] max-h-[94vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg">🛠</span>
              <h2 className="text-base font-bold text-slate-100">副职业</h2>
              {tree && view === 'tree' && <span className="text-[13px] font-mono text-dim/50">已点 {stats.unlocked}/{stats.total} 节点</span>}
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">花<span className="text-lime-300">潜能点</span>（与技能树共用一池）点亮节点：<span className="text-slate-300">{recipeLabel}</span>节点学/精进配方（只进配方清单，不进技能/天赋栏）；微星=磨练基本功（涨总熟练度·不给属性）。有效阶位 <span className="text-slate-300">{effTier}</span>。</p>
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

        {/* 视图切换 + 树选择 + 兑换 */}
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
            {tree && (
              <div className="ml-auto flex flex-wrap items-center gap-3 max-lg:ml-0 max-lg:w-full max-lg:justify-end">
                <div className="hidden sm:flex items-center gap-2">
                  {tree.branches.map((b) => <span key={b.id} className="flex items-center gap-1 text-[11px] text-dim/60"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />{b.name}</span>)}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">－</button>
                  <button onClick={() => setZoom(1)} className="px-2 h-7 rounded border border-edge text-[11px] font-mono text-dim hover:text-slate-200">{Math.round(zoom * 100)}%</button>
                  <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">＋</button>
                </div>
                <button onClick={() => doExchange(1)} disabled={exAffordable < 1}
                  title={`兑换下一点 = ${exPrice.toLocaleString()} 乐园币（越买越贵）`}
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
              className={`flex-1 overflow-auto p-3 ${tree ? (grabbing ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onPointerDown={tree ? onCanvasPointerDown : undefined}
              onPointerMove={tree ? onCanvasPointerMove : undefined}
              onPointerUp={endPan} onPointerLeave={endPan} onPointerCancel={endPan}>
              {!tree && <div className="text-center text-dim/40 text-sm py-16">还没有副职业树。到「设置 → 变量管理 → 副职业设置」里创建或 AI 生成一套，或从内置炼金术/锻造开始。</div>}
              {tree && <TreeCanvas tree={tree} ranks={ranks} availableIds={availableIds} mode="play" selectedId={selId} onNodeClick={setSelId} zoom={zoom} heightVh={76} />}
            </div>

            {/* 选中节点详情 + 解锁 */}
            {selNode && (
              <div className="border-t border-edge p-4 shrink-0 max-h-[40vh] overflow-y-auto bg-panel2/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-100">{asText(selNode.name)}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-dim/70">
                        {selIsRecipe ? (selNode.kind === 'capstone' ? `宗师级${recipeLabel}` : selNode.kind === 'major' ? `招牌${recipeLabel}` : `${recipeLabel}`) : '基本功'}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-sky-600/50 text-sky-300 font-mono">点数 {selRank}/{selMaxR}</span>
                      {!!selNode.spentGate && <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-amber-300/80 font-mono">需累计 {selNode.spentGate} 点</span>}
                    </div>
                    {selNode.desc && <p className="text-[13px] text-dim/70 mt-1 leading-relaxed">{asText(selNode.desc)}</p>}
                  </div>
                  <button onClick={doRankUp} disabled={!selChk?.ok}
                    className={`shrink-0 px-4 py-1.5 rounded text-[13px] font-mono transition-colors ${selChk?.ok
                      ? 'border border-lime-500/50 text-lime-300 bg-lime-500/10 hover:bg-lime-500/20'
                      : 'border border-edge text-dim/40 cursor-not-allowed'}`}>
                    {selIsRecipe ? (selRank === 0 ? `学会${recipeLabel}` : '钻研精进') : selRank === 0 ? '研习' : '＋练一次'} <span className="text-[11px] opacity-70">潜能 {selNode.cost}</span>
                  </button>
                </div>
                {!selChk?.ok && selChk?.reason && <p className="text-[12px] text-amber-400/80 mt-1.5">⚠ {selChk.reason}</p>}
                {msg && <p className="text-[12px] text-lime-300 mt-1.5">{msg}</p>}
                {/* 配方信息（信息完整：档位/材料/产物/说明）*/}
                {selRecipe && (
                  <div className="mt-3 rounded-lg border border-emerald-700/40 bg-emerald-950/15 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-emerald-200">📜 {asText(selRecipe.name)}</span>
                      {selRecipe.tier && <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-600/40 text-emerald-300/90">{asText(selRecipe.tier)}</span>}
                      {selRank >= 1 && <span className="text-[11px] text-emerald-400/70">已掌握（钻研可提升熟练度）</span>}
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
          /* 已学配方清单（来自副职业本体·剧情实践也会写入这里）*/
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {subProfs.length === 0 && <div className="text-center text-dim/40 text-sm py-12">还没有副职业。在「配方星图」里点亮配方节点习得，或剧情中拜师习得。</div>}
            {subProfs.map((sp) => <SubProfCard key={sp.name} sp={sp} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SubProfCard({ sp }: { sp: SubProfession }) {
  const [open, setOpen] = useState(true);
  const tcls = TIER_CLS[sp.tier] ?? TIER_CLS['新手'];
  const bcls = BAR_CLS[sp.tier] ?? BAR_CLS['新手'];
  const recipes = sp.recipes ?? [];
  const label = sp.recipeLabel || '配方';
  return (
    <div className={`rounded-xl border p-3 space-y-2 bg-panel ${tcls}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{sp.name}</span>
        {sp.category && <span className="text-[11px] font-mono text-dim/50">{sp.category}</span>}
        <span className={`text-[12px] font-mono font-bold ${tcls.split(' ')[0]}`}>{sp.tier}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-dim/50 shrink-0">总熟练</span>
        <div className="flex-1"><Bar value={sp.progress ?? 0} cls={bcls} /></div>
        <span className="text-[11px] font-mono text-dim/60 shrink-0 w-10 text-right">{sp.progress ?? 0}%</span>
      </div>
      {sp.effect && <div className="text-[12px] text-slate-300/80 leading-relaxed"><span className="text-dim/40">效果·</span>{sp.effect}</div>}
      <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-mono text-god/70 hover:text-god transition-colors">
        {open ? '收起' : `${label}（${recipes.length}）▾`}
      </button>
      {open && recipes.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-edge/40">
          {recipes.map((r) => <RecipeRow key={r.id || r.name} r={r} />)}
        </div>
      )}
      {open && recipes.length === 0 && <div className="text-[12px] text-dim/40 pt-1 border-t border-edge/40">暂无{label}</div>}
    </div>
  );
}

function RecipeRow({ r }: { r: Recipe }) {
  const [open, setOpen] = useState(false);
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
        </div>
      )}
    </div>
  );
}
