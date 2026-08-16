import { useEffect, useRef, useState } from 'react';
import { useOutfits, type OutfitRecord } from '../store/outfitStore';
import { useOutfitTemplates, type OutfitTemplate } from '../store/outfitTemplateStore';
import { putTplImg, getTplImg, delTplImg } from '../systems/outfitTemplateDb';
import { getImg } from '../systems/imageDb';
import { outfitImgSet, outfitImgDel } from '../systems/outfitImages';   // 写/删走内存缓存+imageDb 双写——缓存并进存档快照，读档/新游戏不丢（2026-08-11）
import { shrinkDataUrl } from '../systems/imageGen';
import { outfitImageKey } from '../systems/outfit';
import { generateOutfitFromEquipment, extractOutfitFromNarrative } from '../systems/outfitGen';
import { buildTryOnPrompt, generateTryOnImage } from '../systems/outfitTryOn';

/* 👗 衣柜（穿搭预设）——主角侧栏 / NPC 详情的弹层共用；内容区抽成 OutfitPanelBody 供「形象工坊」嵌入。
   激活的穿搭 = 服装单一权威源：立绘 ${attire}、正文配图 roster、漫画分镜外观锁、<钦定穿搭> 正文注入 全读它；
   AI 可经 <state> `outfit.<角色ID>=穿搭名` 按剧情换装（也可写场景标签）。
   穿搭参考图存 imageDb（key=outfit:<charId>:<id>·随存档快照）——chatimg 多模态线绘漫画/配图时随参考图发送锁服装。
   🎨 试衣（借鉴 Outfit-Manager 2.0 流程思想·无许可证代码自写）：按「角色形象+这套穿搭」生图预览（不必激活），
   满意可一键存为该套参考图 / 另存为新穿搭。
   概念借鉴 ST 插件 Outfit-Manager（无许可证·代码全自写）。 */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god';

interface DraftOutfit { name: string; desc: string; tags: string; imageTags: string }
const EMPTY_DRAFT: DraftOutfit = { name: '', desc: '', tags: '', imageTags: '' };

/* 🎨 试衣弹层（模块级定义——⚠内联进父组件会每键重挂断输入法）。
   提示词按「角色基础形象 + 这套穿搭(outfitOverride)」预拼，可编辑；生成走立绘服务（chatimg 线附角色现有立绘锁长相）。 */
function TryOnModal({ charId, charName, outfit, onSaved, onClose }: {
  charId: string;
  charName: string;
  outfit: OutfitRecord;
  onSaved: (outfitId: string, url: string) => void;   // 存图成功（该套/新套）→ 父组件刷新缩略图
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(() => buildTryOnPrompt(charId, outfit));
  const [img, setImg] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const locked = busy || saving;
  async function gen() {
    if (locked) return;
    setBusy(true); setErr(''); setMsg('');
    try { setImg(await generateTryOnImage(charId, outfit, prompt)); }
    catch (e: any) { setErr(e?.message || String(e)); }
    setBusy(false);
  }
  async function saveHere() {
    if (!img || locked) return;
    setSaving(true); setErr('');
    try {
      await outfitImgSet(outfitImageKey(charId, outfit.id), img);
      useOutfits.getState().updateOutfit(charId, outfit.id, { hasImage: true });
      onSaved(outfit.id, img);
      setMsg(`✓ 已存为「${outfit.name}」的参考图——立绘/正文配图/漫画三条线即刻生效`);
    } catch (e: any) { setErr('保存失败：' + (e?.message || String(e))); }
    setSaving(false);
  }
  async function saveAsNew() {
    if (!img || locked) return;
    setSaving(true); setErr('');
    try {
      const S = useOutfits.getState();
      const nid = S.addOutfit(charId, { name: `${outfit.name}·新`.slice(0, 24), desc: outfit.desc, tags: outfit.tags, imageTags: outfit.imageTags });
      await outfitImgSet(outfitImageKey(charId, nid), img);
      S.updateOutfit(charId, nid, { hasImage: true });
      onSaved(nid, img);
      setMsg('✓ 已另存为新穿搭（含此图）——回列表可改名/激活');
    } catch (e: any) { setErr('保存失败：' + (e?.message || String(e))); }
    setSaving(false);
  }
  return (
    <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!locked) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl border border-god/30 bg-panel p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-100">🎨 试衣 · {charName} ·「{outfit.name}」</div>
          <button onClick={() => { if (!locked) onClose(); }} className="text-dim hover:text-slate-200 text-sm disabled:opacity-40" disabled={locked}>✕</button>
        </div>
        <div className="text-[11px] text-dim/50 leading-relaxed">提示词已按「角色基础形象 + 这套穿搭」拼好（<b>不必先激活</b>），可直接修改。生成走「生图设置→立绘服务」；多模态Chat线会附角色现有立绘锁长相、只换衣不换人。</div>
        <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="试衣生图提示词…" className={inputCls + ' resize-y leading-relaxed font-mono'} />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { void gen(); }} disabled={locked || !prompt.trim()}
            className="px-3 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
            {busy ? '⏳ 生成中…' : img ? '🔁 再来一张' : '🎨 生成预览'}
          </button>
          {img && (
            <>
              <button onClick={() => { void saveHere(); }} disabled={locked}
                className="px-3 py-1 text-[13px] font-mono border border-emerald-500/50 text-emerald-300 rounded hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
                title="满意：把这张图存为这套穿搭的参考图（自动缩到768px·随存档走）">{saving ? '⏳' : '💾 存为该套参考图'}</button>
              <button onClick={() => { void saveAsNew(); }} disabled={locked}
                className="px-2 py-1 text-[12px] font-mono border border-edge text-dim rounded hover:text-god disabled:opacity-40 transition-colors"
                title="复制这套的文字+这张图，另存成衣柜里新的一套">➕ 另存为新穿搭</button>
            </>
          )}
        </div>
        {err && <div className="text-[12px] font-mono text-blood whitespace-pre-line leading-snug">{err}</div>}
        {msg && <div className="text-[12px] font-mono text-emerald-300">{msg}</div>}
        {img && <img src={img} alt="试衣预览" className="w-full max-h-[52vh] object-contain rounded-lg border border-edge bg-void" />}
      </div>
    </div>
  );
}

