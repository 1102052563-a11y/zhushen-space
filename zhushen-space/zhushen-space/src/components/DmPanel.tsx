import { useState, useRef, useEffect } from 'react';
import { useDm, type DmDeal, type DmDealKind, type DmThread, type DmMessage } from '../store/dmStore';
import { useItems, gradeNameClass, gradeBadgeClass } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { normCur } from '../systems/dmTrade';

/* 私信（一对一私聊）独立界面：左侧会话列表 + 右侧对话。
   动作：聊天 / 💰购买 / 🤲给予出售 / 🙏索取 / 🔄换物。交易由 AI 报价、玩家可讨价还价、点「成交」确定性结算。*/

export interface DmHandlers {
  onReply: (threadId: string, text: string) => Promise<void>;
  onPropose: (threadId: string, kind: DmDealKind, payload: any) => Promise<void>;
  onHaggle: (threadId: string, dealId: string, text: string) => Promise<void>;
  onAccept: (threadId: string, dealId: string) => { ok: boolean; error?: string };
  onGenArchive: (threadId: string) => Promise<void>;
  onAddFriend?: (threadId: string) => Promise<void>;
  onOpenNpc?: (cId: string) => void;
}

/* 单笔交易卡片（give/get + 对方话术 + 成交/讨价还价/婉拒）*/
function DealCard({ deal, busy, onAccept, onHaggle, onReject }: {
  deal: DmDeal; busy: boolean;
  onAccept: () => void; onHaggle: (text: string) => void; onReject: () => void;
}) {
  const [haggle, setHaggle] = useState(false);
  const [text, setText] = useState('');
  const gives: string[] = [];
  const gets: string[] = [];
  if (deal.giveItem) gives.push(`${deal.giveItem.name}${(deal.giveItem.qty ?? 1) > 1 ? ` ×${deal.giveItem.qty}` : ''}`);
  if (deal.giveCurrency && deal.giveCurrency.amount > 0) gives.push(`${deal.giveCurrency.amount} ${normCur(deal.giveCurrency.type)}`);
  if (deal.getItem) gets.push(`${deal.getItem.name}${(deal.getItem.qty ?? 1) > 1 ? ` ×${deal.getItem.qty}` : ''}`);
  if (deal.getCurrency && deal.getCurrency.amount > 0) gets.push(`${deal.getCurrency.amount} ${normCur(deal.getCurrency.type)}`);
  const kindLabel = deal.kind === 'buy' ? '购买' : deal.kind === 'sell' ? '出售/给予' : deal.kind === 'request' ? '索取' : '以物换物';
  const done = deal.status === 'done';
  const dead = deal.status === 'rejected' || deal.status === 'cancelled';

  return (
    <div className={`mt-1.5 rounded-lg border px-2.5 py-2 text-[12px] ${done ? 'border-emerald-600/40 bg-emerald-900/10' : dead ? 'border-edge/50 bg-void/40 opacity-70' : 'border-amber-500/30 bg-void/50'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300/80">🤝 {kindLabel}</span>
        {done && <span className="font-mono text-[10px] text-emerald-300">✓ 已成交</span>}
        {dead && <span className="font-mono text-[10px] text-dim/50">{deal.status === 'rejected' ? '对方未答应' : '已取消'}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono">
        <div>
          <div className="text-[10px] text-dim/45">你交出</div>
          <div className="text-rose-300/85">{gives.length ? gives.join(' + ') : '（无）'}</div>
        </div>
        <div>
          <div className="text-[10px] text-dim/45">你获得</div>
          <div className={gradeNameClass(deal.getItem?.gradeDesc) || 'text-emerald-300/85'}>{gets.length ? gets.join(' + ') : '（无）'}</div>
        </div>
      </div>
      {deal.getItem?.gradeDesc && <span className={`inline-block mt-1 font-mono text-[10px] ${gradeBadgeClass(deal.getItem.gradeDesc)}`}>{deal.getItem.gradeDesc}{deal.getItem.category ? `·${deal.getItem.category}` : ''}</span>}
      {deal.source === 'source' && !done && <div className="mt-1 text-[10px] font-mono text-amber-200/55">（对方称自己没有，可代为筹来转卖，故价偏高）</div>}
      {deal.note && <div className="mt-1 text-[12px] text-dim/70 italic leading-snug">「{deal.note}」</div>}

      {!done && !dead && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <button onClick={onAccept} disabled={busy}
            className="px-2 py-0.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40 font-mono text-[11px] transition-colors">✓ 成交</button>
          <button onClick={() => setHaggle((v) => !v)} disabled={busy}
            className="px-2 py-0.5 rounded border border-amber-600/40 text-amber-300/80 hover:bg-amber-900/20 disabled:opacity-40 font-mono text-[11px] transition-colors">讨价还价</button>
          <button onClick={onReject} disabled={busy}
            className="px-2 py-0.5 rounded border border-edge text-dim/60 hover:text-blood font-mono text-[11px] transition-colors">取消</button>
        </div>
      )}
      {haggle && !done && !dead && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !busy) { onHaggle(text.trim()); setText(''); setHaggle(false); } }}
            placeholder="如：太贵了，便宜点 / 我再加50魂币换那把刀"
            className="flex-1 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-amber-500/50" />
          <button onClick={() => { if (text.trim() && !busy) { onHaggle(text.trim()); setText(''); setHaggle(false); } }} disabled={busy || !text.trim()}
            className="shrink-0 px-2 py-1 rounded border border-amber-600/50 text-amber-300 hover:bg-amber-900/30 disabled:opacity-40 font-mono text-[11px] transition-colors">{busy ? '…' : '发出'}</button>
        </div>
      )}
    </div>
  );
}

function MsgBubble({ m, npcName, busy, h, threadId }: { m: DmMessage; npcName: string; busy: boolean; h: DmHandlers; threadId: string }) {
  const dm = useDm.getState();
  if (m.from === 'system') {
    return <div className="text-center text-[11px] font-mono text-dim/45 py-1">— {m.text} —</div>;
  }
  const mine = m.from === 'player';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!mine && <div className="text-[10px] font-mono text-dim/45 mb-0.5 px-1">{npcName}</div>}
        <div className={`rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${mine ? 'bg-god/15 border border-god/30 text-slate-100 rounded-br-sm' : 'bg-panel border border-edge text-slate-200 rounded-bl-sm'}`}>
          {m.text}
        </div>
        {m.deal && (
          <DealCard
            deal={m.deal} busy={busy}
            onAccept={() => h.onAccept(threadId, m.deal!.id)}
            onHaggle={(t) => h.onHaggle(threadId, m.deal!.id, t)}
            onReject={() => dm.updateDeal(threadId, m.deal!.id, { status: 'cancelled' })}
          />
        )}
      </div>
    </div>
  );
}

type ActionKind = 'buy' | 'give' | 'request' | 'barter' | null;

export default function DmPanel({ onClose, focusThreadId, h }: { onClose: () => void; focusThreadId?: string; h: DmHandlers }) {
  const threads = useDm((s) => s.threads);
  const order = useDm((s) => s.order);
  const removeThread = useDm((s) => s.removeThread);
  const playerItems = useItems((s) => s.items);
  const sellable = playerItems.filter((it) => !it.equipped);

  const [active, setActive] = useState<string | undefined>(focusThreadId ?? order[0]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [action, setAction] = useState<ActionKind>(null);
  const [chatText, setChatText] = useState('');
  const [showListMobile, setShowListMobile] = useState(!focusThreadId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 表单字段
  const [fItemName, setFItemName] = useState('');
  const [fQty, setFQty] = useState('1');
  const [fItemId, setFItemId] = useState(sellable[0]?.id ?? '');
  const [fPrice, setFPrice] = useState('');
  const [fPlea, setFPlea] = useState('');
  const [fWant, setFWant] = useState('');

  const npcMap = useNpc((s) => s.npcs);
  useEffect(() => { if (focusThreadId) { setActive(focusThreadId); setShowListMobile(false); } }, [focusThreadId]);
  const th: DmThread | undefined = active ? threads[active] : undefined;
  const targetFriend = th?.targetId ? !!npcMap[th.targetId]?.isFriend : false;
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [th?.messages.length, active]);

  const isBusy = active ? !!busy[active] : false;
  function withBusy(tid: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [tid]: true }));
    fn().finally(() => setBusy((b) => ({ ...b, [tid]: false })));
  }

  function sendChat() {
    if (!th || isBusy) return;
    const t = chatText.trim(); if (!t) return;
    setChatText('');
    withBusy(th.id, () => h.onReply(th.id, t));
  }
  function submitAction() {
    if (!th || isBusy || !action) return;
    let payload: any = null;
    if (action === 'buy') { if (!fItemName.trim()) return; payload = { itemName: fItemName.trim(), qty: Math.max(1, Number(fQty) || 1) }; }
    else if (action === 'give') { const it = sellable.find((x) => x.id === fItemId); if (!it) return; payload = { itemId: it.id, qty: Math.max(1, Math.min(Number(fQty) || 1, it.quantity || 1)), askPrice: fPrice ? Math.max(0, Number(fPrice) || 0) : undefined }; }
    else if (action === 'request') { if (!fItemName.trim()) return; payload = { itemName: fItemName.trim(), plea: fPlea.trim() || undefined }; }
    else if (action === 'barter') { const it = sellable.find((x) => x.id === fItemId); if (!it || !fWant.trim()) return; payload = { itemId: it.id, qty: Math.max(1, Math.min(Number(fQty) || 1, it.quantity || 1)), wantName: fWant.trim() }; }
    if (!payload) return;
    const kind: DmDealKind = action === 'give' ? 'sell' : action;
    setAction(null); setFItemName(''); setFPrice(''); setFPlea(''); setFWant(''); setFQty('1');
    withBusy(th.id, () => h.onPropose(th.id, kind, payload));
  }

  const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">✉</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">私信</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">一对一私聊·可向契约者/随从/宠物聊天·交易·索取·赠予</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* 会话列表 */}
          <div className={`${showListMobile ? 'flex' : 'hidden'} sm:flex shrink-0 w-full sm:w-52 flex-col border-r border-edge bg-panel/40`}>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {order.length === 0 && <div className="text-[12px] font-mono text-dim/40 text-center py-8 px-2">还没有私信。<br />在「📡 频道」或「📇 NPC」里点对方的「✉ 私信」开始聊。</div>}
              {order.map((id) => {
                const t = threads[id]; if (!t) return null;
                const last = t.messages[t.messages.length - 1];
                return (
                  <button key={id} onClick={() => { setActive(id); setShowListMobile(false); setAction(null); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${active === id ? 'border-god/50 bg-god/10' : 'border-transparent hover:border-edge hover:bg-panel/60'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-slate-100 truncate flex-1">{t.targetName}</span>
                      {!t.archived && <span className="text-[9px] font-mono px-1 rounded border border-amber-500/40 text-amber-300/70 shrink-0">未建档</span>}
                    </div>
                    {last && <div className="text-[11px] font-mono text-dim/45 truncate mt-0.5">{last.from === 'player' ? '我：' : last.from === 'system' ? '' : ''}{last.text}</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 对话区 */}
          <div className={`${showListMobile ? 'hidden' : 'flex'} sm:flex flex-1 min-w-0 flex-col`}>
            {!th ? (
              <div className="flex-1 flex items-center justify-center text-dim/40 text-sm font-mono">选择左侧一个会话开始私聊</div>
            ) : (
              <>
                {/* 对方信息条 */}
                <div className="shrink-0 px-4 py-2 border-b border-edge bg-panel/60 flex items-center gap-2 flex-wrap">
                  <button onClick={() => setShowListMobile(true)} className="sm:hidden text-[12px] font-mono text-dim/60 hover:text-god">‹ 列表</button>
                  <span className="text-[14px] font-semibold text-slate-100">{th.targetName}</span>
                  {th.targetTier && <span className="text-[11px] font-mono text-dim/55">{th.targetTier}</span>}
                  {th.targetJob && <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-violet-500/40 text-violet-300/80 bg-violet-900/15">{th.targetJob}</span>}
                  {th.targetStrength && <span className="text-[10px] font-mono text-amber-300/55">{th.targetStrength}</span>}
                  {th.targetTag && <span className="text-[10px] font-mono px-1 py-0.5 rounded border border-cyan-700/50 text-cyan-300/70">{th.targetTag}</span>}
                  <span className="flex-1" />
                  {th.archived && th.targetId && h.onOpenNpc && (
                    <button onClick={() => h.onOpenNpc!(th.targetId!)} className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god/80 hover:bg-god/10 transition-colors">查看档案</button>
                  )}
                  {!th.archived && (
                    <button onClick={() => withBusy(th.id, () => h.onGenArchive(th.id))} disabled={isBusy}
                      title="据其发言与已知信息生成完整 NPC 档案（离场状态）"
                      className="text-[11px] font-mono px-2 py-0.5 rounded border border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40 transition-colors">✨ 生成档案</button>
                  )}
                  {h.onAddFriend && (targetFriend
                    ? <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 text-amber-300/80" title="已在好友栏">⭐ 已好友</span>
                    : <button onClick={() => withBusy(th.id, () => h.onAddFriend!(th.id))} disabled={isBusy}
                        title="加为好友（频道未建档者会先生成离场档案）"
                        className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-500/40 text-amber-300/80 hover:bg-amber-900/20 disabled:opacity-40 transition-colors">⭐ 加好友</button>
                  )}
                  <button onClick={() => { if (confirm(`删除与 ${th.targetName} 的私信会话？`)) { removeThread(th.id); setActive(order.find((x) => x !== th.id)); } }}
                    className="text-[11px] font-mono text-dim/40 hover:text-blood transition-colors">🗑</button>
                </div>

                {/* 消息流 */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {th.messages.length === 0 && (
                    <div className="text-center text-[12px] font-mono text-dim/40 py-8">
                      {th.sourceContent ? <>对方在频道说过：<span className="text-dim/55 italic">「{th.sourceContent}」</span><br /></> : null}
                      发条消息打个招呼，或用下方按钮发起交易/索取/赠予。
                    </div>
                  )}
                  {th.messages.map((m) => <MsgBubble key={m.id} m={m} npcName={th.targetName} busy={isBusy} h={h} threadId={th.id} />)}
                  {isBusy && <div className="text-[11px] font-mono text-dim/45 px-1">{th.targetName} 正在回复…</div>}
                </div>

                {/* 动作表单 */}
                {action && (
                  <div className="shrink-0 border-t border-edge bg-panel/70 px-4 py-2.5 space-y-2">
                    <div className="flex items-center gap-2 text-[12px] font-mono text-god/80">
                      <span>{action === 'buy' ? '💰 向 TA 购买' : action === 'give' ? '🤲 给予 / 出售给 TA' : action === 'request' ? '🙏 向 TA 索取' : '🔄 以物换物'}</span>
                      <span className="flex-1" />
                      <button onClick={() => setAction(null)} className="text-dim/50 hover:text-blood">✕</button>
                    </div>
                    {(action === 'buy' || action === 'request') && (
                      <div className="flex gap-2">
                        <input value={fItemName} onChange={(e) => setFItemName(e.target.value)} placeholder="想要的物品名" className={`${inputCls} flex-1`} />
                        <input value={fQty} onChange={(e) => setFQty(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} w-14 font-mono`} />
                      </div>
                    )}
                    {action === 'request' && (
                      <input value={fPlea} onChange={(e) => setFPlea(e.target.value)} placeholder="说点什么（可空）：如 我手头紧，行行好…" className={inputCls} />
                    )}
                    {(action === 'give' || action === 'barter') && (
                      <div className="flex gap-2">
                        {sellable.length === 0 ? <div className="text-[12px] font-mono text-dim/40 py-1">背包里没有可交易的未装备物品</div> : (
                          <select value={fItemId} onChange={(e) => setFItemId(e.target.value)} className={`${inputCls} flex-1 font-mono`}>
                            {sellable.map((it) => <option key={it.id} value={it.id}>{it.name}{it.gradeDesc ? `（${it.gradeDesc}）` : ''}{it.quantity > 1 ? ` ×${it.quantity}` : ''}</option>)}
                          </select>
                        )}
                        <input value={fQty} onChange={(e) => setFQty(e.target.value.replace(/[^\d]/g, ''))} className={`${inputCls} w-14 font-mono`} />
                      </div>
                    )}
                    {action === 'give' && (
                      <input value={fPrice} onChange={(e) => setFPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="期望售价（留空 = 无偿赠予，对方会道谢/回礼）" className={`${inputCls} font-mono`} />
                    )}
                    {action === 'barter' && (
                      <input value={fWant} onChange={(e) => setFWant(e.target.value)} placeholder="想换 TA 的什么物品（名称）" className={inputCls} />
                    )}
                    <div className="flex justify-end">
                      <button onClick={submitAction} disabled={isBusy}
                        className="px-3 py-1 rounded border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 text-[12px] font-mono transition-colors">{isBusy ? '…' : '发起'}</button>
                    </div>
                  </div>
                )}

                {/* 动作按钮 + 聊天输入 */}
                <div className="shrink-0 border-t border-edge bg-panel">
                  <div className="flex items-center gap-1 px-3 pt-2 flex-wrap">
                    <button onClick={() => setAction(action === 'buy' ? null : 'buy')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'buy' ? 'border-amber-500/60 text-amber-200 bg-amber-900/20' : 'border-amber-600/30 text-amber-300/70 hover:bg-amber-900/15'}`}>💰 购买</button>
                    <button onClick={() => setAction(action === 'give' ? null : 'give')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'give' ? 'border-sky-500/60 text-sky-200 bg-sky-900/20' : 'border-sky-600/30 text-sky-300/70 hover:bg-sky-900/15'}`}>🤲 给予/出售</button>
                    <button onClick={() => setAction(action === 'request' ? null : 'request')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'request' ? 'border-violet-500/60 text-violet-200 bg-violet-900/20' : 'border-violet-600/30 text-violet-300/70 hover:bg-violet-900/15'}`}>🙏 索取</button>
                    <button onClick={() => setAction(action === 'barter' ? null : 'barter')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'barter' ? 'border-emerald-500/60 text-emerald-200 bg-emerald-900/20' : 'border-emerald-600/30 text-emerald-300/70 hover:bg-emerald-900/15'}`}>🔄 换物</button>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input value={chatText} onChange={(e) => setChatText(e.target.value)} disabled={isBusy}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) sendChat(); }}
                      placeholder={`私信 ${th.targetName}…`} className="flex-1 input-base text-sm" />
                    <button onClick={sendChat} disabled={isBusy || !chatText.trim()}
                      className="shrink-0 px-3 py-1.5 rounded text-sm font-mono border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{isBusy ? '…' : '发送'}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
