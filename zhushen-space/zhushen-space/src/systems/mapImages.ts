import { putImg, delImg } from './imageDb';
import { logWarn } from '../utils/log';

/* ════════════════════════════════════════════
   🧭 地点图内存缓存（key=map:<worldKey>:<nodeId> → dataURL）。
   为什么需要它：imageSync.snapshotImages() 是**同步**函数（从各 store 内存收图做存档快照），
   而地点图不进 mapStore（localStorage 5MB 会爆）、只存 imageDb——若无此缓存，存档快照收不到
   地点图 → 读档 clearAllImg() 后地点图全灭。本模块保持一份与 imageDb 同步的内存镜像：
   - 写/删 walk-through：mapImgSet/mapImgDel 同时更新缓存与 imageDb；
   - 启动回填：imageSync.hydrateImages() 把 imageDb 里 map: 前缀键灌进来（见该文件调用点）；
   - 存档：imageSync.collect() 把本缓存并进快照 → 读档 bulkPutImg 原样回来。
   体积：384px JPEG 每张 ~30-60KB，百个地点 ~5MB 内存，与 npc/item 图全量驻留 store 的现状同量级。
   ⚠ 本模块只依赖 imageDb，绝不 import store/imageSync（防 ESM 循环——imageSync 反向 import 这里）。
════════════════════════════════════════════ */

const cache = new Map<string, string>();

/** 地点图 imageDb key（口径照 outfitImageKey）。worldKey 必须已过 mapWorldKey。 */
export function mapImageKey(worldKey: string, nodeId: string): string {
  return `map:${worldKey}:${nodeId}`;
}

/** 写入：缓存 + imageDb（落库失败只告警，缓存仍在——存档快照兜底）。 */
export function mapImgSet(key: string, dataUrl: string): void {
  cache.set(key, dataUrl);
  putImg(key, dataUrl).catch((e) => logWarn('mapImages.putImg', e));
}

/** 删除：缓存 + imageDb。 */
export function mapImgDel(key: string): void {
  cache.delete(key);
  delImg(key).catch((e) => logWarn('mapImages.delImg', e));
}

/** 同步读（只查缓存；未命中返回 undefined——正常路径下 hydrate 已回填，未命中≈无图）。 */
export function mapImgGet(key: string): string | undefined {
  return cache.get(key);
}

/** 全量只读视图：imageSync.collect() 并进存档快照用。 */
export function allMapImgs(): ReadonlyMap<string, string> {
  return cache;
}

/** 启动回填：imageSync.hydrateImages() 把 imageDb 全量里 map: 前缀灌进缓存。 */
export function hydrateMapImgs(all: Record<string, string>): void {
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('map:') && typeof v === 'string' && v) cache.set(k, v);
  }
}

/** 清空内存缓存（新游戏清随档进度图用，见 imageSync.clearSnapshotDomainImages——
    只清 imageDb 不清缓存的话，旧局地点图会随 collect() 泄漏进新局的存档快照）。 */
export function clearMapImgCache(): void { cache.clear(); }
