import { useEffect } from 'react';

/** 顶部一次性「已更新到新版本」横幅。仅在版本号变化时显示，纯提示，不改任何玩家数据。 */
export default function VersionToast({
  version, note, onClose,
}: { version: string; note?: string; onClose: () => void }) {
  // 12 秒后自动消失（玩家也可点 ✕ 立即关闭）
  useEffect(() => {
    const t = setTimeout(onClose, 12000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-[92vw] flex items-center gap-3 px-4 py-2.5 rounded-lg border border-god/40 bg-panel/95 shadow-xl backdrop-blur fade-in">
      <span className="text-lg shrink-0">✨</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-god god-glow">已更新到 v{version}</div>
        {note && <div className="text-xs text-dim mt-0.5">{note}</div>}
      </div>
      <button
        onClick={onClose}
        aria-label="关闭"
        className="ml-2 shrink-0 text-dim hover:text-slate-200 text-sm leading-none"
      >✕</button>
    </div>
  );
}
