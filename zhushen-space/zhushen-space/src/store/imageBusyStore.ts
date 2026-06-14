import { create } from 'zustand';

/* 全局「图片生成中」提示（不持久化）。任何生图处 start(标题, 提示词预览) → done()。
   底部 toast 显示标题 + 实际使用的提示词前若干字，便于确认画风/标签是否生效。*/
interface ImageBusyState {
  busy: number;
  title: string;
  preview: string;
  start: (title: string, preview?: string) => void;
  done: () => void;
}

export const useImageBusy = create<ImageBusyState>((set) => ({
  busy: 0,
  title: '',
  preview: '',
  start: (title, preview = '') => set((s) => ({ busy: s.busy + 1, title, preview })),
  done: () => set((s) => ({ busy: Math.max(0, s.busy - 1) })),
}));
