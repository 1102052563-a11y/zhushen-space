import { useEffect } from 'react';
import { useImageViewer } from '../store/imageViewerStore';

/* 全屏大图查看器（灯箱）。挂在 App 根部一次即可；任意处调用 useImageViewer.open(src) 打开。
   点击遮罩/✕/按 Esc 关闭；点图片本身不关闭。*/
export default function ImageViewer() {
  const src = useImageViewer((s) => s.src);
  const alt = useImageViewer((s) => s.alt);
  const close = useImageViewer((s) => s.close);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, close]);

  if (!src) return null;
  return (
    <div
      onClick={close}
      className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
    >
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default select-none"
      />
      <button
        onClick={close}
        className="absolute top-4 right-5 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg"
        title="关闭 (Esc)"
      >✕</button>
      <a
        href={src} download="image.jpg" onClick={(e) => e.stopPropagation()}
        className="absolute bottom-5 right-5 px-3 py-1.5 text-[13px] font-mono rounded-lg bg-white/10 hover:bg-white/20 text-white"
        title="下载这张图"
      >⬇ 下载</a>
    </div>
  );
}
