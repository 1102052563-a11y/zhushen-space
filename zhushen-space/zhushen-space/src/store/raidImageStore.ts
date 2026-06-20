import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 组队副本 BOSS 立绘（本机配置·非游戏进度）：按 encId（ice/poison/stun/bakal）存一张图。
   纯本地、各客户端各自设置；用户「导入」自己有版权/授权的图，不碰任何第三方素材。
   导入时缩放到 ≤512px 的 jpeg dataURL，控体积，防 localStorage 撑爆。 */

interface RaidImageState {
  images: Record<string, string>;   // bossId → dataURL
  setImage: (id: string, url: string) => void;
  clearImage: (id: string) => void;
}

export const useRaidImages = create<RaidImageState>()(
  persist(
    (set): RaidImageState => ({
      images: {},
      setImage: (id, url) => set((s) => ({ images: { ...s.images, [id]: url } })),
      clearImage: (id) => set((s) => { const n = { ...s.images }; delete n[id]; return { images: n }; }),
    }),
    { name: 'drpg-raid-boss-img' },
  ),
);

/* 图片 File → 缩放到 ≤max 的 jpeg dataURL（控体积）。 */
export function fileToScaledDataUrl(file: File, max = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d'); if (!ctx) { reject(new Error('no canvas ctx')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = String(fr.result);
    };
    fr.onerror = () => reject(new Error('file read failed'));
    fr.readAsDataURL(file);
  });
}
