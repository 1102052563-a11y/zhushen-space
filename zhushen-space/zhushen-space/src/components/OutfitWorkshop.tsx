import { useEffect, useMemo, useRef, useState } from 'react';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { useOutfits } from '../store/outfitStore';
import { OutfitPanelBody } from './OutfitPanel';
import ImagePromptEditModal from './ImagePromptEditModal';
import { charLook, listWardrobeChars, currentPortraitPromptFor, saveAvatarPrompt, regenAvatarWithPrompt } from '../systems/outfitTryOn';
import { parseOutfitPack, type ParsedPack, type PackOutfit } from '../systems/outfitPack';
import { packList, packGetImg, packPut, packKeys, packDel, packClearPack, type PackDbEntry } from '../systems/outfitPackDb';
import { outfitImageKey } from '../systems/outfit';
import { outfitImgSet } from '../systems/outfitImages';
import { shrinkDataUrl } from '../systems/imageGen';

/* ════════════════════════════════════════════
   👗 形象工坊（右侧导航独立入口）——每个角色一个专属衣柜的总控台：
   ① 角色列（主角+NPC）→ ② 读取当前人物形象（档案/装备/激活穿搭）→ ③ 立绘生图提示词查看/编辑/按新词重生成
   → ④ 衣柜（OutfitPanelBody 复用：搭配增删改/激活/🎨试衣生图预览→存参考图）
   → ⑤ 📦 成衣库：导入 Outfit-Manager 2.0 的 outfit-mgr-char-*.json 资产包（几百套带图），筛选后逐套「入柜」。
   成衣库存独立 IndexedDB（drpg-outfit-packs·跨存档·不进存档快照）；入柜才拷进 outfitStore+imageDb。
   概念借鉴 ST 插件 Outfit-Manager 2.0（无许可证·代码全自写）。
════════════════════════════════════════════ */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god';

/* 🎁 内置成衣包清单（构建期由 scripts/build-outfit-pack.mjs 产出到 public/outfit-packs/：
   47MB 大包按 ≤20MB 切片绕开 Cloudflare Pages 单文件 25MiB 上限；分片仍是源格式→同一个 parseOutfitPack）。 */
interface BuiltinPack { id: string; name: string; count: number; shards: string[] }

