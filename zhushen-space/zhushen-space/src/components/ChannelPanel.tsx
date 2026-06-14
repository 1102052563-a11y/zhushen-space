import { useState } from 'react';
import { useChannel, CHANNEL_DEFS, type ChannelKey, type ChannelMessage, type ChannelQuote } from '../store/channelStore';
import { useItems, ITEM_GRADES, gradeColorClass, gradeBadgeClass, gradeNameClass, type CurrencyWallet } from '../store/itemStore';
import {
  buyFromListing, isBuyable, parseChannelPrice, normChannelCurrency,
  acceptQuote, postWantToBuy, postSellItem, type BuyResult,
} from '../systems/channelTrade';

/* 频道配色 */
const CH_FALLBACK = { dot: 'bg-slate-400', chip: 'border-slate-500/40 text-slate-300' };
const CH_CLS: Record<ChannelKey, { dot: string; chip: string }> = {
  general: { dot: 'bg-slate-400',   chip: 'border-slate-500/40 text-slate-300' },
  trade:   { dot: 'bg-amber-400',   chip: 'border-amber-500/40 text-amber-300' },
  team:    { dot: 'bg-sky-400',     chip: 'border-sky-500/40 text-sky-300' },
  battle:  { dot: 'bg-rose-400',    chip: 'border-rose-500/40 text-rose-300' },
  world:   { dot: 'bg-violet-400',  chip: 'border-violet-500/40 text-violet-300' },
  intel:   { dot: 'bg-cyan-400',    chip: 'border-cyan-500/40 text-cyan-300' },
  system:  { dot: 'bg-emerald-400', chip: 'border-emerald-500/40 text-emerald-300' },
};
const KIND_LABEL: Record<string, string> = {
  sell: '出售', buy: '求购', recruit: '招募', seek: '求组', chat: '闲聊',
  intel: '情报', world: '传闻', battle: '战况', system: '公告',
};
const CUR_OPTS: (keyof CurrencyWallet)[] = ['乐园币', '灵魂钱币'];

/* 详情弹窗载荷：物品源(offer/quote 合并对象) + 价格/卖家 + 可选成交动作 */
interface DetailPayload { src: any; price?: string | number; currency?: string; fromName?: string; action?: () => void; actionLabel?: string }

