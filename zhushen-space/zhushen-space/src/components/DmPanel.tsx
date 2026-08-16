import { useState, useRef, useEffect } from 'react';
import { useDm, isDmableTag, type DmDeal, type DmDealKind, type DmThread, type DmMessage, type DmGroupMember } from '../store/dmStore';
import { useItems, gradeNameClass, gradeBadgeClass } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useSettings } from '../store/settingsStore';
import { useStickers, stickerUrlOf } from '../store/stickerStore';
import { normCur } from '../systems/dmTrade';

/* 私信（一对一私聊）独立界面：左侧会话列表 + 右侧对话。
   动作：聊天 / 💰购买 / 🤲给予出售 / 🙏索取 / 🔄换物。交易由 AI 报价、玩家可讨价还价、点「成交」确定性结算。*/

export interface DmHandlers {
  onReply: (threadId: string, text: string, opts?: { kind?: 'sticker' }) => Promise<void>;
  onPropose: (threadId: string, kind: DmDealKind, payload: any) => Promise<void>;
  onHaggle: (threadId: string, dealId: string, text: string) => Promise<void>;
  onAccept: (threadId: string, dealId: string) => { ok: boolean; error?: string };
  onGenArchive: (threadId: string) => Promise<void>;
  onAddFriend?: (threadId: string) => Promise<void>;
  onOpenNpc?: (cId: string) => void;
  onGroupReply?: (threadId: string, text?: string, opts?: { kind?: 'sticker' }) => Promise<void>;   // 👥群聊：text=主角发言；undefined=潜水（成员自治聊天）
  onEavesdrop?: (aId: string, bId: string) => Promise<{ ok: boolean; msg: string; lines: { sender: string; text: string }[]; discovered: boolean }>;   // 🕳窃听两离场角色
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
  const kindLabel = deal.kind === 'buy' ? '购买' : deal.kind === 'sell' ? '出售/给予' : deal.kind === 'request' ? '索取' : deal.kind === 'transfer' ? '💸转账' : '以物换物';
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
  const [peeked, setPeeked] = useState(false);   // 撤回消息：点开偷看原文
  const who = m.senderName || npcName;   // 👥群消息显示发言人；单聊显示对方名
  if (m.from === 'system') {
    return <div className="text-center text-[11px] font-mono text-dim/45 py-1">— {m.text} —</div>;
  }
  // 戳一戳：居中演出行
  if (m.kind === 'poke') {
    return <div className="text-center text-[11px] font-mono text-amber-200/60 py-1">👉 「{who}」戳了戳你</div>;
  }
  // 撤回：居中占位，点开偷看原文（再点收起）
  if (m.kind === 'recalled') {
    return (
      <div className="text-center py-1">
        <button onClick={() => setPeeked((v) => !v)} className="text-[11px] font-mono text-dim/45 hover:text-dim/70 transition-colors">
          「{who}」撤回了一条消息{m.orig ? (peeked ? '' : '（偷看）') : ''}
        </button>
        {peeked && m.orig && <div className="mt-0.5 text-[12px] text-dim/60 italic">“{m.orig}”</div>}
      </div>
    );
  }
  const mine = m.from === 'player';
  // 😊 表情包：按名解析 URL（库里删了就降级为 [表情] 名 文本）
  if (m.kind === 'sticker') {
    const url = stickerUrlOf(m.text);
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[60%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
          {!mine && <div className="text-[10px] font-mono text-dim/45 mb-0.5 px-1">{who}</div>}
          {url
            ? <img src={url} alt={m.text} title={m.text} className="max-h-28 max-w-full rounded-lg object-contain" />
            : <div className="text-[12px] font-mono text-dim/55 px-2 py-1 rounded border border-edge">[表情] {m.text}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!mine && <div className="text-[10px] font-mono text-dim/45 mb-0.5 px-1">{who}</div>}
        {/* 状态头（本轮第一条 NPC 消息携带）：对方此刻的情绪/地点/现状 + 心声（玩家可见的戏剧反讽，不回喂 AI） */}
        {!mine && m.meta && (m.meta.emotion || m.meta.location || m.meta.state) && (
          <div className="text-[10px] font-mono text-dim/50 mb-0.5 px-1 leading-snug">
            {[m.meta.emotion, m.meta.location, m.meta.state].filter(Boolean).join(' · ')}
          </div>
        )}
        {!mine && m.meta?.thought && (
          <div className="text-[10px] font-mono text-violet-300/45 mb-0.5 px-1 leading-snug italic">💭 {m.meta.thought}</div>
        )}
        <div className={`rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${mine ? 'bg-god/15 border border-god/30 text-slate-100 rounded-br-sm' : 'bg-panel border border-edge text-slate-200 rounded-bl-sm'}`}>
          {m.quote && <div className="mb-1 pl-2 border-l-2 border-edge text-[11px] text-dim/55 leading-snug">{m.quote}</div>}
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

/* 📨 NPC主动来讯开关（settingsStore.inlineComm·借鉴Abstract外置手机意图两阶段）：
   开=正文尾允许离场白名单NPC附<通讯>意图→私信链路二次生成落这里（红点提醒）；关=规则不注入，NPC 不会主动来讯。 */
function InlineCommToggle() {
  const on = useSettings((s) => s.inlineComm?.on ?? true);
  const set = useSettings((s) => s.setInlineComm);
  return (
    <button onClick={() => set({ on: !on })}
      title={on ? '主动来讯已开：离场的随从/契约者/宠物可能在剧情推进后主动发私讯（每隔几回合至多一条）' : '主动来讯已关：NPC 不会主动发私讯'}
      className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${on ? 'border-god/50 text-god/90 bg-god/10' : 'border-edge text-dim/50 hover:text-dim/80'}`}>
      📨 来讯{on ? '·开' : '·关'}
    </button>
  );
}

/* 🕳 窃听弹窗（借鉴Abstract外置手机 peek·选两名离场角色→监听其私下交谈；花乐园币·有被察觉风险）*/
function EavesdropModal({ onClose, onEavesdrop }: { onClose: () => void; onEavesdrop: NonNullable<DmHandlers['onEavesdrop']> }) {
  const npcs = useNpc((s) => s.npcs);
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lines, setLines] = useState<{ sender: string; text: string }[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const candidates = Object.values(npcs)
    .filter((n) => !!(n.name || '').trim() && !n.onScene && !n.isDead && !n.archived)
    .sort((a, b) => (b.favor ?? 0) - (a.favor ?? 0));
  function run() {
    if (!aId || !bId || aId === bId || busy) return;
    setBusy(true); setMsg(''); setLines([]); setDiscovered(false);
    onEavesdrop(aId, bId).then((r) => { setMsg(r.ok ? '' : r.msg); setLines(r.lines); setDiscovered(r.discovered); }).finally(() => setBusy(false));
  }
  const sel = 'flex-1 bg-void border border-edge rounded px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-god/50';
  return (
    <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl border border-edge bg-void shadow-xl p-4 space-y-2.5 max-h-[85%] overflow-y-auto">
        <div className="flex items-center">
          <span className="text-[14px] font-bold text-slate-100">🕳 窃听</span>
          <span className="ml-2 text-[10px] font-mono text-dim/45">监听两名离场角色的私下交谈 · 500 乐园币/次 · 有被察觉风险</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood">✕</button>
        </div>
        <div className="flex gap-2">
          <select value={aId} onChange={(e) => setAId(e.target.value)} className={sel}>
            <option value="">选对象 A…</option>
            {candidates.map((n) => <option key={n.id} value={n.id}>{n.name}{n.npcTag ? `（${n.npcTag}）` : ''}</option>)}
          </select>
          <select value={bId} onChange={(e) => setBId(e.target.value)} className={sel}>
            <option value="">选对象 B…</option>
            {candidates.filter((n) => n.id !== aId).map((n) => <option key={n.id} value={n.id}>{n.name}{n.npcTag ? `（${n.npcTag}）` : ''}</option>)}
          </select>
        </div>
        {candidates.length < 2 && <div className="text-[12px] font-mono text-dim/40 text-center py-2">离场角色不足两人，没得听</div>}
        <button onClick={run} disabled={busy || !aId || !bId || aId === bId}
          className="w-full py-1.5 rounded border border-cyan-600/50 text-cyan-300 hover:bg-cyan-900/20 disabled:opacity-40 text-[13px] font-mono transition-colors">{busy ? '监听中…' : '🕳 开始监听（500 乐园币）'}</button>
        {msg && <div className="text-[12px] font-mono text-amber-300/70">{msg}</div>}
        {discovered && <div className="text-[12px] font-mono text-blood border border-blood/40 rounded px-2 py-1">⚠ 他们察觉到了监听——两人对你的好感下降，后续剧情可能提防或对质。</div>}
        {lines.length > 0 && (
          <div className="space-y-1.5 border-t border-edge pt-2">
            {lines.map((l, i) => (
              <div key={i} className="text-[13px] leading-relaxed">
                <span className="font-mono text-[11px] text-cyan-300/70">{l.sender}</span>
                <span className="text-slate-300">：{l.text}</span>
              </div>
            ))}
            <div className="text-[10px] font-mono text-dim/40 pt-1">（窃听所得已作为场外情报进入下回合正文须知）</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 😊 表情包库管理弹窗（借鉴Abstract外置手机按名点播·玩家自建素材：名称→图片URL）*/
function StickerManagerModal({ onClose }: { onClose: () => void }) {
  const items = useStickers((s) => s.items);
  const [nm, setNm] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  function add() {
    const r = useStickers.getState().addSticker(nm, url);
    if (!r.ok) { setErr(r.error || '添加失败'); return; }
    setNm(''); setUrl(''); setErr('');
  }
  return (
    <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-xl border border-edge bg-void shadow-xl p-4 space-y-2.5">
        <div className="flex items-center">
          <span className="text-[14px] font-bold text-slate-100">😊 表情包库</span>
          <span className="ml-2 text-[10px] font-mono text-dim/45">AI 和你都能在私聊/群聊里发；名称会给 AI 点播，图片仅本地渲染</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood">✕</button>
        </div>
        <div className="flex gap-1.5">
          <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="名称（如 猫猫点头）"
            className="w-32 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="图片 URL（https:// 或 data:image/…）"
            className="flex-1 bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50" />
          <button onClick={add} disabled={!nm.trim() || !url.trim()}
            className="shrink-0 px-2 py-1 rounded border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 text-[12px] font-mono">＋</button>
        </div>
        {err && <div className="text-[11px] font-mono text-blood">{err}</div>}
        <div className="max-h-64 overflow-y-auto grid grid-cols-4 gap-2 pr-1">
          {items.length === 0 && <div className="col-span-4 text-[12px] font-mono text-dim/40 text-center py-6">空空如也——添加几个表情包（贴图 URL），NPC 聊天就会用起来</div>}
          {items.map((it) => (
            <div key={it.id} className="relative group border border-edge rounded-lg p-1.5 flex flex-col items-center gap-1">
              <img src={it.url} alt={it.name} className="h-14 w-14 object-contain" />
              <span className="text-[10px] font-mono text-dim/60 truncate w-full text-center">{it.name}</span>
              <button onClick={() => useStickers.getState().removeSticker(it.id)} title="删除"
                className="absolute -top-1.5 -right-1.5 hidden group-hover:block text-[10px] w-4 h-4 leading-4 rounded-full bg-blood/80 text-white">✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* 👥 建群弹窗（借鉴Abstract外置手机群聊·成员只能从可私信白名单挑：随从/契约者/宠物）*/
function GroupCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (threadId: string) => void }) {
  const npcs = useNpc((s) => s.npcs);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const candidates = Object.values(npcs)
    .filter((n) => !!(n.name || '').trim() && isDmableTag(n.npcTag) && !n.isDead && !n.archived)
    .sort((a, b) => (b.partyMember ? 1 : 0) - (a.partyMember ? 1 : 0) || (b.favor ?? 0) - (a.favor ?? 0));
  const pickedCount = Object.values(picked).filter(Boolean).length;
  function create() {
    const members: DmGroupMember[] = candidates.filter((n) => picked[n.id]).map((n) => ({ id: n.id, name: (n.name || '').trim() }));
    if (members.length < 2) return;
    const tid = useDm.getState().createGroupThread(name.trim() || `${members[0].name}们的小群`, members);
    onCreated(tid);
  }
  return (
    <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-xl border border-edge bg-void shadow-xl p-4 space-y-2.5">
        <div className="flex items-center">
          <span className="text-[14px] font-bold text-slate-100">👥 建群聊</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood">✕</button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="群名（可空，自动起名）"
          className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-god/50" />
        <div className="text-[11px] font-mono text-dim/50">勾选成员（至少 2 人；仅随从/契约者/宠物可入群）：</div>
        <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
          {candidates.length === 0 && <div className="text-[12px] font-mono text-dim/40 text-center py-4">没有可入群的对象（先收随从/加契约者好友）</div>}
          {candidates.map((n) => (
            <label key={n.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-panel/60 cursor-pointer">
              <input type="checkbox" checked={!!picked[n.id]} onChange={(e) => setPicked((p) => ({ ...p, [n.id]: e.target.checked }))} />
              <span className="text-[13px] text-slate-200 truncate">{n.name}</span>
              <span className="text-[10px] font-mono text-dim/45 shrink-0">{n.npcTag}{n.partyMember ? '·随行' : n.onScene ? '·在场' : ''}</span>
            </label>
          ))}
        </div>
        <button onClick={create} disabled={pickedCount < 2}
          className="w-full py-1.5 rounded border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 text-[13px] font-mono transition-colors">建群（已选 {pickedCount} 人）</button>
      </div>
    </div>
  );
}

type ActionKind = 'buy' | 'give' | 'request' | 'barter' | 'transfer' | null;

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
  const [fCurrency, setFCurrency] = useState('乐园币');   // 💸转账币种
  const [groupModal, setGroupModal] = useState(false);    // 👥建群弹窗
  const [stickerModal, setStickerModal] = useState(false);   // 😊表情包库管理
  const [stickerPick, setStickerPick] = useState(false);     // 😊发送picker
  const [eavesModal, setEavesModal] = useState(false);       // 🕳窃听弹窗
  const stickerItems = useStickers((s) => s.items);

  const npcMap = useNpc((s) => s.npcs);
  useEffect(() => { if (focusThreadId) { setActive(focusThreadId); setShowListMobile(false); } }, [focusThreadId]);
  // 📨 主动来讯未读：正在看哪个会话就清哪个（新消息落进正在看的会话也顺手清）
  const activeUnread = useDm((s) => (active ? s.threads[active]?.unread || 0 : 0));
  useEffect(() => { if (active && activeUnread > 0) useDm.getState().clearUnread(active); }, [active, activeUnread]);
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
    // 👥群聊走群回合（成员回应）；单聊走原私信回复
    withBusy(th.id, () => (th.kind === 'group' && h.onGroupReply ? h.onGroupReply(th.id, t) : h.onReply(th.id, t)));
  }
  function submitAction() {
    if (!th || isBusy || !action) return;
    let payload: any = null;
    if (action === 'buy') { if (!fItemName.trim()) return; payload = { itemName: fItemName.trim(), qty: Math.max(1, Number(fQty) || 1) }; }
    else if (action === 'give') { const it = sellable.find((x) => x.id === fItemId); if (!it) return; payload = { itemId: it.id, qty: Math.max(1, Math.min(Number(fQty) || 1, it.quantity || 1)), askPrice: fPrice ? Math.max(0, Number(fPrice) || 0) : undefined }; }
    else if (action === 'request') { if (!fItemName.trim()) return; payload = { itemName: fItemName.trim(), plea: fPlea.trim() || undefined }; }
    else if (action === 'barter') { const it = sellable.find((x) => x.id === fItemId); if (!it || !fWant.trim()) return; payload = { itemId: it.id, qty: Math.max(1, Math.min(Number(fQty) || 1, it.quantity || 1)), wantName: fWant.trim() }; }
    else if (action === 'transfer') { const amt = Math.max(1, Number(fPrice) || 0); if (!fPrice || amt < 1) return; payload = { amount: amt, currency: fCurrency, note: fPlea.trim() || undefined }; }
    if (!payload) return;
    const kind: DmDealKind = action === 'give' ? 'sell' : action;
    setAction(null); setFItemName(''); setFPrice(''); setFPlea(''); setFWant(''); setFQty('1');
    withBusy(th.id, () => h.onPropose(th.id, kind, payload));
  }

  const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-god/50';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">✉</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">私信</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">一对一私聊·可向契约者/随从/宠物聊天·交易·索取·赠予</div>
          </div>
          {h.onEavesdrop && (
            <button onClick={() => setEavesModal(true)} title="窃听：监听两名离场角色的私下交谈（花乐园币·有被察觉风险）"
              className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim/60 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors">🕳 窃听</button>
          )}
          <button onClick={() => setStickerModal(true)} title="表情包库：添加/删除（名称→图片URL），AI 和你都能在聊天里发"
            className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim/60 hover:text-god hover:border-god/40 transition-colors">😊 表情包</button>
          <InlineCommToggle />
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* 会话列表 */}
          <div className={`${showListMobile ? 'flex' : 'hidden'} sm:flex shrink-0 w-full sm:w-52 flex-col border-r border-edge bg-panel/40`}>
            <div className="shrink-0 px-1.5 pt-1.5">
              <button onClick={() => setGroupModal(true)}
                title="拉几个随从/契约者/宠物建个群（👥 成员会在群里互相聊天）"
                className="w-full text-[11px] font-mono px-2 py-1 rounded border border-dashed border-edge text-dim/60 hover:text-god hover:border-god/40 transition-colors">➕ 建群聊</button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {order.length === 0 && <div className="text-[12px] font-mono text-dim/40 text-center py-8 px-2">还没有私信。<br />在「📡 频道」或「📇 NPC」里点对方的「✉ 私信」开始聊。</div>}
              {order.map((id) => {
                const t = threads[id]; if (!t) return null;
                const last = t.messages[t.messages.length - 1];
                const isGrp = t.kind === 'group';
                return (
                  <button key={id} onClick={() => { setActive(id); setShowListMobile(false); setAction(null); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${active === id ? 'border-god/50 bg-god/10' : 'border-transparent hover:border-edge hover:bg-panel/60'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-slate-100 truncate flex-1">{isGrp ? '👥 ' : ''}{t.targetName}</span>
                      {(t.unread || 0) > 0 && <span className="text-[9px] font-mono px-1 rounded-full bg-blood/80 text-white shrink-0">{t.unread}</span>}
                      {isGrp && <span className="text-[9px] font-mono px-1 rounded border border-edge text-dim/50 shrink-0">{(t.members?.length ?? 0) + 1}人</span>}
                      {!isGrp && !t.archived && <span className="text-[9px] font-mono px-1 rounded border border-amber-500/40 text-amber-300/70 shrink-0">未建档</span>}
                    </div>
                    {last && <div className="text-[11px] font-mono text-dim/45 truncate mt-0.5">{last.from === 'player' ? '我：' : last.from === 'system' ? '' : (isGrp && last.senderName ? `${last.senderName}：` : '')}{last.text}</div>}
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
                  <span className="text-[14px] font-semibold text-slate-100">{th.kind === 'group' ? `👥 ${th.targetName}` : th.targetName}</span>
                  {th.kind === 'group' && <span className="text-[11px] font-mono text-dim/55 truncate max-w-[50%]" title={(th.members ?? []).map((m) => m.name).join('、')}>{(th.members ?? []).length + 1} 人：{(th.members ?? []).map((m) => m.name).join('、')}</span>}
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
                  {th.kind !== 'group' && h.onAddFriend && (targetFriend
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
                      <span>{action === 'buy' ? '💰 向 TA 购买' : action === 'give' ? '🤲 给予 / 出售给 TA' : action === 'request' ? '🙏 向 TA 索取' : action === 'transfer' ? '💸 给 TA 转账（无偿赠予·TA 可拒收）' : '🔄 以物换物'}</span>
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
                    {action === 'transfer' && (
                      <>
                        <div className="flex gap-2">
                          <input value={fPrice} onChange={(e) => setFPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="转账金额" className={`${inputCls} flex-1 font-mono`} />
                          <select value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} className={`${inputCls} w-28 font-mono`}>
                            <option value="乐园币">乐园币</option>
                            <option value="灵魂钱币">灵魂钱币</option>
                          </select>
                        </div>
                        <input value={fPlea} onChange={(e) => setFPlea(e.target.value)} placeholder="附言（可空）：如 拿去买点好装备 / 上次的谢礼" className={inputCls} />
                      </>
                    )}
                    <div className="flex justify-end">
                      <button onClick={submitAction} disabled={isBusy}
                        className="px-3 py-1 rounded border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 text-[12px] font-mono transition-colors">{isBusy ? '…' : '发起'}</button>
                    </div>
                  </div>
                )}

                {/* 动作按钮 + 聊天输入（群聊：无交易动作，多一个👂潜水；单聊：交易四件+💸转账） */}
                <div className="shrink-0 border-t border-edge bg-panel">
                  {th.kind !== 'group' && (
                    <div className="flex items-center gap-1 px-3 pt-2 flex-wrap">
                      <button onClick={() => setAction(action === 'buy' ? null : 'buy')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'buy' ? 'border-amber-500/60 text-amber-200 bg-amber-900/20' : 'border-amber-600/30 text-amber-300/70 hover:bg-amber-900/15'}`}>💰 购买</button>
                      <button onClick={() => setAction(action === 'give' ? null : 'give')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'give' ? 'border-sky-500/60 text-sky-200 bg-sky-900/20' : 'border-sky-600/30 text-sky-300/70 hover:bg-sky-900/15'}`}>🤲 给予/出售</button>
                      <button onClick={() => setAction(action === 'request' ? null : 'request')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'request' ? 'border-violet-500/60 text-violet-200 bg-violet-900/20' : 'border-violet-600/30 text-violet-300/70 hover:bg-violet-900/15'}`}>🙏 索取</button>
                      <button onClick={() => setAction(action === 'barter' ? null : 'barter')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'barter' ? 'border-emerald-500/60 text-emerald-200 bg-emerald-900/20' : 'border-emerald-600/30 text-emerald-300/70 hover:bg-emerald-900/15'}`}>🔄 换物</button>
                      <button onClick={() => setAction(action === 'transfer' ? null : 'transfer')} className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${action === 'transfer' ? 'border-rose-500/60 text-rose-200 bg-rose-900/20' : 'border-rose-600/30 text-rose-300/70 hover:bg-rose-900/15'}`}>💸 转账</button>
                    </div>
                  )}
                  {/* 😊 发送表情包 picker（点选即发；无表情包时引导去添加） */}
                  {stickerPick && (
                    <div className="px-3 pt-2 flex gap-2 flex-wrap max-h-28 overflow-y-auto">
                      {stickerItems.length === 0 && (
                        <button onClick={() => { setStickerPick(false); setStickerModal(true); }} className="text-[11px] font-mono text-dim/50 hover:text-god">表情包库是空的——点这里去添加</button>
                      )}
                      {stickerItems.map((it) => (
                        <button key={it.id} disabled={isBusy} title={it.name}
                          onClick={() => { setStickerPick(false); withBusy(th.id, () => (th.kind === 'group' && h.onGroupReply ? h.onGroupReply(th.id, it.name, { kind: 'sticker' }) : h.onReply(th.id, it.name, { kind: 'sticker' }))); }}
                          className="border border-edge rounded-lg p-1 hover:border-god/50 disabled:opacity-40 transition-colors">
                          <img src={it.url} alt={it.name} className="h-12 w-12 object-contain" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => setStickerPick((v) => !v)} disabled={isBusy} title="发表情包"
                      className={`shrink-0 px-2 py-1.5 rounded text-sm border transition-colors ${stickerPick ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-god'}`}>😊</button>
                    <input value={chatText} onChange={(e) => setChatText(e.target.value)} disabled={isBusy}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) sendChat(); }}
                      placeholder={th.kind === 'group' ? `在「${th.targetName}」里说点什么…` : `私信 ${th.targetName}…`} className="flex-1 input-base text-sm" />
                    {th.kind === 'group' && h.onGroupReply && (
                      <button onClick={() => { if (!isBusy) withBusy(th.id, () => h.onGroupReply!(th.id)); }} disabled={isBusy}
                        title="不发言，就看群里聊——让成员们自己聊起来"
                        className="shrink-0 px-2.5 py-1.5 rounded text-sm font-mono border border-edge text-dim/70 hover:text-god hover:border-god/40 disabled:opacity-40 transition-colors">{isBusy ? '…' : '👂 潜水'}</button>
                    )}
                    <button onClick={sendChat} disabled={isBusy || !chatText.trim()}
                      className="shrink-0 px-3 py-1.5 rounded text-sm font-mono border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{isBusy ? '…' : '发送'}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {groupModal && <GroupCreateModal onClose={() => setGroupModal(false)} onCreated={(tid) => { setGroupModal(false); setActive(tid); setShowListMobile(false); }} />}
      {stickerModal && <StickerManagerModal onClose={() => setStickerModal(false)} />}
      {eavesModal && h.onEavesdrop && <EavesdropModal onClose={() => setEavesModal(false)} onEavesdrop={h.onEavesdrop} />}
    </div>
  );
}
