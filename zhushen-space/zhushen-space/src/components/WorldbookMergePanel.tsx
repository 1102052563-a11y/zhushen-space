import { useSettings } from '../store/settingsStore';

// 内置世界书更新时的「双改」冲突裁决弹窗（策略B）：内置改了、玩家也改了同一条 → 逐条选「用新版」或「保留我的」。
// 冲突全部解决（或点「稍后」）后 worldbookConflicts 清空 → App 自动卸载本弹窗。
export default function WorldbookMergePanel() {
  const conflicts = useSettings((s) => s.worldbookConflicts);
  const resolve = useSettings((s) => s.resolveWorldbookConflict);
  const setConflicts = useSettings((s) => s.setWorldbookConflicts);
  if (conflicts.length === 0) return null;

  const resolveAll = (choice: 'fresh' | 'mine') => { conflicts.slice().forEach((c) => resolve(c.bookId, c.uid, choice)); };

  return (
    <div className="fixed inset-0 z-[60] bg-void/95 backdrop-blur-sm flex flex-col">
      <div className="shrink-0 px-6 py-3 border-b border-edge flex items-center gap-3 flex-wrap">
        <span className="text-lg font-bold text-amber-300">⚠ 内置世界书有更新</span>
        <span className="text-xs font-mono text-dim/70">以下 {conflicts.length} 条你改过、内置也更新了——逐条选保留谁（关掉＝先都保留你的，下次启动再问）。</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => resolveAll('fresh')} className="text-[12px] font-mono px-2.5 py-1 rounded border border-god/40 text-god hover:bg-god/10 transition-colors">全部用新版</button>
          <button onClick={() => resolveAll('mine')} className="text-[12px] font-mono px-2.5 py-1 rounded border border-edge text-dim hover:text-slate-200 hover:border-god/40 transition-colors">全部保留我的</button>
          <button onClick={() => setConflicts([])} title="先不处理：这次保留你的所有改动，下次启动会再问" className="text-[12px] font-mono px-2.5 py-1 text-dim/60 hover:text-blood transition-colors">稍后 ✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-5xl mx-auto w-full">
        {conflicts.map((c) => (
          <div key={`${c.bookId}_${c.uid}`} className="border border-amber-500/20 rounded-lg bg-void/40 p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-sm font-medium text-slate-200">{c.comment}</span>
              <span className="text-[11px] font-mono text-dim/50">{c.bookName} · #{c.uid}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => resolve(c.bookId, c.uid, 'fresh')} className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 transition-colors">用新版覆盖</button>
                <button onClick={() => resolve(c.bookId, c.uid, 'mine')} className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:text-slate-200 hover:border-god/40 transition-colors">保留我的</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
              <div>
                <div className="text-[11px] font-mono text-god/70 mb-1">内置新版</div>
                <pre className="text-[12px] text-slate-300/90 leading-relaxed whitespace-pre-wrap font-sans border border-god/15 rounded p-2 max-h-48 overflow-y-auto">{preview(c.freshEntry.content)}</pre>
              </div>
              <div>
                <div className="text-[11px] font-mono text-amber-300/70 mb-1">我的当前</div>
                <pre className="text-[12px] text-slate-300/90 leading-relaxed whitespace-pre-wrap font-sans border border-amber-500/15 rounded p-2 max-h-48 overflow-y-auto">{preview(c.userEntry.content)}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function preview(s: string): string {
  const t = (s || '').trim();
  return t.length > 1200 ? t.slice(0, 1200) + '\n…（略）' : (t || '（空）');
}
