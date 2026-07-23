import { useState, useEffect, useMemo } from 'react';
import { useWorldEdit } from '../store/worldEditStore';
import { useWorkshop } from '../store/workshopStore';
import {
  loadWorldIndex, getWorldDetail, getBaseWorldDetail, getPublishedDetail, getOverrideNames,
  invalidateWorldDetail, refreshOverrides, type WorldDetail,
} from '../systems/worldDetail';
import { wdSubmit, wdListMine, wdListPending, wdReview, type WdSubmission } from '../systems/worldDetailShare';

/* 世界资料库：浏览/搜索全部世界详情档案（public/worlddetail 分片，4311 世界）＋ 编辑修订。
 *   - 编辑保存 → 本机立即生效（worldEditStore 本地修订，卡片生成/正文注入即刻读到），并询问是否提交站长审核；
 *   - 审核页签仅站长可见（复用创意工坊管理员密钥：创意工坊→设置 里验证过的 adminKey），通过后写服务端
 *     overrides 对所有玩家全局生效（读取优先级：本地修订 > 全局修订 > 内置分片，见 systems/worldDetail.ts）。 */

type Tab = 'lib' | 'mine' | 'review';
const LIB_LABEL: Record<string, string> = { main: '主库', leisure: '休闲' };
const LIST_CAP = 150;

function fmtDate(ts?: number): string { try { return ts ? new Date(ts).toLocaleString() : ''; } catch { return ''; } }

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors ${active ? 'bg-god/15 text-god border-god/40' : 'text-dim/50 border-edge hover:text-slate-200'}`}>
      {label}
    </button>
  );
}

function StatusChip({ status }: { status: WdSubmission['status'] }) {
  const map: Record<WdSubmission['status'], [string, string]> = {
    pending: ['待审核', 'text-amber-300 border-amber-400/40 bg-amber-400/10'],
    approved: ['已通过·全局生效', 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10'],
    rejected: ['已拒绝', 'text-blood border-blood/40 bg-blood/10'],
  };
  const [label, cls] = map[status] || map.pending;
  return <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono border ${cls}`}>{label}</span>;
}

function TextBlock({ title, text, tall }: { title: string; text?: string; tall?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel/40 min-w-0">
      <div className="px-3 py-1.5 border-b border-edge text-[12px] font-mono text-god/80">{title}{text ? ` · ${text.length} 字` : ''}</div>
      <div className={`p-3 text-[13px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words overflow-y-auto ${tall ? 'max-h-[52vh]' : 'max-h-[38vh]'}`}>
        {text || <span className="text-dim/40">（无）</span>}
      </div>
    </div>
  );
}

