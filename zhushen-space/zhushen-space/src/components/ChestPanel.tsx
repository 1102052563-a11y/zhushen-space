import { useMemo, useState } from 'react';
import { useChest, CHEST_BATCH_MAX, type ChestProduct } from '../store/chestStore';
import { useItems, gradeColorClass, splitAffixEntries } from '../store/itemStore';
import { isChest, chestGradeNum, luckBonus, luckTierLabel, chestCategoryLock } from '../systems/chestEngine';
import { gradeName } from '../systems/craftEngine';
import { playerLuck } from '../systems/playerVitals';

/* 开箱面板（批量）：储存空间里勾选若干宝箱、各设数量 → 开启 → 每只【独立】开出一批物品（互不相同）→ 预览确认。
   前端只掷"开几件、逐件品级上限"并锁死品级；AI 产物由 onOpen 生成到各 job.loot（未入库）；
   确认时 onConfirm 才 addItem 产物 + consumeItem 宝箱 → 天然支持重新生成/放弃。 */
interface Props {
  onClose: () => void;
  onOpen: () => Promise<void>;             // App.runChestOpenPhase：读 session.jobs → 每只调装备强化 API → setJobLoot/setJobError
  onConfirm: () => Promise<void> | void;   // App.confirmChestOpen：逐 job 入库 + 汇总消耗宝箱 + endSession
}

/** 预览用·一件产物卡（模块级组件，避免内联定义；此卡无受控输入，安全）。 */
function LootCard({ p }: { p: ChestProduct }) {
  return (
    <div className="rounded-lg border border-edge bg-panel2/40 p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-100">{p.name}</span>
        <span className={`text-[12px] ${gradeColorClass(p.gradeDesc)}`}>{p.gradeDesc}</span>
        <span className="text-[11px] text-dim/60">{p.category}{p.subType ? '·' + p.subType : ''}</span>
        {p.score && <span className="text-[11px] text-dim/45">评分 {p.score}</span>}
      </div>
      {p.combatStat && <div className="mt-1 text-[12px] text-amber-200/80">{p.combatStat}{p.attrBonus ? ' · ' + p.attrBonus : ''}</div>}
      {(p.origin || p.durability || p.requirement) && (
        <div className="mt-0.5 text-[11px] text-dim/55 flex flex-wrap gap-x-2.5 gap-y-0.5">
          {p.origin && <span>产地：{p.origin}</span>}
          {p.durability && <span>耐久：{p.durability}</span>}
          {p.requirement && <span>需求：{p.requirement}</span>}
        </div>
      )}
      {p.affix && splitAffixEntries(p.affix).map((a, k) => <div key={k} className="mt-0.5 text-[12px] text-sky-200/80 border-l-2 border-sky-500/30 pl-2">缀·{a}</div>)}
      {p.effect && splitAffixEntries(p.effect).map((e, k) => <div key={k} className="mt-0.5 text-[12px] text-emerald-200/70 border-l-2 border-emerald-500/25 pl-2">效·{e}</div>)}
      {p.intro && <div className="mt-1 text-[11px] text-dim/60">{p.intro}</div>}
      {p.appearance && <div className="mt-0.5 text-[11px] text-dim/40">外观：{p.appearance}</div>}
    </div>
  );
}