/* 频道物品详情（只读·固定格式全字段）*/
function ChannelItemDetail({ p, onClose }: { p: DetailPayload; onClose: () => void }) {
  const s = p.src ?? {};
  const F = ({ label, value, cls }: { label: string; value?: string; cls?: string }) =>
    value ? (<div><div className="text-[11px] font-mono text-dim/40">{label}</div><div className={`text-[13px] ${cls ?? 'text-slate-300'}`}>{value}</div></div>) : null;
  const hasStatGrid = s.origin || s.subType || s.combatStat || s.durability || s.score || s.killCount;
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col max-h-[85vh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-amber-300/80 text-lg">📦</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold truncate ${gradeNameClass(s.gradeDesc)}`}>{s.itemName || '物品'}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {s.category && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">{s.category}{s.subType ? `·${s.subType}` : ''}</span>}
              {s.gradeDesc && <span className={`text-[11px] font-mono ${gradeBadgeClass(s.gradeDesc)}`}>{s.gradeDesc}</span>}
              {s.qty > 1 && <span className="text-[11px] font-mono text-dim/50">×{s.qty}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {hasStatGrid && (
            <div className="grid grid-cols-2 gap-3 bg-panel2 rounded-xl p-3 border border-edge/40">
              <F label="产地" value={s.origin} />
              <F label="类型" value={s.subType} />
              <F label="攻击/防御" value={s.combatStat} cls="font-mono text-amber-300/90" />
              <F label="耐久度" value={s.durability} cls="font-mono text-slate-300" />
              <F label="评分" value={s.score} cls="font-mono text-emerald-300/90" />
              <F label="杀敌数量" value={s.killCount} cls="font-mono text-blood/90" />
            </div>
          )}
          <F label="装备需求" value={s.requirement} cls="text-sky-200/80" />
          <F label="词缀" value={s.affix} cls="text-amber-200/85" />
          {(() => {
            // 技能书/卷轴/图纸/天赋碎片：把「效果」当作"学习内容"突出展示
            const isLearn = /技能书|技能卷轴|功法书|秘籍|卷轴|图纸|配方|蓝图|天赋碎片|知识/.test(`${s.subType ?? ''}${s.category ?? ''}${s.itemName ?? ''}`);
            if (!s.effect) return null;
            return (
              <div>
                <div className="text-[11px] font-mono text-dim/40">{isLearn ? '📖 学习内容 / 用途' : '效果'}</div>
                <div className={`text-[13px] leading-relaxed border rounded-lg p-2 ${isLearn ? 'text-sky-200/90 bg-sky-900/10 border-sky-500/25' : 'text-dim/80 bg-panel2 border-edge/40'}`}>{s.effect}</div>
              </div>
            );
          })()}
          {s.intro && <div><div className="text-[11px] font-mono text-dim/40">简介</div><div className="text-[13px] text-dim/55 italic border-l-2 border-edge/40 pl-2">{s.intro}</div></div>}
          <div>
            <div className="text-[11px] font-mono text-dim/40">外观（生图依据）</div>
            {s.appearance
              ? <div className="text-[13px] text-dim/60 italic border-l-2 border-edge/40 pl-2">{s.appearance}</div>
              : <div className="text-[12px] text-dim/30 italic border-l-2 border-edge/30 pl-2">（卖家未提供外观）</div>}
          </div>
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-edge bg-panel/60 flex items-center gap-2">
          {p.fromName && <span className="text-[12px] font-mono text-dim/50 truncate">卖家：{p.fromName}</span>}
          <span className="flex-1" />
          {p.price != null && p.price !== '' && <span className="text-amber-300 font-bold font-mono">{p.price} {p.currency ?? '乐园币'}</span>}
          {p.action && <button onClick={() => { p.action!(); onClose(); }} className="px-3 py-1.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 text-sm font-mono transition-colors">{p.actionLabel ?? '购买'}</button>}
        </div>
      </div>
    </div>
  );
}

