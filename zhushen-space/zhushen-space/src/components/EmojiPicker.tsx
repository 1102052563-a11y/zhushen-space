import { useState } from 'react';
import { EMOJI_CATEGORIES } from '../systems/chatEmoji';

/* 轻量 emoji 选择器（自包含·零依赖·原生 emoji 渲染）：分类标签 + 网格，点选回调 onPick。
   定位在输入框上方（父容器需 relative）。点选后不自动关闭，便于连选；外层点遮罩关闭。 */
export default function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState(0);
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full mb-2 left-0 z-20 w-72 rounded-xl border border-edge bg-void shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="flex border-b border-edge bg-panel/60">
          {EMOJI_CATEGORIES.map((c, i) => (
            <button key={c.label} onClick={() => setCat(i)}
              className={`flex-1 py-1.5 text-[11px] transition-colors ${cat === i ? 'text-god border-b-2 border-god' : 'text-dim/55 hover:text-slate-200'}`}>{c.label}</button>
          ))}
        </div>
        <div className="p-2 grid grid-cols-8 gap-0.5 max-h-44 overflow-y-auto">
          {EMOJI_CATEGORIES[cat].emojis.map((e) => (
            <button key={e} onClick={() => onPick(e)} title={e}
              className="text-xl leading-none p-1 rounded hover:bg-panel2 transition-colors">{e}</button>
          ))}
        </div>
      </div>
    </>
  );
}
