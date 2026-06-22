import { useEffect, useRef, useState } from 'react';
import {
  listSlots, listAutoSnaps, saveSlot, loadSlot, renameSlot, deleteSlot, exportSlot, importSlot, newGame,
  extractPlayerFromSlot, type SlotMeta,
} from '../systems/saveManager';
import { buildDiagnosticBundle } from '../systems/diagnostics';
import { exportNovelTxt } from '../systems/novelExport';
import { useSettings } from '../store/settingsStore';
import {
  cloudUser, cloudLoggedIn, cloudLogin, cloudLogout, cloudListSaves, cloudUpload, cloudDownload, cloudDelete,
  type CloudUser, type CloudSaveMeta,
} from '../systems/cloudSave';

interface Props {
  messages: any[];     // 当前对话历史（保存时快照）
  onClose: () => void;
}

export default function SaveLoadPanel({ messages, onClose }: Props) {
  const [slots, setSlots] = useState<SlotMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null);
  const [confirmExtract, setConfirmExtract] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [diag, setDiag] = useState('');         // 诊断包文本（非空=显示结果浮层）
  const [diagBusy, setDiagBusy] = useState(false);
  const autoSaveEnabled = useSettings((s) => s.autoSaveEnabled);
  const autoSaveEvery = useSettings((s) => s.autoSaveEvery);
  const setAutoSaveEnabled = useSettings((s) => s.setAutoSaveEnabled);
  const setAutoSaveEvery = useSettings((s) => s.setAutoSaveEvery);
  const [cUser, setCUser] = useState<CloudUser | null>(cloudUser());   // 云存档登录用户
  const [cloudOpen, setCloudOpen] = useState(false);                   // 展开云存档区
  const [cloudSaves, setCloudSaves] = useState<CloudSaveMeta[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [confirmCloudDel, setConfirmCloudDel] = useState<string | null>(null);
  const [snapsOpen, setSnapsOpen] = useState(false);                   // 展开「自动备份」折叠区
  const [autoSnaps, setAutoSnaps] = useState<SlotMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() { setSlots(await listSlots()); }
  async function refreshSnaps() { setAutoSnaps(await listAutoSnaps()); }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (snapsOpen) void refreshSnaps(); }, [snapsOpen]);
  // 展开云存档区且已登录 → 拉云端列表
  useEffect(() => { if (cloudOpen && cloudLoggedIn()) void refreshCloud(); /* eslint-disable-next-line */ }, [cloudOpen]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 4000); }

  // 把当前对话历史导出成小说形式的 TXT（自动分章，剥除游戏数据块/结算卡，仅留剧情）
  function handleNovelExport() {
    const real = (messages || []).filter((m) => m && m.role !== 'system');
    if (real.length === 0) { flash('暂无对话内容可导出'); return; }
    try {
      const { chapters, chars } = exportNovelTxt(messages);
      flash(`📖 已导出小说 TXT：${chapters} 章 · ${chars.toLocaleString()} 字`);
    } catch (e: any) { flash('❌ 导出失败：' + (e?.message ?? e)); }
  }

  async function refreshCloud() {
    if (!cloudLoggedIn()) { setCloudSaves([]); return; }
    setCloudBusy(true);
    try { setCloudSaves(await cloudListSaves()); }
    catch (e: any) { flash('❌ ' + (e?.message ?? e)); setCUser(cloudUser()); }
    finally { setCloudBusy(false); }
  }
  async function handleCloudLogin() {
    setCloudBusy(true);
    try { const u = await cloudLogin(); setCUser(u); await refreshCloud(); flash(`✓ 已登录云存档：${u.name}`); }
    catch (e: any) { flash('❌ ' + (e?.message ?? e)); }
    finally { setCloudBusy(false); }
  }
  function handleCloudLogout() { cloudLogout(); setCUser(null); setCloudSaves([]); flash('已登出云存档'); }
  async function handleCloudUpload(s: SlotMeta) {
    if (!cloudLoggedIn()) { flash('请先登录云存档'); setCloudOpen(true); return; }
    setCloudBusy(true);
    try { await cloudUpload(s.id); await refreshCloud(); flash(`☁️ 已上传「${s.name}」到云端`); }
    catch (e: any) { flash('❌ 上传失败：' + (e?.message ?? e)); }
    finally { setCloudBusy(false); }
  }
  async function handleCloudDownload(cs: CloudSaveMeta) {
    setCloudBusy(true);
    try { await cloudDownload(cs.id); await refresh(); flash(`✓ 已从云端下载「${cs.name}」到本地（新存档槽）`); }
    catch (e: any) { flash('❌ 下载失败：' + (e?.message ?? e)); }
    finally { setCloudBusy(false); }
  }
  async function handleCloudDelete(cloudId: string) {
    setConfirmCloudDel(null); setCloudBusy(true);
    try { await cloudDelete(cloudId); await refreshCloud(); flash('已删除云端存档'); }
    catch (e: any) { flash('❌ 删除失败：' + (e?.message ?? e)); }
    finally { setCloudBusy(false); }
  }

  async function handleDiag() {
    if (diagBusy) return;
    setDiagBusy(true);
    try {
      const txt = await buildDiagnosticBundle();
      setDiag(txt);
      try { await navigator.clipboard.writeText(txt); flash('🩺 诊断包已生成并复制到剪贴板'); }
      catch { flash('🩺 诊断包已生成（复制失败，请在弹窗里手动复制）'); }
    } catch (e: any) {
      flash('❌ 诊断包生成失败：' + (e?.message ?? e));
    } finally { setDiagBusy(false); }
  }
  function downloadDiag() {
    const blob = new Blob([diag], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `诊断包_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function handleNew() {
    setBusy(true);
    try { await saveSlot(null, `存档 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, messages); await refresh(); flash('✓ 已新建存档'); }
    finally { setBusy(false); }
  }
  async function handleOverwrite(s: SlotMeta) {
    setBusy(true);
    try { await saveSlot(s.id, s.name, messages); await refresh(); flash(`✓ 已覆盖「${s.name}」`); }
    finally { setBusy(false); }
  }
  async function handleExtract(id: string) {
    setConfirmExtract(null);
    setBusy(true);
    try {
      const r = await extractPlayerFromSlot(id);
      if (!r) { flash('❌ 该存档里没有主角(B1)数据，无法提取'); return; }
      const c = r.counts;
      const tree = r.treeApplied ? '；技能树点位已同步该档' : '';
      if (r.added.length === 0) flash(`当前主角已包含该存档的全部 技能/天赋/副职业（无新增）${tree}。现 技能${c.skills}/天赋${c.traits}/副职业${c.subProfessions}`);
      else flash(`✓ 已并入主角：${r.added.join('、')}${tree}。现 技能${c.skills}/天赋${c.traits}/副职业${c.subProfessions}/称号${c.titles}`);
    } catch (e: any) { flash('❌ 提取失败：' + (e?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function handleLoad(id: string) {
    setBusy(true);
    flash('读取中…即将重载页面');
    // loadSlot 内部会 location.reload()，对话历史经 sessionStorage 恢复
    const ok = await loadSlot(id);
    if (!ok) { setBusy(false); setConfirmLoad(null); flash('❌ 存档不存在'); }
  }
  async function handleDelete(id: string) {
    await deleteSlot(id); await refresh(); if (snapsOpen) await refreshSnaps(); setConfirmDel(null); flash('已删除');
  }
  async function handleRename(id: string) {
    await renameSlot(id, renameVal); setRenaming(null); await refresh();
  }
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try { await importSlot(ev.target?.result as string); await refresh(); flash('✓ 已导入存档'); }
      catch (err: any) { flash('❌ 导入失败：' + (err?.message ?? '格式错误')); }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">

        <header className="shrink-0 flex flex-wrap items-center gap-3 max-lg:gap-2 px-5 max-lg:px-3 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg shrink-0">💾</span>
          <div className="flex-1 min-w-0 max-lg:basis-full">
            <div className="text-sm font-bold text-slate-100">存档管理</div>
            <div className="text-[12px] font-mono text-dim/60">每个存档 = 当前全部进度 + 对话历史的快照</div>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          {confirmNew ? (
            <>
              <span className="text-[12px] font-mono text-blood">开新游戏会清空当前进度（设置/预设保留）</span>
              <button onClick={() => newGame()} className="px-2.5 py-1 text-[13px] font-mono border border-blood/60 text-blood rounded hover:bg-blood/10">确认新游戏</button>
              <button onClick={() => setConfirmNew(false)} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded">取消</button>
            </>
          ) : (
            <button onClick={() => setConfirmNew(true)} disabled={busy}
              className="px-2.5 py-1 text-[13px] font-mono border border-amber-600/50 text-amber-400 rounded hover:bg-amber-900/20 transition-colors disabled:opacity-40">🆕 新游戏</button>
          )}
          <button onClick={handleNovelExport} disabled={busy}
            title="把当前对话历史导出成小说形式的 TXT（自动分章：第一章/第二章…；只留剧情正文，剥除 <state>/结算卡/骰子卡等游戏数据；玩家行动以 ▷ 标出）"
            className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors disabled:opacity-40">📖 导出小说</button>
          <button onClick={handleDiag} disabled={diagBusy}
            title="导出精简诊断包（不含图片/对话）：各存档与当前进度的 技能/天赋/副职业 计数 + 内存vs本地对照 + 容量占用，可直接粘贴给开发者排查"
            className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors disabled:opacity-40">{diagBusy ? '生成中…' : '🩺 诊断包'}</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors disabled:opacity-40">导入</button>
          <button onClick={handleNew} disabled={busy}
            className="px-3 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 transition-colors disabled:opacity-40">+ 新建存档</button>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors ml-1">✕</button>
        </header>

        {msg && <div className={`shrink-0 px-5 py-1.5 text-sm font-mono ${msg.includes('❌') ? 'text-blood' : 'text-god'}`}>{msg}</div>}

        {/* 自动存档开关（省内存/防大档撑爆）：自动档不含图片，手动「新建存档」才带图 */}
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 max-lg:px-3 py-2 border-b border-edge/60 bg-panel/40 text-[12px] font-mono text-dim">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={autoSaveEnabled !== false} onChange={(e) => setAutoSaveEnabled(e.target.checked)} className="accent-god" />
            <span className={autoSaveEnabled !== false ? 'text-god' : 'text-dim'}>每回合自动存档</span>
          </label>
          {autoSaveEnabled !== false && (
            <label className="flex items-center gap-1.5">
              <span>每</span>
              <input type="number" min={1} value={autoSaveEvery} onChange={(e) => setAutoSaveEvery(Number(e.target.value))}
                className="w-12 bg-void border border-edge rounded px-1 py-0.5 text-center text-slate-200 outline-none focus:border-god/50" />
              <span>回合存一次</span>
            </label>
          )}
          <span className="text-dim/40 max-lg:basis-full">{autoSaveEnabled !== false ? '自动档不含图片(省内存)；跨设备/备份请用「新建存档」(带图)' : '已关闭——进度不再自动保存，请手动「新建/覆盖存档」'}</span>
        </div>

        {/* ☁️ 云存档（Discord 登录 + 手动上传/下载，含图） */}
        <div className="shrink-0 border-b border-edge/60 bg-panel/30">
          <button onClick={() => setCloudOpen((v) => !v)} className="w-full flex items-center gap-2 px-5 max-lg:px-3 py-2 text-[12px] font-mono text-dim hover:text-god transition-colors">
            <span className="text-god/70">☁️</span>
            <span className="font-bold text-slate-200">云存档</span>
            {cUser ? <span className="text-god/80">· {cUser.name}</span> : <span className="text-dim/50">· 未登录</span>}
            {cloudBusy && <span className="animate-spin inline-block">◌</span>}
            <span className={`ml-auto text-god/50 transition-transform ${cloudOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {cloudOpen && (
            <div className="px-5 max-lg:px-3 pb-2 space-y-2">
              {!cUser ? (
                <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono text-dim">
                  <button onClick={handleCloudLogin} disabled={cloudBusy}
                    className="px-3 py-1 rounded border border-[#5865F2]/60 text-[#aab4ff] bg-[#5865F2]/10 hover:bg-[#5865F2]/20 disabled:opacity-50 transition-colors">🎮 用 Discord 登录</button>
                  <span className="text-dim/40">登录后可把存档(含图)同步到云端，换设备/重装都能拉回</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
                    <span className="text-dim">已登录 <span className="text-god">{cUser.name}</span></span>
                    <button onClick={refreshCloud} disabled={cloudBusy} className="px-2 py-0.5 border border-edge text-dim rounded hover:text-god disabled:opacity-50">刷新</button>
                    <button onClick={handleCloudLogout} className="px-2 py-0.5 border border-edge text-dim rounded hover:text-blood">登出</button>
                    <span className="text-dim/40 max-lg:basis-full">本地存档点「☁️上传」推到云端；下方为你的云端存档</span>
                  </div>
                  {cloudSaves.length === 0 ? (
                    <div className="text-[12px] font-mono text-dim/40 py-1">云端暂无存档——在下方本地存档上点「☁️上传」</div>
                  ) : cloudSaves.map((cs) => (
                    <div key={cs.id} className="rounded-lg border border-god/15 bg-god/5 px-3 py-2 flex items-center gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-100 truncate">{cs.name} {cs.hasImages && <span className="text-[11px] text-god/60">🖼</span>}</div>
                        <div className="text-[12px] font-mono text-dim/60 truncate">回合 {cs.turn ?? 0}{cs.playerName ? ` · ${cs.playerName}` : ''} · {new Date(cs.updatedAt).toLocaleString('zh-CN', { hour12: false })} · {(cs.size / 1024 / 1024).toFixed(1)}MB</div>
                      </div>
                      {confirmCloudDel === cs.id ? (
                        <>
                          <button onClick={() => handleCloudDelete(cs.id)} className="px-2 py-0.5 text-[12px] font-mono border border-blood/60 text-blood rounded hover:bg-blood/10">删云端</button>
                          <button onClick={() => setConfirmCloudDel(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleCloudDownload(cs)} disabled={cloudBusy} className="px-2 py-0.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-50">⬇ 下载</button>
                          <button onClick={() => setConfirmCloudDel(cs.id)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood">删</button>
                        </>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {slots.length === 0 ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              暂无存档<div className="mt-2 text-dim/30">点右上「+ 新建存档」保存当前进度</div>
            </div>
          ) : slots.map((s) => (
            <div key={s.id} className="rounded-lg border border-edge bg-panel/60 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                {renaming === s.id ? (
                  <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(s.id); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={() => handleRename(s.id)}
                    className="flex-1 bg-void border border-god/40 rounded px-2 py-0.5 text-sm font-mono text-slate-100 outline-none" />
                ) : (
                  <span className="flex-1 text-sm font-semibold text-slate-100 truncate">{s.name}</span>
                )}
                <span className="text-[12px] font-mono text-dim/50 shrink-0">{new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-dim/70 font-mono">
                <span>回合 {s.preview?.turn ?? 0}</span>
                {s.preview?.playerName && <span>主角 {s.preview.playerName}</span>}
                {s.preview?.location && <span>📍 {s.preview.location}</span>}
              </div>
              {s.preview?.lastText && <div className="text-[13px] text-dim/60 leading-relaxed line-clamp-2">{s.preview.lastText}</div>}

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {confirmLoad === s.id ? (
                  <>
                    <span className="text-[12px] font-mono text-amber-400">读取将覆盖当前进度？</span>
                    <button onClick={() => handleLoad(s.id)} disabled={busy} className="px-2 py-0.5 text-[12px] font-mono border border-amber-500/50 text-amber-300 rounded hover:bg-amber-900/20">确认读取</button>
                    <button onClick={() => setConfirmLoad(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                  </>
                ) : confirmDel === s.id ? (
                  <>
                    <span className="text-[12px] font-mono text-blood">确认删除？</span>
                    <button onClick={() => handleDelete(s.id)} className="px-2 py-0.5 text-[12px] font-mono border border-blood/60 text-blood rounded hover:bg-blood/10">删除</button>
                    <button onClick={() => setConfirmDel(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                  </>
                ) : confirmExtract === s.id ? (
                  <>
                    <span className="text-[12px] font-mono text-god">把此档的主角技能/天赋/副职业并入当前游戏（技能只增不减；<span className="text-amber-400">技能树点位会换成此档的</span>以保持一致）？</span>
                    <button onClick={() => handleExtract(s.id)} disabled={busy} className="px-2 py-0.5 text-[12px] font-mono border border-god/60 text-god rounded hover:bg-god/10">确认提取</button>
                    <button onClick={() => setConfirmExtract(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                  </>
                ) : (
                  <>
                    <Btn onClick={() => setConfirmLoad(s.id)} cls="border-god/40 text-god hover:bg-god/10">读取</Btn>
                    <Btn onClick={() => handleOverwrite(s)} cls="border-edge text-dim hover:border-god/40 hover:text-god">覆盖</Btn>
                    <Btn onClick={() => { setRenaming(s.id); setRenameVal(s.name); }} cls="border-edge text-dim hover:text-slate-200">改名</Btn>
                    <Btn onClick={() => exportSlot(s.id)} cls="border-edge text-dim hover:text-slate-200">导出</Btn>
                    <Btn onClick={() => handleCloudUpload(s)} cls="border-god/30 text-god/80 hover:bg-god/10" title="把这个存档（含图）上传到云端（需先在上方☁️登录）；同名存档会覆盖云端那份">☁️上传</Btn>
                    <Btn onClick={() => setConfirmExtract(s.id)} cls="border-god/30 text-god/80 hover:bg-god/10" title="把这个存档里【主角(B1)的 技能/天赋/副职业/称号】补进当前游戏（按名字去重、只增不减），并把技能树点位同步成此档的以保持一致；不读回整档、不动剧情/其它角色——救「技能丢了但旧档还在」">提主角</Btn>
                    <Btn onClick={() => setConfirmDel(s.id)} cls="border-edge text-dim hover:border-blood/40 hover:text-blood">删除</Btn>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* 🛟 自动备份（滚动·从主列表移到这里，避免一堆刷屏）：每回合一份、保最近 5 份，供回滚 */}
          <div className="rounded-lg border border-edge/60 bg-panel/20">
            <button onClick={() => setSnapsOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-mono text-dim hover:text-god transition-colors">
              <span className="text-god/60">🛟</span>
              <span className="font-bold text-slate-300">自动备份{snapsOpen && autoSnaps.length ? ` (${autoSnaps.length})` : ''}</span>
              <span className="text-dim/40 max-lg:hidden">每回合自动留一份·保最近 5 份·供回滚</span>
              <span className={`ml-auto text-god/50 transition-transform ${snapsOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {snapsOpen && (
              <div className="px-3 pb-2 space-y-1.5">
                {autoSnaps.length === 0 ? (
                  <div className="text-[12px] font-mono text-dim/40 py-1">暂无自动备份</div>
                ) : autoSnaps.map((s) => (
                  <div key={s.id} className="rounded border border-edge/60 bg-void/40 px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-slate-200 truncate">{s.name}</div>
                      <div className="text-[11px] font-mono text-dim/50 truncate">回合 {s.preview?.turn ?? 0}{s.preview?.location ? ` · 📍${s.preview.location}` : ''} · {new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}</div>
                    </div>
                    {confirmLoad === s.id ? (
                      <>
                        <span className="text-[12px] font-mono text-amber-400">回滚到此备份(覆盖当前)？</span>
                        <button onClick={() => handleLoad(s.id)} disabled={busy} className="px-2 py-0.5 text-[12px] font-mono border border-amber-500/50 text-amber-300 rounded hover:bg-amber-900/20">确认</button>
                        <button onClick={() => setConfirmLoad(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                      </>
                    ) : confirmDel === s.id ? (
                      <>
                        <button onClick={() => handleDelete(s.id)} className="px-2 py-0.5 text-[12px] font-mono border border-blood/60 text-blood rounded hover:bg-blood/10">删</button>
                        <button onClick={() => setConfirmDel(null)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded">取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setConfirmLoad(s.id)} className="px-2 py-0.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10">回滚</button>
                        <button onClick={() => setConfirmDel(s.id)} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood">删</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {diag && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDiag(''); }}>
          <div className="w-full max-w-2xl h-[80vh] flex flex-col rounded-2xl border border-god/30 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
            <header className="shrink-0 flex items-center gap-2 px-5 max-lg:px-3 py-3 border-b border-edge bg-panel">
              <span className="text-god/60 text-lg shrink-0">🩺</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100">诊断包</div>
                <div className="text-[12px] font-mono text-dim/60 truncate">已复制到剪贴板，可直接粘贴；下方亦可手动选择或下载 .txt</div>
              </div>
              <button onClick={() => { navigator.clipboard?.writeText(diag).then(() => flash('已复制')).catch(() => {}); }}
                className="px-2.5 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 shrink-0">复制</button>
              <button onClick={downloadDiag}
                className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:text-god hover:border-god/40 shrink-0">下载</button>
              <button onClick={() => setDiag('')} className="text-dim/50 hover:text-blood text-lg ml-1 shrink-0">✕</button>
            </header>
            <textarea readOnly value={diag} onFocus={(e) => e.currentTarget.select()}
              className="flex-1 w-full resize-none bg-void text-[12px] font-mono text-slate-300 leading-relaxed p-4 outline-none whitespace-pre" />
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({ onClick, cls, children, title }: { onClick: () => void; cls: string; children: React.ReactNode; title?: string }) {
  return (
    <button onClick={onClick} title={title} className={`px-2 py-0.5 text-[12px] font-mono border rounded transition-colors ${cls}`}>
      {children}
    </button>
  );
}
