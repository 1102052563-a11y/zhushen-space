import { useMemo, useState } from 'react';
import { useChest } from '../store/chestStore';
import { useItems, gradeColorClass, splitAffixEntries } from '../store/itemStore';
import { isChest, chestGradeNum } from '../systems/chestEngine';
import { gradeName } from '../systems/craftEngine';

/* 开箱面板：储存空间里选一只宝箱 → 显示"本箱最高可开出的品级" + 倾向 → 开启 → 产物预览（确认入库/重新生成/放弃）。
   前端只掷"开几件、逐件品级上限"并锁死品级；AI 产物由 onOpen 生成到 session.pending（未入库）；
   确认时 onConfirm 才 addItem 产物 + consumeItem 宝箱 → 天然支持重新生成/放弃。 */
interface Props {
  onClose: () => void;
  onOpen: () => Promise<void>;             // App.runChestOpenPhase：读 session → 调装备强化 API → setPending/setError
  onConfirm: () => Promise<void> | void;   // App.confirmChestOpen：产物入库 + 消耗宝箱 + endSession
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

  const selected = session.chestId ? items.find((x) => x.id === session.chestId) : undefined;
  const generating = busy || session.phase === 'generating';
  const preview = session.phase === 'preview' && !!session.pending;

  async function doOpen(regen = false) {
    if (busy || !selected) return;
    setBusy(true);
    try {
      if (regen) useChest.getState().resetResult();
      else {
        const r = useChest.getState().startOpen(selected);
        if (!r.ok) { flash(r.why || '无法开启'); return; }
      }
      await onOpen();
    } finally { setBusy(false); }
  }
  async function doConfirm() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); flash('✓ 已收入储存空间'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)]" onClick={(e) => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🎁 开启宝箱</h2>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </div>

        {toast && <div className="px-5 py-1.5 text-[12px] text-god border-b border-edge bg-god/5">{toast}</div>}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── 未选宝箱：列表 ── */}
          {!selected && (
            <>
              <div className="flex items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索宝箱名…"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-panel2 border border-edge text-sm text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
                <label className="flex items-center gap-1.5 text-[12px] text-dim/70 shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-god" />
                  显示全部物品
                </label>
              </div>
              <div className="text-[12px] text-dim/50">
                从储存空间里选一只宝箱开启。开箱调用「装备强化」的 AI 接口，读取宝箱全部信息 + 物品世界书 + 品级体系，按合理性思维链开出与其品级相称之物（不同等级宝箱有不同产出上限）。
              </div>
              {chests.length === 0 ? (
                <div className="py-10 text-center text-dim/50 text-sm">
                  {showAll ? '储存空间是空的。' : '储存空间里没有可开启的宝箱。'}
                  {!showAll && <div className="mt-1 text-[12px]">（若你的宝箱没被识别，可勾选「显示全部物品」强制开启任意物品）</div>}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {chests.map((it) => {
                    const cap = chestGradeNum(it);
                    return (
                      <button key={it.id} onClick={() => useChest.getState().selectChest(it)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-edge bg-panel2/40 hover:border-god/50 hover:bg-panel2 transition-colors text-left">
                        <span className="text-2xl shrink-0">🎁</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-100 truncate">{it.name}</div>
                          <div className="text-[11px] text-dim/60 flex items-center gap-1.5 flex-wrap">
                            <span className={gradeColorClass(it.gradeDesc)}>{it.gradeDesc || '未标品级'}</span>
                            <span>·</span>
                            <span>最高可开：<span className={gradeColorClass(gradeName(cap))}>{gradeName(cap)}</span></span>
                            {(Math.floor(it.quantity) || 1) > 1 && <span className="text-dim/50">·×{Math.floor(it.quantity)}</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── 已选宝箱：开启台 / 预览 ── */}
          {selected && (
            <>
              {/* 宝箱信息卡 */}
              <div className="rounded-xl border border-god/30 bg-god/5 p-3.5 flex gap-3">
                <span className="text-3xl shrink-0">🎁</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
                    {selected.name}
                    <span className={`text-[12px] ${gradeColorClass(selected.gradeDesc)}`}>{selected.gradeDesc || '未标品级'}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-god">
                    本箱最高可开出：<b className={gradeColorClass(gradeName(chestGradeNum(selected)))}>{gradeName(chestGradeNum(selected))}</b> 档物品（越高档的宝箱开得越多、越稀有）
                  </div>
                  {selected.intro && <div className="mt-1 text-[12px] text-dim/70 line-clamp-2">{selected.intro}</div>}
                  {selected.appearance && <div className="mt-0.5 text-[11px] text-dim/45 line-clamp-2">外观：{selected.appearance}</div>}
                </div>
              </div>

              {/* 倾向输入（未出预览时可编辑） */}
              {!preview && (
                <div>
                  <label className="text-[12px] text-dim/70">倾向提示（想开出什么方向，可留空 · 只决定方向不决定档次）</label>
                  <input value={session.tendency} onChange={(e) => useChest.getState().setTendency(e.target.value)}
                    placeholder="如：偏武器 / 恢复类消耗品 / 某属性装备 / 惊喜就好"
                    className="mt-1 w-full px-3 py-1.5 rounded-lg bg-panel2 border border-edge text-sm text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
                </div>
              )}

              {session.phase === 'error' && (
                <div className="rounded-lg border border-blood/40 bg-blood/5 px-3 py-2 text-[12px] text-rose-300">
                  {session.error || '开启失败'}
                </div>
              )}

              {/* 产物预览 */}
              {preview && (
                <div className="space-y-2">
                  <div className="text-[12px] text-god">✨ 开出 {session.pending!.length} 件（确认后收入储存空间、消耗 1 只宝箱）：</div>
                  {session.pending!.map((p, i) => (
                    <div key={i} className="rounded-xl border border-edge bg-panel2/40 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-100">{p.name}</span>
                        <span className={`text-[12px] ${gradeColorClass(p.gradeDesc)}`}>{p.gradeDesc}</span>
                        <span className="text-[11px] text-dim/60">{p.category}{p.subType ? '·' + p.subType : ''}</span>
                        {p.score && <span className="text-[11px] text-dim/45">评分 {p.score}</span>}
                      </div>
                      {p.combatStat && <div className="mt-1 text-[12px] text-amber-200/80">{p.combatStat}{p.attrBonus ? ' · ' + p.attrBonus : ''}</div>}
                      {p.affix && splitAffixEntries(p.affix).map((a, k) => <div key={k} className="mt-0.5 text-[12px] text-sky-200/80 border-l-2 border-sky-500/30 pl-2">缀·{a}</div>)}
                      {p.effect && splitAffixEntries(p.effect).map((e, k) => <div key={k} className="mt-0.5 text-[12px] text-emerald-200/70 border-l-2 border-emerald-500/25 pl-2">效·{e}</div>)}
                      {p.intro && <div className="mt-1 text-[11px] text-dim/60">{p.intro}</div>}
                      {p.appearance && <div className="mt-0.5 text-[11px] text-dim/40">外观：{p.appearance}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作条 */}
        {selected && (
          <div className="px-5 py-3 border-t border-edge flex items-center gap-2">
            {!preview ? (
              <>
                <button onClick={() => useChest.getState().clearChest()} disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">← 返回列表</button>
                <div className="flex-1" />
                <button onClick={() => doOpen(false)} disabled={busy}
                  className="px-5 py-1.5 rounded-lg border border-god/50 bg-god/10 text-god font-semibold hover:bg-god/20 text-sm disabled:opacity-40">
                  {generating ? '✨ 开启中…' : '🎁 开启宝箱'}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => useChest.getState().clearChest()} disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">放弃</button>
                <button onClick={() => doOpen(true)} disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-panel2 text-sm disabled:opacity-40">🔄 重新生成</button>
                <div className="flex-1" />
                <button onClick={doConfirm} disabled={busy}
                  className="px-5 py-1.5 rounded-lg border border-god/50 bg-god/10 text-god font-semibold hover:bg-god/20 text-sm disabled:opacity-40">✓ 收入储存空间</button>
              </>
            )}
          </div>
        )}

        {/* 加载遮罩 */}
        {generating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="text-4xl animate-bounce">🎁</div>
              <div className="text-god text-sm">✨ 正在开启宝箱…</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
