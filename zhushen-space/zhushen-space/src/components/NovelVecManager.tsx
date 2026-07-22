import { useRef, useState, type ChangeEvent } from 'react';
import { useNovelVec, type UserIndexMeta, type UserIndexKind } from '../store/novelVecStore';
import { loadNovelIndex, novelVecStatus, retrieveNovel, refreshNovelIndex, invalidateUserIndex, BUILTIN_SOURCES, type NovelHit } from '../systems/novelVec';
import { buildUserIndex, chunkText } from '../systems/novelVecBuild';
import { exportUserIndexToFile, importUserIndexFromFile } from '../systems/novelVecShare';
import { deleteIndex } from '../systems/novelVecDb';
import { cloudUpload, cloudList, cloudDownload, cloudDelete, pubList, pubPublish, pubDownload, pubDelete, type CloudIndexInfo, type PubIndexMeta } from '../systems/novelVecCloud';
import { myPlayerId } from '../systems/mpConfig';
import { chatReady } from '../systems/chatIdentity';

/* 向量资料库：查询接口 + 检索参数 + 【浏览器内自建库】 + 我的库列表(导出/删除/上传云端/发布社区) + 云端·社区浏览 + 测试。 */
const inputCls = 'w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-god/50';
const btnCls = 'text-[12px] font-mono px-2.5 py-1 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors';
const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