function MessageCard({ m, onBuy, onAcceptQuote, onCancel, onDetail }: {
  m: ChannelMessage;
  onBuy: (m: ChannelMessage) => void;
  onAcceptQuote: (m: ChannelMessage, q: ChannelQuote) => void;
  onCancel: (id: string) => void;
  onDetail: (p: DetailPayload) => void;
}) {
  const c = CH_CLS[m.channel] ?? CH_FALLBACK;
  const chDef = CHANNEL_DEFS.find((d) => d.key === m.channel);
  const canBuy = isBuyable(m);
  const isSold = m.channel === 'trade' && m.kind === 'sell' && !m.byPlayer && m.traded;
  const isMine = !!m.byPlayer;
  const quotes = m.quotes ?? [];
  return (
    <div className={`rounded-lg border px-3 py-2 ${isMine ? 'border-god/40 bg-god/5' : 'border-edge bg-panel/60'}`}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${isMine ? 'bg-god' : c.dot} shrink-0`} />
        <span className="text-[13px] font-semibold text-slate-100">{isMine ? '我' : m.authorName}</span>
        {m.authorTier && !isMine && <span className="text-[11px] font-mono text-dim/55">{m.authorTier}</span>}
        {m.authorTag && !isMine && <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-edge text-dim/50">{m.authorTag}</span>}
        <span className="flex-1" />
        {isMine && m.fulfilled && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/50">已成交</span>}
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${c.chip}`}>{chDef?.icon}{KIND_LABEL[m.kind] ?? m.kind}</span>
      </div>
      <div className="text-[14px] text-slate-300 leading-relaxed">{m.content}</div>

      {/* NPC 出售帖：点击看详情（固定格式全字段）+ 一键购买 */}
      {!isMine && m.offer && (m.offer.itemName || m.offer.price) && (
        <div onClick={() => onDetail({ src: m.offer, price: m.offer!.price, currency: m.offer!.currency, fromName: m.authorName, action: canBuy ? () => onBuy(m) : undefined, actionLabel: '购买' })}
          title="点击查看物品详情"
          className="mt-1.5 flex items-center gap-2 flex-wrap text-[12px] font-mono rounded bg-void/50 border border-amber-500/20 px-2 py-1 cursor-pointer hover:border-amber-500/40 transition-colors">
          <span className={gradeNameClass(m.offer.gradeDesc)}>{m.offer.itemName ?? '（物品）'}</span>
          {m.offer.gradeDesc && <span className={gradeBadgeClass(m.offer.gradeDesc)}>{m.offer.gradeDesc}</span>}
          {m.offer.category && <span className="text-dim/40">{m.offer.category}</span>}
          {m.offer.qty != null && m.offer.qty > 1 && <span className="text-dim/50">×{m.offer.qty}</span>}
          <span className="text-god/40">🔍</span>
          <span className="flex-1" />
          {(m.offer.price || m.offer.currency) && <span className="text-amber-300 font-bold">{m.offer.price} {m.offer.currency ?? '乐园币'}</span>}
          {canBuy && (
            <button onClick={(e) => { e.stopPropagation(); onBuy(m); }}
              className="shrink-0 px-2 py-0.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 transition-colors">购买</button>
          )}
          {isSold && <span className="shrink-0 px-2 py-0.5 rounded border border-edge text-dim/50">已购买</span>}
        </div>
      )}

      {/* 玩家求购/出售帖：物品概览（可点详情）+ 报价列表 + 成交 */}
      {isMine && (
        <div className="mt-1.5 space-y-1">
          {m.offer && (m.offer.itemName) && (
            <div onClick={() => onDetail({ src: m.offer, price: m.offer!.price, currency: m.offer!.currency })}
              title="点击查看物品详情"
              className="flex items-center gap-2 flex-wrap text-[12px] font-mono rounded bg-void/40 border border-edge px-2 py-1 cursor-pointer hover:border-god/40 transition-colors">
              <span className="text-dim/50">{m.kind === 'buy' ? '想要' : '出售'}</span>
              <span className={gradeNameClass(m.offer.gradeDesc)}>{m.offer.itemName}</span>
              {m.offer.gradeDesc && <span className={gradeBadgeClass(m.offer.gradeDesc)}>{m.offer.gradeDesc}</span>}
              {m.offer.qty != null && m.offer.qty > 1 && <span className="text-dim/50">×{m.offer.qty}</span>}
              <span className="text-god/40">🔍</span>
            </div>
          )}
          {quotes.length === 0 && !m.fulfilled && (
            <div className="text-[12px] font-mono text-dim/40 px-2 py-1 rounded border border-dashed border-edge">
              等待契约者报价中…（点右上角刷新或稍候，会有人回应）
            </div>
          )}
          {quotes.map((q) => {
            const acceptable = !m.fulfilled;
            const buyDetail = m.kind === 'buy'
              ? () => onDetail({ src: { ...(m.offer ?? {}), ...q }, price: q.price, currency: q.currency, fromName: q.fromName, action: acceptable ? () => onAcceptQuote(m, q) : undefined, actionLabel: '买下' })
              : undefined;
            return (
              <div key={q.id} className="rounded bg-void/50 border border-amber-500/15 px-2 py-1.5">
                <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
                  <span className="text-slate-200">{q.fromName}</span>
                  {q.fromTier && <span className="text-dim/45">{q.fromTier}</span>}
                  {q.fromTag && <span className="text-[10px] px-1 rounded border border-edge text-dim/40">{q.fromTag}</span>}
                  {buyDetail && q.itemName && (
                    <button onClick={buyDetail} className="text-amber-200/80 hover:text-amber-200 underline decoration-dotted">
                      → {q.itemName}{q.gradeDesc ? `(${q.gradeDesc})` : ''} 🔍
                    </button>
                  )}
                  <span className="flex-1" />
                  <span className="text-amber-300 font-bold">{q.price} {q.currency}{q.qty && q.qty > 1 ? ` /${q.qty}件` : ''}</span>
                  {acceptable ? (
                    <button onClick={() => onAcceptQuote(m, q)}
                      className="shrink-0 px-2 py-0.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 transition-colors">
                      {m.kind === 'buy' ? '买下' : '卖出'}
                    </button>
                  ) : <span className="shrink-0 text-dim/40">—</span>}
                </div>
                {q.note && <div className="text-[12px] text-dim/65 mt-0.5 italic leading-snug">「{q.note}」</div>}
              </div>
            );
          })}
          {!m.fulfilled && (
            <div className="flex justify-end">
              <button onClick={() => onCancel(m.id)}
                className="text-[11px] font-mono text-dim/45 hover:text-blood transition-colors">取消挂单</button>
            </div>
          )}
        </div>
      )}

      {/* 组队帖（只读展示）*/}
      {m.recruit && (m.recruit.targetWorld || m.recruit.role) && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[12px] font-mono rounded bg-void/50 border border-sky-500/20 px-2 py-1">
          {m.recruit.targetWorld && <span className="text-sky-200/90">🌐 {m.recruit.targetWorld}</span>}
          {m.recruit.role && <span className="text-dim/70">缺：{m.recruit.role}</span>}
          {m.recruit.reqTier && <span className="text-dim/50">要求 {m.recruit.reqTier}</span>}
          {m.recruit.slots && <span className="text-dim/50">×{m.recruit.slots}</span>}
          {m.recruit.reward && <span className="text-emerald-300/70">报酬：{m.recruit.reward}</span>}
        </div>
      )}
    </div>
  );
}

