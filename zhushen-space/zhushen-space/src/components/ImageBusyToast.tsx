import { useImageBusy } from '../store/imageBusyStore';

/* 底部居中「图片生成中」toast：显示标题 + 实际使用的提示词预览（确认画风/标签是否生效）*/
export default function ImageBusyToast() {
  const busy = useImageBusy((s) => s.busy);
  const title = useImageBusy((s) => s.title);
  const preview = useImageBusy((s) => s.preview);
  if (busy <= 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] max-w-lg w-[min(92vw,32rem)] pointer-events-none">
      <div className="rounded-xl border border-god/40 bg-void/95 backdrop-blur px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2 text-god text-sm font-mono">
          <span className="animate-spin inline-block">◌</span>
          <span>{title || '正在生成图片…'}</span>
          {busy > 1 && <span className="text-dim/50">（{busy} 张排队中）</span>}
        </div>
        {preview && (
          <div className="mt-1.5 text-[11px] font-mono text-dim/60 leading-snug break-words max-h-16 overflow-hidden">
            提示词：{preview}
          </div>
        )}
      </div>
    </div>
  );
}
