import AuditRollback from './AuditRollback';

/* 右侧导航「🧾 审计」弹窗：包一层模态外壳，内容复用 AuditRollback（数据库引入②）。 */
export default function AuditPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🧾</span>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-100">变量审计 · 回滚</div>
            <div className="text-[12px] font-mono text-dim/60">本回合每个变量改了什么 · 把变量回滚到某回合演化前</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4"><AuditRollback /></div>
      </div>
    </div>
  );
}