export default function ChestPanel({ onClose, onOpen, onConfirm }: Props) {
  const session = useChest((s) => s.session);
  const items = useItems((s) => s.items);

  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const chests = useMemo(
    () => items.filter((it) =>
      !it.locked && (Math.floor(it.quantity) || 1) > 0 &&
      (showAll || isChest(it)) &&
      (!q || it.name.includes(q) || (it.subType ?? '').includes(q))
    ),
    [items, showAll, q],
  );

  const { selection, jobs, phase, tendency } = session;
  const luck = playerLuck();
  const lb = luckBonus(luck);
  const totalSel = Object.values(selection).reduce((a, b) => a + b, 0);
  const overCap = totalSel > CHEST_BATCH_MAX;
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const settled = jobs.filter((j) => j.status !== 'pending').length;
  const totalLoot = jobs.reduce((a, j) => a + (j.loot?.length || 0), 0);
  const generating = busy || phase === 'generating';

  const setQty = (id: string, qty: number, max: number) => useChest.getState().setSelectQty(id, qty, max);

  async function doOpen(regen = false) {
    if (busy) return;
    setBusy(true);
    try {
      if (regen) useChest.getState().resetResults();
      else {
        const r = useChest.getState().startBatch(items, playerLuck());
        if (!r.ok) { flash(r.why || '无法开启'); return; }
      }
      await onOpen();
    } finally { setBusy(false); }
  }
  async function doConfirm() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); flash('✓ 已全部收入储存空间'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)]" onClick={(e) => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🎁 开启宝箱{phase !== 'select' && <span className="text-[12px] text-dim/50 font-normal">· 共 {jobs.length} 只</span>}</h2>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </div>

        {toast && <div className="px-5 py-1.5 text-[12px] text-god border-b border-edge bg-god/5">{toast}</div>}
        {session.error && <div className="px-5 py-1.5 text-[12px] text-rose-300 border-b border-edge bg-blood/5">{session.error}</div>}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── 选箱阶段 ── */}
          {phase === 'select' && (
            <>
              <div className="flex items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索宝箱名…"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-panel2 border border-edge text-sm text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
                <label className="flex items-center gap-1.5 text-[12px] text-dim/70 shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-god" />
                  显示全部物品
                </label>
              </div>
              <div>
                <label className="text-[12px] text-dim/70">倾向提示（整批共用·可留空 · 只决定方向不决定档次）</label>
                <input value={tendency} onChange={(e) => useChest.getState().setTendency(e.target.value)}
                  placeholder="如：偏武器 / 恢复类消耗品 / 某属性装备 / 惊喜就好"
                  className="mt-1 w-full px-3 py-1.5 rounded-lg bg-panel2 border border-edge text-sm text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
              </div>
              {/* 幸运加成（六维·幸运 → 开箱加成标准表） */}
              <div className="flex items-center gap-2 flex-wrap text-[12px] rounded-lg border border-god/20 bg-god/5 px-3 py-1.5">
                <span>🍀 开启者幸运 <b className="text-god">{luck}</b></span>
                <span className="text-dim/40">·</span>
                <span>开箱加成 <b className={lb > 0 ? 'text-god' : 'text-dim/60'}>+{Math.round(lb * 100)}%</b>（{luckTierLabel(luck)}）</span>
                {lb > 0 && <span className="text-dim/45">— 产物更贴近品级上限、可能多开惊喜件</span>}
              </div>
              <div className="text-[12px] text-dim/50">
                勾选宝箱、各设数量后一次开启。开箱调用「装备强化」的 AI 接口，**每只宝箱独立生成、开出的物品各不相同**；不同等级的宝箱有不同的产出上限（幸运只在上限内加成，不越级）。单次最多 {CHEST_BATCH_MAX} 只。
              </div>
              {chests.length === 0 ? (
                <div className="py-10 text-center text-dim/50 text-sm">
                  {showAll ? '储存空间是空的。' : '储存空间里没有可开启的宝箱。'}
                  {!showAll && <div className="mt-1 text-[12px]">（宝箱由物品演化打上「宝箱」标签识别；若你的宝箱没被认出，可勾「显示全部物品」强制开启任意物品）</div>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {chests.map((it) => {
                    const cap = chestGradeNum(it);
                    const lock = chestCategoryLock(it);
                    const stackQty = Math.max(1, Math.floor(it.quantity) || 1);
                    const count = selection[it.id] || 0;
                    return (
                      <div key={it.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${count > 0 ? 'border-god/50 bg-god/5' : 'border-edge bg-panel2/40'}`}>
                        <button onClick={() => setQty(it.id, count > 0 ? 0 : 1, stackQty)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                          <span className="text-2xl shrink-0">🎁</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-slate-100 truncate">{it.name}{stackQty > 1 && <span className="text-dim/50 text-[12px]"> ×{stackQty}</span>}</div>
                            <div className="text-[11px] text-dim/60 flex items-center gap-1.5 flex-wrap">
                              <span className={gradeColorClass(it.gradeDesc)}>{it.gradeDesc || '未标品级'}</span>
                              <span>·</span>
                              <span>最高可开：<span className={gradeColorClass(gradeName(cap))}>{gradeName(cap)}</span></span>
                              {lock && <><span>·</span><span className="text-god/70">内含：{lock.join('/')}</span></>}
                            </div>
                          </div>
                        </button>
                        {/* 数量步进 */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setQty(it.id, count - 1, stackQty)} disabled={count <= 0}
                            className="w-6 h-6 rounded border border-edge text-slate-300 hover:bg-panel2 disabled:opacity-30 text-sm leading-none">−</button>
                          <span className={`w-6 text-center text-sm ${count > 0 ? 'text-god font-semibold' : 'text-dim/50'}`}>{count}</span>
                          <button onClick={() => setQty(it.id, count + 1, stackQty)} disabled={count >= stackQty}
                            className="w-6 h-6 rounded border border-edge text-slate-300 hover:bg-panel2 disabled:opacity-30 text-sm leading-none">+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── 生成中 ── */}
          {phase === 'generating' && (
            <div className="py-8 text-center space-y-3">
              <div className="text-4xl animate-bounce">🎁</div>
              <div className="text-god text-sm">✨ 正在开启宝箱… {settled}/{jobs.length}</div>
              <div className="text-[12px] text-dim/50">每只宝箱独立开启，稍候…</div>
            </div>
          )}

          {/* ── 预览 ── */}
          {phase === 'preview' && (
            <div className="space-y-3">
              <div className="text-[12px] text-god">✨ {doneCount} 只宝箱开出 {totalLoot} 件（确认后收入储存空间、消耗对应宝箱）：</div>
              {jobs.map((job, gi) => (
                <div key={job.jobId} className="rounded-xl border border-edge/70 bg-panel/40 p-2.5">
                  <div className="text-[12px] mb-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-slate-200">📦 {job.chestName} <span className="text-dim/40">#{gi + 1}</span></span>
                    <span className={gradeColorClass(job.gradeDesc)}>{job.gradeDesc || gradeName(job.plan.capGrade)}</span>
                    {job.status === 'error'
                      ? <span className="text-rose-300">⚠ {job.error || '失败'}</span>
                      : <span className="text-dim/45">{job.loot?.length || 0} 件</span>}
                  </div>
                  {job.status !== 'error' && (
                    <div className="space-y-1.5">
                      {(job.loot || []).map((p, i) => <LootCard key={i} p={p} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作条 */}
        {phase === 'select' && (
          <div className="px-5 py-3 border-t border-edge flex items-center gap-2">
            <button onClick={() => useChest.getState().clearSelection()} disabled={busy || totalSel === 0}
              className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">清空</button>
            <div className="flex-1 text-[12px] text-dim/50">
              {totalSel > 0 ? <>已选 <span className={overCap ? 'text-rose-300' : 'text-god'}>{totalSel}</span> 只{overCap && ` · 超过上限 ${CHEST_BATCH_MAX}`}</> : '未选择宝箱'}
            </div>
            <button onClick={() => doOpen(false)} disabled={busy || totalSel === 0 || overCap}
              className="px-5 py-1.5 rounded-lg border border-god/50 bg-god/10 text-god font-semibold hover:bg-god/20 text-sm disabled:opacity-40">
              🎁 开启（共 {totalSel} 只）
            </button>
          </div>
        )}
        {phase === 'preview' && (
          <div className="px-5 py-3 border-t border-edge flex items-center gap-2">
            <button onClick={() => useChest.getState().backToSelect()} disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">放弃</button>
            <button onClick={() => doOpen(true)} disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">🔄 重新生成</button>
            <div className="flex-1" />
            <button onClick={doConfirm} disabled={busy || totalLoot === 0}
              className="px-5 py-1.5 rounded-lg border border-god/50 bg-god/10 text-god font-semibold hover:bg-god/20 text-sm disabled:opacity-40">✓ 全部收入（{totalLoot} 件）</button>
          </div>
        )}

        {/* 加载遮罩 */}
        {generating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="text-4xl animate-bounce">🎁</div>
              <div className="text-god text-sm">✨ 正在开启宝箱… {settled}/{jobs.length || '…'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
