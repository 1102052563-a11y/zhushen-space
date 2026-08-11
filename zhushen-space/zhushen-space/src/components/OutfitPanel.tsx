import { useEffect, useRef, useState } from 'react';
import { useOutfits, type OutfitRecord } from '../store/outfitStore';
import { useOutfitTemplates, type OutfitTemplate } from '../store/outfitTemplateStore';
import { putTplImg, getTplImg, delTplImg } from '../systems/outfitTemplateDb';
import { getImg } from '../systems/imageDb';
import { outfitImgSet, outfitImgDel } from '../systems/outfitImages';   // 写/删走内存缓存+imageDb 双写——缓存并进存档快照，读档/新游戏不丢（2026-08-11）
import { shrinkDataUrl } from '../systems/imageGen';
import { outfitImageKey } from '../systems/outfit';
import { generateOutfitFromEquipment, extractOutfitFromNarrative } from '../systems/outfitGen';

/* 👗 衣柜（穿搭预设）弹层——主角侧栏 / NPC 详情共用。
   激活的穿搭 = 服装单一权威源：立绘 ${attire}、正文配图 roster、漫画分镜外观锁、<钦定穿搭> 正文注入 全读它；
   AI 可经 <state> `outfit.<角色ID>=穿搭名` 按剧情换装（也可写场景标签）。
   穿搭参考图存 imageDb（key=outfit:<charId>:<id>·随存档快照）——chatimg 多模态线绘漫画/配图时随参考图发送锁服装。
   概念借鉴 ST 插件 Outfit-Manager（无许可证·代码全自写）。 */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god';

interface DraftOutfit { name: string; desc: string; tags: string; imageTags: string }
const EMPTY_DRAFT: DraftOutfit = { name: '', desc: '', tags: '', imageTags: '' };

export default function OutfitPanel({ charId, charName, currentAttire, onClose }: {
  charId: string;
  charName: string;
  currentAttire?: string;   // 「从当前穿着导入」预填（主角=外观描述 / NPC=appearance5 穿着段）
  onClose: () => void;
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
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-xl border border-edge bg-panel p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-100">👗 {charName} 的衣柜</div>
          <button onClick={onClose} className="text-dim hover:text-slate-200 text-sm">✕</button>
        </div>
        <div className="text-[12px] text-dim/60 leading-relaxed">激活的穿搭是<b>服装唯一权威源</b>：正文描写、立绘、正文配图、漫画都以它为准（优先于装备栏与外观描述）。AI 也知道这份衣柜——剧情需要时会用 <span className="font-mono">outfit.{charId}=穿搭名</span> 指令自动换装（场景标签也能命中，如「战斗」）。不激活任何一套＝维持原逻辑。</div>

        {/* 激活选择 */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge cursor-pointer hover:border-god/30 transition-colors">
            <input type="radio" name="of-active" checked={!wardrobe.activeId} onChange={() => setActive(charId, '')} />
            <span className="text-[13px] text-dim">不钦定（跟随装备栏 / 外观描述）</span>
          </label>
          {wardrobe.outfits.map((o) => (
            <div key={o.id} className={`px-2 py-1.5 rounded-lg border transition-colors ${wardrobe.activeId === o.id ? 'border-god/40 bg-god/5' : 'border-edge'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="of-active" checked={wardrobe.activeId === o.id} onChange={() => setActive(charId, o.id)} />
                {imgMap[o.id] && <img src={imgMap[o.id]} alt="" className="w-8 h-8 rounded object-cover border border-edge shrink-0" />}
                <span className="text-[13px] text-slate-200 font-semibold flex-1 truncate">{o.name}{o.tags ? <span className="text-[11px] text-dim/50 font-normal ml-1.5">[{o.tags}]</span> : null}</span>
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
          <div className="text-[11px] text-dim/40 leading-relaxed">📷 每套可传一张穿搭参考图（自动缩到 768px·随存档走）：用「多模态Chat出图」画立绘/漫画/配图时会作为参考图发送，服装还原度最高。</div>
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
      </div>
    </div>
  );
}
