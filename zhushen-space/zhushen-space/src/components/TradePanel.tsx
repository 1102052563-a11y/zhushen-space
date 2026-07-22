import { useEffect, useMemo, useState } from 'react';
import { useTrade, type TradeListing } from '../store/tradeStore';
import { tradeClient } from '../systems/tradeClient';
import { useItems, isResourcePseudoItem } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';
import { AutoText } from './AutoText';
import ChatAvatar from './ChatAvatar';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatToken } from '../systems/chatIdentity';

/* 全局交易行：上架自己背包物品(价格+简介) + 公开还价看板。不能聊天，只挂牌/还价，全部可见。
   与聊天室共用 Discord 身份(凭 chatToken 鉴权·pid=chat:uid)，挂牌/还价显示头像+#UID+名牌色。
   托管：上架即从背包扣物存本地托管，手动下架或满 1 天自动归还(offline-safe，见 tradeClient escrow)。 */

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '法宝']);
const CURRENCIES = ['乐园币', '魂币'];

// 交易行分类筛选桶（无「全部」标签）：把细分物品分类归并成几个大桶，按桶过滤挂牌。
const CAT_BUCKETS: { key: string; label: string; cats: string[] }[] = [
  { key: '装备', label: '⚔️ 装备', cats: ['武器', '防具', '饰品', '法宝'] },
  { key: '宝石', label: '💎 宝石', cats: ['宝石'] },
  { key: '消耗', label: '🧪 消耗', cats: ['消耗品', '丹药', '灵药', '符箓'] },
  { key: '材料', label: '🧱 材料', cats: ['材料', '工具', '阵具', '功法'] },
  { key: '随从', label: '🐾 随从', cats: [] },   // 随从/宠物/召唤物 专桶，按 item._entity==='npc' 判定
  { key: '其他', label: '📦 其他', cats: [] },   // 兜底：上面没归到的(重要物品/特殊物品/凡物/其他物品/未知)
];
function bucketOf(item: any): string {
  if (item?._entity === 'npc') return '随从';
  const c = String(item?.category || '');
  for (const b of CAT_BUCKETS) if (b.cats.length && b.cats.includes(c)) return b.key;
  return '其他';
}

function itemKind(item: any): EntityKind {
  if (item?._entity === 'npc') return 'npc';
  return EQUIP_CATS.has(String(item?.category || '')) ? 'equip' : 'item';
}
function fmtTime(at: number) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function nameColor(hue?: number) { return typeof hue === 'number' ? `hsl(${hue} 70% 72%)` : '#cbd5e1'; }
function parseUid(pid?: string): number { return pid && pid.startsWith('chat:') ? (parseInt(pid.slice(5), 10) || 0) : 0; }
function uidTag(pid?: string, du?: number): string { const n = du || parseUid(pid); return n ? '#' + n : ''; }   // du=自定义靓号优先，回退内部 uid
function StatusDot({ status }: { status: string }) {
  const c = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-dim/40';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />;
}

