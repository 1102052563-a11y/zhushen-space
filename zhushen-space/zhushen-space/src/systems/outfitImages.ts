import { putImg, delImg } from './imageDb';

/* ════════════════════════════════════════════
   👗 穿搭参考图内存缓存（key=outfit:<charId>:<outfitId> → dataURL）。
   为什么需要它：与地点图(mapImages)同因——imageSync.snapshotImages() 是**同步**函数（从内存收图做存档快照），
   而穿搭参考图不进 outfitStore（localStorage 不存图）、只存 imageDb——若无此缓存，存档快照收不到穿搭图 →
   读档清快照域后衣柜图全灭，「存档→新游戏→再读旧档」或跨设备导入也无法恢复（2026-08-11 修）。
   本模块保持一份与 imageDb 同步的内存镜像：
   - 写/删 walk-through：outfitImgSet/outfitImgDel 同时更新缓存与 imageDb（OutfitPanel 上传/模板导入/删除走这）；
   - 启动回填：imageSync.hydrateImages() 把 imageDb 里 outfit: 前缀键灌进来（见该文件调用点）；
   - 存档：imageSync.collect() 把本缓存并进快照 → 读档 bulkPutImg 原样回来；
   - 新游戏：saveManager.clearProgress 连缓存一起清（不清则旧局衣柜图会随 collect() 泄漏进新局快照）。
   体积：768px JPEG 每张 ~100-250KB（OutfitPanel 上传时已 shrinkDataUrl 压过），只进手动档/上一局存档（自动档/回退点不带图）。
   ⚠ 本模块只依赖 imageDb，绝不 import store/imageSync（防 ESM 循环——imageSync 反向 import 这里）。
════════════════════════════════════════════ */

const cache = new Map<string, string>();

/** 穿搭参考图 imageDb key 单一权威源（systems/outfit.ts 转发导出，旧调用点 import 路径不变）。 */
export function outfitImageKey(charId: string, outfitId: string): string {
  return `outfit:${charId}:${outfitId}`;
}

/** 写入：缓存先行 + imageDb 落库。刻意返回落库 promise 而不学 mapImgSet 吞错——
    OutfitPanel 要 await 后弹「参考图保存失败」；落库失败缓存仍在，存档快照兜底。 */
export function outfitImgSet(key: string, dataUrl: string): Promise<void> {
  cache.set(key, dataUrl);
  return putImg(key, dataUrl);
}

/** 删除：缓存 + imageDb（delImg 自身吞错、不会 reject）。 */
export function outfitImgDel(key: string): Promise<void> {
  cache.delete(key);
  return delImg(key);
}

/** 同步读（只查缓存；未命中≈无图。面板/生图线仍按需 getImg，此口给同步场景备用）。 */
export function outfitImgGet(key: string): string | undefined {
  return cache.get(key);
}

/** 全量只读视图：imageSync.collect() 并进存档快照用。 */
export function allOutfitImgs(): ReadonlyMap<string, string> {
  return cache;
}

/** 启动回填：imageSync.hydrateImages() 把 imageDb 全量里 outfit: 前缀灌进缓存。 */
export function hydrateOutfitImgs(all: Record<string, string>): void {
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('outfit:') && typeof v === 'string' && v) cache.set(k, v);
  }
}

/** 清空内存缓存（新游戏清随档进度图用，见 imageSync.clearSnapshotDomainImages；测试也用）。 */
export function clearOutfitImgCache(): void { cache.clear(); }