/* 发帖表单（求购 / 出售）*/
function PostForm({ mode, onClose, onPosted }: { mode: 'buy' | 'sell'; onClose: () => void; onPosted: () => void }) {
  const items = useItems((s) => s.items);
  const sellable = items.filter((it) => !it.equipped);
  const [itemName, setItemName] = useState('');
  const [grade, setGrade] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<keyof CurrencyWallet>('乐园币');
  const [note, setNote] = useState('');
  const [sellId, setSellId] = useState(sellable[0]?.id ?? '');

  const sel = sellable.find((it) => it.id === sellId);
  const valid = mode === 'buy' ? itemName.trim().length > 0 : !!sel;

  function submit() {
    if (!valid) return;
    if (mode === 'buy') {
      postWantToBuy({
        itemName: itemName.trim(), gradeDesc: grade || undefined, qty: Math.max(1, Number(qty) || 1),
        budget: price ? Math.max(0, Number(price) || 0) : undefined, currency, note: note.trim() || undefined,
      });
    } else if (sel) {
      postSellItem(sel, {
        qty: Math.max(1, Math.min(Number(qty) || 1, sel.quantity || 1)),
        askPrice: price ? Math.max(0, Number(price) || 0) : undefined, currency, note: note.trim() || undefined,
      });
    }
    onPosted();
    onClose();
  }

  const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 focus:outline-none focus:border-god/50';
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
          <span className="text-amber-300/80 text-lg">{mode === 'buy' ? '🛒' : '🏷'}</span>
          <span className="text-base font-bold text-slate-100">{mode === 'buy' ? '发布求购帖' : '发布出售帖'}</span>
        </div>
        <div className="px-5 py-4 space-y-2.5">
          {mode === 'buy' ? (
            <>
              <div>
                <div className="text-[11px] font-mono text-dim/50 mb-0.5">想要的物品 *</div>
                <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="如：橙色长剑 / 高级治疗药剂" className={inputCls} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[11px] font-mono text-dim/50 mb-0.5">品级</div>
                  <select value={grade} onChange={(e) => setGrade(e.target.value)} className={`${inputCls} font-mono ${gradeColorClass(grade)}`}>
                    <option value="">不限</option>
                    {ITEM_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="w-16">
                  <div className="text-[11px] font-mono text-dim/50 mb-0.5">数量</div>
                  <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} font-mono`} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="text-[11px] font-mono text-dim/50 mb-0.5">出售物品 *（背包未装备的）</div>
                {sellable.length === 0
                  ? <div className="text-[12px] text-dim/40 font-mono py-1">背包里没有可出售的物品</div>
                  : (
                    <select value={sellId} onChange={(e) => setSellId(e.target.value)} className={`${inputCls} font-mono`}>
                      {sellable.map((it) => <option key={it.id} value={it.id}>{it.name}{it.gradeDesc ? `（${it.gradeDesc}）` : ''}{it.quantity > 1 ? ` ×${it.quantity}` : ''}</option>)}
                    </select>
                  )}
              </div>
              {sel && sel.quantity > 1 && (
                <div className="w-20">
                  <div className="text-[11px] font-mono text-dim/50 mb-0.5">出售数量</div>
                  <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} font-mono`} />
                </div>
              )}
            </>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[11px] font-mono text-dim/50 mb-0.5">{mode === 'buy' ? '预算（可空=面议）' : '期望售价（可空=面议）'}</div>
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="数字" className={`${inputCls} font-mono`} />
            </div>
            <div className="w-28">
              <div className="text-[11px] font-mono text-dim/50 mb-0.5">货币</div>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as keyof CurrencyWallet)} className={`${inputCls} font-mono`}>
                {CUR_OPTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-dim/50 mb-0.5">留言（可空）</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'buy' ? '如：急用，价格好商量' : '如：诚心出，可小刀'} className={inputCls} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">取消</button>
          <button onClick={submit} disabled={!valid}
            className="px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10 text-sm font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed">发布</button>
        </div>
      </div>
    </div>
  );
}

