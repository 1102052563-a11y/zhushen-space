import { useEffect } from 'react';

/** 顶部一次性「已更新到新版本」横幅。仅在版本号变化时显示，纯提示，不改任何玩家数据。
    P4：从单行说明升级为**更新日志条目**——每条可带 nav（点击经 runNavAction 直达该功能），
    治「功能做了没人发现」的最后一公里。旧单行口径（note）仍兼容。 */
export default function VersionToast({
  version, note, notes, onNav, onClose,
}: {
  version: string;
  note?: string;
  notes?: { text: string; nav?: string }[];
  onNav?: (label: string) => void;
  onClose: () => void;
}) {
  const list = notes?.length ? notes : note ? [{ text: note }] : [];
  // 有多条日志给 25 秒读完（也可点 ✕ 立即关闭）；单行保持原 12 秒
  useEffect(() => {
    const t = setTimeout(onClose, list.length > 1 ? 25000 : 12000);
    return () => clearTimeout(t);
  }, [onClose, list.length]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[min(560px,92vw)] rounded-lg border border-god/40 bg-panel/95 shadow-xl backdrop-blur fade-in">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-lg shrink-0">✨</span>
        <div className="text-sm font-semibold text-god god-glow flex-1">已更新到 v{version}</div>
        <button onClick={onClose} aria-label="关闭" className="shrink-0 text-dim hover:text-slate-200 text-sm leading-none">✕</button>
      </div>
      {list.length > 0 && (
        <ul className="px-4 pb-3 space-y-1.5">
          {list.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-dim leading-relaxed">
              <span className="text-god/50 shrink-0 mt-[1px]">·</span>
              <span className="min-w-0">{n.text}</span>
              {n.nav && onNav && (
                <button
                  onClick={() => { onNav(n.nav!); onClose(); }}
                  className="shrink-0 px-1.5 py-0.5 rounded border border-god/30 text-god/80 hover:bg-god/10 text-[10px] leading-none whitespace-nowrap"
                >去看看 →</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
