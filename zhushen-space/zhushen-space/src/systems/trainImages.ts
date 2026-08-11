import { putImg, delImg } from './imageDb';

/* ════════════════════════════════════════════
   🔗 调教场景图内存缓存（key=train:<npcId>:<shotId> → dataURL）。仿 outfitImages/mapImages：
   - 图不进 trainingStore（localStorage 不存 dataURL，几张就爆 5MB）——store 只存 gallery 元数据（含 key 引用）；
   - imageSync.snapshotImages() 是**同步**收图做存档快照，故需此内存镜像，否则读档清快照域后调教图全灭；
   - 写/删：trainImgSet/trainImgDel 同步缓存 + imageDb；启动回填 hydrateTrainImgs；新游戏 clearTrainImgCache。
   ⚠ 只依赖 imageDb，绝不 import store/imageSync（防 ESM 循环——imageSync 反向 import 这里）。
════════════════════════════════════════════ */

const cache = new Map<string, string>();

/** 调教场景图 imageDb key 单一权威源。 */
export function trainImageKey(npcId: string, shotId: string): string {
  return `train:${npcId}:${shotId}`;
}

/** 写入：缓存先行 + imageDb 落库（返回落库 promise，供面板 await 后提示保存失败）。 */
export function trainImgSet(key: string, dataUrl: string): Promise<void> {
  cache.set(key, dataUrl);
  return putImg(key, dataUrl);
}

/** 删除：缓存 + imageDb（delImg 自身吞错）。 */
export function trainImgDel(key: string): Promise<void> {
  cache.delete(key);
  return delImg(key);
}

/** 同步读（只查缓存；未命中≈无图）。 */
export function trainImgGet(key: string): string | undefined {
  return cache.get(key);
}

/** 全量只读视图：imageSync.collect() 并进存档快照用。 */
export function allTrainImgs(): ReadonlyMap<string, string> {
  return cache;
}

/** 启动回填：imageSync.hydrateImages() 把 imageDb 全量里 train: 前缀灌进缓存。 */
export function hydrateTrainImgs(all: Record<string, string>): void {
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('train:') && typeof v === 'string' && v) cache.set(k, v);
  }
}

/** 清空内存缓存（新游戏清随档进度图，见 imageSync.clearSnapshotDomainImages）。 */
export function clearTrainImgCache(): void { cache.clear(); }
