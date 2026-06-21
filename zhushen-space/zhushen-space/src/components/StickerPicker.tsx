import { useEffect, useState } from 'react';
import { stickerPacks, loadStickerPacks, stickerSrc } from '../systems/chatStickers';

/* 表情包（大贴纸）选择器：包标签 + 贴纸网格，点一下即回调 onPick(pack,id) 发送。
   定位在输入框上方（父容器需 relative）。外层点遮罩关闭。结构对齐 EmojiPicker。
   打开时拉一次文件夹直投的 manifest（public/stickers/<包名>/），与内置 SVG 两套合并显示。 */
export default function StickerPicker({ onPick, onClose }: { onPick: (pack: string, id: string) => void; onClose: () => void }) {
  const [pi, setPi] = useState(0);
  const [, bump] = useState(0);
  useEffect(() => { loadStickerPacks().then(() => bump((v) => v + 1)); }, []);
  const packs = stickerPacks();
  const pack = packs[pi] || packs[0];
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full mb-2 left-0 z-20 w-80 rounded-xl border border-edge bg-void shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="flex border-b border-edge bg-panel/60 overflow-x-auto">
          {packs.map((p, i) => (
            <button key={p.id} onClick={() => setPi(i)}
              className={`shrink-0 px-3 py-1.5 text-[11px] whitespace-nowrap transition-colors ${pi === i ? 'text-god border-b-2 border-god' : 'text-dim/55 hover:text-slate-200'}`}>{p.emoji} {p.label}</button>
          ))}
        </div>
        <div className="p-2 grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto">
          {pack?.stickers.map((s) => (
            <button key={s.id} onClick={() => onPick(pack.id, s.id)} title={s.label}
              className="aspect-square rounded-lg overflow-hidden border border-transparent hover:border-god/50 transition-colors">
              <img src={stickerSrc({ pack: pack.id, id: s.id })} alt={s.label} className="w-full h-full object-cover" draggable={false} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
