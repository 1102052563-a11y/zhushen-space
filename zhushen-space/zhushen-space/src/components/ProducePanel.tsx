import { useEffect, useRef, useState } from 'react';
import {
  useShop, hydrateShopImages, SHOP_TYPE_META,
  type ShopType, type ShopGood, type ShopSmith, type ShopEntity,
} from '../store/shopStore';
import { useJoy, type JoyGirl } from '../store/joyStore';
import { stageFromDesire } from '../systems/joyGirls';
import { shrinkDataUrl } from '../systems/imageGen';
import { useItems, ITEM_CATEGORIES, type ItemCategory } from '../store/itemStore';
import { pushSceneNotice } from '../systems/allocNotice';
import { resolveEnhance, enhanceCost, displayRate, isEnhanceable, bumpScore, withEnhanceNote, SCORE_PER_LEVEL, MAX_ENHANCE, isRiskLevel } from '../systems/enhanceEngine';
import { shopClient } from '../systems/shopClient';
import { useShopMarket } from '../store/shopMarketStore';
import type { PublishedShop } from '../systems/shopProtocol';
import { chatReady, chatName, chatToken } from '../systems/chatIdentity';

/* 玩家产业·管理面板（🏪 右导航顶层）—— 开店 / 编辑 / 上传立绘。
   三型合一：商店(货架) / 娼馆(复用 JoyGirl) / 铁匠铺(复用 enhanceEngine 的 BossDef)。
   进店消费 / AI 生成货品 / 联机上传分别在后续步骤接入（本面板留好 onGenerateGoods 钩子）。
   ⚠ 所有受控输入子组件一律定义在模块级（避免输入法「打一个字就断」的重挂卸载 bug）。*/

const inputCls = 'bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-cyan-400/40';
const taCls = 'w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 leading-relaxed resize-y focus:outline-none focus:border-cyan-400/40';
const btnGhost = 'text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100';
const btnPrimary = 'text-[13px] font-mono py-1.5 px-4 rounded-lg border border-cyan-400/50 text-cyan-100 bg-cyan-500/15 hover:bg-cyan-500/25';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-mono text-dim/55">{label}</span>
      {children}
    </label>
  );
}

/** 通用立绘上传（FileReader → shrinkDataUrl → onPick；大图由各 store 存 IndexedDB）。 */
function ImgUpload({ src, emoji, onPick, onClear, h = 'h-32' }: {
  src?: string; emoji: string; onPick: (d: string) => void; onClear: () => void; h?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { onPick(await shrinkDataUrl(String(reader.result), 1280, 0.85)); }
      catch { onPick(String(reader.result)); }
    };
    reader.readAsDataURL(f);
  };
  return (
    <div className="w-24 shrink-0 flex flex-col gap-1.5">
      <div className={`w-24 ${h} rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center`}>
        {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <span className="text-4xl text-cyan-300/25">{emoji}</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <button onClick={() => ref.current?.click()} className="text-[11px] font-mono py-1 rounded border border-edge text-dim hover:text-cyan-100 hover:border-cyan-400/40">上传立绘</button>
      {src && <button onClick={onClear} className="text-[11px] font-mono py-0.5 rounded text-blood/60 hover:text-blood">清除</button>}
    </div>
  );
}

/* 店招·多图上传（可多张·第一张为封面·逛店自动轮播）。立绘存 IndexedDB（addShopSign/removeShopSign）。 */
function MultiImgUpload({ shopId, shop, emoji }: { shopId: string; shop: ShopEntity; emoji: string }) {
  const addShopSign = useShop((s) => s.addShopSign);
  const removeShopSign = useShop((s) => s.removeShopSign);
  const ref = useRef<HTMLInputElement>(null);
  const imgs = shop.signs ?? (shop.sign ? [shop.sign] : []);
  const imgsCount = () => (useShop.getState().shops.find((x) => x.id === shopId)?.signs?.length ?? 0);
  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (imgsCount() >= 8) break;
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(f); });
      if (!url) continue;
      let out = url; try { out = await shrinkDataUrl(url, 1280, 0.85); } catch { /* 原图兜底 */ }
      addShopSign(shopId, out);
    }
    if (ref.current) ref.current.value = '';
  };
  return (
    <div className="w-full space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {imgs.map((src, i) => (
          <div key={i} className="relative w-20 h-24 rounded-lg border border-edge bg-void overflow-hidden">
            <img src={src} alt="" className="w-full h-full object-cover" />
            <button onClick={() => removeShopSign(shopId, i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-blood/90 hover:text-blood text-[11px] flex items-center justify-center" title="删除这张">✕</button>
            {i === 0 && <span className="absolute bottom-0 inset-x-0 text-center text-[9px] font-mono bg-black/60 text-cyan-200/80">封面</span>}
          </div>
        ))}
        {imgs.length < 8 && (
          <button onClick={() => ref.current?.click()} className="w-20 h-24 rounded-lg border border-dashed border-edge text-dim/50 hover:text-cyan-100 hover:border-cyan-400/40 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl">{imgs.length ? '＋' : emoji}</span>
            <span className="text-[10px] font-mono">上传立绘</span>
          </button>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <div className="text-[10px] font-mono text-dim/40">可上传多张（≤8）· 逛店 / 商城时自动轮播 · 第一张为封面</div>
    </div>
  );
}

/* 店招展示：多张时定时淡入轮播，单张 / 无图退化为静态。imgs 优先，cover 兜底（远程店 snapshot 亦复用）。 */
function SignShow({ imgs, cover, imgClass = 'object-cover', interval = 3000 }: {
  imgs?: string[]; cover?: string; imgClass?: string; interval?: number;
}) {
  const list = (imgs && imgs.length ? imgs : (cover ? [cover] : []));
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setI((p) => (p + 1) % list.length), interval);
    return () => clearInterval(t);
  }, [list.length, interval]);
  if (!list.length) return null;
  if (list.length === 1) return <img src={list[0]} alt="" className={`w-full h-full ${imgClass}`} />;
  const idx = i % list.length;
  return (
    <div className="relative w-full h-full">
      {list.map((src, k) => (
        <img key={k} src={src} alt="" className={`absolute inset-0 w-full h-full ${imgClass} transition-opacity duration-700 ${k === idx ? 'opacity-100' : 'opacity-0'}`} />
      ))}
    </div>
  );
}

/* 完整字段编辑器：照物品 / 随从固定模板逐字段编辑（AI 生成的 payload 也在此改）。 */
const GOOD_ITEM_FIELDS: { key: string; label: string; area?: boolean }[] = [
  { key: 'subType', label: '类型细分 subType' },
  { key: 'gradeDesc', label: '品质 gradeDesc（15档色名之一）' },
  { key: 'combatStat', label: '攻防 combatStat（如"攻击力 80"/"防御力 8-12"）' },
  { key: 'durability', label: '耐久 durability' },
  { key: 'requirement', label: '装备需求 requirement' },
  { key: 'affix', label: '词缀 affix', area: true },
  { key: 'score', label: '评分 score' },
  { key: 'effect', label: '效果 effect', area: true },
  { key: 'origin', label: '产地 origin' },
  { key: 'intro', label: '简介 intro', area: true },
  { key: 'appearance', label: '外观 appearance（逐部件·配图依据）', area: true },
  { key: 'killCount', label: '杀敌数 killCount（武器）' },
];
const GOOD_NPC_FIELDS: { key: string; label: string; area?: boolean }[] = [
  { key: 'realm', label: '阶位|职业 realm（如"一阶|剑客"）' },
  { key: 'profession', label: '身份/职业 profession' },
  { key: 'gender', label: '性别 gender' },
  { key: 'age', label: '年龄 age' },
  { key: 'strength', label: '生物强度 strength（T0~T9）' },
  { key: 'personality', label: '性格 personality', area: true },
  { key: 'background', label: '背景/来历 background', area: true },
  { key: 'appearance', label: '外观 appearance（逐部件）', area: true },
  { key: 'selfNarration', label: '自述 selfNarration', area: true },
];

