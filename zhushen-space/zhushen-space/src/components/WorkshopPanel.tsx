import { useState, useEffect, useMemo, useRef } from 'react';
import { useWorkshop } from '../store/workshopStore';
import { AutoText } from './AutoText';
import TreeCanvas from './TreeCanvas';
import { autoLayout } from '../systems/skillTree';
import type { TreeDef } from '../store/skillTreeStore';
import {
  wsList, wsGet, wsListMine, wsDelete, wsRename, wsVerifyAdmin, installFromBackend, uploadLocal, uploadPacked, statusFor, KIND_LIST, kindOf, apiBase,
  CREATION_TYPES, ccListLocal, packWorldBookFile, WB_CAT_TEXT, WB_CAT_AUX,
  type WorkshopMeta, type WorkshopItem, type WorkshopKindId, type WbShelf,
} from '../systems/workshop';
import { myMpName } from '../systems/mpConfig';

/* 创意工坊：社区共享内容（无审核直传 + 浏览 + 下载数）。后端=zhushen-multiplayer Worker(D1)。
   页签：浏览 / 上传 / 已安装 / 设置。 */

type Tab = 'browse' | 'upload' | 'mine' | 'installed' | 'settings';

const FILE_LOCAL_ID = '__file__';   // 「本地导入」的合成条目 id（内容不在本地库，走 uploadPacked 直传）

function fmtDate(ts?: number): string { try { return ts ? new Date(ts).toLocaleDateString() : ''; } catch { return ''; } }

