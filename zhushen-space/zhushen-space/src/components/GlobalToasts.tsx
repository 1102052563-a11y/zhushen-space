import { useToasts } from '../store/toastStore';

/* 全局 toast 渲染层（P4）：顶部居中堆叠，点击即关。常驻挂 App（eager·体积极小）。
   供后台事件实时反馈：交易行离线成交/托管归还、来宾离房奖励补发、派遣酬劳入库等——
   此前这些只能等下一回合正文提起，玩家毫无实时感知。 */
export default function GlobalToasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  const color = (k: string) =>
    k === 'ok' ? 'border-emerald-500/50 text-emerald-200'
    : k === 'err' ? 'border-blood/60 text-red-200'
    : 'border-god/40 text-slate-200';
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[190] w-[min(480px,90vw)] space-y-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto w-full text-left px-3.5 py-2 rounded-lg border bg-panel/95 shadow-lg backdrop-blur fade-in text-[12px] leading-relaxed ${color(t.kind)}`}
          title="点击关闭"
        >{t.text}</button>
      ))}
    </div>
  );
}