/** 衣柜内容区（无弹层壳）：弹层入口（主角侧栏/NPC详情）与「形象工坊」共用。 */
export function OutfitPanelBody({ charId, charName, currentAttire }: {
  charId: string;
  charName: string;
  currentAttire?: string;   // 「从当前穿着导入」预填（主角=外观描述 / NPC=appearance5 穿着段）
}) {
  const wardrobe = useOutfits((s) => s.byChar[charId]) ?? { outfits: [], activeId: '' };
  const addOutfit = useOutfits((s) => s.addOutfit);
  const updateOutfit = useOutfits((s) => s.updateOutfit);
  const removeOutfit = useOutfits((s) => s.removeOutfit);
  const setActive = useOutfits((s) => s.setActive);
  const toggleRandomPool = useOutfits((s) => s.toggleRandomPool);
  const setAutoDaily = useOutfits((s) => s.setAutoDaily);
  const randomPool = wardrobe.randomPool ?? [];
  const [draft, setDraft] = useState<DraftOutfit>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState('');   // ''=新增模式；否则在编辑该套
  // 🔎 搜索（大衣柜可用性：成衣包导入后可能有几十上百套）
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? wardrobe.outfits.filter((o) => [o.name, o.tags, o.desc, o.imageTags].some((s) => (s || '').toLowerCase().includes(q))) : wardrobe.outfits;
  // 🎲 手动随机搭配（借鉴 2.0 的 roll：随机换上一套并激活；候选池优先）
  const rollRandom = useOutfits((s) => s.rollRandom);
  const [rollMsg, setRollMsg] = useState('');
  function onRoll() {
    const name = rollRandom(charId);
    setRollMsg(name ? `🎲 已随机换上「${name}」——已激活为服装权威源，不满意再点一次` : '没有可随机的穿搭');
  }
  // 🎨 试衣
  const [tryOn, setTryOn] = useState<OutfitRecord | null>(null);
  // 穿搭参考图（imageDb 按需加载）
  const [imgMap, setImgMap] = useState<Record<string, string>>({});
  const [imgBusy, setImgBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingIdRef = useRef('');
  // 📚 跨存档模板库
  const templates = useOutfitTemplates((s) => s.templates);
  const saveTemplate = useOutfitTemplates((s) => s.saveTemplate);
  const patchTemplate = useOutfitTemplates((s) => s.patchTemplate);
  const removeTemplate = useOutfitTemplates((s) => s.removeTemplate);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplImgMap, setTplImgMap] = useState<Record<string, string>>({});
  const [tplMsg, setTplMsg] = useState('');
  // ✨ 按装备生成穿搭描述
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  async function onGenFromEquipment() {
    if (genBusy) return;
    setGenBusy(true); setGenMsg('');
    try {
      const r = await generateOutfitFromEquipment(charId);
      setDraft((d) => ({ ...d, desc: r.desc, imageTags: r.tags || d.imageTags, name: d.name || '当前装备' }));
      setGenMsg('✓ 已按装备栏生成——检查/修改后点「＋ 添加」（或编辑态点「保存修改」）');
    } catch (e: any) { setGenMsg('✗ ' + (e?.message || String(e))); }
    setGenBusy(false);
  }
  // ✨ 从正文提炼穿着（借鉴V3.2）：读最近正文 → LLM 提炼该角色此刻实穿 → 回填表单
  const [extractBusy, setExtractBusy] = useState(false);
  async function onExtractFromNarrative() {
    if (extractBusy) return;
    setExtractBusy(true); setGenMsg('');
    try {
      const r = await extractOutfitFromNarrative(charId);
      setDraft((d) => ({ ...d, desc: r.desc, imageTags: r.tags || d.imageTags, name: d.name || '正文提炼' }));
      setGenMsg('✓ 已从最近正文提炼——检查/修改后点「＋ 添加」（或编辑态点「保存修改」）');
    } catch (e: any) { setGenMsg('✗ ' + (e?.message || String(e))); }
    setExtractBusy(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const o of wardrobe.outfits) {
        if (!o.hasImage) continue;
        const url = await getImg(outfitImageKey(charId, o.id));
        if (url) next[o.id] = url;
      }
      if (alive) setImgMap(next);
    })();
    return () => { alive = false; };

  }, [charId, wardrobe.outfits.map((o) => `${o.id}:${o.hasImage ? 1 : 0}`).join(',')]);

  function startEdit(o: OutfitRecord) {
    setEditingId(o.id);
    setDraft({ name: o.name, desc: o.desc, tags: o.tags, imageTags: o.imageTags });
  }
  function saveDraft() {
    const name = draft.name.trim() || '未命名穿搭';
    const payload = { name, desc: draft.desc.trim(), tags: draft.tags.trim(), imageTags: draft.imageTags.trim() };
    if (!payload.desc) return;
    if (editingId) updateOutfit(charId, editingId, payload);
    else addOutfit(charId, payload);
    setDraft(EMPTY_DRAFT); setEditingId('');
  }
  function onRemove(o: OutfitRecord) {
    if (!window.confirm(`删除穿搭「${o.name}」？`)) return;
    removeOutfit(charId, o.id);
    if (o.hasImage) void outfitImgDel(outfitImageKey(charId, o.id));
    if (editingId === o.id) { setDraft(EMPTY_DRAFT); setEditingId(''); }
  }
  function pickImage(outfitId: string) {
    pendingIdRef.current = outfitId;
    fileRef.current?.click();
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    const oid = pendingIdRef.current;
    if (!f || !oid) return;
    setImgBusy(oid);
    try {
      const raw = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('读图失败'));
        r.readAsDataURL(f);
      });
      const url = await shrinkDataUrl(raw, 768, 0.85);
      await outfitImgSet(outfitImageKey(charId, oid), url);
      updateOutfit(charId, oid, { hasImage: true });
      setImgMap((m) => ({ ...m, [oid]: url }));
    } catch (err: any) { window.alert('参考图保存失败：' + (err?.message || String(err))); }
    setImgBusy('');
  }
  async function removeImage(o: OutfitRecord) {
    await outfitImgDel(outfitImageKey(charId, o.id));
    updateOutfit(charId, o.id, { hasImage: false });
    setImgMap((m) => { const n = { ...m }; delete n[o.id]; return n; });
  }

  // ── 📚 跨存档模板库 ──
  useEffect(() => {
    if (!tplOpen) return;
    let alive = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const t of templates) {
        if (!t.hasImage) continue;
        const url = await getTplImg(t.id);
        if (url) next[t.id] = url;
      }
      if (alive) setTplImgMap(next);
    })();
    return () => { alive = false; };

  }, [tplOpen, templates.map((t) => `${t.id}:${t.hasImage ? 1 : 0}`).join(',')]);

  async function onSaveTemplate(o: OutfitRecord) {
    setTplMsg('');
    try {
      const tid = saveTemplate({ name: o.name, desc: o.desc, tags: o.tags, imageTags: o.imageTags, hasImage: false });
      if (o.hasImage) {
        const url = imgMap[o.id] || (await getImg(outfitImageKey(charId, o.id)));
        if (url) { await putTplImg(tid, url); patchTemplate(tid, { hasImage: true }); }
      } else {
        void delTplImg(tid);   // 同名覆盖且新版无图 → 清掉旧模板图
      }
      setTplMsg(`✓ 已存入模板库：「${o.name}」（跨存档可用）`);
      setTplOpen(true);
    } catch (e: any) { setTplMsg('✗ ' + (e?.message || String(e))); }
  }
  async function onImportTemplate(t: OutfitTemplate) {
    setTplMsg('');
    const oid = addOutfit(charId, { name: t.name, desc: t.desc, tags: t.tags, imageTags: t.imageTags });
    if (t.hasImage) {
      const url = tplImgMap[t.id] || (await getTplImg(t.id));
      if (url) {
        await outfitImgSet(outfitImageKey(charId, oid), url);
        updateOutfit(charId, oid, { hasImage: true });
        setImgMap((m) => ({ ...m, [oid]: url }));
      }
    }
    setTplMsg(`✓ 已导入「${t.name}」到 ${charName} 的衣柜`);
  }
  function onRemoveTemplate(t: OutfitTemplate) {
    if (!window.confirm(`从模板库删除「${t.name}」？（跨存档共用，删了所有档都没）`)) return;
    removeTemplate(t.id);
    void delTplImg(t.id);
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-dim/60 leading-relaxed">激活的穿搭是<b>服装唯一权威源</b>：正文描写、立绘、正文配图、漫画都以它为准（优先于装备栏与外观描述）。AI 也知道这份衣柜——剧情需要时会用 <span className="font-mono">outfit.{charId}=穿搭名</span> 指令自动换装（场景标签也能命中，如「战斗」）。不激活任何一套＝维持原逻辑。每套可点 🎨 试衣：生图预览满意再存为参考图。</div>

      {wardrobe.outfits.length >= 8 && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`🔎 搜索 ${wardrobe.outfits.length} 套穿搭（名称/标签/描述）…`} className={inputCls} />
      )}

      {/* 🎲 随机搭配 */}
      {wardrobe.outfits.length >= 2 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onRoll}
            title={randomPool.length ? `从 🎲 候选池（${randomPool.length} 套）随机换一套并激活` : '从全衣柜随机换一套并激活（给穿搭点 🎲 可限定候选池）'}
            className="px-3 py-1 text-[13px] font-mono border border-amber-500/50 text-amber-300 rounded hover:bg-amber-500/10 transition-colors">🎲 随机搭配</button>
          {rollMsg && <span className="text-[12px] font-mono text-amber-300/90">{rollMsg}</span>}
        </div>
      )}

      {/* 激活选择 */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge cursor-pointer hover:border-god/30 transition-colors">
          <input type="radio" name="of-active" checked={!wardrobe.activeId} onChange={() => setActive(charId, '')} />
          <span className="text-[13px] text-dim">不钦定（跟随装备栏 / 外观描述）</span>
        </label>
        {shown.map((o) => (
          <div key={o.id} className={`px-2 py-1.5 rounded-lg border transition-colors ${wardrobe.activeId === o.id ? 'border-god/40 bg-god/5' : 'border-edge'}`}>
            <div className="flex items-center gap-2">
              <input type="radio" name="of-active" checked={wardrobe.activeId === o.id} onChange={() => setActive(charId, o.id)} />
              {imgMap[o.id] && <img src={imgMap[o.id]} alt="" className="w-8 h-8 rounded object-cover border border-edge shrink-0" />}
              <span className="text-[13px] text-slate-200 font-semibold flex-1 truncate">{o.name}{o.tags ? <span className="text-[11px] text-dim/50 font-normal ml-1.5">[{o.tags}]</span> : null}</span>
              <button onClick={() => setTryOn(o)} title="试衣：按「角色形象+这套穿搭」生图预览（不必激活），满意可存为参考图" className="text-[12px] text-dim/60 hover:text-god">🎨</button>
              <button onClick={() => toggleRandomPool(charId, o.id)}
                title={randomPool.includes(o.id) ? '已在每日随机候选（点击移出）' : '加入每日随机候选（配合下方「每日随机换装」开关）'}
                className={`text-[12px] disabled:opacity-40 ${randomPool.includes(o.id) ? 'text-amber-300' : 'text-dim/40 hover:text-amber-300'}`}>🎲</button>
              <button onClick={() => pickImage(o.id)} disabled={imgBusy === o.id} title="上传穿搭参考图（多模态Chat线绘立绘/漫画/配图时锁服装）" className="text-[12px] text-dim/60 hover:text-god disabled:opacity-40">{imgBusy === o.id ? '⏳' : '📷'}</button>
              {o.hasImage && <button onClick={() => { void removeImage(o); }} title="移除参考图" className="text-[12px] text-dim/60 hover:text-red-300">🚫</button>}
              <button onClick={() => { void onSaveTemplate(o); }} title="存为模板（跨存档模板库·同名覆盖）" className="text-[12px] text-dim/60 hover:text-amber-300">⭐</button>
              <button onClick={() => startEdit(o)} className="text-[12px] text-dim/60 hover:text-god">✎</button>
              <button onClick={() => onRemove(o)} className="text-[12px] text-dim/60 hover:text-red-300">🗑</button>
            </div>
            <div className="text-[12px] text-dim/70 mt-0.5 pl-6 leading-relaxed">{o.desc}</div>
            {o.imageTags && <div className="text-[11px] font-mono text-dim/45 mt-0.5 pl-6 break-all">{o.imageTags}</div>}
          </div>
        ))}
        {wardrobe.outfits.length === 0 && <div className="text-[12px] text-dim/40 text-center py-1">还没有穿搭——在下面添加第一套</div>}
        {wardrobe.outfits.length > 0 && shown.length === 0 && <div className="text-[12px] text-dim/40 text-center py-1">没有匹配「{query.trim()}」的穿搭</div>}
      </div>

      {/* 👗 每日随机换装（借鉴V3.2）：世界时间进入新的一天 → 从 🎲 候选里自动换一套 */}
      <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${wardrobe.autoDaily ? 'border-amber-500/40 bg-amber-500/5' : 'border-edge hover:border-amber-500/30'}`}>
        <input type="checkbox" checked={!!wardrobe.autoDaily} onChange={(e) => setAutoDaily(charId, e.target.checked)} />
        <span className="text-[13px] text-slate-200">每日随机换装</span>
        <span className="text-[11px] text-dim/50 flex-1">
          {randomPool.length ? `候选 ${randomPool.length} 套（给穿搭点 🎲 增删）——世界时间进入新的一天自动换上一套` : '先给至少一套穿搭点 🎲 加入候选，再开这个开关'}
        </span>
      </label>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e); }} />

      {/* 新增 / 编辑 */}
      <div className="rounded-lg border border-edge bg-void/40 p-2.5 space-y-2">
        <div className="text-[12px] font-mono text-god/70">{editingId ? '✎ 编辑穿搭' : '＋ 添加穿搭'}</div>
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 24) })} placeholder="名称（如 战斗服）" className={inputCls} />
          <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value.slice(0, 40) })} placeholder="场景标签（如 战斗,外出）" className={inputCls} />
        </div>
        <textarea rows={3} value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value.slice(0, 600) })} placeholder="穿搭文字描述（必填·中文即可）：款式/颜色/材质/配饰…" className={inputCls + ' resize-y leading-relaxed'} />
        <textarea rows={2} value={draft.imageTags} onChange={(e) => setDraft({ ...draft, imageTags: e.target.value.slice(0, 400) })} placeholder="英文服装标签（可选·NAI/ComfyUI 线用，如 black suit, red tie, leather gloves）" className={inputCls + ' resize-y font-mono'} />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={saveDraft} disabled={!draft.desc.trim()} className="px-3 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">{editingId ? '保存修改' : '＋ 添加'}</button>
          {editingId && <button onClick={() => { setDraft(EMPTY_DRAFT); setEditingId(''); }} className="px-2 py-1 text-[12px] font-mono border border-edge text-dim rounded hover:text-slate-200">取消编辑</button>}
          <button onClick={() => { void onGenFromEquipment(); }} disabled={genBusy}
            className="px-2 py-1 text-[12px] font-mono border border-god/30 text-god/80 rounded hover:bg-god/10 disabled:opacity-40 transition-colors"
            title="读取该角色装备栏所有已穿戴物品的外观描述，交给 LLM 整理成完整穿搭描述+英文服装标签（走「生图标签 LLM」路由）">{genBusy ? '⏳ 生成中…' : '✨ 按装备生成'}</button>
          <button onClick={() => { void onExtractFromNarrative(); }} disabled={extractBusy}
            className="px-2 py-1 text-[12px] font-mono border border-god/30 text-god/80 rounded hover:bg-god/10 disabled:opacity-40 transition-colors"
            title="读最近两回合正文，让 LLM 提炼该角色此刻身上实际穿着（含正文写到的换装/损毁），回填表单（走「生图标签 LLM」路由）">{extractBusy ? '⏳ 提炼中…' : '✨ 从正文提炼'}</button>
          {(currentAttire || '').trim() && !editingId && (
            <button onClick={() => setDraft({ ...draft, desc: (currentAttire || '').trim().slice(0, 600), name: draft.name || '当前穿着' })}
              className="px-2 py-1 text-[12px] font-mono border border-edge text-dim rounded hover:text-god transition-colors" title="把角色当前的穿着描述填进来，改改就能存成一套">⤵ 从当前穿着导入</button>
          )}
        </div>
        {genMsg && <div className={`text-[12px] font-mono ${genMsg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>{genMsg}</div>}
        <div className="text-[11px] text-dim/40 leading-relaxed">📷 每套可传一张穿搭参考图（自动缩到 768px·随存档走）；也可点 🎨 试衣直接生成一张。用「多模态Chat出图」画立绘/漫画/配图时会作为参考图发送，服装还原度最高。</div>
      </div>

      {/* 📚 跨存档模板库 */}
      <div className="rounded-lg border border-edge bg-void/40 p-2.5 space-y-2">
        <button onClick={() => setTplOpen((v) => !v)} className="w-full flex items-center justify-between text-[12px] font-mono text-god/70 hover:text-god">
          <span>📚 模板库（跨存档·{templates.length} 套）</span><span>{tplOpen ? '▲' : '▼'}</span>
        </button>
        {tplMsg && <div className={`text-[12px] font-mono ${tplMsg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>{tplMsg}</div>}
        {tplOpen && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-dim/45 leading-relaxed">衣柜随存档走；模板库<b>不随存档</b>——新开档/换档都在。衣柜里点 ⭐ 存进来（同名覆盖），这里 ⤵ 导入到当前角色的衣柜（含参考图）。</div>
            {templates.length === 0 && <div className="text-[12px] text-dim/40 text-center py-1">还没有模板——去衣柜里给心仪的穿搭点 ⭐</div>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge">
                {tplImgMap[t.id] && <img src={tplImgMap[t.id]} alt="" className="w-8 h-8 rounded object-cover border border-edge shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-slate-200 font-semibold truncate">{t.name}{t.tags ? <span className="text-[11px] text-dim/50 font-normal ml-1.5">[{t.tags}]</span> : null}</div>
                  <div className="text-[11px] text-dim/55 truncate">{t.desc}</div>
                </div>
                <button onClick={() => { void onImportTemplate(t); }} title={`导入到 ${charName} 的衣柜`} className="shrink-0 px-2 py-0.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10">⤵ 导入</button>
                <button onClick={() => onRemoveTemplate(t)} className="shrink-0 text-[12px] text-dim/60 hover:text-red-300">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 🎨 试衣弹层 */}
      {tryOn && <TryOnModal charId={charId} charName={charName} outfit={tryOn}
        onSaved={(oid, url) => setImgMap((m) => ({ ...m, [oid]: url }))}
        onClose={() => setTryOn(null)} />}
    </div>
  );
}

export default function OutfitPanel({ charId, charName, currentAttire, onClose }: {
  charId: string;
  charName: string;
  currentAttire?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-xl border border-edge bg-panel p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-100">👗 {charName} 的衣柜</div>
          <button onClick={onClose} className="text-dim hover:text-slate-200 text-sm">✕</button>
        </div>
        <OutfitPanelBody charId={charId} charName={charName} currentAttire={currentAttire} />
      </div>
    </div>
  );
}