export default function WorldDetailLibPanel({ onClose }: { onClose: () => void }) {
  const edits = useWorldEdit((s) => s.edits);
  const adminKey = useWorkshop((s) => s.adminKey);

  const [tab, setTab] = useState<Tab>('lib');
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 3500); };

  // ── 资料库：索引 + 搜索 ──
  const [index, setIndex] = useState<{ name: string; lib: string }[]>([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [overrideNames, setOverrideNames] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [libFilter, setLibFilter] = useState('');   // '' | 'main' | 'leisure'
  useEffect(() => {
    let dead = false;
    (async () => {
      const idx = await loadWorldIndex();
      if (dead) return;
      setIndex(idx); setIndexLoading(false);
      setOverrideNames(await getOverrideNames());
    })();
    return () => { dead = true; };
  }, []);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return index.filter((w) => (!libFilter || w.lib === libFilter) && (!q || w.name.toLowerCase().includes(q)));
  }, [index, search, libFilter]);

  // ── 选中世界：详情 / 原版对照 / 编辑 ──
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [baseDetail, setBaseDetail] = useState<WorldDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showBase, setShowBase] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ePlot, setEPlot] = useState('');
  const [eCut, setECut] = useState('');
  const [eNote, setENote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function openWorld(name: string) {
    setSelected(name); setEditing(false); setShowBase(false); setDetail(null); setBaseDetail(null);
    setDetailLoading(true);
    const [d, b] = await Promise.all([getWorldDetail(name), getBaseWorldDetail(name)]);
    setDetail(d); setBaseDetail(b ?? null);
    setDetailLoading(false);
  }
  function startEdit() {
    if (!detail) return;
    setEPlot(detail.plot); setECut(detail.cut || ''); setENote('');
    setEditing(true);
  }
  async function saveEdit() {
    if (!selected) return;
    const plot = ePlot.trim();
    if (!plot) { flash('·剧情 不能为空'); return; }
    useWorldEdit.getState().setEdit(selected, { plot, cut: eCut.trim() || undefined });
    invalidateWorldDetail(selected);
    setEditing(false);
    await openWorld(selected);
    // 用户流程：保存 → 弹出「是否提交给站长」
    if (window.confirm('已保存到本机（你的卡片生成/正文注入立即用这份修订）。\n\n是否把这份修订提交给站长审核？通过后将更新到所有玩家的世界资料库。')) {
      setSubmitting(true);
      try {
        await wdSubmit({ name: selected, plot, cut: eCut.trim() || undefined, note: eNote });
        useWorldEdit.getState().markSubmitted(selected);
        flash('✅ 已提交审核——可在「我的提交」页签查看状态');
      } catch (e) {
        flash(`提交失败（本机修订不受影响）：${e instanceof Error ? e.message : e}`);
      } finally { setSubmitting(false); }
    } else {
      flash('已保存到本机（未提交）');
    }
  }
  async function revertLocal() {
    if (!selected) return;
    if (!window.confirm(`撤销「${selected}」的本地修订，恢复为${overrideNames.has(selected) ? '全局修订版' : '内置原版'}？`)) return;
    useWorldEdit.getState().removeEdit(selected);
    invalidateWorldDetail(selected);
    await openWorld(selected);
    flash('已撤销本地修订');
  }

  // ── 我的提交 ──
  const [mineList, setMineList] = useState<WdSubmission[]>([]);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineErr, setMineErr] = useState('');
  useEffect(() => {
    if (tab !== 'mine') return;
    let dead = false;
    setMineLoading(true); setMineErr('');
    wdListMine().then((l) => { if (!dead) setMineList(l); })
      .catch((e) => { if (!dead) setMineErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!dead) setMineLoading(false); });
    return () => { dead = true; };
  }, [tab]);

  // ── 审核（站长）──
  const [pending, setPending] = useState<WdSubmission[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingErr, setPendingErr] = useState('');
  const [reviewSel, setReviewSel] = useState<WdSubmission | null>(null);
  const [reviewCurrent, setReviewCurrent] = useState<WorldDetail | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  async function loadPending() {
    setPendingLoading(true); setPendingErr(''); setReviewSel(null); setReviewCurrent(null);
    try { setPending(await wdListPending()); }
    catch (e) { setPendingErr(e instanceof Error ? e.message : String(e)); }
    finally { setPendingLoading(false); }
  }
  useEffect(() => { if (tab === 'review' && adminKey) void loadPending(); }, [tab, adminKey]);
  async function openReview(s: WdSubmission) {
    setReviewSel(s); setReviewCurrent(null);
    setReviewCurrent(await getPublishedDetail(s.name));
  }
  async function doReview(action: 'approve' | 'reject') {
    if (!reviewSel) return;
    if (action === 'approve' && !window.confirm(`通过「${reviewSel.name}」的修订？将立即对所有玩家全局生效（覆盖内置档案）。`)) return;
    setReviewBusy(true);
    try {
      await wdReview(reviewSel.id, action);
      flash(action === 'approve' ? `✅ 已通过「${reviewSel.name}」·全局生效` : `已拒绝「${reviewSel.name}」`);
      if (action === 'approve') { refreshOverrides(); setOverrideNames(await getOverrideNames()); }
      await loadPending();
    } catch (e) { flash(`操作失败：${e instanceof Error ? e.message : e}`); }
    finally { setReviewBusy(false); }
  }

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 text-[13px] font-mono rounded-lg transition-colors ${tab === id ? 'bg-god/15 text-god border border-god/40' : 'text-dim/60 hover:text-slate-200 border border-transparent'}`}>
      {label}
    </button>
  );

  const viewDetail = showBase ? (baseDetail ?? undefined) : (detail ?? undefined);
  const hasLocal = !!(selected && edits[selected]);
  const hasOverride = !!(selected && overrideNames.has(selected));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-5xl h-[90dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-xl">🗂</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">世界资料库</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">
              {index.length || '…'} 个世界档案 · 编辑保存＝本机即刻生效 · 提交审核通过＝全局生效
            </div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/50">
          <TabBtn id="lib" label="资料库" />
          <TabBtn id="mine" label="我的提交" />
          {adminKey && <TabBtn id="review" label={`审核 ${pending.length || ''}`} />}
        </div>

        {/* ── 资料库 ── */}
        {tab === 'lib' && !selected && (
          <>
            <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel/30 flex items-center gap-2 flex-wrap">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索世界名…"
                className="flex-1 min-w-[180px] bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
              <Chip active={libFilter === ''} onClick={() => setLibFilter('')} label="全部" />
              <Chip active={libFilter === 'main'} onClick={() => setLibFilter('main')} label="⚔ 主库" />
              <Chip active={libFilter === 'leisure'} onClick={() => setLibFilter('leisure')} label="🌸 休闲" />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {indexLoading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
              {!indexLoading && index.length === 0 && (
                <div className="py-16 text-center text-dim/40 text-[13px] font-mono border border-dashed border-edge rounded-xl px-4">
                  世界详情分片缺失（/worlddetail/manifest.json 不可达）——重新构建部署后可用
                </div>
              )}
              {!indexLoading && index.length > 0 && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {filtered.slice(0, LIST_CAP).map((w) => (
                      <button key={w.name} onClick={() => void openWorld(w.name)}
                        className="text-left rounded-lg border border-edge bg-panel/60 px-2.5 py-2 hover:border-god/30 transition-colors">
                        <div className="text-[13px] text-slate-200 truncate">{w.name}</div>
                        <div className="text-[10px] font-mono text-dim/50 flex items-center gap-1.5 mt-0.5">
                          <span>{LIB_LABEL[w.lib] || w.lib}</span>
                          {edits[w.name] && <span className="text-sky-300">🖊 本地修订</span>}
                          {overrideNames.has(w.name) && <span className="text-emerald-300">🌐 全局修订</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                  {filtered.length > LIST_CAP && (
                    <div className="py-3 text-center text-dim/40 text-[11px] font-mono">已显示前 {LIST_CAP} 个 · 还有 {filtered.length - LIST_CAP} 个——继续输入以缩小范围</div>
                  )}
                  {filtered.length === 0 && <div className="py-16 text-center text-dim/40 text-sm font-mono">没有匹配的世界</div>}
                </>
              )}
            </div>
          </>
        )}

        {/* ── 世界详情 / 编辑 ── */}
        {tab === 'lib' && selected && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => { setSelected(null); setEditing(false); }} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">← 返回</button>
              <span className="text-base font-bold text-slate-100">{selected}</span>
              {hasLocal && <span className="text-[10px] font-mono text-sky-300 border border-sky-400/40 bg-sky-400/10 rounded-full px-2 py-0.5">🖊 本地修订生效中</span>}
              {hasOverride && <span className="text-[10px] font-mono text-emerald-300 border border-emerald-400/40 bg-emerald-400/10 rounded-full px-2 py-0.5">🌐 有全局修订</span>}
              <span className="flex-1" />
              {!editing && (hasLocal || hasOverride) && baseDetail && (
                <button onClick={() => setShowBase((v) => !v)}
                  className="text-[12px] font-mono px-2.5 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">
                  {showBase ? '看当前生效版' : '看内置原版'}
                </button>
              )}
              {!editing && hasLocal && <button onClick={() => void revertLocal()} className="text-[12px] font-mono px-2.5 py-1 rounded border border-edge text-dim/70 hover:text-blood hover:border-blood/40 transition-colors">🗑 撤销本地修订</button>}
              {!editing && detail && <button onClick={startEdit} className="text-[12px] font-mono px-2.5 py-1 rounded border border-god/40 bg-god/10 text-god hover:bg-god/20 transition-colors">✏️ 编辑</button>}
            </div>

            {detailLoading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
            {!detailLoading && !detail && !editing && (
              <div className="py-12 text-center text-dim/40 text-[13px] font-mono border border-dashed border-edge rounded-xl">档案拉取失败（分片不可达），稍后再试</div>
            )}

            {!editing && viewDetail && (
              <>
                {showBase && <div className="text-[11px] font-mono text-amber-300/80">正在查看内置原版（非当前生效版）</div>}
                <TextBlock title="·剧情（卡片生成 + 入世正文都读）" text={viewDetail.plot} tall />
                <TextBlock title="·切入点（仅世界选择/卡片生成时读，入世后不注入）" text={viewDetail.cut} />
              </>
            )}

            {editing && (
              <div className="space-y-3">
                <div className="text-[12px] font-mono text-dim/60">
                  修订「{selected}」——保存后本机立即生效（你的世界卡生成与正文注入即用此版），随后可选提交站长审核、通过后对所有玩家生效。
                </div>
                <div>
                  <div className="text-[12px] font-mono text-god/80 mb-1">·剧情（≥全文粘贴编辑·必填）</div>
                  <textarea value={ePlot} onChange={(e) => setEPlot(e.target.value)} spellCheck={false}
                    className="w-full min-h-[38vh] bg-void border border-edge rounded-lg p-3 text-[13px] leading-relaxed text-slate-200 focus:outline-none focus:border-god/50 font-mono" />
                </div>
                <div>
                  <div className="text-[12px] font-mono text-god/80 mb-1">·切入点（可空）</div>
                  <textarea value={eCut} onChange={(e) => setECut(e.target.value)} spellCheck={false}
                    className="w-full min-h-[20vh] bg-void border border-edge rounded-lg p-3 text-[13px] leading-relaxed text-slate-200 focus:outline-none focus:border-god/50 font-mono" />
                </div>
                <div>
                  <div className="text-[12px] font-mono text-god/80 mb-1">附言（给站长看的修订说明·选填）</div>
                  <input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="改了什么 / 为什么（如：补全势力表、修正阶位映射…）"
                    className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => void saveEdit()} disabled={submitting}
                    className="px-4 py-1.5 rounded-lg border border-god/40 bg-god/15 text-god text-[13px] font-mono hover:bg-god/25 transition-colors disabled:opacity-50">💾 保存</button>
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg border border-edge text-dim/70 text-[13px] font-mono hover:text-slate-200 transition-colors">取消</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 我的提交 ── */}
        {tab === 'mine' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {mineLoading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
            {mineErr && !mineLoading && <div className="py-12 text-center text-blood/70 text-[13px] font-mono border border-dashed border-blood/30 rounded-xl px-4">{mineErr}<div className="text-dim/40 mt-2 text-[11px]">后端可能未部署或不可达（与创意工坊同一后端）。</div></div>}
            {!mineLoading && !mineErr && mineList.length === 0 && (
              <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">还没有提交过修订 · 在「资料库」编辑某个世界并保存即可提交</div>
            )}
            {mineList.map((s) => (
              <div key={s.id} className="rounded-xl border border-edge bg-panel/60 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-200 truncate">{s.name}</div>
                  <div className="text-[11px] font-mono text-dim/50 truncate">
                    {fmtDate(s.createdAt)} · 剧情 {s.plotLen ?? 0} 字{s.cutLen ? ` · 切入点 ${s.cutLen} 字` : ''}{s.note ? ` · ${s.note}` : ''}
                  </div>
                </div>
                <StatusChip status={s.status} />
              </div>
            ))}
          </div>
        )}

        {/* ── 审核（站长）── */}
        {tab === 'review' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {pendingLoading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
            {pendingErr && !pendingLoading && <div className="py-12 text-center text-blood/70 text-[13px] font-mono border border-dashed border-blood/30 rounded-xl px-4">{pendingErr}</div>}
            {!pendingLoading && !pendingErr && !reviewSel && (
              <>
                {pending.length === 0 && <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">没有待审核的修订</div>}
                {pending.map((s) => (
                  <button key={s.id} onClick={() => void openReview(s)}
                    className="w-full text-left rounded-xl border border-edge bg-panel/60 p-3 hover:border-god/30 transition-colors flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-slate-200 truncate">{s.name}</div>
                      <div className="text-[11px] font-mono text-dim/50 truncate">
                        {s.author || '匿名'} · {fmtDate(s.createdAt)} · 剧情 {s.plot?.length ?? 0} 字{s.cut ? ` · 切入点 ${s.cut.length} 字` : ''}{s.note ? ` · 📝 ${s.note}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] font-mono text-dim/50">审核 →</span>
                  </button>
                ))}
              </>
            )}
            {reviewSel && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => { setReviewSel(null); setReviewCurrent(null); }} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">← 待审列表</button>
                  <span className="text-base font-bold text-slate-100">{reviewSel.name}</span>
                  <span className="text-[11px] font-mono text-dim/50">{reviewSel.author || '匿名'} · {fmtDate(reviewSel.createdAt)}</span>
                  <span className="flex-1" />
                  <button onClick={() => void doReview('approve')} disabled={reviewBusy}
                    className="px-3 py-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 text-emerald-300 text-[13px] font-mono hover:bg-emerald-400/20 transition-colors disabled:opacity-50">✅ 通过·全局生效</button>
                  <button onClick={() => void doReview('reject')} disabled={reviewBusy}
                    className="px-3 py-1.5 rounded-lg border border-blood/40 bg-blood/10 text-blood text-[13px] font-mono hover:bg-blood/20 transition-colors disabled:opacity-50">❌ 拒绝</button>
                </div>
                {reviewSel.note && <div className="text-[12px] font-mono text-amber-200/80 border border-amber-400/30 bg-amber-400/10 rounded-lg px-3 py-2">📝 提交者附言：{reviewSel.note}</div>}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <TextBlock title={`现行版 ·剧情（${reviewCurrent ? '全局修订/内置' : '加载中…'}）`} text={reviewCurrent?.plot} tall />
                  <TextBlock title="提交版 ·剧情" text={reviewSel.plot} tall />
                  <TextBlock title="现行版 ·切入点" text={reviewCurrent?.cut} />
                  <TextBlock title="提交版 ·切入点" text={reviewSel.cut} />
                </div>
              </div>
            )}
          </div>
        )}

        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-god/40 text-god text-[13px] font-mono rounded-lg px-4 py-2 shadow-lg">{toast}</div>
        )}
      </div>
    </div>
  );
}