/* 📦 成衣库（模块级定义——⚠内联进父组件会每键重挂断输入法） */
function PackLibrary({ charId, charName }: { charId: string; charName: string }) {
  const [entries, setEntries] = useState<PackDbEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [imp, setImp] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);
  const [msg, setMsg] = useState('');
  const [filterPack, setFilterPack] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(24);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    setLoading(true);
    try { setEntries(await packList()); } catch { setEntries([]); }
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  // 🎁 内置成衣包：读 manifest（本地没跑分片脚本/线上没带 → 静默隐藏区块）
  const [builtins, setBuiltins] = useState<BuiltinPack[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/outfit-packs/manifest.json');
        if (!r.ok) return;
        const j = await r.json();
        if (alive && Array.isArray(j)) setBuiltins(j.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.shards)));
      } catch { /* 无内置包 → 不渲染 */ }
    })();
    return () => { alive = false; };
  }, []);

  const packs = useMemo(() => [...new Set(entries.map((e) => e.charName).filter(Boolean))], [entries]);
  const topTags = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const e of entries) for (const t of (e.tags || '').split(',').map((x) => x.trim()).filter(Boolean)) cnt.set(t, (cnt.get(t) ?? 0) + 1);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [entries]);

  const q = query.trim().toLowerCase();
  const filtered = entries.filter((e) =>
    (!filterPack || e.charName === filterPack)
    && (!filterTag || (e.tags || '').split(',').map((x) => x.trim()).includes(filterTag))
    && (!q || [e.name, e.desc, e.tags].some((s) => (s || '').toLowerCase().includes(q))));
  const shown = filtered.slice(0, visible);

  // 缩略图按需加载：只取可见页、逐条从 IDB 单取（避免几百张图一次进内存）
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const e of shown) {
        if (!e.hasImage || thumbs[e.key]) continue;
        const img = await packGetImg(e.key);
        if (!alive) return;
        if (img) setThumbs((m) => (m[e.key] ? m : { ...m, [e.key]: img }));
      }
    })();
    return () => { alive = false; };

  }, [entries, visible, filterPack, filterTag, q]);

  /** 共用导入管线：去重（key=包名#源id，与手动导整包同键→互不重复）→ 逐张压缩(768) → 入库。可中停续传。 */
  async function runImport(packs: ParsedPack[]) {
    const existing = await packKeys();
    const jobs: { cn: string; o: PackOutfit }[] = [];
    let dupTotal = 0, skippedTotal = 0;
    for (const p of packs) {
      skippedTotal += p.skipped;
      for (const o of p.outfits) {
        if (existing.has(o.key)) { dupTotal++; continue; }
        jobs.push({ cn: p.charName, o });
      }
    }
    const names = [...new Set(packs.map((p) => p.charName))].join('、');
    if (!jobs.length) {
      setMsg(`✓ 「${names}」的穿搭已全部在库（重复导入自动跳过）`);
      return;
    }
    cancelRef.current = false;
    setImp({ done: 0, total: jobs.length });
    let done = 0, imgFail = 0;
    for (const { cn, o } of jobs) {
      if (cancelRef.current) break;
      let img = '';
      if (o.imageData) {
        try { img = await shrinkDataUrl(o.imageData, 768, 0.8); } catch { imgFail++; }   // 单张坏图不拖垮整包
      }
      await packPut({ key: o.key, charName: cn, name: o.name, desc: o.desc, tags: o.tags, hasImage: !!img, createdAt: o.createdAt || Date.now() }, img || undefined);
      done++;
      setImp({ done, total: jobs.length });
    }
    setImp(null);
    setMsg(`✓ 导入「${names}」：新入库 ${done} 套`
      + (dupTotal ? `，跳过重复 ${dupTotal} 套` : '')
      + (skippedTotal ? `，源文件空条目 ${skippedTotal} 条` : '')
      + (imgFail ? `，${imgFail} 张图片压缩失败（只存了文字）` : '')
      + (cancelRef.current ? '（已手动停止，再点一次续传）' : ''));
    void reload();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    setMsg('');
    try {
      const text = await f.text();               // 47MB 大包也行——全在浏览器本地解析
      await runImport([parseOutfitPack(text)]);
    } catch (err: any) {
      setImp(null);
      setMsg('✗ ' + (err?.message || String(err)));
    }
  }

  /** 🎁 内置包一键入库：顺序下载分片 → 同一条解析/去重/压缩管线。 */
  async function importBuiltin(bp: BuiltinPack) {
    if (imp) return;
    setMsg('');
    try {
      const packs: ParsedPack[] = [];
      for (let i = 0; i < bp.shards.length; i++) {
        setMsg(`⬇ 下载「${bp.name}」分片 ${i + 1}/${bp.shards.length}…`);
        const r = await fetch(`/outfit-packs/${bp.shards[i]}`);
        if (!r.ok) throw new Error(`分片 ${bp.shards[i]} 下载失败（HTTP ${r.status}）`);
        packs.push(parseOutfitPack(await r.text()));
      }
      setMsg('');
      await runImport(packs);
    } catch (err: any) {
      setImp(null);
      setMsg('✗ ' + (err?.message || String(err)));
    }
  }

  async function addToWardrobe(e: PackDbEntry) {
    setMsg('');
    try {
      const S = useOutfits.getState();
      const oid = S.addOutfit(charId, { name: e.name, desc: e.desc, tags: e.tags, imageTags: '' });
      if (e.hasImage) {
        const img = thumbs[e.key] || (await packGetImg(e.key));
        if (img) {
          await outfitImgSet(outfitImageKey(charId, oid), img);
          S.updateOutfit(charId, oid, { hasImage: true });
        }
      }
      setMsg(`✓ 已把「${e.name}」放进 ${charName} 的衣柜（含参考图）——回「衣柜与形象」页激活/试衣`);
    } catch (err: any) { setMsg('✗ 入柜失败：' + (err?.message || String(err))); }
  }
  async function onDelEntry(e: PackDbEntry) {
    if (!window.confirm(`从成衣库删除「${e.name}」？（跨存档共用，删了所有档都没；已入柜的不受影响）`)) return;
    await packDel(e.key);
    setEntries((list) => list.filter((x) => x.key !== e.key));
    setThumbs((m) => { const n = { ...m }; delete n[e.key]; return n; });
  }
  async function onDelPack() {
    if (!filterPack) return;
    if (!window.confirm(`删除整包「${filterPack}」的全部 ${entries.filter((x) => x.charName === filterPack).length} 套？（跨存档共用·不可恢复；已入柜的不受影响）`)) return;
    const n = await packClearPack(filterPack);
    setMsg(`✓ 已删除整包「${filterPack}」共 ${n} 套`);
    setFilterPack('');
    setThumbs({});
    void reload();
  }

  const chipCls = (on: boolean) => `px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors ${on ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'}`;

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-dim/60 leading-relaxed">
        📦 成衣库=跨存档的穿搭资产库：导入 Outfit-Manager 导出的 <span className="font-mono">outfit-mgr-char-*.json</span>（几十 MB 的几百套大包也行，全部只进浏览器本地库，<b>不占存档空间</b>、换档/新开档都在）。挑中意的点「⤵ 入柜」拷进当前角色的衣柜（文字+参考图）。
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void onImportFile(e); }} />
        <button onClick={() => fileRef.current?.click()} disabled={!!imp}
          className="px-3 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">📥 导入成衣包</button>
        {imp && (
          <>
            <span className="text-[12px] font-mono text-god/80">⏳ 压缩入库 {imp.done}/{imp.total}…</span>
            <button onClick={() => { cancelRef.current = true; }} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim rounded hover:text-red-300">停止</button>
          </>
        )}
        {!imp && entries.length > 0 && <span className="text-[12px] text-dim/50 font-mono">库存 {entries.length} 套</span>}
        {!imp && filterPack && <button onClick={() => { void onDelPack(); }} className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim/60 rounded hover:text-red-300" title="删除当前筛选的整个来源包">🗑 删除整包</button>}
      </div>
      {imp && <div className="h-1.5 rounded bg-void overflow-hidden"><div className="h-full bg-god/60 transition-all" style={{ width: `${Math.round((imp.done / Math.max(1, imp.total)) * 100)}%` }} /></div>}
      {msg && <div className={`text-[12px] font-mono leading-relaxed ${msg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>{msg}</div>}

      {/* 🎁 内置成衣包（随游戏发布的分片资产·一键入库） */}
      {builtins.length > 0 && (
        <div className="rounded-lg border border-edge bg-void/40 p-2.5 space-y-1.5">
          <div className="text-[12px] font-mono text-god/70">🎁 内置成衣包（随游戏发布·点一下全部入库）</div>
          {builtins.map((bp) => {
            const inLib = entries.filter((x) => x.charName === bp.name).length;
            const full = bp.count > 0 && inLib >= bp.count;
            return (
              <div key={bp.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-slate-200 font-semibold">{bp.name}</span>
                <span className="text-[11px] text-dim/50 flex-1">{bp.count} 套{inLib ? `（已入库 ${inLib}${full ? '·齐了' : ''}）` : ''}</span>
                <button onClick={() => { void importBuiltin(bp); }} disabled={!!imp}
                  className="px-2 py-0.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
                  {full ? '↻ 校对补缺' : '📥 一键入库'}
                </button>
              </div>
            );
          })}
          <div className="text-[11px] text-dim/40 leading-relaxed">首次入库需下载分片（共几十MB，一次性），之后跨存档常驻本机；重复点只补缺不重复。</div>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setFilterPack('')} className={chipCls(!filterPack)}>全部来源</button>
            {packs.map((p) => <button key={p} onClick={() => setFilterPack(filterPack === p ? '' : p)} className={chipCls(filterPack === p)}>{p}</button>)}
          </div>
          {topTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => setFilterTag('')} className={chipCls(!filterTag)}>全部标签</button>
              {topTags.map((t) => <button key={t} onClick={() => setFilterTag(filterTag === t ? '' : t)} className={chipCls(filterTag === t)}>{t}</button>)}
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`🔎 搜索 ${filtered.length} 套（名称/描述/标签）…`} className={inputCls} />
        </>
      )}

      {loading && <div className="text-[12px] text-dim/40 text-center py-4">读取成衣库…</div>}
      {!loading && entries.length === 0 && <div className="text-[12px] text-dim/40 text-center py-4">库是空的——点上面「📥 导入成衣包」选择 outfit-mgr-char-*.json</div>}
      {!loading && entries.length > 0 && shown.length === 0 && <div className="text-[12px] text-dim/40 text-center py-4">没有匹配的穿搭</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {shown.map((e) => (
          <div key={e.key} className="rounded-lg border border-edge bg-void/40 overflow-hidden flex flex-col">
            {thumbs[e.key]
              ? <img src={thumbs[e.key]} alt={e.name} loading="lazy" className="w-full h-44 object-cover" />
              : <div className="w-full h-44 flex items-center justify-center text-3xl text-dim/20 bg-void/60">{e.hasImage ? '⏳' : '👗'}</div>}
            <div className="p-2 space-y-1 flex-1 flex flex-col">
              <div className="text-[12px] text-slate-200 font-semibold leading-snug">{e.name}</div>
              {e.tags && <div className="text-[10px] font-mono text-dim/45 leading-snug">[{e.tags}]</div>}
              <div className="text-[11px] text-dim/60 leading-snug max-h-8 overflow-hidden flex-1">{e.desc}</div>
              <div className="flex items-center gap-1.5 pt-0.5">
                <button onClick={() => { void addToWardrobe(e); }} title={`拷进 ${charName} 的衣柜（文字+参考图）`}
                  className="flex-1 px-1.5 py-0.5 text-[11px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">⤵ 入柜</button>
                <button onClick={() => { void onDelEntry(e); }} className="px-1.5 py-0.5 text-[11px] text-dim/50 hover:text-red-300">🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length > visible && (
        <button onClick={() => setVisible((v) => v + 24)} className="w-full px-3 py-1.5 text-[12px] font-mono border border-edge text-dim rounded hover:text-god transition-colors">
          显示更多（{visible}/{filtered.length}）
        </button>
      )}
    </div>
  );
}

export default function OutfitWorkshop({ onClose }: { onClose: () => void }) {
  const npcs = useNpc((s) => s.npcs);
  const profile = usePlayer((s) => s.profile);
  const setProfile = usePlayer((s) => s.setProfile);
  const upsertNpc = useNpc((s) => s.upsertNpc);
  const byChar = useOutfits((s) => s.byChar);
  const [sel, setSel] = useState('B1');
  const [tab, setTab] = useState<'wardrobe' | 'pack'>('wardrobe');
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [tagsDraft, setTagsDraft] = useState<string | null>(null);   // null=非编辑态

  const chars = useMemo(() => listWardrobeChars(), [npcs, profile]);
  const look = useMemo(() => charLook(sel), [sel, npcs, profile, byChar]);
  useEffect(() => { setErr(''); setNote(''); setTagsDraft(null); }, [sel]);

  const hasCustomPrompt = sel === 'B1' ? !!(profile.avatarPrompt || '').trim() : !!(npcs[sel]?.avatarPrompt || '').trim();
  const curImageTags = sel === 'B1' ? (profile.imageTags || '') : (npcs[sel]?.imageTags || '');

  async function regen(p: string) {
    setBusy(true); setErr(''); setNote('');
    try {
      await regenAvatarWithPrompt(sel, p);
      setPromptOpen(false);
      setNote('✓ 已按新提示词重生成立绘并保存提示词');
    } catch (e: any) { setErr(e?.message || String(e)); }
    setBusy(false);
  }
  function saveTags() {
    if (tagsDraft === null) return;
    const v = tagsDraft.trim().slice(0, 400);
    if (sel === 'B1') setProfile({ imageTags: v });
    else if (npcs[sel]) upsertNpc(sel, { imageTags: v });
    setTagsDraft(null);
    setNote('✓ 生图标签已保存——之后立绘/配图/漫画三条线都用它');
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-5xl h-[94dvh] sm:h-[92dvh] rounded-xl border border-edge bg-panel flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-edge shrink-0">
          <div className="min-w-0">
            <span className="text-sm font-bold text-slate-100">👗 形象工坊</span>
            <span className="hidden sm:inline text-[11px] text-dim/50 ml-2">每个角色一个专属衣柜：读形象 · 搭配 · 试衣生图 · 生图提示词</span>
          </div>
          <button onClick={onClose} className="text-dim/60 hover:text-slate-200 text-sm shrink-0">✕</button>
        </header>
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* 角色列：手机横向滚动条，桌面左侧竖列 */}
          <aside className="lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-edge p-2 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto">
            {chars.map((c) => {
              const n = byChar[c.id]?.outfits.length ?? 0;
              return (
                <button key={c.id} onClick={() => setSel(c.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left shrink-0 lg:shrink lg:w-full transition-colors ${sel === c.id ? 'border-god/50 bg-god/10' : 'border-edge hover:border-god/30'}`}>
                  {c.avatar
                    ? <img src={c.avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-edge shrink-0" />
                    : <span className="w-8 h-8 rounded-full bg-void/60 border border-edge flex items-center justify-center text-dim/30 shrink-0">👤</span>}
                  <span className="min-w-0">
                    <span className={`block text-[13px] font-semibold truncate max-w-[9rem] ${sel === c.id ? 'text-god' : 'text-slate-200'}`}>{c.dead ? '☠ ' : ''}{c.name}</span>
                    <span className="block text-[10px] text-dim/45 truncate">{c.hint}{n ? ` · 👗${n}` : ''}</span>
                  </span>
                </button>
              );
            })}
          </aside>
          {/* 右侧主区 */}
          <main className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setTab('wardrobe')} className={`px-3 py-1 rounded-lg text-[13px] font-mono border transition-colors ${tab === 'wardrobe' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'}`}>👗 衣柜与形象</button>
              <button onClick={() => setTab('pack')} className={`px-3 py-1 rounded-lg text-[13px] font-mono border transition-colors ${tab === 'pack' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'}`}>📦 成衣库</button>
            </div>

            {tab === 'pack' && <PackLibrary charId={sel} charName={look?.name || sel} />}

            {tab === 'wardrobe' && (look ? (
              <>
                {/* ① 当前形象（读取自档案·随剧情演化） */}
                <section className="rounded-lg border border-edge bg-void/40 p-3">
                  <div className="flex items-start gap-3">
                    {look.avatar
                      ? <img src={look.avatar} alt={look.name} className="w-20 h-20 rounded-lg object-cover border border-edge shrink-0" />
                      : <div className="w-20 h-20 rounded-lg bg-void/60 border border-edge flex items-center justify-center text-3xl text-dim/25 shrink-0">👤</div>}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-[13px] font-bold text-slate-100">{look.name} <span className="text-[11px] text-dim/45 font-normal ml-1">当前形象（读取自档案，随剧情演化）</span></div>
                      {look.rows.length === 0 && <div className="text-[12px] text-dim/40">档案里还没有外观信息</div>}
                      {look.rows.map((r) => (
                        <div key={r.label} className="text-[12px] leading-relaxed"><span className="text-dim/45">{r.label}：</span><span className="text-dim/90 break-all">{r.value}</span></div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* ② 生图提示词 */}
                <section className="rounded-lg border border-edge bg-void/40 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-mono text-god/70">✏️ 生图提示词</span>
                    <button onClick={() => { setErr(''); setNote(''); setPromptOpen(true); }} disabled={busy}
                      className="px-2 py-0.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">✏️ 查看/编辑完整提示词</button>
                    {hasCustomPrompt && (
                      <button onClick={() => { if (window.confirm('清除已保存的自定义提示词，恢复按档案自动拼装？')) { saveAvatarPrompt(sel, ''); setNote('✓ 已恢复自动拼装'); } }} disabled={busy}
                        className="px-2 py-0.5 text-[12px] font-mono border border-edge text-dim/60 rounded hover:text-slate-200 disabled:opacity-40 transition-colors">🧹 恢复自动</button>
                    )}
                    <span className="text-[11px] text-dim/45">{hasCustomPrompt ? '已保存自定义提示词（「重新生成」按它出图）' : '未自定义——按档案字段实时拼装'}</span>
                  </div>
                  {/* 生图标签：三条生图线（立绘/正文配图/漫画）持续生效的英文标签——改这里才是「长期改形象提示词」 */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-dim/45">生图标签（英文·三线通用·演化可能更新）：</span>
                      {tagsDraft === null
                        ? <button onClick={() => setTagsDraft(curImageTags)} className="px-2 py-0.5 text-[11px] font-mono border border-edge text-dim/60 rounded hover:text-god transition-colors">✎ 编辑</button>
                        : (
                          <>
                            <button onClick={saveTags} className="px-2 py-0.5 text-[11px] font-mono border border-emerald-500/50 text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors">💾 保存</button>
                            <button onClick={() => setTagsDraft(null)} className="px-2 py-0.5 text-[11px] font-mono border border-edge text-dim/60 rounded hover:text-slate-200 transition-colors">取消</button>
                          </>
                        )}
                    </div>
                    {tagsDraft === null
                      ? <div className="text-[11px] font-mono text-dim/60 break-all leading-relaxed">{curImageTags || '（空——生成立绘时会自动翻译档案外观补上）'}</div>
                      : <textarea rows={2} value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)} placeholder="1girl, long black hair, ..." className={inputCls + ' resize-y font-mono'} />}
                  </div>
                  {err && <div className="text-[12px] font-mono text-blood whitespace-pre-line leading-snug">{err}</div>}
                  {note && <div className="text-[12px] font-mono text-emerald-300">{note}</div>}
                </section>

                {/* ③ 衣柜（复用弹层内容区：搭配/激活/🎨试衣/参考图/模板库） */}
                <section className="rounded-lg border border-edge bg-void/40 p-3">
                  <OutfitPanelBody charId={sel} charName={look.name} currentAttire={look.attire} />
                </section>
              </>
            ) : (
              <div className="text-[13px] text-dim/50 p-4">角色不存在（可能已删除）——从左侧选择另一个角色。</div>
            ))}
          </main>
        </div>
      </div>
      {promptOpen && look && (
        <ImagePromptEditModal
          title={`${look.name} · 立绘生图提示词`}
          initialPrompt={currentPortraitPromptFor(sel)}
          busy={busy}
          note="「💾 仅保存」只把改后的提示词存回（下次「重新生成」用它）；「🔄 重新生成」立即按新词重出立绘并保存。想长期改形象请改上方「生图标签」或档案里的基底外观。"
          onClose={() => { if (!busy) setPromptOpen(false); }}
          onSaveOnly={(p) => { saveAvatarPrompt(sel, p); setPromptOpen(false); setNote('✓ 提示词已保存（未生成）'); }}
          onSubmit={(p) => { void regen(p); }}
        />
      )}
    </div>
  );
}
