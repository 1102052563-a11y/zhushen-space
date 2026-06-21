import { createAvatar } from '@dicebear/core';
import { pixelArt, bottts, funEmoji, thumbs, lorelei, openPeeps, croodles, notionists } from '@dicebear/collection';

// DiceBear 头像（核心 MIT · github.com/dicebear/dicebear）。多样式自包含本地生成：
//   头像描述符 = `<style>~<seed>`（无 ~ 则按旧值当 pixel-art 种子），同描述符各端生成同一图，只广播这串字符零图传。
//   样式许可：pixel-art/bottts/thumbs/lorelei/open-peeps/croodles/notionists 为 CC0；fun-emoji 为 CC-BY 4.0（作者 Davis Uche）。

const STYLES: Record<string, any> = {
  'pixel-art': pixelArt, 'bottts': bottts, 'fun-emoji': funEmoji, 'thumbs': thumbs,
  'lorelei': lorelei, 'open-peeps': openPeeps, 'croodles': croodles, 'notionists': notionists,
};
export const DICEBEAR_STYLES: { id: string; label: string }[] = [
  { id: 'pixel-art', label: '像素' }, { id: 'bottts', label: '机器人' }, { id: 'fun-emoji', label: '趣味' },
  { id: 'thumbs', label: '抽象' }, { id: 'lorelei', label: '萝拉' }, { id: 'open-peeps', label: '手绘人' },
  { id: 'croodles', label: '涂鸦' }, { id: 'notionists', label: '简笔' },
];
export const DEFAULT_DB_STYLE = 'pixel-art';

export function parseDicebear(descriptor: string): { style: string; seed: string } {
  const d = descriptor || '';
  const i = d.indexOf('~');
  if (i >= 0) return { style: d.slice(0, i) || DEFAULT_DB_STYLE, seed: d.slice(i + 1) };
  return { style: DEFAULT_DB_STYLE, seed: d };   // 旧值（纯种子）当 pixel-art
}

const cache = new Map<string, string>();
export function dicebearDataUri(descriptor: string): string {
  const d = descriptor || DEFAULT_DB_STYLE;
  const hit = cache.get(d);
  if (hit) return hit;
  const { style, seed } = parseDicebear(d);
  const fn = STYLES[style] || pixelArt;
  const svg = createAvatar(fn, { seed: seed || style, size: 64 }).toString();
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(d, uri);
  return uri;
}
// 兼容旧引用
export const dicebearPixelDataUri = dicebearDataUri;
