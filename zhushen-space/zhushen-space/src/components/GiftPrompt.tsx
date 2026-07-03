import { acceptGift, declineGift } from '../systems/mpGift';

/* 收到联机赠予时的弹窗：查看对方要给的物品，决定收下/拒绝。 */
export default function GiftPrompt({ gift, onClose }: { gift: any; onClose: () => void }) {
  const items: any[] = gift?.items || [];
  const fromName = gift?.from?.name || '某位道友';
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
          <span className="text-god/70 text-lg">🎁</span>
          <div className="text-base font-bold text-slate-100 flex-1"><span className="text-god/80">{fromName}</span> 想送你东西</div>
        </header>
        <div className="px-5 py-4 space-y-2 max-h-[50dvh] overflow-y-auto">
          {items.length === 0 && <div className="text-[12px] text-dim/50 text-center py-4">（空）</div>}
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-edge bg-panel/60 p-2.5">
              <div className="text-[14px] text-slate-100">
                {it.name}
                {it.gradeDesc ? <span className="text-[11px] text-amber-300/70"> · {it.gradeDesc}</span> : null}
                {it.quantity > 1 ? <span className="text-[11px] text-dim/60"> ×{it.quantity}</span> : null}
              </div>
              {it.effect && <div className="text-[12px] text-dim/70 mt-0.5 leading-relaxed">{String(it.effect).slice(0, 100)}</div>}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-edge bg-panel/50 flex gap-2">
          <button onClick={() => { declineGift(gift); onClose(); }} className="flex-1 px-4 py-2 rounded-lg border border-edge text-dim/80 hover:text-slate-200 text-sm transition-colors">拒绝</button>
          <button onClick={() => { acceptGift(gift); onClose(); }} className="flex-1 px-4 py-2 rounded-lg bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 text-sm transition-colors">收下</button>
        </div>
      </div>
    </div>
  );
}
