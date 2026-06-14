import { create } from 'zustand';

/* 全局大图查看器（灯箱）——点击任意图片缩略图放大查看，不持久化 */
interface ImageViewerState {
  src: string | null;
  alt: string;
  open: (src: string, alt?: string) => void;
  close: () => void;
}

export const useImageViewer = create<ImageViewerState>((set) => ({
  src: null,
  alt: '',
  open: (src, alt = '') => set({ src, alt }),
  close: () => set({ src: null, alt: '' }),
}));