export default function NovelVecManager() {
  const settings = useNovelVec((s) => s.settings);
  const setSettings = useNovelVec((s) => s.setSettings);
  const userIndexes = useNovelVec((s) => s.userIndexes);
  const removeUserIndex = useNovelVec((s) => s.removeUserIndex);
  const setUserIndexEnabled = useNovelVec((s) => s.setUserIndexEnabled);
  const setBuiltinEnabled = useNovelVec((s) => s.setBuiltinEnabled);

  const [status, setStatus] = useState(novelVecStatus());
  const [loadingIdx, setLoadingIdx] = useState(false);
  const [testQuery, setTestQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [hits, setHits] = useState<NovelHit[] | null>(null);

  // 建库
  const [bName, setBName] = useState('');
  const [bKind, setBKind] = useState<UserIndexKind>('text');
  const [bText, setBText] = useState('');
  const [bFile, setBFile] = useState<File | null>(null);
  const [bChunk, setBChunk] = useState(700);
  const [bOverlap, setBOverlap] = useState(100);
  const [building, setBuilding] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [buildMsg, setBuildMsg] = useState('');
  const [preview, setPreview] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const buildFileRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // 云端/社区
  const [showCloud, setShowCloud] = useState(false);
  const [cloudItems, setCloudItems] = useState<CloudIndexInfo[] | null>(null);
  const [cloudMsg, setCloudMsg] = useState('');
  const [pubItems, setPubItems] = useState<PubIndexMeta[] | null>(null);
  const [pubQ, setPubQ] = useState('');
  const [pubMsg, setPubMsg] = useState('');
  const [busyId, setBusyId] = useState('');   // 正在处理的库 id（禁用按钮）

  async function doLoad() {
    setLoadingIdx(true);
    await loadNovelIndex();
    setStatus(novelVecStatus());
    setLoadingIdx(false);
  }
  async function doTest() {
    if (!testQuery.trim() || testing) return;
    setTesting(true); setHits(null);
    try { setHits(await retrieveNovel(testQuery.trim())); } catch { setHits([]); }
    setStatus(novelVecStatus());
    setTesting(false);
  }

  async function readSource(): Promise<string> {
    if (bFile) return await bFile.text();
    return bText;
  }
  async function doPreview() {
    try {
      const text = await readSource();
      if (!text.trim()) { setPreview(0); return; }
      setPreview(chunkText(bKind, text, bChunk, bOverlap).length);
    } catch (e: any) { setBuildMsg('预览失败：' + (e?.message ?? e)); setPreview(null); }
  }

  async function doBuild() {
    if (building) return;
    const name = bName.trim();
    if (!name) { setBuildMsg('请先给向量库起个名字'); return; }
    if (!settings.apiBase || !settings.apiKey) { setBuildMsg('请先在上方「Embedding 接口」填 Base + Key（建库也用它）'); return; }
    let text = '';
    try { text = await readSource(); } catch (e: any) { setBuildMsg('读取来源失败：' + (e?.message ?? e)); return; }
    if (!text.trim()) { setBuildMsg('来源为空：粘贴文本或选一个文件'); return; }
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setBuilding(true); setBuildMsg(''); setProg({ done: 0, total: 0 });
    try {
      const meta = await buildUserIndex({
        name, kind: bKind, text, chunkSize: bChunk, overlap: bOverlap,
        apiBase: settings.apiBase, apiKey: settings.apiKey, model: (settings.model || 'Pro/BAAI/bge-m3'),
        signal: ctrl.signal,
        onProgress: (done, total) => setProg({ done, total }),
      });
      setBuildMsg(`✓ 建好「${meta.name}」：${meta.count} 段 · ${meta.dim} 维 · ${kb(meta.sizeBytes)}`);
      setBName(''); setBText(''); setBFile(null); setPreview(null);
      if (buildFileRef.current) buildFileRef.current.value = '';
      await refreshNovelIndex(); setStatus(novelVecStatus());
    } catch (e: any) {
      setBuildMsg(e?.name === 'AbortError' ? '已取消建库' : '建库失败：' + (e?.message ?? e));
    } finally { setBuilding(false); abortRef.current = null; }
  }

  async function doDeleteIndex(m: UserIndexMeta) {
    if (!window.confirm(`删除向量库「${m.name}」？（本地数据将清除，不影响已上传云端/社区的副本）`)) return;
    setBusyId(m.id);
    try {
      removeUserIndex(m.id);
      await deleteIndex(m.id);
      invalidateUserIndex(m.id);
      await refreshNovelIndex(); setStatus(novelVecStatus());
    } finally { setBusyId(''); }
  }
  async function doExport(m: UserIndexMeta) {
    setBusyId(m.id);
    try { await exportUserIndexToFile(m); } catch (e: any) { alert('导出失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }
  async function doImportFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const meta = await importUserIndexFromFile(f);
      setBuildMsg(`✓ 已导入「${meta.name}」：${meta.count} 段`);
      await refreshNovelIndex(); setStatus(novelVecStatus());
    } catch (err: any) { setBuildMsg('导入失败：' + (err?.message ?? err)); }
    if (importFileRef.current) importFileRef.current.value = '';
  }
  async function doCloudUpload(m: UserIndexMeta) {
    setBusyId(m.id); setCloudMsg('');
    try { await cloudUpload(m); setCloudMsg(`✓ 已上传「${m.name}」到私有云`); }
    catch (e: any) { setCloudMsg('上传失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }
  async function doPublish(m: UserIndexMeta) {
    if (!window.confirm(`发布「${m.name}」到公开社区？任何人都能浏览下载。\n⚠ 请勿发布受版权保护的整本原文。`)) return;
    setBusyId(m.id); setPubMsg('');
    try { const id = await pubPublish(m, {}); setPubMsg(`✓ 已发布到社区（id ${id}）`); }
    catch (e: any) { setPubMsg('发布失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }

  async function loadCloud() {
    setCloudMsg('加载中…');
    try { setCloudItems(await cloudList()); setCloudMsg(''); }
    catch (e: any) { setCloudMsg('拉取私有云失败：' + (e?.message ?? e)); setCloudItems([]); }
  }
  async function loadPub() {
    setPubMsg('加载中…');
    try { setPubItems(await pubList({ q: pubQ.trim() || undefined, sort: 'recent', limit: 60 })); setPubMsg(''); }
    catch (e: any) { setPubMsg('拉取社区失败：' + (e?.message ?? e)); setPubItems([]); }
  }
  async function doCloudDownload(info: CloudIndexInfo) {
    setBusyId(info.remoteId);
    try { const m = await cloudDownload(info.remoteId); setCloudMsg(`✓ 已取回「${m.name}」到本地`); await refreshNovelIndex(); setStatus(novelVecStatus()); }
    catch (e: any) { setCloudMsg('取回失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }
  async function doCloudDelete(info: CloudIndexInfo) {
    if (!window.confirm(`从私有云删除「${info.name}」？（本地副本不受影响）`)) return;
    setBusyId(info.remoteId);
    try { await cloudDelete(info.remoteId); await loadCloud(); }
    catch (e: any) { setCloudMsg('删除失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }
  async function doPubDownload(it: PubIndexMeta) {
    setBusyId(it.id);
    try { const m = await pubDownload(it.id); setPubMsg(`✓ 已下载「${m.name}」到本地`); await refreshNovelIndex(); setStatus(novelVecStatus()); }
    catch (e: any) { setPubMsg('下载失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }
  async function doPubDelete(it: PubIndexMeta) {
    if (!window.confirm(`从社区下架「${it.name}」？`)) return;
    setBusyId(it.id);
    try { await pubDelete(it.id); await loadPub(); }
    catch (e: any) { setPubMsg('下架失败：' + (e?.message ?? e)); } finally { setBusyId(''); }
  }

  const kindBadge = (k: string) => (k === 'worldbook' ? '世界书' : '文本');
  const originBadge = (o: string) => (o === 'cloud' ? '☁️私有云' : o === 'community' ? '🌐社区' : '本地');
  const bigWarn = preview != null && preview > 3000;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="text-[13px] text-dim/70 leading-relaxed bg-panel/60 border border-edge rounded-xl p-4">
        把任意<b>小说原文 / 设定文本 / 世界书</b>向量化，当"语义世界书"用——每回合按当前剧情自动检索最相关片段注入正文。
        内置《轮回乐园》原著是<b>预建的</b>；下面你还能<b>在浏览器里自建</b>自己的向量库，本地使用、导出成文件分享，或上传私有云 / 发布社区。
        <div className="mt-1.5 text-dim/50">不同库可用不同 embedding 模型：检索时按模型分组各查一次，互不干扰。</div>
      </div>

      {/* 总开关 */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ enabled: e.target.checked })} className="accent-god w-4 h-4" />
        <span className="text-sm font-mono text-god/80 uppercase tracking-widest">启用向量资料库</span>
      </label>

      {/* Embedding 接口（查询 + 建库共用） */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">Embedding 接口（查询 + 建库）</div>
        <div className="text-[12px] text-amber-300/70">⚠ 查询某个库时会用<b>建它时的模型</b>；内置库默认 Pro/BAAI/bge-m3（1024 维）。同一套 Base/Key 建议托管你要用的所有模型。</div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">Base URL</div>
          <input value={settings.apiBase} onChange={(e) => setSettings({ apiBase: e.target.value })} placeholder="https://api.siliconflow.cn/v1" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">API Key</div>
          <input type="password" value={settings.apiKey} onChange={(e) => setSettings({ apiKey: e.target.value })} placeholder="sk-…" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">模型（内置库查询 + 新建库默认）</div>
          <input value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} placeholder="Pro/BAAI/bge-m3" className={`${inputCls} font-mono`} />
        </div>
      </div>

      {/* 检索参数 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">检索参数</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">topK（注入段数）</span>
            <input type="number" min={1} max={20} value={settings.topK} onChange={(e) => setSettings({ topK: Math.max(1, Math.min(20, Number(e.target.value) || 5)) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">相似度阈值(0~1)</span>
            <input type="number" step={0.05} min={0} max={1} value={settings.threshold} onChange={(e) => setSettings({ threshold: Math.max(0, Math.min(1, Number(e.target.value) || 0.35)) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">注入字数上限</span>
            <input type="number" min={200} step={100} value={settings.maxChars} onChange={(e) => setSettings({ maxChars: Math.max(200, Number(e.target.value) || 2500) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
        </div>
      </div>

      {/* 🛠 自建向量库 */}
      <div className="space-y-2.5 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">🛠 自建向量库（浏览器内）</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="库名，如：凡人修仙传原著" className={inputCls} />
          <select value={bKind} onChange={(e) => { setBKind(e.target.value as UserIndexKind); setPreview(null); }} className={inputCls}>
            <option value="text">纯文本（小说 / 设定）</option>
            <option value="worldbook">世界书 JSON（SillyTavern / 本项目导出）</option>
          </select>
        </div>
        <textarea value={bText} onChange={(e) => { setBText(e.target.value); setBFile(null); setPreview(null); }} disabled={!!bFile}
          placeholder={bFile ? '（已选文件，忽略此处）' : (bKind === 'worldbook' ? '粘贴世界书 JSON…' : '粘贴文本…（大文件请用下方选文件）')}
          className={`${inputCls} h-24 resize-y font-mono disabled:opacity-40`} />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={buildFileRef} type="file" accept=".txt,.json,.md,text/plain,application/json"
            onChange={(e) => { const f = e.target.files?.[0] || null; setBFile(f); setPreview(null); }}
            className="text-[12px] text-dim/70 file:mr-2 file:text-[12px] file:font-mono file:px-2 file:py-1 file:rounded file:border file:border-god/40 file:text-god file:bg-transparent" />
          {bFile && <span className="text-[12px] text-dim/60">{bFile.name} · {kb(bFile.size)}</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">块大小(字)</span>
            <input type="number" min={200} max={2000} step={50} value={bChunk} onChange={(e) => { setBChunk(Math.max(200, Math.min(2000, Number(e.target.value) || 700))); setPreview(null); }} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">重叠(字)</span>
            <input type="number" min={0} max={400} step={20} value={bOverlap} onChange={(e) => { setBOverlap(Math.max(0, Math.min(400, Number(e.target.value) || 100))); setPreview(null); }} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <button onClick={doPreview} disabled={building} className={btnCls}>预览分块</button>
          {building
            ? <button onClick={() => abortRef.current?.abort()} className="text-[12px] font-mono px-2.5 py-1 rounded border border-blood/50 text-blood hover:bg-blood/10 transition-colors">取消</button>
            : <button onClick={doBuild} className="text-[12px] font-mono px-2.5 py-1 rounded border border-god/60 bg-god/10 text-god hover:bg-god/20 transition-colors">🛠 开始建库</button>}
        </div>
        {preview != null && (
          <div className={`text-[12px] font-mono ${bigWarn ? 'text-amber-300/80' : 'text-dim/60'}`}>
            预计 {preview} 段{bigWarn ? '　⚠ 量较大：浏览器建库会较慢、较耗 embedding 额度，超大原著建议用终端 npm run build-vectors' : ''}
          </div>
        )}
        {building && (
          <div className="space-y-1">
            <div className="h-1.5 bg-void rounded overflow-hidden"><div className="h-full bg-god/70 transition-all" style={{ width: prog.total ? `${(prog.done / prog.total) * 100}%` : '8%' }} /></div>
            <div className="text-[12px] font-mono text-dim/60">嵌入中 {prog.done}/{prog.total || '…'}（用你自己的 key，请保持页面打开）</div>
          </div>
        )}
        {buildMsg && <div className="text-[12px] font-mono text-emerald-300/80 whitespace-pre-wrap">{buildMsg}</div>}
        <div className="pt-1 border-t border-edge/50">
          <input ref={importFileRef} type="file" accept=".zsvec,.gz,application/gzip" onChange={doImportFile} className="hidden" />
          <button onClick={() => importFileRef.current?.click()} className={btnCls}>📥 从 .zsvec 文件导入</button>
          <span className="text-[12px] text-dim/40 ml-2">别人导出的向量库文件</span>
        </div>
      </div>

      {/* 📀 内置向量库（预建·可单独关） */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">📀 内置向量库（预建）</div>
        <div className="text-[12px] text-dim/50 leading-relaxed">预建的《轮回乐园》原著 / 世界书 / 轮回WIKI 向量。不想让它参与检索注入就<b>取消勾选</b>——只关它、不影响你的自建库，也不用动上面的「启用向量资料库」总开关。</div>
        {BUILTIN_SOURCES.map((b) => {
          const on = !(settings.builtinDisabled ?? []).includes(b.name);
          const label = b.name === 'novel-vectors' ? '《轮回乐园》原著'
            : b.name === 'worldbook-vectors' ? '内置世界书'
            : b.name === 'wiki-vectors' ? '轮回WIKI（世界观百科·按条目切块）' : b.label;
          return (
            <label key={b.name} className="flex items-center gap-2 text-[13px] rounded border border-edge/60 bg-void/40 p-2.5 cursor-pointer">
              <input type="checkbox" checked={on}
                onChange={(e) => { setBuiltinEnabled(b.name, e.target.checked); refreshNovelIndex().then(setStatus); }}
                className="accent-god w-3.5 h-3.5" title="是否参与正文检索注入" />
              <span className="text-slate-200 font-medium flex-1">{label}</span>
              <span className={`font-mono text-[11px] ${on ? 'text-emerald-300/70' : 'text-dim/40'}`}>{on ? '注入中' : '已关闭'}</span>
            </label>
          );
        })}
      </div>

      {/* 📚 我的向量库 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">📚 我的向量库（{userIndexes.length}）</div>
        {userIndexes.length === 0 ? <div className="text-[12px] text-dim/40">还没有自建库。用上方「自建向量库」建一个，或从文件/社区导入。</div>
          : userIndexes.map((m) => (
            <div key={m.id} className="text-[12px] rounded border border-edge/60 bg-void/40 p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={m.enabled} onChange={(e) => { setUserIndexEnabled(m.id, e.target.checked); invalidateUserIndex(m.id); refreshNovelIndex().then(setStatus); }} className="accent-god w-3.5 h-3.5" title="是否参与正文检索" />
                <span className="text-slate-200 font-medium flex-1 truncate">{m.name}</span>
                <span className="text-dim/50 font-mono">{kindBadge(m.kind)} · {m.count}段 · {kb(m.sizeBytes)} · {m.dim}维</span>
              </div>
              <div className="text-dim/40 font-mono truncate">{originBadge(m.origin)} · {m.model}{m.remoteId ? ' · ☁️已上传' : ''}{m.publishedId ? ' · 🌐已发布' : ''}</div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => doExport(m)} disabled={busyId === m.id} className={btnCls}>导出文件</button>
                <button onClick={() => doCloudUpload(m)} disabled={busyId === m.id} className={btnCls} title={chatReady() ? '' : '需登录'}>上传私有云</button>
                <button onClick={() => doPublish(m)} disabled={busyId === m.id} className={btnCls}>发布社区</button>
                <button onClick={() => doDeleteIndex(m)} disabled={busyId === m.id} className="text-[12px] font-mono px-2.5 py-1 rounded border border-blood/40 text-blood hover:bg-blood/10 disabled:opacity-40 transition-colors">删除</button>
              </div>
            </div>
          ))}
        {cloudMsg && <div className="text-[12px] font-mono text-dim/70 whitespace-pre-wrap">{cloudMsg}</div>}
        {pubMsg && <div className="text-[12px] font-mono text-dim/70 whitespace-pre-wrap">{pubMsg}</div>}
      </div>

      {/* ☁️🌐 云端 / 社区 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-god/70 uppercase tracking-widest flex-1">☁️ 云端 / 🌐 社区</span>
          <button onClick={() => setShowCloud((v) => !v)} className={btnCls}>{showCloud ? '收起' : '展开'}</button>
        </div>
        {showCloud && (
          <div className="space-y-3 pt-1">
            {/* 私有云 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-mono text-fuchsia-300/70">私有云（跨设备·本人）</span>
                <button onClick={loadCloud} className={btnCls}>{chatReady() ? '刷新' : '需登录'}</button>
              </div>
              {!chatReady() && <div className="text-[12px] text-dim/40">私有云与聊天室/云存档共用身份，请先登录后使用。</div>}
              {cloudItems && cloudItems.map((it) => (
                <div key={it.remoteId} className="flex items-center gap-2 text-[12px] rounded border border-edge/50 bg-void/30 p-2">
                  <span className="flex-1 truncate text-slate-300">{it.name}</span>
                  <span className="text-dim/40 font-mono">{it.count}段·{kb(it.sizeBytes)}</span>
                  <button onClick={() => doCloudDownload(it)} disabled={busyId === it.remoteId} className={btnCls}>取回</button>
                  <button onClick={() => doCloudDelete(it)} disabled={busyId === it.remoteId} className="text-[12px] font-mono px-2 py-1 rounded border border-blood/40 text-blood hover:bg-blood/10 transition-colors">删</button>
                </div>
              ))}
              {cloudItems && cloudItems.length === 0 && <div className="text-[12px] text-dim/40">私有云暂无内容。</div>}
            </div>
            {/* 社区 */}
            <div className="space-y-1.5 pt-2 border-t border-edge/50">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-mono text-fuchsia-300/70">社区库（公开）</span>
                <input value={pubQ} onChange={(e) => setPubQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadPub(); }} placeholder="搜索…" className={`${inputCls} flex-1 max-w-[180px] py-1`} />
                <button onClick={loadPub} className={btnCls}>浏览</button>
              </div>
              {pubItems && pubItems.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-[12px] rounded border border-edge/50 bg-void/30 p-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-slate-300">{it.name} {it.author && <span className="text-dim/40">· {it.author}</span>}</div>
                    {it.summary && <div className="truncate text-dim/40">{it.summary}</div>}
                  </div>
                  <span className="text-dim/40 font-mono shrink-0">{it.count}段·{kb(it.sizeBytes)}·↓{it.downloads ?? 0}</span>
                  <button onClick={() => doPubDownload(it)} disabled={busyId === it.id} className={btnCls}>下载</button>
                  {it.owner === myPlayerId() && <button onClick={() => doPubDelete(it)} disabled={busyId === it.id} className="text-[12px] font-mono px-2 py-1 rounded border border-blood/40 text-blood hover:bg-blood/10 transition-colors">下架</button>}
                </div>
              ))}
              {pubItems && pubItems.length === 0 && <div className="text-[12px] text-dim/40">没有匹配的社区向量库。</div>}
            </div>
          </div>
        )}
      </div>

      {/* 索引状态 + 测试 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-god/70 uppercase tracking-widest flex-1">索引状态</span>
          <button onClick={doLoad} disabled={loadingIdx} className={btnCls}>{loadingIdx ? '加载中…' : '加载/检查索引'}</button>
        </div>
        <div className="text-[12px] font-mono text-dim/70">
          {status.ready ? <span className="text-emerald-300/80">✓ 已就绪：{status.count} 段（{status.sources.map((s) => `${s.name} ${s.count}`).join(' + ') || '—'}），{status.dim} 维</span>
            : status.error ? <span className="text-blood/80">✗ {status.error}</span>
            : <span className="text-dim/50">未加载（点上方按钮加载，或开启后首次发消息时自动懒加载）</span>}
        </div>
        <div className="flex gap-2 pt-1">
          <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doTest(); }} placeholder="测试检索：输入一句剧情/设定问题…" className={`${inputCls} flex-1`} />
          <button onClick={doTest} disabled={testing || !testQuery.trim()} className="shrink-0 text-[12px] font-mono px-3 py-1.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">{testing ? '检索中…' : '🔍 测试'}</button>
        </div>
        {hits && (
          <div className="space-y-1.5 pt-1">
            {hits.length === 0 ? <div className="text-[12px] text-dim/40">无命中（阈值过高 / 接口未配 / 索引未建）。</div>
              : hits.map((h, i) => (
                <div key={i} className="text-[12px] rounded border border-edge/60 bg-void/40 p-2">
                  <div className="font-mono text-dim/50 mb-0.5"><span className="text-fuchsia-300/70">{h.source}</span> · {h.chap || h.vol || '—'} · 相似度 {h.score.toFixed(3)}</div>
                  <div className="text-slate-300/80 leading-relaxed line-clamp-4">{h.text}</div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