function GoodEditModal({ shopId, good, onClose }: { shopId: string; good: ShopGood; onClose: () => void }) {
  const upsertGood = useShop((s) => s.upsertGood);
  const [kind, setKind] = useState<'item' | 'npc'>(good.kind === 'npc' ? 'npc' : 'item');
  const [name, setName] = useState(good.name);
  const [category, setCategory] = useState(good.category);
  const [price, setPrice] = useState<number>(good.price);
  const [stock, setStock] = useState<string>(good.stock == null ? '' : String(good.stock));
  const [pf, setPf] = useState<Record<string, string>>(() => {
    const p: any = good.payload && typeof good.payload === 'object' ? good.payload : {};
    const o: Record<string, string> = {};
    for (const f of [...GOOD_ITEM_FIELDS, ...GOOD_NPC_FIELDS]) if (p[f.key] != null && o[f.key] == null) o[f.key] = String(p[f.key]);
    return o;
  });
  const fields = kind === 'npc' ? GOOD_NPC_FIELDS : GOOD_ITEM_FIELDS;

  const save = () => {
    const payload: any = { ...(good.payload && typeof good.payload === 'object' ? good.payload : {}), name };
    for (const f of fields) { const v = (pf[f.key] ?? '').trim(); if (v) payload[f.key] = v; else delete payload[f.key]; }
    upsertGood(shopId, {
      ...good, kind, name: name.trim() || good.name, category: category.trim() || good.category,
      price: Math.max(0, Math.round(price || 0)), stock: stock === '' ? undefined : Math.max(0, Number(stock) || 0),
      desc: ((kind === 'npc' ? pf.selfNarration : pf.effect) || good.desc || '').slice(0, 200), payload,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[86] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl rounded-2xl border border-cyan-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[90dvh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20 bg-panel">
          <span className="text-base">✎</span>
          <div className="flex-1 min-w-0"><div className="text-sm font-bold text-cyan-100 truncate">{name || '货品'} · 完整字段</div>
            <div className="text-[11px] font-mono text-cyan-300/50">照物品 / 随从固定模板逐字段编辑</div></div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setKind('item')} className={`text-[12px] font-mono px-3 py-1 rounded-lg border ${kind === 'item' ? 'border-cyan-400/50 text-cyan-100 bg-cyan-500/15' : 'border-edge text-dim'}`}>📦 物品</button>
            <button onClick={() => setKind('npc')} className={`text-[12px] font-mono px-3 py-1 rounded-lg border ${kind === 'npc' ? 'border-fuchsia-400/50 text-fuchsia-100 bg-fuchsia-500/15' : 'border-edge text-dim'}`}>🧑 随从</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full`} /></Field>
            <Field label="分类"><input value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} w-full`} /></Field>
            <Field label="价格"><input type="number" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-full`} /></Field>
            <Field label="库存（空=∞）"><input type="number" value={stock} onChange={(e) => setStock(e.target.value)} className={`${inputCls} w-full`} /></Field>
          </div>
          {fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.area
                ? <textarea value={pf[f.key] ?? ''} onChange={(e) => setPf((s) => ({ ...s, [f.key]: e.target.value }))} rows={2} className={taCls} />
                : <input value={pf[f.key] ?? ''} onChange={(e) => setPf((s) => ({ ...s, [f.key]: e.target.value }))} className={`${inputCls} w-full`} />}
            </Field>
          ))}
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-cyan-500/20 bg-panel">
          <div className="flex-1" />
          <button onClick={onClose} className={btnGhost}>取消</button>
          <button onClick={save} className={btnPrimary}>保存</button>
        </footer>
      </div>
    </div>
  );
}

/* ══════════ 商店·单件商品 ══════════ */
function GoodRow({ shopId, good }: { shopId: string; good: ShopGood }) {
  const upsertGood = useShop((s) => s.upsertGood);
  const removeGood = useShop((s) => s.removeGood);
  const setGoodImage = useShop((s) => s.setGoodImage);
  const [editFull, setEditFull] = useState(false);
  const patch = (p: Partial<ShopGood>) => upsertGood(shopId, { ...good, ...p });

  return (
    <div className="rounded-xl border border-edge bg-panel p-3 flex max-lg:flex-col gap-3">
      <ImgUpload emoji={good.kind === 'npc' ? '🧑' : '📦'} h="h-24" src={good.image}
        onPick={(d) => setGoodImage(shopId, good.id, d)} onClear={() => setGoodImage(shopId, good.id, undefined)} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={good.name} onChange={(e) => patch({ name: e.target.value })} placeholder={good.kind === 'npc' ? '随从名' : '商品名'} className={`${inputCls} flex-1 font-semibold min-w-0`} />
          <input value={good.category} onChange={(e) => patch({ category: e.target.value })} placeholder="分类" className={`${inputCls} w-24`} />
          <button onClick={() => removeGood(shopId, good.id)} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="删除">✕</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-[12px] text-dim shrink-0">价
            <input type="number" value={good.price} onChange={(e) => patch({ price: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} w-24`} />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-dim shrink-0">库存
            <input type="number" value={good.stock ?? ''} placeholder="∞" onChange={(e) => patch({ stock: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} w-20`} />
          </label>
          {good.kind === 'npc' && <span className="text-[10px] font-mono text-fuchsia-300/70 px-1.5 py-0.5 rounded border border-fuchsia-500/25">随从</span>}
          {good.aiGen && <span className="text-[10px] font-mono text-cyan-300/60 px-1.5 py-0.5 rounded border border-cyan-500/25">AI 生成</span>}
          <button onClick={() => setEditFull(true)} className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:text-cyan-100 hover:border-cyan-400/40">✎ 完整字段</button>
        </div>
        <textarea value={good.desc ?? ''} onChange={(e) => patch({ desc: e.target.value })} rows={2} placeholder="商品描述（效果 / 卖点 / 品级…）" className={`${taCls} resize-none`} />
      </div>
      {editFull && <GoodEditModal shopId={shopId} good={good} onClose={() => setEditFull(false)} />}
    </div>
  );
}

/* ══════════ 娼馆·娼妇详细预设弹窗（镜像 JoyManager，作用域到本店）══════════ */
function GirlPresetModal({ shopId, girl, onClose }: { shopId: string; girl: JoyGirl; onClose: () => void }) {
  const upsertShopGirl = useShop((s) => s.upsertShopGirl);
  const [personality, setPersonality] = useState(girl.personality ?? '');
  const [background, setBackground] = useState(girl.background ?? '');
  const [appearance, setAppearance] = useState(girl.appearance ?? '');
  const [appellation, setAppellation] = useState(girl.appellation ?? '');
  const [chat, setChat] = useState(girl.chatPreset ?? '');
  const [s1, setS1] = useState(girl.stageDesc?.['1'] ?? '');
  const [s2, setS2] = useState(girl.stageDesc?.['2'] ?? '');
  const [s3, setS3] = useState(girl.stageDesc?.['3'] ?? '');
  const [s4, setS4] = useState(girl.stageDesc?.['4'] ?? '');

  const save = () => {
    upsertShopGirl(shopId, {
      ...girl,
      personality: personality.trim() || undefined,
      background: background.trim() || undefined,
      appearance: appearance.trim() || undefined,
      appellation: appellation.trim() || undefined,
      chatPreset: chat.trim() || undefined,
      stageDesc: { '1': s1.trim(), '2': s2.trim(), '3': s3.trim(), '4': s4.trim() },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl border border-pink-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[90dvh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-pink-500/20 bg-panel">
          <span className="text-base">✎</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-pink-100 truncate">{girl.name || '娼妇'} · 预设编辑</div>
            <div className="text-[11px] font-mono text-pink-300/50">性格 / 经历 / 外观 / 对话 / 四阶段递进</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <Field label="性格（详细 · AI 优先采用，留空用卡片性格简介）"><textarea value={personality} onChange={(e) => setPersonality(e.target.value)} rows={3} className={taCls} /></Field>
          <Field label="个人经历 / 身世"><textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={3} className={taCls} /></Field>
          <Field label="外观（容貌 · 身段 · 衣着）"><textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={3} className={taCls} /></Field>
          <Field label="初始称谓（她一开始怎么称呼客人；之后随好感度演变）"><input value={appellation} onChange={(e) => setAppellation(e.target.value)} className={`${inputCls} w-full`} placeholder="如：公子 / 客人 / 你" /></Field>
          <Field label="对话 / 演绎预设（她陪侍时的口吻与风格）"><textarea value={chat} onChange={(e) => setChat(e.target.value)} rows={4} className={`${taCls} font-mono`} /></Field>
          <div className="text-[12px] font-mono text-pink-300/55 pt-1">四阶段递进（按情欲值注入 · 语言 + 身体变化）</div>
          <Field label="① 25% 以下"><textarea value={s1} onChange={(e) => setS1(e.target.value)} rows={2} className={taCls} /></Field>
          <Field label="② 25–50%"><textarea value={s2} onChange={(e) => setS2(e.target.value)} rows={2} className={taCls} /></Field>
          <Field label="③ 50–75%"><textarea value={s3} onChange={(e) => setS3(e.target.value)} rows={2} className={taCls} /></Field>
          <Field label="④ 75–100%"><textarea value={s4} onChange={(e) => setS4(e.target.value)} rows={2} className={taCls} /></Field>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-pink-500/20 bg-panel">
          <div className="flex-1" />
          <button onClick={onClose} className={btnGhost}>取消</button>
          <button onClick={save} className="text-[13px] font-mono py-1.5 px-4 rounded-lg border border-pink-400/50 text-pink-100 bg-pink-500/15 hover:bg-pink-500/25">保存</button>
        </footer>
      </div>
    </div>
  );
}

/* ══════════ 娼馆·单个娼妇 ══════════ */
function GirlRow({ shopId, girl }: { shopId: string; girl: JoyGirl }) {
  const upsertShopGirl = useShop((s) => s.upsertShopGirl);
  const removeShopGirl = useShop((s) => s.removeShopGirl);
  const setPortrait = useShop((s) => s.setShopGirlPortrait);
  const [editing, setEditing] = useState(false);
  const patch = (p: Partial<JoyGirl>) => upsertShopGirl(shopId, { ...girl, ...p });

  return (
    <div className="rounded-xl border border-pink-500/20 bg-panel p-3 flex max-lg:flex-col gap-3">
      <ImgUpload emoji="💋" src={girl.portrait}
        onPick={(d) => setPortrait(shopId, girl.id, d)} onClear={() => setPortrait(shopId, girl.id, undefined)} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={girl.name} onChange={(e) => patch({ name: e.target.value })} placeholder="芳名" className={`${inputCls} flex-1 font-semibold min-w-0`} />
          <input value={girl.race} onChange={(e) => patch({ race: e.target.value })} placeholder="种族" className={`${inputCls} w-24`} />
          <button onClick={() => removeShopGirl(shopId, girl.id)} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="删除">✕</button>
        </div>
        <input value={girl.title ?? ''} onChange={(e) => patch({ title: e.target.value.trim() || undefined })} placeholder="头衔（花魁 / 头牌…可空）" className={`${inputCls} w-full`} />
        <textarea value={girl.persona} onChange={(e) => patch({ persona: e.target.value })} rows={2} placeholder="性格简介（一句话 · 卡片摘要；详细见下方编辑）" className={`${taCls} resize-none leading-snug`} />
        <button onClick={() => setEditing(true)} className="w-full text-left text-[12px] font-mono px-2 py-1.5 rounded-lg border border-pink-500/30 text-pink-200/90 bg-pink-500/5 hover:bg-pink-500/10">
          ✎ 性格 · 经历 · 外观 · 对话 · 四阶段递进（点击编辑）
        </button>
      </div>
      {editing && <GirlPresetModal shopId={shopId} girl={girl} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ══════════ 铁匠铺·铁匠编辑 ══════════ */
function NumField({ label, hint, value, step, min, max, onChange }: {
  label: string; hint: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-mono text-dim/55">{label} <span className="text-dim/35">· {hint}</span></span>
      <input type="number" step={step} min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className={`${inputCls} w-full`} />
    </label>
  );
}

function SmithEditor({ shopId, smith }: { shopId: string; smith: ShopSmith }) {
  const setShopSmith = useShop((s) => s.setShopSmith);
  const setPortrait = useShop((s) => s.setShopSmithPortrait);
  const boss = smith.boss;
  const patchBoss = (p: Partial<typeof boss>) => setShopSmith(shopId, { ...smith, boss: { ...boss, ...p } });
  const patchSmith = (p: Partial<ShopSmith>) => setShopSmith(shopId, { ...smith, ...p });

  return (
    <div className="rounded-xl border border-amber-500/20 bg-panel p-3 space-y-3">
      <div className="flex max-lg:flex-col gap-3">
        <ImgUpload emoji="⚒️" src={boss.portrait}
          onPick={(d) => setPortrait(shopId, d)} onClear={() => setPortrait(shopId, undefined)} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <input value={boss.name} onChange={(e) => patchBoss({ name: e.target.value })} placeholder="铁匠芳名" className={`${inputCls} flex-1 font-semibold min-w-0`} />
            <select value={boss.gender} onChange={(e) => patchBoss({ gender: e.target.value as '男' | '女' | '' })} className={`${inputCls} w-20`}>
              <option value="">性别</option><option value="男">男</option><option value="女">女</option>
            </select>
          </div>
          <textarea value={boss.persona} onChange={(e) => patchBoss({ persona: e.target.value })} rows={2} placeholder="铁匠性格简介（一句话 · 强化时吐槽兜底）" className={`${taCls} resize-none leading-snug`} />
        </div>
      </div>
      <Field label="强化对话预设（分阶段吐槽风格 · 随强化进度升级；留空回退性格）">
        <textarea value={boss.banterPreset ?? ''} onChange={(e) => patchBoss({ banterPreset: e.target.value.trim() || undefined })} rows={4} className={`${taCls} font-mono`}
          placeholder="例：你是铁匠XX本人，第一人称、硬气爱用工匠行话。阶段1爽朗祝好运；阶段2激将挑衅；阶段3劝见好就收；阶段4被结果震惊。" />
      </Field>
      <div className="text-[12px] font-mono text-amber-300/55">强化参数（玩家自定义 · 直接喂 enhanceEngine）</div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <NumField label="费用倍率 costMul" hint="0.7 便宜 / 1.3 贵" value={boss.costMul} step={0.05} min={0.1} max={5} onChange={(v) => patchBoss({ costMul: v })} />
        <NumField label="成功率加成 rateAdd" hint="0.06 = +6%" value={boss.rateAdd} step={0.01} min={-0.5} max={0.5} onChange={(v) => patchBoss({ rateAdd: v })} />
        <NumField label="明面率虚标 displayLie" hint="0.15 看着高其实低" value={boss.displayLie} step={0.01} min={0} max={0.5} onChange={(v) => patchBoss({ displayLie: v })} />
        <NumField label="暴击跳级 critJump" hint="0.03 概率额外 +1" value={boss.critJump} step={0.01} min={0} max={0.5} onChange={(v) => patchBoss({ critJump: v })} />
        <NumField label="店主服务费倍率 feeMul" hint="额外抽成，默认 1" value={smith.feeMul ?? 1} step={0.1} min={1} max={5} onChange={(v) => patchSmith({ feeMul: v })} />
      </div>
    </div>
  );
}

/* ══════════ 单店编辑弹窗 ══════════ */
function ShopEditorModal({ shopId, onClose, onGenerateGoods }: {
  shopId: string; onClose: () => void; onGenerateGoods?: (shopId: string, tendency: string) => void | Promise<void>;
}) {
  const shop = useShop((s) => s.shops.find((x) => x.id === shopId));
  const patchShop = useShop((s) => s.patchShop);
  const upsertGood = useShop((s) => s.upsertGood);
  const upsertShopGirl = useShop((s) => s.upsertShopGirl);
  const [tendency, setTendency] = useState('');
  const [genBusy, setGenBusy] = useState(false);

  if (!shop) return null;
  const meta = SHOP_TYPE_META[shop.type];

  const runGen = async () => {
    if (!onGenerateGoods || genBusy) return;
    setGenBusy(true);
    try { await onGenerateGoods(shopId, tendency.trim()); }
    finally { setGenBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-2xl border border-cyan-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[92dvh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20 bg-panel">
          <span className="text-lg">{meta.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-cyan-100 truncate">{shop.name || meta.label} · 经营</div>
            <div className="text-[11px] font-mono text-cyan-300/50">{meta.label} · {meta.blurb}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>

        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* 店铺门面 */}
          <MultiImgUpload shopId={shopId} shop={shop} emoji={meta.emoji} />
          <div className="space-y-2">
              <Field label="店名"><input value={shop.name} onChange={(e) => patchShop(shopId, { name: e.target.value })} className={`${inputCls} w-full font-semibold`} /></Field>
              <Field label="招牌语（一句话 · 逛店时展示）"><input value={shop.tagline ?? ''} onChange={(e) => patchShop(shopId, { tagline: e.target.value })} className={`${inputCls} w-full`} placeholder="如：童叟无欺，奇物尽有" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="结算货币"><input value={shop.currency} onChange={(e) => patchShop(shopId, { currency: e.target.value })} className={`${inputCls} w-full`} placeholder="乐园币 / 魂币" /></Field>
                <Field label="所属世界 / 乐园（空 = 通用）"><input value={shop.world ?? ''} onChange={(e) => patchShop(shopId, { world: e.target.value.trim() || undefined })} className={`${inputCls} w-full`} /></Field>
              </div>
          </div>
          <Field label="店铺简介（多行 · 逛店展示 + AI 生成货品参考此定位）">
            <textarea value={shop.intro ?? ''} onChange={(e) => patchShop(shopId, { intro: e.target.value })} rows={2} className={`${taCls} resize-none`} placeholder="如：坐落黑市深处的老字号，专营来路不明的异界奇物，童叟无欺（大概）。" />
          </Field>
          <Field label="掌柜 / 老板性格（进店叙事时 AI 据此演绎）">
            <textarea value={shop.ownerPersona ?? ''} onChange={(e) => patchShop(shopId, { ownerPersona: e.target.value })} rows={2} className={`${taCls} resize-none`} placeholder="如：精明市侩的独眼老商人，爱吹嘘货物来历" />
          </Field>

          {/* 分型主体 */}
          {shop.type === 'store' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-[13px] font-bold text-cyan-100">货架（{(shop.goods ?? []).length}）</div>
                <div className="flex-1" />
                <button onClick={() => upsertGood(shopId, { id: '', category: '商品', name: '', price: 100 })} className={btnGhost}>＋ 添加商品</button>
              </div>
              {/* AI 生成货品：玩家输入倾向 → 注入物品世界书 + CoT 生成（步骤④接入） */}
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                <div className="text-[12px] font-mono text-cyan-200/80">✨ AI 生成货品（输入倾向，自动按物品世界书 + 思维链生成）</div>
                <div className="flex max-lg:flex-col gap-2">
                  <input value={tendency} onChange={(e) => setTendency(e.target.value)} placeholder="倾向：如「中世纪冷兵器铺，偏实战剑与匕首」" className={`${inputCls} flex-1`} />
                  <button onClick={runGen} disabled={!onGenerateGoods || genBusy} className={`${btnPrimary} ${(!onGenerateGoods || genBusy) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    {genBusy ? '生成中…' : onGenerateGoods ? '生成货品' : '待接入'}
                  </button>
                </div>
              </div>
              {(shop.goods ?? []).map((g) => <GoodRow key={g.id} shopId={shopId} good={g} />)}
              {!(shop.goods ?? []).length && <div className="text-center text-dim/50 text-sm py-6">货架空空，「添加商品」或用 AI 生成。</div>}
            </div>
          )}

          {shop.type === 'brothel' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-[13px] font-bold text-pink-100">花名册（{(shop.girls ?? []).length}）</div>
                <div className="flex-1" />
                <button onClick={() => upsertShopGirl(shopId, { id: '', name: '', race: '', persona: '' })} className={btnGhost}>＋ 添加娼妇</button>
              </div>
              {(shop.girls ?? []).map((g) => <GirlRow key={g.id} shopId={shopId} girl={g} />)}
              {!(shop.girls ?? []).length && <div className="text-center text-dim/50 text-sm py-6">尚无娼妇，「添加娼妇」自定义性格与立绘。</div>}
            </div>
          )}

          {shop.type === 'smithy' && shop.smith && <SmithEditor shopId={shopId} smith={shop.smith} />}
        </div>

        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-cyan-500/20 bg-panel">
          <div className="text-[11px] font-mono text-dim/50">改动即时保存</div>
          <div className="flex-1" />
          <button onClick={onClose} className={btnPrimary}>完成</button>
        </footer>
      </div>
    </div>
  );
}