export default function TradePanel({ onClose }: { onClose: () => void }) {
  const st = useTrade();
  const items = useItems((s) => s.items);

  const [entered, setEntered] = useState(false);
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [busy, setBusy] = useState(false);
  const [gateErr, setGateErr] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [listMode, setListMode] = useState<'item' | 'npc'>('item');   // 上架类型：物品 / 随从·宠物
  const [selId, setSelId] = useState('');
  const [selNpcId, setSelNpcId] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<{ kind: EntityKind; data: any } | null>(null);
  const [view, setView] = useState<'board' | 'history'>('board');   // 看板 / 历史成交
  const [cat, setCat] = useState('');   // 分类筛选选中的桶（空=未选→回退首个有挂牌的桶）

  // 进场：已登录则确保身份后连接（与聊天室同一 Discord 身份）；未登录显门禁。离场断开。
  useEffect(() => {
    (async () => {
      if (!discordLoggedIn()) return;
      try {
        if (!chatReady()) await fetchChatIdentity();
        tradeClient.connect(chatName() || '道友', chatToken());
        setEntered(true);
      } catch { /* 失败留在门禁 */ }
    })();
    return () => tradeClient.leave();
     
  }, []);

  const doLogin = async () => {
    setBusy(true); setGateErr('');
    try {
      await discordLogin();
      setLoggedIn(true);
      await fetchChatIdentity();
      tradeClient.connect(chatName() || '道友', chatToken());
      setEntered(true);
    } catch (e: any) { setGateErr(e?.message || '登录失败'); }
    setBusy(false);
  };

  const sellable = useMemo(() => (items || []).filter((it: any) => !isResourcePseudoItem(it)), [items]);
  const connected = st.status === 'connected';
  const selItem = sellable.find((it: any) => it.id === selId) || null;
  const selMax = Math.max(1, Number(selItem?.quantity) || 1);

  // 可上架的随从/宠物/召唤物：己方拥有（排除助战借来的 assistOwnerId）、未死亡。
  const npcs = useNpc((s) => s.npcs);
  const tradablePets = useMemo(() => Object.values(npcs).filter((r: any) =>
    ['随从', '宠物', '召唤物'].includes(r.npcTag) && !r.isDead && !r.assistOwnerId && r.name), [npcs]);
  const selNpc = tradablePets.find((r: any) => r.id === selNpcId) || null;

  // 分类筛选：按桶统计挂牌数，只展示有挂牌的桶（无「全部」标签）；选中桶为空时回退到首个有挂牌的桶。
  const bucketCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const L of st.listings) { const k = bucketOf(L.item); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [st.listings]);
  const presentBuckets = CAT_BUCKETS.filter((b) => (bucketCounts[b.key] || 0) > 0);
  const activeCat = presentBuckets.some((b) => b.key === cat) ? cat : (presentBuckets[0]?.key || '');
  const shownListings = useMemo(() => st.listings.filter((L) => bucketOf(L.item) === activeCat), [st.listings, activeCat]);

  const doList = () => {
    if (!connected) return;
    const p = Math.max(0, parseInt(price || '0', 10) || 0);
    if (listMode === 'npc') {
      if (!selNpc) return;
      tradeClient.listNpc(selNpc.id, p, currency, note.trim());
    } else {
      if (!selItem) return;
      const n = Math.min(selMax, Math.max(1, parseInt(qty || '1', 10) || 1));
      tradeClient.listItem(selItem, n, p, currency, note.trim());
    }
    setSelId(''); setSelNpcId(''); setQty('1'); setPrice(''); setNote(''); setShowForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[85dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🛒</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">交易行 · 挂牌还价</div>
            <div className="text-[11px] font-mono text-dim/60 flex items-center gap-1.5">
              <StatusDot status={entered ? st.status : 'idle'} />
              <span>{!entered ? '未进入' : connected ? `${st.listings.length} 条挂牌 · ${st.online} 人在线` : st.status === 'connecting' ? '连接中…' : st.status === 'closed' ? '已断开' : '未连接'}</span>
            </div>
          </div>
          {entered && <button onClick={() => setView((v) => (v === 'history' ? 'board' : 'history'))} className="px-3 py-1.5 rounded-lg text-[13px] border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">{view === 'history' ? '← 挂牌' : '📜 历史'}</button>}
          {entered && view === 'board' && <button onClick={() => setShowForm((v) => !v)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{showForm ? '收起' : '➕ 上架物品'}</button>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!entered ? (
          /* ── 门禁（与聊天室共用 Discord 身份）── */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-5xl">🛒</div>
            <div className="text-base font-bold text-slate-100">进入交易行</div>
            <div className="text-[12px] text-dim/60 max-w-xs leading-relaxed">交易行与聊天室<span className="text-god">共用 Discord 身份</span>——挂牌和还价会带上你的头像与专属编号。</div>
            <button onClick={doLogin} disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-50 transition-colors">{busy ? '登录中…' : (loggedIn ? '进入交易行' : '用 Discord 登录')}</button>
            {gateErr && <div className="text-[11px] text-amber-400/80 max-w-xs leading-relaxed">{gateErr}</div>}
          </div>
        ) : view === 'history' ? (
          /* ── 历史成交 ── */
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {st.error && <div className="text-[11px] font-mono text-amber-400/80 pb-1">{st.error}</div>}
            <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">历史成交 · {st.history.length} 笔（最多 100，全员公开）</div>
            {st.history.length === 0 && (
              <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有成交记录 · 买家点「立即购买」或卖家接受还价即成交 —</div>
            )}
            {st.history.map((r) => (
              <div key={r.id} className="rounded-xl border border-edge bg-panel/30 p-3 space-y-1.5">
                <EntityCard kind={itemKind(r.item)} data={r.item} onOpen={() => setDetail({ kind: itemKind(r.item), data: r.item })} mt />
                <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
                  <span className="font-mono font-bold text-amber-300">{r.price} {r.currency}</span>
                  <span className="text-dim/40">·</span>
                  {uidTag(r.sellerId, r.sellerDu) && <span className="font-mono text-[10px] text-god/40">{uidTag(r.sellerId, r.sellerDu)}</span>}
                  <span className="text-dim/70">{r.sellerName}</span>
                  <span className="text-god/60 font-bold">→</span>
                  {uidTag(r.buyerId, r.buyerDu) && <span className="font-mono text-[10px] text-god/40">{uidTag(r.buyerId, r.buyerDu)}</span>}
                  <span className="text-dim/70">{r.buyerName}</span>
                  <span className="ml-auto text-[10px] font-mono text-dim/35">{fmtTime(r.at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* 上架表单 */}
            {showForm && (
              <div className="shrink-0 border-b border-edge bg-panel/50 px-5 py-3 space-y-2">
                <div className="text-[11px] font-mono text-amber-400/60">上架即移入「托管」：成交 → 自动交付买家并收款；手动下架 / 满 1 天未成交 → 自动归还（随从/宠物归还花名册）</div>
                {/* 上架类型切换：物品 / 随从·宠物·召唤物 */}
                <div className="flex items-center gap-1.5">
                  {([['item', '📦 物品'], ['npc', '🐾 随从']] as const).map(([m, lab]) => (
                    <button key={m} type="button" onClick={() => setListMode(m)}
                      className={`px-3 py-1 rounded-lg text-[12px] font-semibold border transition-colors ${listMode === m ? 'bg-god/20 border-god/40 text-god' : 'border-edge text-dim/60 hover:text-slate-200'}`}>{lab}</button>
                  ))}
                </div>
                {listMode === 'item' ? (
                  <>
                    <select value={selId} onChange={(e) => { setSelId(e.target.value); setQty('1'); }} className="w-full px-2.5 py-2 rounded-lg bg-void border border-edge text-sm text-slate-100 outline-none focus:border-god/40">
                      <option value="">— 选择背包物品 —</option>
                      {sellable.map((it: any) => (
                        <option key={it.id} value={it.id}>{it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}{it.gradeDesc ? ` · ${it.gradeDesc}` : ''}</option>
                      ))}
                    </select>
                    {sellable.length === 0 && <div className="text-[11px] text-dim/40">背包里没有可上架的物品。</div>}
                    {selItem && selMax > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-dim/70 shrink-0">卖出数量</span>
                        <input type="number" min={1} max={selMax} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 px-2.5 py-2 rounded-lg bg-void border border-edge text-sm text-slate-100 outline-none focus:border-god/40" />
                        <span className="text-[11px] font-mono text-dim/40 shrink-0">库存 {selMax}</span>
                        <button type="button" onClick={() => setQty(String(selMax))} className="text-[11px] text-god/70 hover:text-god transition-colors shrink-0">全部</button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <select value={selNpcId} onChange={(e) => setSelNpcId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-void border border-edge text-sm text-slate-100 outline-none focus:border-god/40">
                      <option value="">— 选择随从 / 宠物 / 召唤物 —</option>
                      {tradablePets.map((r: any) => (
                        <option key={r.id} value={r.id}>{r.name} · {(r.realm || '').split('|')[0] || r.npcTag}{r.npcTag ? ` · ${r.npcTag}` : ''}</option>
                      ))}
                    </select>
                    {tradablePets.length === 0 && <div className="text-[11px] text-dim/40">你名下没有可交易的随从 / 宠物 / 召唤物。</div>}
                    <div className="text-[10px] font-mono text-dim/40">整只出售：上架即从花名册移出（含六维 / 技能 / 装备快照）；未成交或下架自动归还。</div>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="价格" className="flex-1 px-2.5 py-2 rounded-lg bg-void border border-edge text-sm text-slate-100 placeholder:text-dim/40 outline-none focus:border-god/40" />
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="px-2.5 py-2 rounded-lg bg-void border border-edge text-sm text-slate-100 outline-none focus:border-god/40">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="简介 / 说明（可选，最多 300 字）" className="w-full resize-none rounded-lg bg-void border border-edge px-2.5 py-2 text-sm text-slate-100 placeholder:text-dim/40 outline-none focus:border-god/40" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-dim/40">{note.length}/300</span>
                  <button onClick={doList} disabled={(listMode === 'item' ? !selItem : !selNpc) || !connected} className="px-4 py-2 rounded-lg text-sm font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">上架</button>
                </div>
              </div>
            )}

            {st.error && <div className="shrink-0 px-5 py-1.5 text-[11px] font-mono text-amber-400/80 border-b border-edge">{st.error}</div>}

            {/* 分类筛选标签（无「全部」；只展示有挂牌的分类） */}
            {presentBuckets.length > 0 && (
              <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge/60 overflow-x-auto">
                {presentBuckets.map((b) => (
                  <button key={b.key} onClick={() => setCat(b.key)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap border transition-colors ${activeCat === b.key ? 'bg-god/20 border-god/40 text-god' : 'border-edge text-dim/60 hover:text-slate-200'}`}>
                    {b.label} <span className="font-mono opacity-60">{bucketCounts[b.key]}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 挂牌列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {st.listings.length === 0 && (
                <div className="text-center text-dim/40 text-xs font-mono py-12">{connected ? '— 交易行还没有挂牌，点「➕ 上架物品」第一个上架 —' : '— 连接中… —'}</div>
              )}
              {shownListings.map((L) => (
                <ListingCard key={L.id} listing={L} mePid={st.me?.playerId} connected={connected}
                  onOpenDetail={(kind, data) => setDetail({ kind, data })} />
              ))}
            </div>
          </>
        )}
      </div>

      {detail && <EntityDetailModal kind={detail.kind} data={detail.data} onClose={() => setDetail(null)} mt />}
    </div>
  );
}

/* 单条挂牌：物品卡(点开详情) + 卖家(头像/#UID/名牌色)/价格 + 简介 + 全部还价(公开·带头像) + 还价 + (自己的)下架 */
function ListingCard({ listing, mePid, connected, onOpenDetail }: {
  listing: TradeListing;
  mePid?: string;
  connected: boolean;
  onOpenDetail: (kind: EntityKind, data: any) => void;
}) {
  const [offering, setOffering] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMsg, setOfferMsg] = useState('');
  const mine = !!mePid && listing.sellerId === mePid;
  const sellerColor = listing.nc || nameColor(listing.hue);

  const submitOffer = () => {
    if (!connected) return;
    const ok = tradeClient.makeOffer(listing.id, Math.max(0, parseInt(offerPrice || '0', 10) || 0), offerMsg.trim(), listing.currency);
    if (ok) { setOfferPrice(''); setOfferMsg(''); setOffering(false); }   // 失败(余额不足)→保留表单，错误提示在顶部 st.error
  };

  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-3 space-y-2">
      <EntityCard kind={itemKind(listing.item)} data={listing.item} onOpen={() => onOpenDetail(itemKind(listing.item), listing.item)} mt />

      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className="font-mono font-bold text-amber-300">{listing.price} {listing.currency}</span>
        <span className="text-dim/40">·</span>
        <ChatAvatar uid={parseUid(listing.sellerId)} avv={listing.avv} ds={listing.ds} size={18} />
        {uidTag(listing.sellerId, listing.sellerDu) && <span className="font-mono text-[10px] text-god/40">{uidTag(listing.sellerId, listing.sellerDu)}</span>}
        <span style={{ color: sellerColor }}>{listing.sellerName}</span>
        {mine && <span className="text-[10px] font-mono text-god/50">(你)</span>}
        <span className="ml-auto text-[10px] font-mono text-dim/35">{fmtTime(listing.at)}</span>
      </div>

      {listing.note && <div className="text-[12px] text-dim/70 leading-relaxed whitespace-pre-wrap break-words"><AutoText text={listing.note} /></div>}

      {/* 还价（全部公开可见·带头像）*/}
      {listing.offers?.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-edge/60">
          {listing.offers.map((o) => (
            <div key={o.id} className="text-[12px] flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-cyan-300/90 shrink-0">还价 {o.price} {listing.currency}</span>
              <ChatAvatar uid={parseUid(o.buyerId)} avv={o.avv} ds={o.ds} size={16} />
              <span style={{ color: o.nc || nameColor(o.hue) }} className="shrink-0">{o.buyerName}{o.buyerId === mePid ? '(你)' : ''}</span>
              {o.message && <span className="text-dim/60 break-words">「{o.message}」</span>}
              {mine && (
                <button onClick={() => { if (window.confirm(`确认接受「${o.buyerName}」的还价 ${o.price} ${listing.currency}？\n成交后自动交付：物品给买家、${o.price} ${listing.currency} 到你账上，并下架。`)) tradeClient.acceptOffer(listing.id, o.id); }}
                  disabled={!connected}
                  className="ml-auto shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 disabled:opacity-40 transition-colors">✅ 接受</button>
              )}
              <span className={`${mine ? '' : 'ml-auto'} text-[10px] font-mono text-dim/30 shrink-0`}>{fmtTime(o.at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 操作行 */}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {!mine && (
          <button
            onClick={() => { if (window.confirm(`确认以 ${listing.price} ${listing.currency} 立即购买「${listing.item?.name || '该物品'}」？\n款项立即从你账上扣除交付卖家，物品立刻到你背包，此挂牌随即下架。`)) tradeClient.buyListing(listing); }}
            disabled={!connected}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">🛒 立即购买 · {listing.price} {listing.currency}</button>
        )}
        {!mine && !offering && (
          <button onClick={() => setOffering(true)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-cyan-600/40 text-cyan-300/90 hover:bg-cyan-600/10 disabled:opacity-40 transition-colors">💱 还价</button>
        )}
        {mine && (
          <button onClick={() => tradeClient.closeListing(listing.id)} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[12px] border border-blood/40 text-blood/80 hover:bg-blood/10 disabled:opacity-40 transition-colors">下架</button>
        )}
      </div>

      {offering && (
        <div className="space-y-1.5 pt-1.5 border-t border-edge/60">
          <input type="number" min={0} value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder={`你的出价（${listing.currency}）`} className="w-full px-2.5 py-1.5 rounded-lg bg-void border border-edge text-[13px] text-slate-100 placeholder:text-dim/40 outline-none focus:border-cyan-500/40" />
          <input value={offerMsg} onChange={(e) => setOfferMsg(e.target.value.slice(0, 200))} placeholder="留言（可选）" className="w-full px-2.5 py-1.5 rounded-lg bg-void border border-edge text-[13px] text-slate-100 placeholder:text-dim/40 outline-none focus:border-cyan-500/40" />
          <div className="text-[10px] font-mono text-cyan-300/50">出价即扣款托管：被接受 → 付卖家 + 物品入背包；未成交（被买走 / 下架 / 过期）→ 自动退回</div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setOffering(false); setOfferPrice(''); setOfferMsg(''); }} className="px-3 py-1.5 rounded-lg text-[12px] border border-edge text-dim/70 hover:text-slate-200 transition-colors">取消</button>
            <button onClick={submitOffer} disabled={!connected} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-600/30 disabled:opacity-40 transition-colors">提交还价</button>
          </div>
        </div>
      )}
    </div>
  );
}
