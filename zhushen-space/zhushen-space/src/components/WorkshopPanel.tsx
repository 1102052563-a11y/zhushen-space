import { useState, useEffect } from 'react';
import { useWorkshop } from '../store/workshopStore';
import {
  fetchWorkshopIndex, installWorkshopItem, KIND_LIST, kindOf,
  buildSubmission, downloadSubmission, installFromFile,
  type WorkshopIndex, type WorkshopIndexItem, type WorkshopKindId,
} from '../systems/workshop';

/* 创意工坊：浏览/下载/投稿 社区共享的预设与内容。
   - 浏览：从托管的工坊索引(JSON)一键安装，带 新装/已装/有更新 状态。
   - 投稿：把本地某条内容导出成投稿文件（交维护者合进索引）；也可从文件点对点安装。
   - 源：可切换/新增工坊源（同源内置源 + 任意 https 索引 URL）。 */

type Tab = 'browse' | 'installed' | 'publish';

function fmtDate(ts: number): string {
  try { return new Date(ts).toLocaleDateString(); } catch { return ''; }
}

export default function WorkshopPanel({ onClose }: { onClose: () => void }) {
  const sources = useWorkshop((s) => s.sources);
  const activeSourceId = useWorkshop((s) => s.activeSourceId);
  const setActiveSource = useWorkshop((s) => s.setActiveSource);
  const addSource = useWorkshop((s) => s.addSource);
  const removeSource = useWorkshop((s) => s.removeSource);
  const installs = useWorkshop((s) => s.installs);
  const forgetInstall = useWorkshop((s) => s.forgetInstall);

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? sources[0];

  const [tab, setTab] = useState<Tab>('browse');
  const [toast, setToast] = useState('');

  // 浏览
  const [index, setIndex] = useState<WorkshopIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | WorkshopKindId>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [srcMgrOpen, setSrcMgrOpen] = useState(false);

  // 投稿
  const [pubType, setPubType] = useState<WorkshopKindId>('textPreset');
  const [pubLocalId, setPubLocalId] = useState('');
  const [form, setForm] = useState({ name: '', author: '', version: '1.0.0', summary: '', tags: '' });

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(''), 3500); };

  // 拉取索引（切源 / 刷新时）
  useEffect(() => {
    if (!activeSource) return;
    let cancelled = false;
    setLoading(true); setError(''); setIndex(null);
    fetchWorkshopIndex(activeSource.url)
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? '加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSource?.url, refreshKey]);

  // 切投稿类型 → 复位本地条目 + 预填名称
  useEffect(() => {
    const list = kindOf(pubType)?.listLocal() ?? [];
    const first = list[0];
    setPubLocalId(first?.id ?? '');
    setForm((f) => ({ ...f, name: first?.name ?? '' }));
  }, [pubType]);

  function statusOf(item: WorkshopIndexItem): 'new' | 'installed' | 'update' {
    const rec = installs[item.id];
    if (!rec) return 'new';
    if (item.version && rec.version && item.version !== rec.version) return 'update';
    if (item.contentHash && rec.contentHash && item.contentHash !== rec.contentHash) return 'update';
    return 'installed';
  }

  async function doInstall(item: WorkshopIndexItem) {
    if (!activeSource) return;
    setInstallingId(item.id);
    try {
      await installWorkshopItem(item, activeSource.url, activeSource.id);
      flash(`已安装「${item.name}」`);
    } catch (e: any) {
      flash(`安装失败：${e?.message ?? e}`);
    } finally {
      setInstallingId(null);
    }
  }

  function doExport() {
    try {
      const tags = form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const file = buildSubmission(pubType, pubLocalId, { name: form.name, author: form.author, version: form.version, summary: form.summary, tags });
      downloadSubmission(file);
      flash(`已导出投稿文件「${file.meta.name}」`);
    } catch (e: any) {
      flash(`导出失败：${e?.message ?? e}`);
    }
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const res = installFromFile(String(r.result)); flash(res.message); };
    r.onerror = () => flash('读取文件失败');
    r.readAsText(f);
  }

  const items = (index?.items ?? []).filter((it) => {
    if (filterType !== 'all' && it.type !== filterType) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [it.name, it.summary, it.author, ...(it.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const installedList = Object.values(installs).sort((a, b) => b.installedAt - a.installedAt);
  const pubList = kindOf(pubType)?.listLocal() ?? [];

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-[13px] font-mono rounded-lg transition-colors ${tab === id ? 'bg-god/15 text-god border border-god/40' : 'text-dim/60 hover:text-slate-200 border border-transparent'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[86vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 头 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🧩</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">创意工坊</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">浏览 · 下载 · 投稿 社区共享的预设与内容</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 页签 */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/50">
          <TabBtn id="browse" label="浏览" />
          <TabBtn id="installed" label={`已安装 ${installedList.length || ''}`} />
          <TabBtn id="publish" label="投稿 / 导入" />
        </div>

        {/* ── 浏览 ── */}
        {tab === 'browse' && (
          <>
            <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel/30 space-y-2">
              {/* 源 + 刷新 */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-dim/60 shrink-0">源</span>
                <select value={activeSourceId} onChange={(e) => setActiveSource(e.target.value)}
                  className="flex-1 min-w-0 bg-void border border-edge rounded px-2 py-1 text-[12px] font-mono text-slate-200 focus:outline-none focus:border-god/50">
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => setRefreshKey((k) => k + 1)} title="刷新"
                  className="shrink-0 text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">↻</button>
                <button onClick={() => setSrcMgrOpen((v) => !v)} title="管理源"
                  className={`shrink-0 text-[12px] font-mono px-2 py-1 rounded border transition-colors ${srcMgrOpen ? 'border-god/40 text-god' : 'border-edge text-dim/70 hover:text-god hover:border-god/40'}`}>⚙</button>
              </div>

              {srcMgrOpen && <SourceManager sources={sources} onAdd={(n, u) => { const r = addSource(n, u); flash(r.message); }} onRemove={removeSource} />}

              {/* 搜索 + 分类 */}
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称 / 简介 / 标签…"
                  className="flex-1 min-w-0 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <FilterChip active={filterType === 'all'} onClick={() => setFilterType('all')} label="全部" />
                {KIND_LIST.map((k) => <FilterChip key={k.id} active={filterType === k.id} onClick={() => setFilterType(k.id)} label={`${k.emoji} ${k.label}`} />)}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
              {error && !loading && (
                <div className="py-12 text-center text-blood/70 text-[13px] font-mono border border-dashed border-blood/30 rounded-xl px-4">
                  {error}
                  <div className="text-dim/40 mt-2 text-[11px]">检查源 URL 是否可访问、是否返回有效的工坊索引 JSON。</div>
                </div>
              )}
              {!loading && !error && items.length === 0 && (
                <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
                  {index ? '没有匹配的内容' : '该源暂无内容'}
                </div>
              )}
              {!loading && !error && items.map((it) => {
                const st = statusOf(it);
                const kind = kindOf(it.type);
                return (
                  <div key={it.id} className="rounded-xl border border-edge bg-panel/60 p-3 hover:border-god/30 transition-colors">
                    <div className="flex items-start gap-2.5">
                      <span className="text-lg shrink-0 mt-0.5">{kind?.emoji ?? '❔'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[14px] font-semibold text-slate-100">{it.name}</span>
                          <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-edge text-dim/50">{kind?.label ?? it.type}</span>
                          {it.version && <span className="text-[10px] font-mono text-dim/40">v{it.version}</span>}
                        </div>
                        {it.summary && <div className="text-[12px] text-dim/70 mt-1 leading-snug">{it.summary}</div>}
                        <div className="flex items-center gap-2 text-[10px] font-mono text-dim/45 mt-1 flex-wrap">
                          {it.author && <span>by {it.author}</span>}
                          {it.updatedAt && <span>· {it.updatedAt}</span>}
                          {(it.tags ?? []).map((t) => <span key={t} className="px-1 rounded bg-void/60 text-dim/50">#{t}</span>)}
                        </div>
                      </div>
                      <div className="shrink-0 self-center">
                        {st === 'installed' ? (
                          <span className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-600/40 text-emerald-300/80">✓ 已安装</span>
                        ) : (
                          <button onClick={() => doInstall(it)} disabled={installingId === it.id}
                            className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${st === 'update' ? 'border-amber-500/50 text-amber-300/90 hover:bg-amber-900/25' : 'border-god/50 text-god hover:bg-god/10'}`}>
                            {installingId === it.id ? '安装中…' : st === 'update' ? '↻ 更新' : '⤓ 安装'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── 已安装 ── */}
        {tab === 'installed' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {installedList.length === 0 ? (
              <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">还没有从工坊安装过内容</div>
            ) : installedList.map((rec) => (
              <div key={rec.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/60 p-2.5">
                <span className="text-lg shrink-0">{kindOf(rec.type)?.emoji ?? '❔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-100 truncate">{rec.name}</div>
                  <div className="text-[10px] font-mono text-dim/45">{kindOf(rec.type)?.label ?? rec.type}{rec.version ? ` · v${rec.version}` : ''} · {fmtDate(rec.installedAt)}</div>
                </div>
                <button onClick={() => forgetInstall(rec.id)} title="仅清除安装记录（不删除已装内容）"
                  className="shrink-0 text-[11px] font-mono px-2 py-1 rounded border border-edge text-dim/60 hover:text-blood hover:border-blood/40 transition-colors">忘记记录</button>
              </div>
            ))}
            {installedList.length > 0 && (
              <div className="text-[11px] font-mono text-dim/40 px-1 pt-1">「忘记记录」只清安装账本（用于重新追踪更新），已装进各功能的内容需到对应面板删除。</div>
            )}
          </div>
        )}

        {/* ── 投稿 / 导入 ── */}
        {tab === 'publish' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="rounded-xl border border-edge bg-panel/50 p-3 space-y-2.5">
              <div className="text-[13px] font-semibold text-slate-200">导出投稿文件</div>
              <div className="text-[11px] font-mono text-dim/50 -mt-1">把本地内容打包成工坊文件，发给维护者合进索引、或直接分享给朋友。</div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-mono text-dim/60">类型
                  <select value={pubType} onChange={(e) => setPubType(e.target.value as WorkshopKindId)}
                    className="w-full mt-1 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50">
                    {KIND_LIST.map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.label}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-mono text-dim/60">本地条目
                  <select value={pubLocalId} onChange={(e) => { const id = e.target.value; setPubLocalId(id); const en = pubList.find((x) => x.id === id); if (en) setForm((f) => ({ ...f, name: en.name })); }}
                    className="w-full mt-1 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50">
                    {pubList.length === 0 ? <option value="">（无可投稿条目）</option> : pubList.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="标题" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
                <Field label="作者" value={form.author} onChange={(v) => setForm((f) => ({ ...f, author: v }))} />
                <Field label="版本" value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} />
                <Field label="标签（逗号分隔）" value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} />
              </div>
              <Field label="简介" value={form.summary} onChange={(v) => setForm((f) => ({ ...f, summary: v }))} />

              <button onClick={doExport} disabled={!pubLocalId}
                className="w-full mt-1 text-[13px] font-mono px-3 py-2 rounded-lg border border-god/50 text-god hover:bg-god/10 transition-colors disabled:opacity-40">
                ⤒ 导出投稿文件
              </button>
            </div>

            <div className="rounded-xl border border-edge bg-panel/50 p-3 space-y-2">
              <div className="text-[13px] font-semibold text-slate-200">从文件安装</div>
              <div className="text-[11px] font-mono text-dim/50 -mt-1">支持工坊投稿文件 或 整套全局配置文件。</div>
              <label className="block">
                <input type="file" accept="application/json,.json" className="hidden"
                  onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                <span className="block text-center cursor-pointer text-[13px] font-mono px-3 py-2 rounded-lg border border-dashed border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">
                  📂 选择文件…
                </span>
              </label>
            </div>
          </div>
        )}

        {/* toast */}
        {toast && (
          <div className="shrink-0 px-4 py-2 border-t border-edge bg-god/10 text-[12px] font-mono text-god/90 text-center">{toast}</div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors ${active ? 'bg-god/15 text-god border-god/40' : 'text-dim/55 border-edge hover:text-slate-200'}`}>
      {label}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[11px] font-mono text-dim/60 block">{label}
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50" />
    </label>
  );
}

function SourceManager({ sources, onAdd, onRemove }: {
  sources: { id: string; name: string; url: string; builtin?: boolean }[];
  onAdd: (name: string, url: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  return (
    <div className="rounded-lg border border-edge bg-void/50 p-2.5 space-y-2">
      <div className="space-y-1">
        {sources.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-slate-300 shrink-0">{s.name}</span>
            <span className="text-dim/40 truncate flex-1 min-w-0">{s.url}</span>
            {s.builtin
              ? <span className="text-dim/30 shrink-0">内置</span>
              : <button onClick={() => onRemove(s.id)} className="text-dim/50 hover:text-blood shrink-0">删</button>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 pt-1 border-t border-edge/60">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="源名称"
          className="w-24 bg-void border border-edge rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="索引 JSON 的 URL"
          className="flex-1 min-w-0 bg-void border border-edge rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
        <button onClick={() => { if (url.trim()) { onAdd(name, url); setName(''); setUrl(''); } }}
          className="shrink-0 text-[11px] font-mono px-2 py-1 rounded border border-god/50 text-god hover:bg-god/10 transition-colors">添加</button>
      </div>
    </div>
  );
}