/* 货币名归一：店铺自由填的「魂币」等 → itemStore 的 灵魂钱币；其余 → 乐园币。 */
function normCur(c?: string): '乐园币' | '灵魂钱币' { return (c === '魂币' || c === '灵魂钱币' || c === '魂') ? '灵魂钱币' : '乐园币'; }

/* ══════════ 进店消费·商店买货（确定性：扣币 + 入背包 + 场外通报，照 SystemShop 口径）══════════ */
function ShopVisitModal({ shopId, onClose, onBuyCompanion }: { shopId: string; onClose: () => void; onBuyCompanion?: (info: any) => void }) {
  const shop = useShop((s) => s.shops.find((x) => x.id === shopId));
  const upsertGood = useShop((s) => s.upsertGood);
  const earn = useShop((s) => s.earn);
  const bumpVisit = useShop((s) => s.bumpVisit);
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const addItem = useItems((s) => s.addItem);
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3000); };

  useEffect(() => { bumpVisit(shopId); }, [shopId, bumpVisit]);

  if (!shop) return null;
  const cur = normCur(shop.currency);
  const curLabel = shop.currency || '乐园币';
  const goods = shop.goods ?? [];
  const cats = Array.from(new Set(goods.map((g) => g.category || '其他')));

  const buy = (good: ShopGood) => {
    const price = Math.max(0, Math.round(good.price || 0));
    if (good.stock === 0) { flash('已售罄'); return; }
    if (good.kind === 'npc' && !onBuyCompanion) { flash('随从招募暂未接入'); return; }
    if ((currency[cur] ?? 0) < price) { flash(`${curLabel}不足（需 ${price}）`); return; }
    if (price > 0) adjustCurrency(cur, -price, `产业·${shop.name}·${good.kind === 'npc' ? '招募' : '购买'} ${good.name || '商品'}`);
    if (good.kind === 'npc') {
      onBuyCompanion?.(good.payload && typeof good.payload === 'object' ? { ...good.payload, name: good.name } : { name: good.name });
      pushSceneNotice(`【场外·产业】在「${shop.name}」花 ${price} ${curLabel} 招募随从「${good.name || '随从'}」（已入队）`);
    } else {
      const base: any = good.payload && typeof good.payload === 'object' ? { ...good.payload } : {};
      addItem({
        ...base,
        name: good.name || '商品',
        category: (ITEM_CATEGORIES.includes(base.category) ? base.category
          : ITEM_CATEGORIES.includes(good.category as ItemCategory) ? good.category : '特殊物品') as ItemCategory,
        gradeDesc: base.gradeDesc ?? '',
        effect: base.effect ?? good.desc ?? '',
        quantity: 1, equipped: false, tags: base.tags ?? [],
        subType: base.subType ?? (good.category || undefined),
        origin: shop.name || '玩家产业',
        acquisition: `${shop.name || '产业'}·购买`,
      } as any);
      pushSceneNotice(`【场外·产业】在「${shop.name}」花 ${price} ${curLabel} 购得「${good.name || '商品'}」（已入背包）`);
    }
    if (typeof good.stock === 'number' && good.stock > 0) upsertGood(shopId, { ...good, stock: good.stock - 1 });
    earn(shopId, price);
    flash(good.kind === 'npc' ? `已招募「${good.name || '随从'}」` : `已购得「${good.name || '商品'}」`);
  };

  return (
    <div className="fixed inset-0 z-[82] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[86dvh] flex flex-col rounded-2xl border border-cyan-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-cyan-500/20 bg-panel">
          <div className="w-12 h-12 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
            {(shop.signs?.length || shop.sign) ? <SignShow imgs={shop.signs} cover={shop.sign} /> : <span className="text-2xl opacity-30">🏪</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-cyan-100 truncate">{shop.name || '商店'}</div>
            <div className="text-[11px] font-mono text-cyan-300/50 truncate">{shop.tagline || '进店选购'}</div>
          </div>
          <span className="text-[11px] font-mono text-amber-300/80 shrink-0">💰 {currency.乐园币} · 魂 {currency.灵魂钱币}</span>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg shrink-0">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {goods.length === 0
            ? <div className="py-16 text-center text-dim/40 text-sm font-mono">货架空空，店主还没上货。</div>
            : cats.map((cat) => (
              <div key={cat} className="space-y-1.5">
                <div className="text-[12px] font-mono text-cyan-300/55 px-1">{cat}</div>
                {goods.filter((g) => (g.category || '其他') === cat).map((g) => {
                  const sold = g.stock === 0;
                  return (
                    <div key={g.id} className="flex items-center gap-3 px-2.5 py-2 rounded-lg border border-edge bg-panel/50">
                      <div className="w-14 h-14 rounded border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
                        {g.image ? <img src={g.image} alt="" className="w-full h-full object-cover" /> : <span className="text-xl opacity-25">📦</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-100 truncate">{g.name || '（未命名商品）'}{g.aiGen && <span className="ml-1.5 text-[10px] font-mono text-cyan-300/60">AI</span>}</div>
                        {g.desc && <div className="text-[12px] text-dim/60 truncate">{g.desc}</div>}
                        <div className="text-[11px] font-mono text-dim/45">{typeof g.stock === 'number' && g.stock >= 0 ? `库存 ${g.stock}` : '库存 ∞'}</div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-sm font-bold font-mono text-amber-300">{g.price} {curLabel}</span>
                        <button onClick={() => buy(g)} disabled={sold}
                          className={`text-[12px] font-mono py-1 px-3 rounded-lg border ${sold ? 'border-edge text-dim/40 cursor-not-allowed' : 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/25'}`}>
                          {sold ? '售罄' : '购买'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>

        {toast && <div className="shrink-0 px-4 py-2 text-[13px] font-mono border-t border-cyan-500/30 text-cyan-200/80 bg-cyan-500/5">{toast}</div>}
      </div>
    </div>
  );
}

/* ══════════ 进店消费·铁匠铺强化（独立店面·纯引擎 resolveEnhance/enhanceCost·完全不进强化所）══════════ */
function SmithyVisitModal({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const shop = useShop((s) => s.shops.find((x) => x.id === shopId));
  const earn = useShop((s) => s.earn);
  const bumpVisit = useShop((s) => s.bumpVisit);
  const items = useItems((s) => s.items);
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const updateItem = useItems((s) => s.updateItem);
  const removeItem = useItems((s) => s.removeItem);
  const [selId, setSelId] = useState<string | null>(null);
  const [pity, setPity] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2500); };

  useEffect(() => { bumpVisit(shopId); }, [shopId, bumpVisit]);

  if (!shop || !shop.smith) return null;
  const boss = shop.smith.boss;
  const feeMul = shop.smith.feeMul ?? 1;
  const cur = normCur(shop.currency);
  const curLabel = shop.currency || '乐园币';
  const enhanceable = items.filter((it) => isEnhanceable(it.category) && !it.locked);
  const sel = enhanceable.find((it) => it.id === selId) ?? null;
  const level = sel ? (Number(sel.enhanceLevel) || 0) : 0;
  const cost = sel ? Math.round(enhanceCost(level, boss, sel.gradeDesc, sel.score) * feeMul) : 0;
  const rate = sel ? Math.round(displayRate(level, boss, false) * 100) : 0;

  const doEnhance = () => {
    if (!sel) return;
    if (level >= MAX_ENHANCE) { flash('已达强化上限 +' + MAX_ENHANCE); return; }
    if ((currency[cur] ?? 0) < cost) { flash(`${curLabel}不足（需 ${cost}）`); return; }
    adjustCurrency(cur, -cost, `产业·${shop.name}·强化 ${sel.name}`);
    earn(shopId, cost);
    const r = resolveEnhance(level, boss, { useProtect: false, useAmulet: false, pity });
    setPity(r.pityAfter);
    if (r.destroyed) {
      removeItem(sel.id); setSelId(null);
      setLog((l) => [`💥 ${sel.name} 强化失败，装备分解损毁！`, ...l].slice(0, 30));
      pushSceneNotice(`【场外·产业】在「${shop.name}」强化「${sel.name}」（+${level}）失败，装备损毁。`);
      flash('💥 装备损毁'); return;
    }
    const to = r.toLevel;
    updateItem(sel.id, {
      enhanceLevel: to,
      maxEnhanceLevel: Math.max(Number(sel.maxEnhanceLevel) || 0, to),
      score: bumpScore(sel.score, SCORE_PER_LEVEL * (to - level)),
      appearance: withEnhanceNote(sel.appearance, to, 'appearance'),
    });
    const msg = r.outcome === 'crit' ? `⚡ 暴击！+${level} → +${to}`
      : r.outcome === 'guaranteed' ? `🛡 保底必成 +${level} → +${to}`
      : r.outcome === 'success' ? `✨ 成功 +${level} → +${to}`
      : r.outcome === 'downgrade' ? `↓ 失败·降级 +${level} → +${to}`
      : r.outcome === 'reset' ? `🔻 失败·强化归零 +${level} → +0` : '— 未变';
    setLog((l) => [`${msg}（${sel.name}）`, ...l].slice(0, 30));
    flash(msg);
  };

  return (
    <div className="fixed inset-0 z-[82] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[86dvh] flex flex-col rounded-2xl border border-amber-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-amber-500/20 bg-panel">
          <div className="w-12 h-12 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
            {(shop.signs?.length || shop.sign) ? <SignShow imgs={shop.signs} cover={shop.sign} /> : <span className="text-2xl opacity-30">⚒️</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-amber-100 truncate">{shop.name || '铁匠铺'}</div>
            <div className="text-[11px] font-mono text-amber-300/50 truncate">{shop.tagline || '装备强化'}</div>
          </div>
          <span className="text-[11px] font-mono text-amber-300/80 shrink-0">💰 {currency.乐园币} · 魂 {currency.灵魂钱币}</span>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg shrink-0">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 flex max-lg:flex-col gap-3">
          {/* 铁匠 + 强化台 */}
          <div className="lg:w-52 shrink-0 space-y-2">
            <div className="rounded-xl border border-amber-500/20 bg-panel p-3 flex gap-3">
              <div className="w-16 h-20 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
                {boss.portrait ? <img src={boss.portrait} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl opacity-30">⚒️</span>}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-amber-100 truncate">{boss.name || '铁匠'}</div>
                <div className="text-[11px] text-dim/60 line-clamp-4 leading-snug mt-0.5">{boss.persona || '沉默的铁匠。'}</div>
              </div>
            </div>
            {sel ? (
              <div className="rounded-xl border border-edge bg-panel p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-100 truncate">{sel.name} <span className="text-amber-300 font-mono">+{level}</span></div>
                <div className="text-[12px] font-mono text-dim/70">明面成功率 <span className="text-emerald-300">{rate}%</span></div>
                <div className="text-[12px] font-mono text-dim/70">强化费 <span className="text-amber-300">{cost} {curLabel}</span></div>
                {isRiskLevel(level) && <div className="text-[11px] font-mono text-blood/80">⚠ 危险区：失败可能归零或损毁</div>}
                <button onClick={doEnhance} disabled={level >= MAX_ENHANCE}
                  className={`w-full text-[13px] font-mono py-1.5 rounded-lg border ${level >= MAX_ENHANCE ? 'border-edge text-dim/40' : 'border-amber-400/50 text-amber-100 bg-amber-500/15 hover:bg-amber-500/25'}`}>
                  {level >= MAX_ENHANCE ? `已满 +${MAX_ENHANCE}` : `强化 → +${level + 1}`}
                </button>
              </div>
            ) : <div className="rounded-xl border border-edge bg-panel/50 p-3 text-center text-dim/50 text-[12px]">← 选一件装备开始强化</div>}
            {log.length > 0 && (
              <div className="rounded-xl border border-edge bg-panel/50 p-2 space-y-1 max-h-40 overflow-y-auto">
                {log.map((t, i) => <div key={i} className="text-[11px] font-mono text-dim/70">{t}</div>)}
              </div>
            )}
          </div>

          {/* 可强化装备列表 */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="text-[12px] font-mono text-amber-300/55 px-1">可强化装备（{enhanceable.length}）</div>
            {enhanceable.length === 0
              ? <div className="py-12 text-center text-dim/40 text-sm font-mono">背包里没有可强化的装备（武器 / 防具 / 饰品 / 法宝 / 特殊物品）。</div>
              : enhanceable.map((it) => {
                const lv = Number(it.enhanceLevel) || 0;
                return (
                  <button key={it.id} onClick={() => setSelId(it.id)}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${selId === it.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-edge bg-panel/50 hover:border-amber-400/30'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-100 truncate">{it.name}{lv > 0 && <span className="ml-1.5 text-amber-300 font-mono">+{lv}</span>}</div>
                      <div className="text-[11px] text-dim/50 truncate">{it.category}{it.gradeDesc ? ` · ${it.gradeDesc}` : ''}</div>
                    </div>
                    {it.equipped && <span className="text-[10px] font-mono text-cyan-300/60 shrink-0">已装备</span>}
                  </button>
                );
              })}
          </div>
        </div>

        {toast && <div className="shrink-0 px-4 py-2 text-[13px] font-mono border-t border-amber-500/30 text-amber-200/90 bg-amber-500/5">{toast}</div>}
      </div>
    </div>
  );
}

/* ══════════ 进店消费·娼馆陪侍（独立店面·复用 joyStore 会话 + App.onJoySend·完全不进欢愉宫）══════════ */
function BrothelVisitModal({ shopId, onClose, onJoySend }: {
  shopId: string; onClose: () => void; onJoySend?: (girlId: string, text: string) => Promise<void>;
}) {
  const shop = useShop((s) => s.shops.find((x) => x.id === shopId));
  const bumpVisit = useShop((s) => s.bumpVisit);
  const sessions = useJoy((s) => s.sessions);
  const [curId, setCurId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const STAGE_LABEL: Record<number, string> = { 1: '初见', 2: '微醺', 3: '沉沦', 4: '极致' };

  // 进店：把本店娼妇同步进 joyStore（打 shopId·让 App.onJoySend 找得到人设；欢愉宫已按 shopId 过滤隐藏），并计客流。
  useEffect(() => {
    const g = useShop.getState().shops.find((x) => x.id === shopId);
    if (!g || g.type !== 'brothel') return;
    const J = useJoy.getState();
    for (const girl of g.girls ?? []) J.upsertGirl({ ...girl, portrait: undefined, shopId });
    bumpVisit(shopId);
  }, [shopId, bumpVisit]);

  const girls = shop?.girls ?? [];
  const cur = girls.find((x) => x.id === curId) ?? null;
  const sess = curId ? sessions[curId] : undefined;
  const desire = sess?.desire ?? 0;
  const stage = stageFromDesire(desire);
  const messages = sess?.messages ?? [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    const t = input.trim();
    if (!t || !cur || sending || !onJoySend) return;
    setInput(''); setSending(true);
    try { await onJoySend(cur.id, t); } finally { setSending(false); }
  };

  if (!shop) return null;

  return (
    <div className="fixed inset-0 z-[82] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-pink-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-pink-500/20 bg-panel">
          <div className="w-11 h-11 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
            {(shop.signs?.length || shop.sign) ? <SignShow imgs={shop.signs} cover={shop.sign} /> : <span className="text-2xl opacity-30">💗</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-pink-100 truncate">{shop.name || '娼馆'}</div>
            <div className="text-[11px] font-mono text-pink-300/50 truncate">{cur ? `陪侍中 · ${cur.name}` : (shop.tagline || '选一位入包间')}</div>
          </div>
          {cur && <button onClick={() => setCurId(null)} className="text-[12px] font-mono text-pink-200/70 hover:text-pink-100 border border-pink-500/30 rounded px-2 py-0.5 shrink-0">← 换人</button>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg shrink-0">✕</button>
        </header>

        {!cur ? (
          <div className="flex-1 overflow-y-auto p-3">
            {girls.length === 0
              ? <div className="py-16 text-center text-dim/40 text-sm font-mono">花名册空空，先去「经营 / 编辑」添加娼妇。</div>
              : <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {girls.map((g) => (
                    <button key={g.id} onClick={() => setCurId(g.id)} className="rounded-xl border border-pink-500/20 bg-panel overflow-hidden text-left hover:border-pink-400/40 transition-colors">
                      <div className="h-40 bg-void flex items-center justify-center overflow-hidden">
                        {g.portrait ? <img src={g.portrait} alt="" className="w-full h-full object-cover" /> : <span className="text-4xl opacity-25">💋</span>}
                      </div>
                      <div className="p-2">
                        <div className="text-sm font-semibold text-pink-100 truncate">{g.name || '（未命名）'}{g.title ? <span className="ml-1 text-[10px] text-pink-300/60">{g.title}</span> : null}</div>
                        <div className="text-[11px] text-dim/60 line-clamp-2 leading-snug">{g.persona || g.race || '　'}</div>
                      </div>
                    </button>
                  ))}
                </div>}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 flex gap-3 p-3 border-b border-pink-500/10">
              <div className="w-20 h-28 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center shrink-0">
                {cur.portrait ? <img src={cur.portrait} alt="" className="w-full h-full object-cover" /> : <span className="text-3xl opacity-30">💋</span>}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
                <div className="text-sm font-bold text-pink-100">{cur.name}{cur.title ? <span className="ml-1.5 text-[11px] text-pink-300/60">{cur.title}</span> : null}</div>
                <div className="flex items-center justify-between text-[11px] font-mono mb-0.5">
                  <span className="text-pink-300/70">情欲值 · 第{stage}阶 {STAGE_LABEL[stage]}</span>
                  <span className="text-pink-200/90">{desire} / 100</span>
                </div>
                <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-rose-500/70 via-pink-500/80 to-fuchsia-400/90 transition-all duration-500" style={{ width: `${Math.max(2, desire)}%` }} />
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.length === 0 && <div className="text-center text-dim/40 text-[12px] py-8 whitespace-pre-wrap leading-relaxed">{cur.persona || '（她安静地等着你开口。）'}</div>}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-cyan-500/15 text-cyan-50 border border-cyan-500/20' : 'bg-pink-500/10 text-pink-50 border border-pink-500/20'}`}>{m.content}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="shrink-0 flex items-center gap-2 p-3 border-t border-pink-500/15 bg-panel">
              {onJoySend ? (
                <>
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
                    placeholder={sending ? '她正在回应…' : '对她说 / 做点什么…'} disabled={sending}
                    className="flex-1 bg-void border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-pink-400/40" />
                  <button onClick={send} disabled={sending || !input.trim()} className="text-[13px] font-mono py-2 px-4 rounded-lg border border-pink-400/50 text-pink-100 bg-pink-500/15 hover:bg-pink-500/25 disabled:opacity-40">{sending ? '…' : '发送'}</button>
                </>
              ) : <div className="text-[12px] text-dim/50 font-mono">欢愉宫 AI 接口未接入</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════ 店铺卡（列表项）══════════ */
function ShopCard({ shopId, onEdit, onVisit, onPublish }: { shopId: string; onEdit: () => void; onVisit: () => void; onPublish: () => void }) {
  const shop = useShop((s) => s.shops.find((x) => x.id === shopId));
  const earnings = useShop((s) => s.earnings[shopId] ?? 0);
  const visits = useShop((s) => s.visits[shopId] ?? 0);
  const removeShop = useShop((s) => s.removeShop);
  if (!shop) return null;
  const meta = SHOP_TYPE_META[shop.type];
  const count = shop.type === 'store' ? (shop.goods ?? []).length : shop.type === 'brothel' ? (shop.girls ?? []).length : 1;
  const countLabel = shop.type === 'store' ? '件商品' : shop.type === 'brothel' ? '位娼妇' : '位铁匠';

  return (
    <div className="rounded-xl border border-edge bg-panel overflow-hidden flex flex-col">
      <div className="h-28 bg-void flex items-center justify-center overflow-hidden">
        {(shop.signs?.length || shop.sign) ? <SignShow imgs={shop.signs} cover={shop.sign} /> : <span className="text-5xl opacity-25">{meta.emoji}</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{meta.emoji}</span>
          <span className="text-sm font-bold text-slate-100 truncate flex-1">{shop.name || meta.label}</span>
        </div>
        {shop.tagline && <div className="text-[11px] text-dim/70 truncate">{shop.tagline}</div>}
        <div className="text-[11px] font-mono text-dim/55">{meta.label} · {count} {countLabel}{shop.world ? ` · ${shop.world}` : ''}</div>
        <div className="text-[11px] font-mono text-cyan-300/60">客流 {visits} · 待收 {earnings} {shop.currency}</div>
        <div className="flex items-center gap-1.5 pt-1 mt-auto">
          <button onClick={onVisit} className={`${btnPrimary} flex-1`}>{shop.type === 'smithy' ? '进铺强化' : shop.type === 'brothel' ? '进馆' : '进店'}</button>
          <button onClick={onEdit} className={btnGhost}>编辑</button>
          <button onClick={onPublish} className="text-cyan-300/70 hover:text-cyan-100 text-base px-1.5 shrink-0" title="上传 / 更新到商城">⬆</button>
          <button onClick={() => { if (confirm(`确定关掉「${shop.name || meta.label}」？此店的立绘与内容都会删除。`)) removeShop(shopId); }}
            className="text-blood/60 hover:text-blood text-sm px-1.5 shrink-0" title="关店">🗑</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ 商城·店卡（逛别人的店）══════════ */
function MarketShopCard({ shop, mine, onEnter, onUnpublish }: { shop: PublishedShop; mine: boolean; onEnter: () => void; onUnpublish: () => void }) {
  const meta = SHOP_TYPE_META[shop.type] ?? SHOP_TYPE_META.store;
  const snap: any = shop.snapshot || {};
  const count = shop.type === 'store' ? (snap.goods?.length ?? 0) : shop.type === 'brothel' ? (snap.girls?.length ?? 0) : 1;
  const unit = shop.type === 'store' ? '件' : shop.type === 'brothel' ? '位' : '位';
  return (
    <div className="rounded-xl border border-edge bg-panel overflow-hidden flex flex-col">
      <div className="h-28 bg-void flex items-center justify-center overflow-hidden">
        {(snap.signs?.length || snap.sign) ? <SignShow imgs={snap.signs} cover={snap.sign} /> : <span className="text-5xl opacity-25">{meta.emoji}</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5"><span className="text-sm">{meta.emoji}</span><span className="text-sm font-bold text-slate-100 truncate flex-1">{shop.name}</span></div>
        {snap.tagline && <div className="text-[11px] text-dim/70 truncate">{snap.tagline}</div>}
        <div className="text-[11px] font-mono text-dim/55">{meta.label} · {count} {unit} · 店主 {shop.ownerName || '道友'}</div>
        <div className="text-[11px] font-mono text-cyan-300/60">🔥 光顾 {shop.visits}{mine ? ' · 我的店' : ''}</div>
        <div className="flex items-center gap-2 pt-1 mt-auto">
          <button onClick={onEnter} className={`${btnPrimary} flex-1`}>进店</button>
          {mine && <button onClick={onUnpublish} className="text-blood/60 hover:text-blood text-[12px] font-mono px-2 shrink-0" title="下架">下架</button>}
        </div>
      </div>
    </div>
  );
}

/* ══════════ 主面板 ══════════ */
export default function ProducePanel({ onClose, onGenerateGoods, onJoySend, onBuyCompanion }: {
  onClose: () => void;
  onGenerateGoods?: (shopId: string, tendency: string) => void | Promise<void>;
  onJoySend?: (girlId: string, text: string) => Promise<void>;
  onBuyCompanion?: (info: any) => void;
}) {
  const shops = useShop((s) => s.shops);
  const createShop = useShop((s) => s.createShop);
  const upsertShop = useShop((s) => s.upsertShop);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visitingId, setVisitingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'market'>('mine');
  const [toast, setToast] = useState('');
  const market = useShopMarket((s) => s.shops);
  const mpStatus = useShopMarket((s) => s.status);
  const mpOnline = useShopMarket((s) => s.online);
  const mpMe = useShopMarket((s) => s.me);
  const mpError = useShopMarket((s) => s.error);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2500); };

  useEffect(() => { hydrateShopImages(); }, []);
  // 挂载即连商城(有 Discord 身份才连)——上传(我的产业)与逛店(商城)共用同一连接；卸载断开。
  useEffect(() => {
    if (chatReady() && chatToken()) shopClient.connect(chatName() || '道友', chatToken());
    return () => shopClient.leave();
  }, []);

  const mineShops = shops.filter((s) => !s.remote);
  const create = (type: ShopType) => { setTab('mine'); setEditingId(createShop(type)); };

  const publish = async (shop: ShopEntity) => {
    if (!chatReady() || !chatToken()) { flash('上传商城需先登录 Discord（聊天室 / 联机身份）'); return; }
    if (!shopClient.isOpen()) { shopClient.connect(chatName() || '道友', chatToken()); await new Promise((r) => setTimeout(r, 900)); }
    const ok = await shopClient.publishShop(shop);
    flash(ok ? `已上传「${shop.name}」到商城` : '上传失败（连接未就绪，稍后再试）');
  };

  const enterRemote = (ps: PublishedShop) => {
    const snap: any = ps.snapshot || {};
    const localId = 'remote_' + ps.id;
    upsertShop({
      ...snap,
      id: localId, type: ps.type, name: ps.name || snap.name || '小店',
      currency: snap.currency || '乐园币', createdAt: Date.now(),
      remote: true, ownerName: ps.ownerName, marketId: ps.id,
    } as ShopEntity);
    setVisitingId(localId);
    if (!mpMe || ps.ownerId !== mpMe.playerId) { try { shopClient.visit(ps.id); } catch { /* */ } }
  };

  const tabCls = (k: 'mine' | 'market') => `text-[13px] font-mono px-3 py-1 rounded-lg border ${tab === k ? 'border-cyan-400/50 text-cyan-100 bg-cyan-500/15' : 'border-edge text-dim hover:text-slate-200'}`;

  return (
    <div className="fixed inset-0 z-[70] bg-void/95 backdrop-blur-sm flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20 bg-panel">
        <span className="text-lg">🏪</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-cyan-100">玩家产业</div>
          <div className="text-[11px] font-mono text-cyan-300/50">开店经营 · 上传商城 · 逛别人的店消费</div>
        </div>
        <button onClick={() => setTab('mine')} className={tabCls('mine')}>我的产业</button>
        <button onClick={() => setTab('market')} className={tabCls('market')}>逛商城</button>
        <button onClick={onClose} className="text-dim/50 hover:text-blood text-xl px-1">✕</button>
      </header>

      {tab === 'mine' ? (
        <>
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel/50 flex-wrap">
            <span className="text-[12px] font-mono text-dim/60 mr-1">新开：</span>
            {(Object.keys(SHOP_TYPE_META) as ShopType[]).map((t) => (
              <button key={t} onClick={() => create(t)} className={btnGhost}>{SHOP_TYPE_META[t].emoji} {SHOP_TYPE_META[t].label}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {mineShops.length === 0
              ? <div className="text-center text-dim/50 text-sm py-16">还没有产业。点上方「新开」开你的第一家店 —— 商店卖货、娼馆陪侍、铁匠铺强化。开好后点卡片上的 ⬆ 可上传到商城供他人光顾。</div>
              : <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {mineShops.map((s) => <ShopCard key={s.id} shopId={s.id} onEdit={() => setEditingId(s.id)} onVisit={() => setVisitingId(s.id)} onPublish={() => publish(s)} />)}
                </div>}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-[11px] font-mono text-dim/55 mb-3">
            {mpStatus === 'connected' ? `🟢 商城在线 ${mpOnline} 人 · ${market.length} 家店` : mpStatus === 'connecting' ? '连接商城中…' : (!chatReady() || !chatToken()) ? '逛商城需先登录 Discord（聊天室 / 联机身份）' : '未连接'}
            {mpError ? ` · ${mpError}` : ''}
          </div>
          {market.length === 0
            ? <div className="text-center text-dim/50 text-sm py-16">{mpStatus === 'connected' ? '商城暂时没有店铺，去「我的产业」把你的店 ⬆ 上传吧。' : ''}</div>
            : <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {market.map((ps) => <MarketShopCard key={ps.id} shop={ps} mine={!!mpMe && ps.ownerId === mpMe.playerId} onEnter={() => enterRemote(ps)} onUnpublish={() => shopClient.removeShop(ps.id)} />)}
              </div>}
        </div>
      )}

      {toast && <div className="shrink-0 px-4 py-2 text-[13px] font-mono border-t border-cyan-500/30 text-cyan-200/80 bg-cyan-500/5">{toast}</div>}

      {editingId && <ShopEditorModal shopId={editingId} onClose={() => setEditingId(null)} onGenerateGoods={onGenerateGoods} />}
      {visitingId && (() => {
        const vs = shops.find((x) => x.id === visitingId);
        if (!vs) return null;
        if (vs.type === 'smithy') return <SmithyVisitModal shopId={visitingId} onClose={() => setVisitingId(null)} />;
        if (vs.type === 'brothel') return <BrothelVisitModal shopId={visitingId} onClose={() => setVisitingId(null)} onJoySend={onJoySend} />;
        return <ShopVisitModal shopId={visitingId} onClose={() => setVisitingId(null)} onBuyCompanion={onBuyCompanion} />;
      })()}
    </div>
  );
}