export default function ChannelPanel({ onClose, onRefresh, onSolicit }: { onClose: () => void; onRefresh: (force?: boolean) => void; onSolicit?: () => void }) {
  const messages   = useChannel((s) => s.messages);
  const refreshing = useChannel((s) => s.refreshing);
  const channels   = useChannel((s) => s.settings.channels);
  const enabled    = useChannel((s) => s.settings.enabled);
  const removeMessage = useChannel((s) => s.removeMessage);
  const currency   = useItems((s) => s.currency);

  const tabs = CHANNEL_DEFS.filter((d) => channels[d.key]);
  const [tab, setTab] = useState<ChannelKey | 'all'>('all');
  const list = (tab === 'all' ? messages : messages.filter((m) => m.channel === tab));

  const [confirmMsg, setConfirmMsg] = useState<ChannelMessage | null>(null);
  const [postMode, setPostMode] = useState<'buy' | 'sell' | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  function flash(ok: boolean, text: string) { setToast({ ok, text }); setTimeout(() => setToast(null), 4000); }

  function doBuy(m: ChannelMessage) {
    const r: BuyResult = buyFromListing(m);
    flash(r.ok, r.ok ? `已购买「${m.offer?.itemName ?? '物品'}」，花费 ${r.price} ${r.currency}` : (r.error ?? '购买失败'));
    setConfirmMsg(null);
  }
  function doAcceptQuote(m: ChannelMessage, q: ChannelQuote) {
    const r = acceptQuote(m, q);
    if (m.kind === 'buy') flash(r.ok, r.ok ? `已买下「${q.itemName ?? m.offer?.itemName ?? '物品'}」，花费 ${r.price} ${r.currency}` : (r.error ?? '成交失败'));
    else flash(r.ok, r.ok ? `已卖出「${m.offer?.itemName ?? '物品'}」，收入 ${r.price} ${r.currency}` : (r.error ?? '成交失败'));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">📡</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">公共频道</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">轮回乐园·契约者公共广场　交易帖可一键成交</div>
          </div>
          <span className="shrink-0 text-[11px] font-mono text-amber-300/80 whitespace-nowrap" title="当前余额">
            💰 {currency.乐园币} · 魂 {currency.灵魂钱币}
          </span>
          <button onClick={() => onRefresh(true)} disabled={refreshing || !enabled}
            title="刷新一批新帖子" className="text-[12px] font-mono px-2.5 py-1 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {refreshing ? '刷新中…' : '🔄'}
          </button>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 频道 tab + 发帖按钮 */}
        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-edge bg-panel flex-wrap items-center">
          <button onClick={() => setTab('all')}
            className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === 'all' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
            全部{messages.length > 0 ? ` (${messages.length})` : ''}
          </button>
          {tabs.map((d) => {
            const n = messages.filter((m) => m.channel === d.key).length;
            return (
              <button key={d.key} onClick={() => setTab(d.key)} title={d.desc}
                className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === d.key ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                {d.icon}{d.label}{n > 0 ? ` (${n})` : ''}
              </button>
            );
          })}
          <span className="flex-1" />
          <button onClick={() => setPostMode('buy')} disabled={!enabled}
            className="px-2.5 py-1 rounded text-sm font-mono border border-amber-600/40 text-amber-300 hover:bg-amber-900/20 disabled:opacity-40 transition-colors">🛒 求购</button>
          <button onClick={() => setPostMode('sell')} disabled={!enabled}
            className="px-2.5 py-1 rounded text-sm font-mono border border-amber-600/40 text-amber-300 hover:bg-amber-900/20 disabled:opacity-40 transition-colors">🏷 出售</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!enabled ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              公共频道已停用
              <div className="mt-2 text-dim/30">在「设置 → 变量管理 → 📡 公共频道」开启</div>
            </div>
          ) : list.length === 0 ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              {refreshing ? '正在生成频道动态…' : '暂无频道动态'}
              {!refreshing && <div className="mt-2 text-dim/30">点「🔄」生成帖子，或「🛒 求购 / 🏷 出售」自己挂单</div>}
            </div>
          ) : (
            list.map((m) => <MessageCard key={m.id} m={m} onBuy={setConfirmMsg} onAcceptQuote={doAcceptQuote} onCancel={removeMessage} onDetail={setDetail} />)
          )}
        </div>

        {toast && (
          <div className={`shrink-0 px-4 py-2 text-[13px] font-mono border-t ${toast.ok ? 'border-emerald-700/40 text-emerald-300 bg-emerald-900/10' : 'border-blood/40 text-blood bg-blood/5'}`}>
            {toast.ok ? '✓ ' : '⚠ '}{toast.text}
          </div>
        )}

        <div className="shrink-0 px-4 py-2 border-t border-edge bg-panel/60 text-[11px] font-mono text-dim/40 text-center">
          求购/出售挂单后契约者会陆续报价；点「买下/卖出」为确定性结算（直接扣货币或物品）。
        </div>
      </div>

      {/* 购买确认（NPC 出售帖）*/}
      {confirmMsg && confirmMsg.offer && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmMsg(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
              <span className="text-emerald-300/80 text-lg">💰</span>
              <span className="text-base font-bold text-slate-100">确认购买</span>
            </div>
            <div className="px-5 py-4 text-[13px] text-slate-300 leading-relaxed space-y-1">
              <div>向 <span className="text-slate-100">{confirmMsg.authorName}</span> 购买：</div>
              <div className="text-amber-200/90 font-semibold">{confirmMsg.offer.itemName}{confirmMsg.offer.gradeDesc ? `（${confirmMsg.offer.gradeDesc}）` : ''}{(confirmMsg.offer.qty ?? 1) > 1 ? ` ×${confirmMsg.offer.qty}` : ''}</div>
              <div>花费：<span className="text-amber-300 font-bold">{parseChannelPrice(confirmMsg.offer.price)} {normChannelCurrency(confirmMsg.offer.currency)}</span>　（当前 {currency[normChannelCurrency(confirmMsg.offer.currency)]}）</div>
            </div>
            <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
              <button onClick={() => setConfirmMsg(null)}
                className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">取消</button>
              <button onClick={() => doBuy(confirmMsg)}
                className="px-3 py-1.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 text-sm font-mono transition-colors">确认购买</button>
            </div>
          </div>
        </div>
      )}

      {/* 物品详情（固定格式全字段·只读）*/}
      {detail && <ChannelItemDetail p={detail} onClose={() => setDetail(null)} />}

      {/* 发帖表单 */}
      {postMode && <PostForm mode={postMode} onClose={() => setPostMode(null)} onPosted={() => { onSolicit?.(); flash(true, '挂单已发布，等待契约者报价…'); }} />}
    </div>
  );
}
