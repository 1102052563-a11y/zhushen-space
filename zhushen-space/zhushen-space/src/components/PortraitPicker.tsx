import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

/* 肖像图库：从 public/portraits/manifest.json 读取内置肖像，点缩略图即把图片 URL 写入 avatar。
   - 肖像存的是 URL（同源 /portraits/xxx），不占存档体积，多个角色可共用同一张。
   - 主角(PlayerSidebar) / NPC(NpcDetail / OnScenePanel) 共用。
   - PortraitLibraryModal：受控弹窗（可由「空白肖像」点击直接打开）；PortraitPicker：自带按钮的便捷封装。
   - 弹窗用 portal 挂到 body，避免被宿主卡片的 onClick 冒泡误触（在场卡整张可点）。*/

export interface PortraitEntry { file: string; name?: string; category?: string }

const PORTRAIT_BASE = (import.meta.env.BASE_URL || '/') + 'portraits/';
let cache: PortraitEntry[] | null = null;   // 进程内缓存：manifest 只拉一次

/** 受控的图库弹窗：open 控制显隐，选中后回调 onPick(url) 并自动关闭。*/
export function PortraitLibraryModal({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const [list, setList]       = useState<PortraitEntry[]>(cache ?? []);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [cat, setCat]         = useState('');   // 当前分类筛选，'' = 全部

  // 从 manifest 的 category 字段汇总分类（保持出现顺序）
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const e of list) if (e.category && !seen.includes(e.category)) seen.push(e.category);
    return seen;
  }, [list]);
  const shown = cat ? list.filter((e) => e.category === cat) : list;

  useEffect(() => {
    if (!open || cache) return;
    setLoading(true); setErr('');
    fetch(PORTRAIT_BASE + 'manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('未找到 portraits/manifest.json'))))
      .then((d) => { cache = Array.isArray(d) ? d.filter((e) => e && e.file) : []; setList(cache); })
      .catch((e) => setErr(e?.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/75 flex items-center justify-center p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-panel border border-edge rounded-xl w-full max-w-2xl max-h-[80vh] overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-200">肖像图库</span>
          <button type="button" onClick={onClose} className="text-dim hover:text-blood text-sm px-1">✕</button>
        </div>

        {loading && <div className="text-dim text-sm py-10 text-center font-mono animate-pulse">加载中…</div>}

        {!loading && err && (
          <div className="text-blood/80 text-[13px] py-10 text-center leading-relaxed">
            {err}
            <div className="text-dim/60 mt-1 text-[12px]">把图片放到 public/portraits/，并在 portraits/manifest.json 里登记</div>
          </div>
        )}

        {!loading && !err && list.length === 0 && (
          <div className="text-dim text-sm py-10 text-center leading-relaxed">
            图库为空
            <div className="text-dim/50 mt-1 text-[12px]">把图片放到 public/portraits/ 并登记到 manifest.json</div>
          </div>
        )}

        {!loading && !err && list.length > 0 && (
          <>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button type="button" onClick={() => setCat('')}
                  className={`text-[12px] font-mono px-2.5 py-1 rounded-full border transition-colors ${cat === '' ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:text-god hover:border-god/40'}`}>
                  全部 {list.length}
                </button>
                {categories.map((c) => (
                  <button type="button" key={c} onClick={() => setCat(c)}
                    className={`text-[12px] font-mono px-2.5 py-1 rounded-full border transition-colors ${cat === c ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:text-god hover:border-god/40'}`}>
                    {c} {list.filter((e) => e.category === c).length}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {shown.map((e) => (
                <button type="button" key={e.file}
                  onClick={() => { onPick(PORTRAIT_BASE + e.file); onClose(); }}
                  className="group flex flex-col items-center gap-1" title={e.name ?? e.file}>
                  <img src={PORTRAIT_BASE + e.file} alt={e.name ?? e.file} loading="lazy"
                    className="w-full aspect-square object-cover rounded-lg border border-edge group-hover:border-god/60 transition-colors" />
                  {e.name && <span className="text-[11px] text-dim truncate w-full text-center">{e.name}</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** 自带「📁 图库」按钮的便捷封装（按钮 + 受控弹窗）。*/
export function PortraitPicker({ onPick, label = '📁 图库', className }: {
  onPick: (url: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="从内置图库选肖像"
        className={className ?? 'text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40 transition-colors'}
      >{label}</button>
      <PortraitLibraryModal open={open} onClose={() => setOpen(false)} onPick={onPick} />
    </>
  );
}

export default PortraitPicker;