export default function WorkshopPanel({ onClose, creationMode = false, initialTab, initialType }: { onClose: () => void; creationMode?: boolean; initialTab?: Tab; initialType?: WorkshopKindId }) {
  // 创建模式：显「乐园/种族/天赋」+「🎭 角色创建模板」——前三类走自定义内容库；角色创建模板走普通 store 路径(useCreationTemplates)，整份创建设定(乐园/属性/天赋/物品/随从…)一起上传。普通模式：全部(去掉 creationOnly)。
  const CREATION_MODE_KINDS: WorkshopKindId[] = [...CREATION_TYPES, 'creationTemplate'];
  const visibleKinds = creationMode ? KIND_LIST.filter((k) => CREATION_MODE_KINDS.includes(k.id)) : KIND_LIST.filter((k) => !k.creationOnly);
  const groupsPresent = [...new Set(visibleKinds.map((k) => k.group))];
  // 仅「乐园/种族/天赋」走自定义内容库；「角色创建模板」即便在创建模式也走普通 store（listLocal/pack/install）——uploadLocal/installFromBackend 自身已按 CREATION_TYPES 兜底，故此处只需分流「列表来源」。
  const usesCcLib = (t: WorkshopKindId) => creationMode && CREATION_TYPES.includes(t);
  const localEntriesOf = (t: WorkshopKindId) => (usesCcLib(t) ? ccListLocal(t) : (kindOf(t)?.listLocal() ?? []));

  const installs = useWorkshop((s) => s.installs);
  const forgetInstall = useWorkshop((s) => s.forgetInstall);
  const myUploads = useWorkshop((s) => s.myUploads);
  const apiOverride = useWorkshop((s) => s.apiBase);
  const setApiBase = useWorkshop((s) => s.setApiBase);
  const nickname = useWorkshop((s) => s.nickname);
  const setNickname = useWorkshop((s) => s.setNickname);
  const adminKey = useWorkshop((s) => s.adminKey);
  const setAdminKey = useWorkshop((s) => s.setAdminKey);

  const [tab, setTab] = useState<Tab>(initialTab ?? 'browse');
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 3500); };

  // 浏览
  const [list, setList] = useState<WorkshopMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'downloads'>('downloads');
  const [filterType, setFilterType] = useState<WorkshopKindId>(initialType ?? (creationMode ? 'paradise' : 'skill'));
  const [filterCat, setFilterCat] = useState('');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkshopMeta | null>(null);   // 点开的条目（详情弹窗）
  const [detailFull, setDetailFull] = useState<WorkshopItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 已上传（我的）
  const [mineList, setMineList] = useState<WorkshopMeta[]>([]);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineErr, setMineErr] = useState('');
  const [mineRefresh, setMineRefresh] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 上传
  const [pubType, setPubType] = useState<WorkshopKindId>(initialType ?? (creationMode ? 'paradise' : 'skill'));
  const [pubLocalId, setPubLocalId] = useState('');
  const [form, setForm] = useState({ name: '', author: '', version: '1.0.0', summary: '', tags: '' });
  const [uploading, setUploading] = useState(false);
  // 世界书·本地导入：选个 .json 就能直接分享，不必先导进设置页（内容只在内存里，不进本地库）
  const [fileWb, setFileWb] = useState<{ raw: string; fileName: string; name: string; count: number } | null>(null);
  const [wbShelf, setWbShelf] = useState<WbShelf>('text');   // 别人下载后放进哪一栏
  const wbFileRef = useRef<HTMLInputElement>(null);

  // 设置
  const [apiInput, setApiInput] = useState(apiOverride);
  const [nickInput, setNickInput] = useState(nickname || myMpName());
  const [savingNick, setSavingNick] = useState(false);
  const [adminInput, setAdminInput] = useState(adminKey);
  const [savingAdmin, setSavingAdmin] = useState(false);

  async function saveNick() {
    const nm = nickInput.trim();
    if (!nm) { flash('昵称不能为空'); return; }
    setSavingNick(true);
    try {
      const n = await wsRename(nm);   // 传播到已上传（后端按 owner 改署名）
      setNickname(nm);
      flash(n > 0 ? `昵称已改为「${nm}」，同步更新了 ${n} 个已上传` : `昵称已设为「${nm}」`);
      setMineRefresh((k) => k + 1); setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setNickname(nm);   // 后端同步失败也先存本地（之后上传用新名）
      flash(`昵称已保存，但同步到已上传失败：${e?.message ?? e}`);
    } finally { setSavingNick(false); }
  }

  async function saveAdmin() {
    const k = adminInput.trim();
    if (!k) { setAdminKey(''); flash('已关闭管理员'); return; }
    setSavingAdmin(true);
    try {
      const ok = await wsVerifyAdmin(k);
      if (ok) { setAdminKey(k); flash('✓ 管理员已开启——可删除任意条目'); }
      else { flash('管理员密钥不正确'); }
    } catch (e: any) { flash(`验证失败：${e?.message ?? e}`); }
    finally { setSavingAdmin(false); }
  }

  async function adminDelete(m: WorkshopMeta) {
    if (!window.confirm(`【管理员】删除「${m.name}」？将从工坊永久移除，所有人都看不到。`)) return;
    setDeletingId(m.id);
    try {
      await wsDelete(m.id);
      setList((prev) => prev.filter((x) => x.id !== m.id));
      setMineList((prev) => prev.filter((x) => x.id !== m.id));
      if (detail?.id === m.id) setDetail(null);
      flash(`已删除「${m.name}」`);
    } catch (e: any) { flash(`删除失败：${e?.message ?? e}`); }
    finally { setDeletingId(null); }
  }

  const catsOfType = kindOf(filterType)?.categories;

  useEffect(() => { setFilterCat(''); }, [filterType]);

  // 拉列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    wsList({ type: filterType, category: filterCat || undefined, sort })
      .then((items) => { if (!cancelled) setList(items); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? '加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filterType, filterCat, sort, refreshKey]);

  // 点开条目 → 拉完整内容（含 payload）看详情
  useEffect(() => {
    if (!detail) { setDetailFull(null); return; }
    let cancelled = false;
    setDetailLoading(true); setDetailFull(null);
    wsGet(detail.id)
      .then((it) => { if (!cancelled) setDetailFull(it); })
      .catch(() => { if (!cancelled) setDetailFull(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detail]);

  // 「已上传」：进页签时按 owner 拉我上传的
  useEffect(() => {
    if (tab !== 'mine') return;
    let cancelled = false;
    setMineLoading(true); setMineErr('');
    wsListMine()
      .then((items) => { if (!cancelled) setMineList(items); })
      .catch((e) => { if (!cancelled) setMineErr(e?.message ?? '加载失败'); })
      .finally(() => { if (!cancelled) setMineLoading(false); });
    return () => { cancelled = true; };
  }, [tab, mineRefresh]);

  // 切上传类型 → 复位条目 + 预填名（世界书已载入本地文件时，优先选它）
  useEffect(() => {
    if (pubType === 'worldbook' && fileWb) { setPubLocalId(FILE_LOCAL_ID); setForm((f) => ({ ...f, name: fileWb.name })); return; }
    const l = localEntriesOf(pubType);
    setPubLocalId(l[0]?.id ?? '');
    setForm((f) => ({ ...f, name: l[0]?.name ?? '' }));
  }, [pubType]);

  // 进「上传」页时，若当前类型没条目，自动跳到第一个有内容的类型（免得默认空类型让人以为坏了）
  useEffect(() => {
    if (tab !== 'upload') return;
    if (pubType === 'worldbook' && fileWb) return;   // 已载入本地文件 → 别跳走
    if (localEntriesOf(pubType).length > 0) return;
    const firstNonEmpty = visibleKinds.find((k) => localEntriesOf(k.id).length > 0);
    if (firstNonEmpty) setPubType(firstNonEmpty.id);
  }, [tab]);

  const shown = list.filter((m) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [m.name, m.summary, m.author, ...(m.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  async function doInstall(meta: WorkshopMeta) {
    setInstallingId(meta.id);
    try {
      const dl = await installFromBackend(meta, creationMode);
      setList((prev) => prev.map((m) => (m.id === meta.id ? { ...m, downloads: dl } : m)));
      // 世界书说清楚落在哪一栏（老条目没 category → 与 install 缺省一致，落正文世界书）
      const where = meta.type === 'worldbook' ? ` → 已放进设置里的「${meta.category === WB_CAT_AUX ? WB_CAT_AUX : WB_CAT_TEXT}」` : '';
      flash(`已安装「${meta.name}」${where}`);
    } catch (e: any) {
      flash(`安装失败：${e?.message ?? e}`);
    } finally { setInstallingId(null); }
  }

  async function doDelete(m: WorkshopMeta) {
    if (!window.confirm(`确定删除「${m.name}」？将同时从工坊下架，别人不再看到。`)) return;
    setDeletingId(m.id);
    try {
      await wsDelete(m.id);
      setMineList((prev) => prev.filter((x) => x.id !== m.id));
      flash(`已删除「${m.name}」`);
    } catch (e: any) {
      flash(`删除失败：${e?.message ?? e}`);
    } finally { setDeletingId(null); }
  }

  // 世界书本地导入：读文件 → 解析校验 → 存内存（上传时按当前书架重新打包），不进本地库
  function handleWbFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const fileName = f.name.replace(/\.json$/i, '');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = String(ev.target?.result ?? '');
      try {
        const packed = packWorldBookFile(raw, fileName, wbShelf);
        const count = packed.payload.entries.length;
        setFileWb({ raw, fileName, name: packed.name, count });
        setPubLocalId(FILE_LOCAL_ID);
        setForm((f2) => ({ ...f2, name: packed.name }));
        flash(`已载入「${packed.name}」（${count} 条条目）· 填好简介即可上传`);
      } catch (err: any) { flash(`解析失败：${err?.message ?? err}`); }
    };
    reader.readAsText(f, 'utf-8');
    e.target.value = '';
  }

  async function doUpload() {
    if (!nickname.trim()) { flash('请先在「设置」起一个工坊昵称'); setTab('settings'); return; }
    if (!pubLocalId) { flash('没有可上传的本地条目'); return; }
    if (pubType === 'worldbook' && !form.summary.trim()) { flash('上传世界书需要先填写简介——简要介绍这本世界书是做什么的'); return; }
    setUploading(true);
    try {
      const tags = form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const meta = { name: form.name, author: form.author, version: form.version, summary: form.summary, tags };
      if (pubLocalId === FILE_LOCAL_ID) {
        if (!fileWb) throw new Error('请先选择世界书文件');
        await uploadPacked('worldbook', packWorldBookFile(fileWb.raw, fileWb.fileName, wbShelf), meta);
      } else {
        await uploadLocal(pubType, pubLocalId, meta, creationMode);
      }
      flash(`已上传「${form.name || '未命名'}」，现在所有人都能看到`);
      // 上传成功 → 退回（重置）上传页：清掉本次简介/标签，保留作者/版本，便于连续上传
      const cur = pubLocalId === FILE_LOCAL_ID ? fileWb : localEntriesOf(pubType).find((x) => x.id === pubLocalId);
      setForm((f) => ({ ...f, name: cur?.name ?? '', summary: '', tags: '' }));
      setTab('upload');
    } catch (e: any) {
      flash(`上传失败：${e?.message ?? e}`);
    } finally { setUploading(false); }
  }

  const installedList = Object.values(installs).sort((a, b) => b.installedAt - a.installedAt);
  // 本地导入的世界书排在最前（合成条目，id=FILE_LOCAL_ID）
  const pubList = (pubType === 'worldbook' && fileWb)
    ? [{ id: FILE_LOCAL_ID, name: fileWb.name, category: `📂 本地文件 · ${fileWb.count} 条` }, ...localEntriesOf(pubType)]
    : localEntriesOf(pubType);

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 text-[13px] font-mono rounded-lg transition-colors ${tab === id ? 'bg-god/15 text-god border border-god/40' : 'text-dim/60 hover:text-slate-200 border border-transparent'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-5xl h-[90dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-xl">🧩</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">创意工坊</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">社区共享 · 浏览下载 / 一键上传（无审核·实时可见·显示下载数）</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/50">
          <TabBtn id="browse" label="浏览" />
          <TabBtn id="upload" label="上传" />
          <TabBtn id="mine" label={`已上传 ${Object.keys(myUploads).length || ''}`} />
          <TabBtn id="installed" label={`已安装 ${installedList.length || ''}`} />
          <TabBtn id="settings" label="设置" />
        </div>

        {/* ── 浏览 ── */}
        {tab === 'browse' && (
          <>
            <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel/30 space-y-2">
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称 / 简介 / 标签 / 作者…"
                  className="flex-1 min-w-0 bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
                <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'downloads')}
                  className="shrink-0 bg-void border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-slate-200 focus:outline-none focus:border-god/50">
                  <option value="downloads">最热</option>
                  <option value="recent">最新</option>
                </select>
                <button onClick={() => setRefreshKey((k) => k + 1)} title="刷新"
                  className="shrink-0 text-[13px] font-mono px-2.5 py-1.5 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">↻</button>
              </div>
              {/* 类型筛（分组） */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {visibleKinds.map((k) => (
                  <FilterChip key={k.id} active={filterType === k.id} onClick={() => setFilterType(k.id)} label={`${k.emoji}${k.label}`} />
                ))}
              </div>
              {/* 子分类筛 */}
              {catsOfType && catsOfType.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-dim/35">分类</span>
                  <FilterChip active={filterCat === ''} onClick={() => setFilterCat('')} label="全部" />
                  {catsOfType.map((c) => <FilterChip key={c} active={filterCat === c} onClick={() => setFilterCat(c)} label={c} />)}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
              {error && !loading && (
                <div className="py-12 text-center text-blood/70 text-[13px] font-mono border border-dashed border-blood/30 rounded-xl px-4">
                  {error}
                  <div className="text-dim/40 mt-2 text-[11px]">后端可能未部署或不可达。见「设置」检查地址，或参考 multiplayer-worker/WORKSHOP-DEPLOY.md 部署。</div>
                </div>
              )}
              {!loading && !error && shown.length === 0 && (
                <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">暂无内容 · 来「上传」分享第一个吧</div>
              )}
              {!loading && !error && shown.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {shown.map((m) => {
                    const st = statusFor(installs, m);
                    const kind = kindOf(m.type);
                    return (
                      <div key={m.id} onClick={() => setDetail(m)} role="button" tabIndex={0} title="点击看详情"
                        className="rounded-xl border border-edge bg-panel/60 p-3 hover:border-god/30 transition-colors flex flex-col cursor-pointer">
                        <div className="flex items-start gap-2.5">
                          <span className="text-lg shrink-0 mt-0.5">{kind?.emoji ?? '❔'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-semibold text-slate-100"><AutoText text={m.name} /></span>
                              <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-edge text-dim/50">{kind?.label ?? m.type}{m.category ? `·${m.category}` : ''}</span>
                              {m.version && <span className="text-[10px] font-mono text-dim/40">v{m.version}</span>}
                            </div>
                            {m.summary && <div className="text-[12px] text-dim/70 mt-1 leading-snug line-clamp-3"><AutoText text={m.summary} /></div>}
                            <div className="flex items-center gap-2 text-[10px] font-mono text-dim/45 mt-1 flex-wrap">
                              <span className="text-god/60">⬇ {m.downloads ?? 0}</span>
                              {m.author && <span>by {m.author}</span>}
                              {m.createdAt && <span>· {fmtDate(m.createdAt)}</span>}
                              {(m.tags ?? []).slice(0, 4).map((t) => <span key={t} className="px-1 rounded bg-void/60 text-dim/50">#{t}</span>)}
                            </div>
                          </div>
                          <div className="shrink-0 self-center flex flex-col items-end gap-1">
                            {st === 'installed' ? (
                              <span className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-600/40 text-emerald-300/80">✓ 已装</span>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); doInstall(m); }} disabled={installingId === m.id}
                                className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${st === 'update' ? 'border-amber-500/50 text-amber-300/90 hover:bg-amber-900/25' : 'border-god/50 text-god hover:bg-god/10'}`}>
                                {installingId === m.id ? '…' : st === 'update' ? '↻ 更新' : '⤓ 安装'}
                              </button>
                            )}
                            {adminKey && (
                              <button onClick={(e) => { e.stopPropagation(); adminDelete(m); }} disabled={deletingId === m.id} title="管理员删除"
                                className="text-[10px] font-mono px-2 py-0.5 rounded border border-blood/40 text-blood/70 hover:bg-blood/10 transition-colors disabled:opacity-50">
                                {deletingId === m.id ? '…' : '🗑 删'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 上传 ── */}
        {tab === 'upload' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-2xl mx-auto rounded-xl border border-edge bg-panel/50 p-4 space-y-3">
              <div className="text-[14px] font-semibold text-slate-200">上传分享</div>
              <div className="text-[11px] font-mono text-amber-300/70 -mt-1">⚠ 无审核：上传后立即对所有人可见。请勿上传违规内容。</div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="text-[11px] font-mono text-dim/60">类型
                  <select value={pubType} onChange={(e) => setPubType(e.target.value as WorkshopKindId)}
                    className="w-full mt-1 bg-void border border-edge rounded px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-god/50">
                    {groupsPresent.map((g) => (
                      <optgroup key={g} label={g}>
                        {visibleKinds.filter((k) => k.group === g).map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.label}（{localEntriesOf(k.id).length}）</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-mono text-dim/60">本地条目
                  <select value={pubLocalId} onChange={(e) => { const id = e.target.value; setPubLocalId(id); const en = pubList.find((x) => x.id === id); if (en) setForm((f) => ({ ...f, name: en.name })); }}
                    className="w-full mt-1 bg-void border border-edge rounded px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-god/50">
                    {pubList.length === 0 ? <option value="">（无可上传条目）</option> : pubList.map((e) => <option key={e.id} value={e.id}>{e.name}{e.category ? `（${e.category}）` : ''}</option>)}
                  </select>
                </label>
              </div>

              {/* 世界书：本地 .json 直传（不必先导进设置页）+ 指定别人下载后放进哪一栏 */}
              {pubType === 'worldbook' && (
                <div className="rounded-lg border border-edge/70 bg-void/40 p-2.5 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => wbFileRef.current?.click()}
                      className="text-[12px] font-mono px-2.5 py-1.5 rounded border border-god/40 text-god hover:bg-god/10 transition-colors">📂 本地导入 (.json)</button>
                    <input ref={wbFileRef} type="file" accept=".json" className="hidden" onChange={handleWbFile} />
                    <span className="text-[11px] font-mono text-dim/50">兼容 SillyTavern 世界书 · 不必先导进设置页，选了文件就能分享</span>
                  </div>
                  {fileWb && (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-god/80">
                      <span className="truncate">✓ 已载入「{fileWb.name}」· {fileWb.count} 条条目</span>
                      <button type="button" onClick={() => { setFileWb(null); const l = localEntriesOf('worldbook'); setPubLocalId(l[0]?.id ?? ''); setForm((f) => ({ ...f, name: l[0]?.name ?? '' })); }}
                        className="shrink-0 text-dim/60 hover:text-blood">清除</button>
                    </div>
                  )}
                  {pubLocalId === FILE_LOCAL_ID && (
                    <div className="flex items-center gap-3 text-[11px] font-mono text-dim/60">
                      <span>下载后放进：</span>
                      {([['text', WB_CAT_TEXT], ['aux', WB_CAT_AUX]] as [WbShelf, string][]).map(([v, label]) => (
                        <label key={v} className={`cursor-pointer select-none ${wbShelf === v ? 'text-god' : 'text-dim/60 hover:text-slate-300'}`}>
                          <input type="radio" className="mr-1 align-middle accent-cyan-400" checked={wbShelf === v} onChange={() => setWbShelf(v)} />{label}
                        </label>
                      ))}
                    </div>
                  )}
                  {pubLocalId !== FILE_LOCAL_ID && pubList.length > 0 && (
                    <div className="text-[11px] font-mono text-dim/40">选的是本地已有的书 · 别人下载后会放回同一栏（括号里标了是哪一栏）。</div>
                  )}
                </div>
              )}

              {pubList.length === 0 && (
                <div className="text-[11px] font-mono text-amber-300/70">
                  {pubType === 'worldbook'
                    ? '本地还没有世界书——点上面「📂 本地导入」直接选个 .json 文件就能上传。'
                    : '该类型暂无可上传条目——换上面「类型」试试（括号里是各类条目数），或确认已进入有数据的游戏存档（上传读的是当前存档实时数据）。'}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <Field label="标题" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
                <label className="text-[11px] font-mono text-dim/60 block">上传者（署名）
                  <div className="w-full mt-1 bg-void/60 border border-edge rounded px-2 py-1.5 text-[12px] flex items-center justify-between gap-2">
                    <span className={`truncate ${nickname ? 'text-slate-200' : 'text-amber-300/70'}`}>{nickname || '未设置昵称'}</span>
                    <button type="button" onClick={() => setTab('settings')} className="shrink-0 text-god/80 text-[11px] hover:underline">{nickname ? '改名' : '去设置'}</button>
                  </div>
                </label>
                <Field label="版本" value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} />
                <Field label="标签（逗号分隔）" value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} />
              </div>
              <Field label={pubType === 'worldbook' ? '简介（世界书必填 · 简要介绍这本世界书的用途/内容）' : '简介'} value={form.summary} onChange={(v) => setForm((f) => ({ ...f, summary: v }))} />

              <button onClick={doUpload} disabled={!pubLocalId || uploading}
                className="w-full mt-1 text-[13px] font-mono px-3 py-2 rounded-lg border border-god/50 text-god hover:bg-god/10 transition-colors disabled:opacity-40">
                {uploading ? '上传中…' : '⤒ 上传到工坊'}
              </button>
              <div className="text-[11px] font-mono text-dim/40">上传会剥离图片/强化等运行时数据，只分享条目本体；NPC 连同其技能天赋与持有物一起分享；世界书按书架原样送达（默认落「{WB_CAT_TEXT}」）。</div>
            </div>
          </div>
        )}

        {/* ── 已上传（我的）── */}
        {tab === 'mine' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-mono text-dim/50">我上传到工坊的内容（删除会同时从工坊下架）</span>
              <button onClick={() => setMineRefresh((k) => k + 1)} title="刷新"
                className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">↻</button>
            </div>
            {mineLoading && <div className="py-16 text-center text-dim/50 text-sm font-mono">加载中…</div>}
            {mineErr && !mineLoading && (
              <div className="py-12 text-center text-blood/70 text-[13px] font-mono border border-dashed border-blood/30 rounded-xl px-4">{mineErr}</div>
            )}
            {!mineLoading && !mineErr && mineList.length === 0 && (
              <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">还没上传过内容 · 去「上传」分享一个吧</div>
            )}
            {!mineLoading && !mineErr && mineList.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/60 p-2.5">
                <span className="text-lg shrink-0">{kindOf(m.type)?.emoji ?? '❔'}</span>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetail(m)} title="点击看详情">
                  <div className="text-[13px] font-semibold text-slate-100 truncate">{m.name}</div>
                  <div className="text-[10px] font-mono text-dim/45">{kindOf(m.type)?.label ?? m.type}{m.category ? `·${m.category}` : ''}{m.version ? ` · v${m.version}` : ''} · <span className="text-god/60">⬇ {m.downloads ?? 0}</span> · {fmtDate(m.createdAt)}</div>
                </div>
                <button onClick={() => doDelete(m)} disabled={deletingId === m.id}
                  className="shrink-0 text-[11px] font-mono px-2.5 py-1 rounded border border-blood/40 text-blood/80 hover:bg-blood/10 transition-colors disabled:opacity-50">
                  {deletingId === m.id ? '删除中…' : '🗑 删除'}
                </button>
              </div>
            ))}
          </div>
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
              <div className="text-[11px] font-mono text-dim/40 px-1 pt-1">「忘记记录」只清账本（用于重新追踪更新），已装进各功能的内容需到对应面板删除。</div>
            )}
          </div>
        )}

        {/* ── 设置 ── */}
        {tab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="max-w-2xl mx-auto rounded-xl border border-edge bg-panel/50 p-4 space-y-3">
              <div className="text-[14px] font-semibold text-slate-200">工坊昵称（上传署名）</div>
              <div className="text-[11px] font-mono text-dim/50 -mt-1">上传的内容都会署上这个名字；改名后，你已上传的内容署名也会一起更新。</div>
              <div className="flex items-center gap-2">
                <input value={nickInput} onChange={(e) => setNickInput(e.target.value)} placeholder="给自己起个名字…" maxLength={40}
                  className="flex-1 min-w-0 bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
                <button onClick={saveNick} disabled={savingNick}
                  className="shrink-0 text-[12px] font-mono px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10 transition-colors disabled:opacity-50">{savingNick ? '保存中…' : '保存'}</button>
              </div>
              {nickname && <div className="text-[11px] font-mono text-dim/45">当前昵称：<span className="text-slate-300">{nickname}</span></div>}
            </div>
            <div className="max-w-2xl mx-auto rounded-xl border border-edge bg-panel/50 p-4 space-y-3">
              <div className="text-[14px] font-semibold text-slate-200">工坊后端地址</div>
              <div className="text-[11px] font-mono text-dim/50 -mt-1">默认连联机用的同一个 Worker：<span className="text-dim/70">{apiBase()}</span></div>
              <Field label="自定义后端地址（留空=用上面默认）" value={apiInput} onChange={setApiInput} />
              <div className="flex items-center gap-2">
                <button onClick={() => { setApiBase(apiInput); flash('已保存后端地址'); setRefreshKey((k) => k + 1); }}
                  className="text-[12px] font-mono px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10 transition-colors">保存</button>
                <button onClick={async () => { try { await wsList({}); flash('连接正常 ✓'); } catch (e: any) { flash(`连接失败：${e?.message ?? e}`); } }}
                  className="text-[12px] font-mono px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">🔌 测试连接</button>
              </div>
              <div className="text-[11px] font-mono text-dim/40 pt-1">后端是 zhushen-multiplayer Worker 的 /api/workshop（存 Cloudflare D1）。首次启用需建 D1 库并部署，见 multiplayer-worker/WORKSHOP-DEPLOY.md。</div>
            </div>

            <div className="max-w-2xl mx-auto rounded-xl border border-edge bg-panel/50 p-4 space-y-3">
              <div className="text-[14px] font-semibold text-slate-200">管理员密钥 {adminKey && <span className="text-[11px] font-mono text-emerald-300/80">· 已开启</span>}</div>
              <div className="text-[11px] font-mono text-dim/50 -mt-1">填入你在 worker 上设的密钥（<span className="text-dim/70">wrangler secret put WS_ADMIN_KEY</span>），开启后可删除工坊里任意条目（用于内容审核）。留空保存=关闭。</div>
              <div className="flex items-center gap-2">
                <input type="password" value={adminInput} onChange={(e) => setAdminInput(e.target.value)} placeholder="管理员密钥…"
                  className="flex-1 min-w-0 bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-dim/30 focus:outline-none focus:border-god/50" />
                <button onClick={saveAdmin} disabled={savingAdmin}
                  className="shrink-0 text-[12px] font-mono px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10 transition-colors disabled:opacity-50">{savingAdmin ? '验证中…' : '验证开启'}</button>
              </div>
              {adminKey && <div className="text-[11px] font-mono text-emerald-300/70">管理员模式已开：浏览/详情/已上传 里都能删除任意条目。</div>}
            </div>
          </div>
        )}

        {toast && <div className="shrink-0 px-4 py-2 border-t border-edge bg-god/10 text-[12px] font-mono text-god/90 text-center">{toast}</div>}
      </div>

      {/* ── 详情弹窗（点击条目）── */}
      {detail && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className={`w-full ${detail.type === 'skillTree' || detail.type === 'subProfTree' ? 'max-w-3xl' : detail.type === 'characterCard' || detail.type === 'worldbook' ? 'max-w-2xl' : 'max-w-lg'} max-h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden`}>
            <header className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-edge bg-panel">
              <span className="text-lg">{kindOf(detail.type)?.emoji ?? '❔'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-slate-100 truncate">{detail.name}</div>
                <div className="text-[11px] font-mono text-dim/55 truncate">{kindOf(detail.type)?.label}{detail.category ? `·${detail.category}` : ''}{detail.version ? ` · v${detail.version}` : ''} · ⬇{detail.downloads ?? 0}{detail.author ? ` · by ${detail.author}` : ''}</div>
              </div>
              <button onClick={() => setDetail(null)} className="text-dim/50 hover:text-blood text-lg">✕</button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {detail.summary && <div className="text-[12px] text-dim/75 leading-snug border-l-2 border-god/30 pl-2">{detail.summary}</div>}
              {detailLoading && <div className="py-10 text-center text-dim/50 text-sm font-mono">加载详情…</div>}
              {!detailLoading && detailFull && <DetailBody type={detail.type} payload={detailFull.payload} />}
              {!detailLoading && !detailFull && <div className="py-10 text-center text-blood/60 text-[12px] font-mono">详情加载失败</div>}
            </div>
            <div className="shrink-0 p-3 border-t border-edge space-y-2">
              {statusFor(installs, detail) === 'installed' ? (
                <div className="text-center text-[12px] font-mono text-emerald-300/80 py-1.5">✓ 已安装</div>
              ) : (
                <button onClick={() => doInstall(detail)} disabled={installingId === detail.id}
                  className="w-full text-[13px] font-mono px-3 py-2 rounded-lg border border-god/50 text-god hover:bg-god/10 transition-colors disabled:opacity-50">
                  {installingId === detail.id ? '安装中…' : statusFor(installs, detail) === 'update' ? '↻ 更新' : '⤓ 安装'}
                </button>
              )}
              {adminKey && (
                <button onClick={() => adminDelete(detail)} disabled={deletingId === detail.id}
                  className="w-full text-[12px] font-mono px-3 py-1.5 rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10 transition-colors disabled:opacity-50">
                  {deletingId === detail.id ? '删除中…' : '🗑 管理员删除'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
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
        className="w-full mt-1 bg-void border border-edge rounded px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-god/50" />
    </label>
  );
}

/* 详情展示：把条目 payload 的所有具体字段渲染成「标签：值」 */
const DETAIL_LABELS: Record<string, string> = {
  category: '类别', gradeDesc: '品级', effect: '效果', subType: '类型', combatStat: '攻防', durability: '耐久',
  requirement: '装备需求', affix: '词缀', score: '评分', intro: '简介', origin: '产地', appearance: '外观',
  notes: '备注', acquisition: '获得途径', enhanceLevel: '强化等级', awakenLv: '觉醒', sockets: '孔位',
  gemSlot: '宝石部位', gemAttr: '宝石属性', tags: '标签',
  level: '等级', skillType: '技能类型', rarity: '品级', target: '目标', damage: '伤害', cost: '消耗',
  cooldown: '冷却', desc: '描述', source: '来源', attrBonus: '属性加成', layers: '层数', layerEffects: '各层效果',
  note: '点评', bonusEffect: '额外效果', obtainedTime: '获得时间',
  realm: '阶位', personality: '性格', background: '背景', profession: '职业', title: '头衔', age: '年龄',
  gender: '性别', bioStrength: '强度', review: '评价', appearanceDetail: '外观细节', appearance5: '形象',
  tier: '档位', progress: '熟练度', recipeLabel: '配方称谓', recipes: '配方', version: '版本',
};
const DETAIL_SKIP = new Set([
  'id', 'addedAt', 'equipped', 'equipSlot', 'locked', 'numeric', 'contentHash', 'image', 'attrs', 'items',
  'extra', 'onScene', 'isDead', 'isFriend', 'friendedAt', 'deadTurn', 'lastEvolvedTurn', 'freqMode', 'freqInterval',
  'updatedAt', 'avatar', 'avatarTags', 'imageTags', 'maxEnhanceLevel', 'affixLevel', 'realAttrs', 'luckDelta',
  'kitDone', 'keepForever', 'partyMember', 'partyWorld', 'partyRole', 'nodes', 'branches', 'constellations', 'data', 'quantity', 'gems',
]);

function valToStr(v: any): string {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? (x.name || x.title || '') : String(x))).filter(Boolean).join('、');
  if (typeof v === 'object') return '';   // 复杂对象交给特化渲染
  if (typeof v === 'boolean') return v ? '是' : '';
  return String(v);
}

function Row({ label, val }: { label: string; val: string }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="text-dim/45 font-mono shrink-0 w-16">{label}</span>
      <span className="text-slate-200 break-words whitespace-pre-wrap flex-1 min-w-0">{val}</span>
    </div>
  );
}

/* 技能树 / 副职业配方树 详情：完整星图（只读 TreeCanvas）+ 流派 + 各节点技能/天赋/配方 + 星座奖励 */
function TreeDetail({ payload, kind }: { payload: any; kind: WorkshopKindId }) {
  const tree = useMemo(() => autoLayout(payload as TreeDef), [payload]);
  const grants: { node: string; kind: string; name: string; tier?: string; effect?: string; desc?: string; materials?: string; output?: string }[] = [];
  for (const n of tree.nodes) {
    if (n.grants?.skill) grants.push({ node: n.name, kind: '技能', name: n.grants.skill.name, effect: n.grants.skill.effect, desc: n.grants.skill.desc });
    if (n.grants?.trait) grants.push({ node: n.name, kind: '天赋', name: n.grants.trait.name, effect: n.grants.trait.effect, desc: n.grants.trait.desc });
    const r = (n.grants as any)?.recipe;
    if (r) grants.push({ node: n.name, kind: '配方', name: r.name, tier: r.tier, materials: r.materials, output: r.output, desc: r.desc });
  }
  const consts = tree.constellations ?? [];
  const listLabel = kind === 'subProfTree' ? '配方' : '技能 / 天赋';
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-mono text-dim/55">{tree.profession}{tree.title ? ` · ${tree.title}` : ''} · {tree.nodes.length} 节点 · {tree.branches.length} 流派{consts.length ? ` · ${consts.length} 星座` : ''}</div>
      {/* 完整星图（只读） */}
      <div className="overflow-auto rounded-lg border border-edge bg-void/40">
        <TreeCanvas tree={tree} mode="play" heightVh={42} />
      </div>
      {/* 流派 */}
      {tree.branches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tree.branches.map((b) => <span key={b.id} className="text-[11px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: `${b.color}66`, color: b.color }}>{b.name}</span>)}
        </div>
      )}
      {/* 技能 / 天赋效果 */}
      {grants.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-semibold text-slate-300">{listLabel}（{grants.length}）</div>
          {grants.map((g, i) => (
            <div key={i} className="text-[12px] border-l-2 border-god/30 pl-2">
              <span className="text-slate-100 font-semibold">{g.name}</span>
              <span className="text-[10px] font-mono text-dim/45 ml-1.5">{g.kind}{g.tier ? `·${g.tier}` : ''} · 节点「{g.node}」</span>
              {g.materials && <div className="text-dim/55 leading-snug">材料：{g.materials}</div>}
              {g.output && <div className="text-dim/70 leading-snug">产物：{g.output}</div>}
              {(g.effect || (!g.output && g.desc)) && <div className="text-dim/70 leading-snug whitespace-pre-wrap">{g.effect || g.desc}</div>}
            </div>
          ))}
        </div>
      )}
      {/* 星座奖励 */}
      {consts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-semibold text-slate-300">星座成型奖励（{consts.length}）</div>
          {consts.map((c) => (
            <div key={c.id} className="text-[12px] border-l-2 border-amber-500/40 pl-2">
              <span className="text-amber-300/90 font-semibold">✦ <AutoText text={c.name} /></span>
              {c.desc && <div className="text-dim/60 leading-snug"><AutoText text={c.desc} /></div>}
              {c.reward?.skill && <div className="text-dim/70 leading-snug">奖励技能「{c.reward.skill.name}」{c.reward.skill.effect ? '：' + c.reward.skill.effect : ''}</div>}
              {c.reward?.trait && <div className="text-dim/70 leading-snug">奖励天赋「{c.reward.trait.name}」{c.reward.trait.effect ? '：' + c.reward.trait.effect : ''}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 角色卡详情：主角完整面板（身份/六维/装备/物品/技能/天赋/称号/副职业，全字段不简化） */
function CardItemList({ title, items }: { title: string; items: any[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-semibold text-slate-300">{title}（{items.length}）</div>
      {items.map((it, i) => (
        <div key={i} className="text-[12px] border-l-2 border-edge pl-2">
          <span className="text-slate-100 font-semibold"><AutoText text={it.name} /></span>
          {it.gradeDesc && <span className="text-[10px] text-dim/45 ml-1.5">{it.gradeDesc}</span>}
          {it.enhanceLevel ? <span className="text-[10px] text-amber-300/70 ml-1">+{it.enhanceLevel}</span> : null}
          {(it.combatStat || it.durability) && <div className="text-dim/60">{[it.combatStat, it.durability ? `耐久${it.durability}` : ''].filter(Boolean).join(' · ')}</div>}
          {it.effect && <div className="text-dim/70 whitespace-pre-wrap">{it.effect}</div>}
          {it.affix && <div className="text-fuchsia-300/60">{it.affix}</div>}
          {it.intro && <div className="text-dim/45 italic leading-snug"><AutoText text={it.intro} /></div>}
        </div>
      ))}
    </div>
  );
}
function CardAbilityList({ title, arr }: { title: string; arr: any[] }) {
  if (!arr?.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-semibold text-slate-300">{title}（{arr.length}）</div>
      {arr.map((x, i) => (
        <div key={i} className="text-[12px] border-l-2 border-god/30 pl-2">
          <span className="text-slate-100 font-semibold">{x.name}</span>
          {(x.level || x.rarity || x.tier) && <span className="text-[10px] text-dim/45 ml-1.5">{[x.level, x.rarity, x.tier].filter(Boolean).join('·')}</span>}
          {(x.effect || x.desc) && <div className="text-dim/70 whitespace-pre-wrap">{x.effect || x.desc}</div>}
        </div>
      ))}
    </div>
  );
}
function CharacterCardDetail({ payload }: { payload: any }) {
  const p = payload?.profile || {};
  const a = p.attrs || {};
  const items: any[] = payload?.items || [];
  const equipped = items.filter((i) => i.equipped);
  const inv = items.filter((i) => !i.equipped);
  return (
    <div className="space-y-2.5">
      <div className="text-[11px] font-mono text-dim/55">{[p.tier, p.level ? `Lv.${p.level}` : '', p.profession].filter(Boolean).join(' · ')}{p.race ? ` · ${p.race}` : ''}{p.gender ? ` · ${p.gender}` : ''}{p.age ? ` · ${p.age}` : ''}</div>
      {(p.personality || p.personalityDetail) && <Row label="性格" val={[p.personality, p.personalityDetail].filter(Boolean).join('；')} />}
      {p.raceDetail && <Row label="种族详情" val={p.raceDetail} />}
      {p.appearance && <Row label="外观" val={p.appearance} />}
      <Row label="六维" val={`力${a.str ?? '-'} 敏${a.agi ?? '-'} 体${a.con ?? '-'} 智${a.int ?? '-'} 魅${a.cha ?? '-'} 幸${a.luck ?? '-'}`} />
      {(payload?.maxHp != null || payload?.maxEp != null) && <Row label="HP/EP" val={`${payload?.maxHp ?? '-'} / ${payload?.maxEp ?? '-'}`} />}
      <CardItemList title="装备" items={equipped} />
      <CardItemList title="背包物品" items={inv} />
      <CardAbilityList title="技能" arr={payload?.skills || []} />
      <CardAbilityList title="天赋" arr={payload?.traits || []} />
      <CardAbilityList title="称号" arr={payload?.titles || []} />
      <CardAbilityList title="副职业" arr={payload?.subProfessions || []} />
      <div className="text-[11px] font-mono text-dim/40 pt-1">安装后会在「NPC」面板生成一名包含以上全部信息的离场 NPC。</div>
    </div>
  );
}

/* 世界书详情：条目列表（标题 / 关键词 / 内容预览） */
function WorldBookDetail({ payload }: { payload: any }) {
  const entries: any[] = payload?.entries || [];
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-mono text-dim/55">
        {entries.length} 条条目 · 安装后进「{payload?.shelf === 'aux' ? WB_CAT_AUX : WB_CAT_TEXT}」栏{payload?.enabled === false ? ' · 默认关闭' : ''}
      </div>
      {entries.length === 0 && <div className="text-[12px] text-dim/40">（空世界书）</div>}
      {entries.map((e, i) => (
        <div key={i} className="text-[12px] border-l-2 border-cyan-600/40 pl-2">
          <span className="text-slate-100 font-semibold">{e.comment || `条目 ${i + 1}`}</span>
          {Array.isArray(e.key) && e.key.length > 0 && <div className="text-[10px] font-mono text-dim/50">关键词：{e.key.join('、')}</div>}
          {e.content && <div className="text-dim/65 leading-snug whitespace-pre-wrap line-clamp-4">{e.content}</div>}
        </div>
      ))}
    </div>
  );
}

function DetailBody({ type, payload }: { type: WorkshopKindId; payload: any }) {
  if (type === 'worldbook') return <WorldBookDetail payload={payload} />;
  if (type === 'characterCard') return <CharacterCardDetail payload={payload} />;
  if (type === 'skillTree' || type === 'subProfTree') return <TreeDetail payload={payload} kind={type} />;
  const isNpc = type === 'npc';
  const obj = (isNpc ? payload?.record : payload) ?? {};
  const character = isNpc ? payload?.character : undefined;
  const img = obj.image || obj.avatar;
  const rows = Object.keys(obj)
    .filter((k) => !DETAIL_SKIP.has(k) && valToStr(obj[k]) !== '')
    .map((k) => ({ label: DETAIL_LABELS[k] || k, val: valToStr(obj[k]) }));
  return (
    <div className="space-y-1.5">
      {img && <img src={img} alt="" className="max-h-44 rounded-lg border border-edge object-contain mx-auto" />}
      {obj.attrs && <Row label="六维" val={`力${obj.attrs.str ?? '-'} 敏${obj.attrs.agi ?? '-'} 体${obj.attrs.con ?? '-'} 智${obj.attrs.int ?? '-'} 魅${obj.attrs.cha ?? '-'} 幸${obj.attrs.luck ?? '-'}`} />}
      {rows.map((r) => <Row key={r.label} label={r.label} val={r.val} />)}
      {Array.isArray(obj.items) && obj.items.length > 0 && <Row label="持有物" val={obj.items.map((x: any) => x.name).filter(Boolean).join('、')} />}
      {character && ((character.skills?.length ?? 0) > 0 || (character.traits?.length ?? 0) > 0 || (character.titles?.length ?? 0) > 0) && (
        <div className="pt-1.5 mt-1.5 border-t border-edge/50 space-y-1.5">
          {(character.skills?.length ?? 0) > 0 && <Row label="技能" val={character.skills.map((s: any) => s.name).join('、')} />}
          {(character.traits?.length ?? 0) > 0 && <Row label="天赋" val={character.traits.map((t: any) => t.name).join('、')} />}
          {(character.titles?.length ?? 0) > 0 && <Row label="称号" val={character.titles.map((t: any) => t.name).join('、')} />}
        </div>
      )}
      {rows.length === 0 && !img && !obj.attrs && <div className="text-[12px] text-dim/40 font-mono py-4 text-center">（无更多字段）</div>}
    </div>
  );
}
