import { useMemo, useState } from 'react';
import { useCraft } from '../store/craftStore';
import { useItems, splitAffixEntries } from '../store/itemStore';
import { CRAFT_MODES, craftMode, craftCost } from '../systems/craftEngine';

/* 合成工坊面板：门类 tab → 选料(数量步进) + 倾向 → 合成 → 产物预览(确认/重新生成/撤销)。
   前端只掷品质档并锁品级；AI 产物由 onGenerate 生成到 session.pending（未入库）；
   确认时 onConfirm 才 consumeItem 投料 + addItem 产物 → 天然支持撤销/重新生成。 */
interface Props {
  onClose: () => void;
  onGenerate: () => Promise<void>;   // App.runCraftPhase：读 session → 调 AI → setPending/setError
  onConfirm: () => Promise<void> | void;   // App.confirmCraft：投料入账 + 产物入库 + 记配方 + endSession
}

const TIER_COLOR: Record<string, string> = {
  perfect: 'text-amber-300 border-amber-400/50',
  success: 'text-emerald-300 border-emerald-400/50',
  flawed: 'text-sky-300 border-sky-400/40',
  fail: 'text-rose-300 border-rose-400/50',
};

export default function CraftPanel({ onClose, onGenerate, onConfirm }: Props) {
  const config = useCraft((s) => s.config);
  const session = useCraft((s) => s.session);
  const items = useItems((s) => s.items);
  const coin = useItems((s) => s.currency.乐园币);

  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const modes = CRAFT_MODES.filter((m) => config.enabledModes[m.id] !== false);
  const mode = craftMode(session.modeId);
  const stagedIds = new Set(session.inputs.map((i) => i.itemId));
  const costPreview = config.costMul > 0 ? craftCost(session.inputs, config.costMul) : 0;

  const pickable = useMemo(
    () => items.filter((it) =>
      !it.locked && !stagedIds.has(it.id) &&
      (showAll || mode.prefCats.length === 0 || mode.prefCats.includes(it.category)) &&
      (!q || it.name.includes(q) || (it.subType ?? '').includes(q))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, showAll, q, session.modeId, session.inputs.length],
  );

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  async function doGenerate(regen = false) {
    if (busy) return;
    setBusy(true);
    try {
      if (regen) useCraft.getState().resetResult();
      else {
        const r = useCraft.getState().startCraft();
        if (!r.ok) { flash(r.why || '无法合成'); return; }
      }
      await onGenerate();
    } finally { setBusy(false); }
  }
  async function doConfirm() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); flash('✓ 已放入储存空间'); }
    finally { setBusy(false); }
  }

  const generating = busy || session.phase === 'generating';
  const preview = session.phase === 'preview' && !!session.pending;
  const errored = session.phase === 'error';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="w-full max-w-3xl h-[90vh] rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-edge bg-panel flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🛠 合成工坊</h2>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="text-amber-300/80">乐园币 {coin.toLocaleString()}</span>
            <button onClick={onClose} className="text-dim/60 hover:text-blood text-lg font-mono">✕</button>
          </div>
        </div>

        {/* 门类 tab */}
        <div className="px-3 py-2 border-b border-edge bg-panel/50 flex gap-1.5 overflow-x-auto shrink-0">
          {modes.map((m) => (
            <button key={m.id} onClick={() => { useCraft.getState().setMode(m.id); setQ(''); }}
              className={`px-3 py-1.5 rounded-lg text-[13px] whitespace-nowrap border transition-colors ${m.id === session.modeId ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:text-slate-200 hover:border-god/30'}`}>
              <span className="mr-1">{m.icon}</span>{m.name}
            </button>
          ))}
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-hidden relative">
          {/* 预览态：产物结果 */}
          {preview ? (
            <div className="h-full overflow-y-auto p-4 space-y-3">
              {session.quality && (
                <div className={`rounded-xl border px-3 py-2 text-[13px] ${TIER_COLOR[session.quality.tier]}`}>
                  <div className="font-bold">{session.quality.label}</div>
                  <div className="text-dim/80 text-[12px] mt-0.5">{session.quality.note}　产出品级上限：{session.quality.ceilingName}</div>
                </div>
              )}
              {session.pending!.map((p, i) => (
                <div key={i} className="rounded-xl border border-edge bg-panel p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-slate-100">{p.name}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded border border-god/40 text-god/90">{p.gradeDesc}</span>
                    <span className="text-[11px] text-dim/70">{p.category}{p.subType ? ' / ' + p.subType : ''}</span>
                    {p.score && <span className="text-[11px] text-dim/60 ml-auto">评分 {p.score}</span>}
                  </div>
                  {p.combatStat && <div className="text-[12px] text-orange-300/90">⚔ {p.combatStat}</div>}
                  {p.attrBonus && <div className="text-[12px] text-emerald-300/90">✦ {p.attrBonus}</div>}
                  {p.affix && <div className="text-[12px] text-purple-300/90 space-y-0.5">{splitAffixEntries(p.affix).map((a, j) => <div key={j} className="border-l-2 border-purple-400/30 pl-1.5">{a}</div>)}</div>}
                  {p.effect && <div className="text-[12px] text-sky-300/80 space-y-0.5">{splitAffixEntries(p.effect).map((a, j) => <div key={j} className="border-l-2 border-sky-400/30 pl-1.5">{a}</div>)}</div>}
                  {p.intro && <div className="text-[12px] text-dim/70 italic">{p.intro}</div>}
                  {p.appearance && <div className="text-[11px] text-dim/50">外观：{p.appearance}</div>}
                </div>
              ))}
            </div>
          ) : errored ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
              <div className="text-4xl">⚠</div>
              <div className="text-rose-300 text-[14px] font-semibold">合成失败</div>
              <div className="text-dim/70 text-[12px] max-w-md leading-relaxed">{session.error}</div>
            </div>
          ) : (
            /* 选料台 */
            <div className="h-full flex flex-col md:flex-row overflow-hidden">
              {/* 左：背包选料 */}
              <div className="md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-edge overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2 shrink-0">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索材料…"
                    className="flex-1 bg-panel2 border border-edge rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-god/40" />
                  <label className="flex items-center gap-1 text-[11px] text-dim/70 whitespace-nowrap cursor-pointer">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />显示全部
                  </label>
                </div>
                <div className="text-[11px] text-dim/50 px-3 pb-1 shrink-0">建议投入：{mode.inputHint}</div>
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
                  {pickable.length === 0 && <div className="text-center text-dim/40 text-[12px] py-8">背包里没有可投入的材料{!showAll && '（试试「显示全部」）'}</div>}
                  {pickable.map((it) => (
                    <button key={it.id} onClick={() => useCraft.getState().addInput({ itemId: it.id, name: it.name, maxQty: it.quantity, gradeDesc: it.gradeDesc, category: it.category, subType: it.subType })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-edge/60 hover:border-god/40 hover:bg-panel2 text-left transition-colors">
                      <span className="text-[13px] text-slate-200 truncate flex-1">{it.name}</span>
                      {it.equipped && <span className="text-[10px] text-amber-400/70 shrink-0">已装备</span>}
                      {it.gradeDesc && <span className="text-[10px] text-god/70 shrink-0">{it.gradeDesc}</span>}
                      <span className="text-[11px] text-dim/50 shrink-0">×{it.quantity}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 右：料格 + 倾向 + 合成 */}
              <div className="md:w-1/2 flex flex-col overflow-hidden">
                <div className="px-3 py-2 text-[12px] text-dim/70 flex items-center justify-between shrink-0">
                  <span>{mode.icon} {mode.name}·投料台</span>
                  {session.inputs.length > 0 && <button onClick={() => useCraft.getState().clearInputs()} className="text-[11px] text-dim/50 hover:text-blood">清空</button>}
                </div>
                <div className="flex-1 overflow-y-auto px-2 space-y-1 min-h-[80px]">
                  {session.inputs.length === 0 && <div className="text-center text-dim/40 text-[12px] py-8">从左侧点选材料放入</div>}
                  {session.inputs.map((inp) => (
                    <div key={inp.itemId} className="flex items-center gap-2 px-2 py-1.5 rounded border border-god/25 bg-god/5">
                      <span className="text-[13px] text-slate-200 truncate flex-1">{inp.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => useCraft.getState().setInputQty(inp.itemId, inp.qty - 1)} className="w-5 h-5 rounded bg-panel2 text-dim hover:text-slate-100">−</button>
                        <span className="text-[12px] text-slate-200 w-6 text-center">{inp.qty}</span>
                        <button onClick={() => useCraft.getState().setInputQty(inp.itemId, inp.qty + 1)} className="w-5 h-5 rounded bg-panel2 text-dim hover:text-slate-100">＋</button>
                        <span className="text-[10px] text-dim/40">/{inp.maxQty}</span>
                        <button onClick={() => useCraft.getState().removeInput(inp.itemId)} className="ml-1 text-dim/50 hover:text-blood text-sm">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-edge space-y-2 shrink-0">
                  {mode.id === 'crystal' && <div className="text-[11px] text-amber-300/70">💎 炼晶为确定性生成，产出真·可镶嵌宝石（不走 AI；倾向可指定属性/部位，如「暴击」「防具」「采矿」）</div>}
                  <textarea value={session.tendency} onChange={(e) => useCraft.getState().setTendency(e.target.value)}
                    placeholder="倾向提示（可选）：攻击向 / 辅助向 / 冰属性 / 隐匿 / 采集…只导方向、不改档次"
                    rows={2} className="w-full bg-panel2 border border-edge rounded px-2 py-1.5 text-[12px] text-slate-200 outline-none focus:border-god/40 resize-none" />
                  <button onClick={() => doGenerate(false)} disabled={session.inputs.length === 0}
                    className="w-full py-2 rounded-lg border border-god/50 bg-god/10 text-god font-semibold text-[14px] hover:bg-god/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    🛠 合成{costPreview > 0 ? `（手工费约 ${costPreview.toLocaleString()} 乐园币）` : ''}
                  </button>
                  <div className="text-[10px] text-dim/40 text-center">产物先出预览，可重新生成或撤销，确认才消耗材料入库</div>
                </div>
              </div>
            </div>
          )}

          {/* 生成中遮罩 */}
          {generating && (
            <div className="absolute inset-0 bg-void/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10">
              <div className="text-3xl animate-pulse">⚗</div>
              <div className="text-god/90 text-[14px]">工坊正在合成…</div>
            </div>
          )}
        </div>

        {/* 底部操作条（预览/失败态）*/}
        {(preview || errored) && (
          <div className="px-4 py-3 border-t border-edge bg-panel flex items-center gap-2 shrink-0">
            {preview && (
              <button onClick={doConfirm} disabled={busy}
                className="flex-1 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 font-semibold text-[13px] hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">{mode.id === 'tame' ? '✅ 收服宠物' : '✅ 确认入库'}</button>
            )}
            <button onClick={() => doGenerate(true)} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-god/40 text-god/90 text-[13px] hover:bg-god/10 disabled:opacity-40 transition-colors">🔄 重新生成</button>
            <button onClick={() => useCraft.getState().backToStaging()} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-edge text-dim hover:text-slate-200 text-[13px] disabled:opacity-40 transition-colors">↩ 撤销</button>
          </div>
        )}

        {toast && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/85 border border-edge text-slate-100 text-[13px] z-20">{toast}</div>}
      </div>
    </div>
  );
}
