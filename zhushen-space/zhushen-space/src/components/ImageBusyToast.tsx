import { useImageBusy } from '../store/imageBusyStore';

/* 底部居中「图片生成中」toast：显示标题 + 实际使用的提示词预览（确认画风/标签是否生效）*/
export default function ImageBusyToast() {
  const busy = useImageBusy((s) => s.busy);
  const title = useImageBusy((s) => s.title);
  if (busy <= 0) return null;
  // 精简版：只留一个小标号（转圈 + 短标题 + 排队数），不再显示生图提示词
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] pointer-events-none">
      <div className="rounded-full border border-god/40 bg-void/95 backdrop-blur px-3 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)] flex items-center gap-1.5 text-god text-[12px] font-mono">
        <span className="animate-spin inline-block">◌</span>
        <span>{title || '生图中'}{busy > 1 ? `（${busy}）` : ''}</span>
      </div>
    </div>
  );
}
