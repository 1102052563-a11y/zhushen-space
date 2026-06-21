import { useEffect, useRef, useState } from 'react';
import {
  stickerPacks, loadStickerPacks, loadMyCloudStickers, loadPublicStickers, stickerDefSrc, refForDef,
  uploadCloudSticker, deleteMyCloudSticker, hidePublicSticker, type StickerRef,
} from '../systems/chatStickers';

/* 表情包（大贴纸）选择器：包标签 + 贴纸网格，点一下即回调 onPick(ref) 发送。
   三类包并排：内置 SVG 两套 + 文件夹直投(public/stickers/) + 「⭐我的」云端上传(R2)。
   底部「☁上传到云端」选图直传（需登录·素材版权自负）；「我的」包里每张可悬停删除。 */
export default function StickerPicker({ onPick, onClose }: { onPick: (ref: StickerRef) => void; onClose: () => void }) {
  const [pi, setPi] = useState(0);
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const rerender = () => bump((v) => v + 1);

  useEffect(() => {
    loadStickerPacks().then(rerender);
    loadMyCloudStickers().then(rerender);
    loadPublicStickers().then(rerender);
  }, []);

  const packs = stickerPacks();
  const idx = Math.min(pi, packs.length - 1);
  const pack = packs[idx] || packs[0];

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      await uploadCloudSticker(f);
      loadPublicStickers().then(rerender);   // 上传的也进「大家的」
      rerender();
      const mi = stickerPacks().findIndex((p) => p.id === 'mine');
      if (mi >= 0) setPi(mi);   // 切到「我的」看刚上传的
    } catch (e2: any) { setErr(e2?.message || '上传失败'); }
    setBusy(false);
  };
  const onDelete = async (hash: string) => { await deleteMyCloudSticker(hash); rerender(); };
  const onHide = (hash: string) => { hidePublicSticker(hash); rerender(); };

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full mb-2 left-0 z-20 w-80 rounded-xl border border-edge bg-void shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="flex border-b border-edge bg-panel/60 overflow-x-auto">
          {packs.map((p) => (
            <button key={p.id} onClick={() => setPi(packs.indexOf(p))}
              className={`shrink-0 px-3 py-1.5 text-[11px] whitespace-nowrap transition-colors ${pack?.id === p.id ? 'text-god border-b-2 border-god' : 'text-dim/55 hover:text-slate-200'}`}>{p.emoji} {p.label}</button>
          ))}
        </div>
        <div className="p-2 grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto">
          {pack?.stickers.map((s) => (
            <div key={s.id} className="relative group/stk">
              <button onClick={() => onPick(refForDef(pack.id, s))} title={s.label}
                className="block w-full aspect-square rounded-lg overflow-hidden border border-transparent hover:border-god/50 transition-colors">
                <img src={stickerDefSrc(s)} alt={s.label} className="w-full h-full object-cover" draggable={false} loading="lazy" />
              </button>
              {pack.id === 'mine' && (
                <button onClick={() => onDelete(s.id)} title="删除这张"
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blood/90 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/stk:opacity-100 transition-opacity">✕</button>
              )}
              {pack.id === 'public' && (
                <button onClick={() => onHide(s.id)} title="隐藏这张（仅你看不到）"
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] leading-none flex items-center justify-center opacity-0 group-hover/stk:opacity-100 transition-opacity">🚫</button>
              )}
            </div>
          ))}
          {pack?.id === 'mine' && pack.stickers.length === 0 && (
            <div className="col-span-4 text-center text-[11px] text-dim/40 py-4">还没有上传 · 点下方「上传到云端」</div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-edge bg-panel/40 px-2 py-1.5">
          <span className="text-[10px] text-dim/45 truncate">{err ? <span className="text-amber-400/80">{err}</span> : '只上传你有权使用的图 · gif/png/webp ≤2MB'}</span>
          <input ref={fileRef} type="file" accept="image/gif,image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="shrink-0 px-2.5 py-1 rounded-lg text-[12px] bg-god/15 border border-god/40 text-god/90 hover:bg-god/25 disabled:opacity-40 transition-colors">{busy ? '上传中…' : '☁ 上传到云端'}</button>
        </div>
      </div>
    </>
  );
}
