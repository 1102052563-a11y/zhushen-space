import { useEffect, useRef, useState } from 'react';
import {
  useShop, hydrateShopImages, SHOP_TYPE_META,
  type ShopType, type ShopGood, type ShopSmith,
} from '../store/shopStore';
import type { JoyGirl } from '../store/joyStore';
import { shrinkDataUrl } from '../systems/imageGen';

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

/* ══════════ 商店·单件商品 ══════════ */
function GoodRow({ shopId, good }: { shopId: string; good: ShopGood }) {
  const upsertGood = useShop((s) => s.upsertGood);
  const removeGood = useShop((s) => s.removeGood);
  const setGoodImage = useShop((s) => s.setGoodImage);
  const patch = (p: Partial<ShopGood>) => upsertGood(shopId, { ...good, ...p });

  return (
    <div className="rounded-xl border border-edge bg-panel p-3 flex max-lg:flex-col gap-3">
      <ImgUpload emoji="📦" h="h-24" src={good.image}
        onPick={(d) => setGoodImage(shopId, good.id, d)} onClear={() => setGoodImage(shopId, good.id, undefined)} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={good.name} onChange={(e) => patch({ name: e.target.value })} placeholder="商品名" className={`${inputCls} flex-1 font-semibold min-w-0`} />
          <input value={good.category} onChange={(e) => patch({ category: e.target.value })} placeholder="分类" className={`${inputCls} w-24`} />
          <button onClick={() => removeGood(shopId, good.id)} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="删除">✕</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[12px] text-dim shrink-0">价
            <input type="number" value={good.price} onChange={(e) => patch({ price: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} w-24`} />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-dim shrink-0">库存
            <input type="number" value={good.stock ?? ''} placeholder="∞" onChange={(e) => patch({ stock: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} w-20`} />
          </label>
          {good.aiGen && <span className="text-[10px] font-mono text-cyan-300/60 px-1.5 py-0.5 rounded border border-cyan-500/25">AI 生成</span>}
        </div>
        <textarea value={good.desc ?? ''} onChange={(e) => patch({ desc: e.target.value })} rows={2} placeholder="商品描述（效果 / 卖点 / 品级…）" className={`${taCls} resize-none`} />
      </div>
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
  const setShopSign = useShop((s) => s.setShopSign);
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
          <div className="flex max-lg:flex-col gap-3">
            <ImgUpload emoji={meta.emoji} src={shop.sign}
              onPick={(d) => setShopSign(shopId, d)} onClear={() => setShopSign(shopId, undefined)} />
            <div className="flex-1 min-w-0 space-y-2">
              <Field label="店名"><input value={shop.name} onChange={(e) => patchShop(shopId, { name: e.target.value })} className={`${inputCls} w-full font-semibold`} /></Field>
              <Field label="招牌语（一句话 · 逛店时展示）"><input value={shop.tagline ?? ''} onChange={(e) => patchShop(shopId, { tagline: e.target.value })} className={`${inputCls} w-full`} placeholder="如：童叟无欺，奇物尽有" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="结算货币"><input value={shop.currency} onChange={(e) => patchShop(shopId, { currency: e.target.value })} className={`${inputCls} w-full`} placeholder="乐园币 / 魂币" /></Field>
                <Field label="所属世界 / 乐园（空 = 通用）"><input value={shop.world ?? ''} onChange={(e) => patchShop(shopId, { world: e.target.value.trim() || undefined })} className={`${inputCls} w-full`} /></Field>
              </div>
            </div>
          </div>
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

/* ══════════ 店铺卡（列表项）══════════ */
function ShopCard({ shopId, onEdit }: { shopId: string; onEdit: () => void }) {
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
        {shop.sign ? <img src={shop.sign} alt="" className="w-full h-full object-cover" /> : <span className="text-5xl opacity-25">{meta.emoji}</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{meta.emoji}</span>
          <span className="text-sm font-bold text-slate-100 truncate flex-1">{shop.name || meta.label}</span>
        </div>
        {shop.tagline && <div className="text-[11px] text-dim/70 truncate">{shop.tagline}</div>}
        <div className="text-[11px] font-mono text-dim/55">{meta.label} · {count} {countLabel}{shop.world ? ` · ${shop.world}` : ''}</div>
        <div className="text-[11px] font-mono text-cyan-300/60">客流 {visits} · 待收 {earnings} {shop.currency}</div>
        <div className="flex items-center gap-2 pt-1 mt-auto">
          <button onClick={onEdit} className={`${btnGhost} flex-1`}>经营 / 编辑</button>
          <button onClick={() => { if (confirm(`确定关掉「${shop.name || meta.label}」？此店的立绘与内容都会删除。`)) removeShop(shopId); }}
            className="text-blood/60 hover:text-blood text-sm px-2 shrink-0" title="关店">🗑</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ 主面板 ══════════ */
export default function ProducePanel({ onClose, onGenerateGoods }: {
  onClose: () => void; onGenerateGoods?: (shopId: string, tendency: string) => void | Promise<void>;
}) {
  const shops = useShop((s) => s.shops);
  const createShop = useShop((s) => s.createShop);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { hydrateShopImages(); }, []);

  const create = (type: ShopType) => setEditingId(createShop(type));

  return (
    <div className="fixed inset-0 z-[70] bg-void/95 backdrop-blur-sm flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20 bg-panel">
        <span className="text-lg">🏪</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-cyan-100">我的产业</div>
          <div className="text-[11px] font-mono text-cyan-300/50">开店经营 · 上传立绘 · 供他人光顾消费</div>
        </div>
        <button onClick={onClose} className="text-dim/50 hover:text-blood text-xl px-1">✕</button>
      </header>

      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel/50 flex-wrap">
        <span className="text-[12px] font-mono text-dim/60 mr-1">新开：</span>
        {(Object.keys(SHOP_TYPE_META) as ShopType[]).map((t) => (
          <button key={t} onClick={() => create(t)} className={btnGhost}>{SHOP_TYPE_META[t].emoji} {SHOP_TYPE_META[t].label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {shops.length === 0
          ? <div className="text-center text-dim/50 text-sm py-16">还没有产业。点上方「新开」开你的第一家店 —— 商店卖货、娼馆陪侍、铁匠铺强化。</div>
          : <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {shops.map((s) => <ShopCard key={s.id} shopId={s.id} onEdit={() => setEditingId(s.id)} />)}
            </div>}
      </div>

      {editingId && <ShopEditorModal shopId={editingId} onClose={() => setEditingId(null)} onGenerateGoods={onGenerateGoods} />}
    </div>
  );
}
