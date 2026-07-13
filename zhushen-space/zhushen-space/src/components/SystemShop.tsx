import { useEffect, useState } from 'react';
import { useItems, ITEM_CATEGORIES, gradeNameClass, gradeBadgeClass, type ItemCategory } from '../store/itemStore';

export interface ShopItem {
  name: string; category?: string; subType?: string; gradeDesc?: string;
  price?: number; currency?: string; effect?: string; combatStat?: string;
  durability?: string; requirement?: string; affix?: string; origin?: string;
  intro?: string; appearance?: string; score?: string; qty?: number;
}
function normCur(c?: string): '乐园币' | '灵魂钱币' { return (c === '魂币' || c === '灵魂钱币') ? '灵魂钱币' : '乐园币'; }

/* 系统商店：买(AI 生成 20 件，批量购买) / 卖(背包物品 AI 报价，批量出售)。商品/报价由上层(App)注入 AI 函数。 */
export default function SystemShop({ onGenShop, onQuoteSell, onClose }: {
  onGenShop: () => Promise<ShopItem[]>;
  onQuoteSell: (items: { id: string; name: string; gradeDesc: string; category: string; effect?: string; qty: number }[]) => Promise<Record<string, { price: number; currency: string }>>;
  onClose: () => void;
}) {
  const items         = useItems((s) => s.items);
  const currency      = useItems((s) => s.currency);
  const addItem       = useItems((s) => s.addItem);
  const removeItem    = useItems((s) => s.removeItem);
  const adjustCurrency = useItems((s) => s.adjustCurrency);

  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [shop, setShop] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, { price: number; currency: string }>>({});
  const [quoting, setQuoting] = useState(false);
  const [sel, setSel] = useState<Set<number | string>>(new Set());
  const [toast, setToast] = useState('');
  function flash(t: string) { setToast(t); setTimeout(() => setToast(''), 3500); }

  const sellable = items.filter((it) => !it.equipped && !it.locked);

  async function refreshShop() { setLoading(true); setSel(new Set()); setShop(await onGenShop()); setLoading(false); }
  useEffect(() => { refreshShop(); /* 首次进入自动补货 */ }, []);   // eslint-disable-line

  function toggle(key: number | string) { setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; }); }
  function switchTab(t: 'buy' | 'sell') { setTab(t); setSel(new Set()); }

  const buyTotal = [...sel].reduce<number>((sum, i) => sum + (typeof i === 'number' ? (Number(shop[i]?.price) || 0) : 0), 0);
  const sellTotal = [...sel].reduce<number>((sum, id) => sum + (quotes[id as string]?.price || 0), 0);

  function doBuy() {
    let need乐园 = 0, need魂 = 0;
    [...sel].forEach((i) => { const it = shop[i as number]; if (!it) return; const p = Number(it.price) || 0; if (normCur(it.currency) === '灵魂钱币') need魂 += p; else need乐园 += p; });
    if ((currency.乐园币 ?? 0) < need乐园) { flash(`乐园币不足（需 ${need乐园}）`); return; }
    if ((currency.灵魂钱币 ?? 0) < need魂) { flash(`灵魂钱币不足（需 ${need魂}）`); return; }
    let n = 0;
    [...sel].forEach((i) => {
      const it = shop[i as number]; if (!it) return;
      adjustCurrency(normCur(it.currency), -(Number(it.price) || 0), `系统商店·购买 ${it.name}`);
      const cat = (ITEM_CATEGORIES.includes(it.category as ItemCategory) ? it.category : '特殊物品') as ItemCategory;
      addItem({ name: it.name, category: cat, gradeDesc: it.gradeDesc ?? '', effect: it.effect ?? '', quantity: Math.max(1, Number(it.qty) || 1), equipped: false, tags: [], subType: it.subType, combatStat: it.combatStat, durability: it.durability, requirement: it.requirement, affix: it.affix, origin: it.origin ?? '系统商店', intro: it.intro, appearance: it.appearance, score: it.score, acquisition: '系统商店购买' } as any);
      n++;
    });
    setShop((arr) => arr.filter((_, i) => !sel.has(i)));   // 买走的下架
    setSel(new Set());
    flash(`已购买 ${n} 件`);
  }

  async function doQuote() {
    if (sel.size === 0) { flash('先勾选要卖的物品'); return; }
    setQuoting(true);
    const picked = [...sel].map((id) => items.find((x) => x.id === id)).filter(Boolean) as typeof items;
    const q = await onQuoteSell(picked.map((it) => ({ id: it.id, name: it.name, gradeDesc: it.gradeDesc, category: it.category, effect: it.effect, qty: it.quantity })));
    setQuotes((prev) => ({ ...prev, ...q }));
    setQuoting(false);
    if (Object.keys(q).length === 0) flash('估价失败（检查频道 API）');
  }
  function doSell() {
    const ids = [...sel].filter((id) => quotes[id as string]);
    if (ids.length === 0) { flash('请先「询价」再确认出售'); return; }
    let n = 0;
    ids.forEach((id) => { const it = items.find((x) => x.id === id); if (!it) return; const q = quotes[id as string]; adjustCurrency((q.currency as any) || '乐园币', q.price, `系统商店·出售 ${it.name}`); removeItem(it.id); n++; });
    setSel(new Set());
    flash(`已出售 ${n} 件`);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl h-[86dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-amber-300 text-lg">🏪</span>
          <div className="flex-1 font-bold text-slate-100">系统商店</div>
          <span className="text-[11px] font-mono text-amber-300/80">💰 {currency.乐园币} · 魂 {currency.灵魂钱币}</span>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>

        {/* 买 / 卖 tab */}
        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-edge bg-panel">
          <button onClick={() => switchTab('buy')} className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === 'buy' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>🛒 购买（系统出售）</button>
          <button onClick={() => switchTab('sell')} className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === 'sell' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>💰 回收（出售背包）</button>
          <span className="flex-1" />
          {tab === 'buy' && <button onClick={refreshShop} disabled={loading} className="px-2.5 py-1 rounded text-sm font-mono border border-amber-600/40 text-amber-300 hover:bg-amber-900/20 disabled:opacity-40">{loading ? '补货中…' : '🔄 补货'}</button>}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {tab === 'buy' ? (
            loading ? <div className="py-16 text-center text-dim/40 text-sm font-mono">系统正在补货（生成 20 件商品）…</div>
              : shop.length === 0 ? <div className="py-16 text-center text-dim/40 text-sm font-mono">货架空空，点「🔄 补货」</div>
              : shop.map((it, i) => (
                <label key={i} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${sel.has(i) ? 'border-god/50 bg-god/10' : 'border-edge bg-panel/50 hover:border-god/30'}`}>
                  <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} className="accent-god" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${gradeNameClass(it.gradeDesc ?? '')}`}>{it.name}</span>
                      {it.gradeDesc && <span className={gradeBadgeClass(it.gradeDesc)}>{it.gradeDesc}</span>}
                      <span className="text-[11px] text-dim/50">{it.category}{it.subType ? `·${it.subType}` : ''}</span>
                      {it.qty && it.qty > 1 && <span className="text-[11px] text-dim/50">×{it.qty}</span>}
                    </div>
                    {(it.effect || it.combatStat) && <div className="text-[12px] text-dim/60 leading-snug break-words">{it.combatStat ? `[${it.combatStat}] ` : ''}{it.effect}</div>}
                    {(it.affix || it.requirement) && <div className="text-[11px] text-dim/45 leading-snug break-words mt-0.5">{it.affix ? `词缀:${it.affix}　` : ''}{it.requirement ? `需求:${it.requirement}` : ''}</div>}
                  </div>
                  <span className="shrink-0 text-sm font-bold font-mono text-amber-300">{it.price} {normCur(it.currency)}</span>
                </label>
              ))
          ) : (
            sellable.length === 0 ? <div className="py-16 text-center text-dim/40 text-sm font-mono">背包没有可出售的物品（已装备/锁定的不可卖）</div>
              : sellable.map((it) => {
                const q = quotes[it.id];
                return (
                  <label key={it.id} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${sel.has(it.id) ? 'border-god/50 bg-god/10' : 'border-edge bg-panel/50 hover:border-god/30'}`}>
                    <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} className="accent-god" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
                        {it.gradeDesc && <span className={gradeBadgeClass(it.gradeDesc)}>{it.gradeDesc}</span>}
                        <span className="text-[11px] text-dim/50">{it.category}</span>
                        {it.quantity > 1 && <span className="text-[11px] text-dim/50">×{it.quantity}</span>}
                      </div>
                    </div>
                    {q ? <span className="shrink-0 text-sm font-bold font-mono text-emerald-300">{q.price} {q.currency}</span>
                       : <span className="shrink-0 text-[11px] font-mono text-dim/40">未估价</span>}
                  </label>
                );
              })
          )}
        </div>

        {toast && <div className="shrink-0 px-4 py-2 text-[13px] font-mono border-t border-god/30 text-god/80 bg-god/5">{toast}</div>}

        {/* 底部操作 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-edge bg-panel">
          <span className="text-[12px] font-mono text-dim/60">已选 {sel.size} 件</span>
          <span className="flex-1" />
          {tab === 'buy' ? (
            <button onClick={doBuy} disabled={sel.size === 0} className="px-4 py-1.5 rounded text-sm font-mono border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              购买选中（{buyTotal} 乐园币起）
            </button>
          ) : (
            <>
              <button onClick={doQuote} disabled={sel.size === 0 || quoting} className="px-3 py-1.5 rounded text-sm font-mono border border-amber-600/50 text-amber-300 hover:bg-amber-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {quoting ? '询价中…' : '🔍 询价'}
              </button>
              <button onClick={doSell} disabled={sellTotal === 0} className="px-4 py-1.5 rounded text-sm font-mono border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                确认出售（+{sellTotal}）
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
