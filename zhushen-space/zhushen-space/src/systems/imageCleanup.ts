/* ════════════════════════════════════════════
   图片清理 / 存档瘦身
   ——存档(saveDb)体积爆炸的根因：每个存档的 data.messages[].images（正文配图 dataURL）
     + data.images（头像/装备图）。一个长档可堆到几百 MB。
   本模块按需把存档里的图片剥掉，直接在 IndexedDB 里改写存档（不用读档/重存）。
   配套：剥离当前对话的正文配图（交 setMessages），chatDb 会随消息变化自动同步缩小。
════════════════════════════════════════════ */
import { saveDb } from './saveDb';

/** dataURL 是 ASCII base64 字符串，JSON 里 1 字符≈1 字节 → 字符串长度≈存档占用字节（估算） */
const len = (s?: unknown): number => (typeof s === 'string' ? s.length : 0);

export interface ImgFootprint {
  slots: number;        // 扫描到的存档数
  storyImgs: number;    // 正文配图张数
  storyBytes: number;   // 正文配图占用（估算字节）
  avatarImgs: number;   // 头像/装备图张数
  avatarBytes: number;  // 头像/装备图占用（估算字节）
}

/** 估算所有存档里图片占用（正文配图 + 头像/装备）。逐条游标读，峰值内存=单档。 */
export async function estimateSaveImages(): Promise<ImgFootprint> {
  const ids = (await saveDb.keys()).map(String);
  const f: ImgFootprint = { slots: 0, storyImgs: 0, storyBytes: 0, avatarImgs: 0, avatarBytes: 0 };
  for (const id of ids) {
    let slot: any;
    try { slot = await saveDb.get(id); } catch { continue; }
    if (!slot?.data) continue;
    f.slots++;
    for (const m of slot.data.messages ?? []) for (const im of m.images ?? []) { f.storyImgs++; f.storyBytes += len(im?.url); }
    for (const v of Object.values(slot.data.images ?? {})) { f.avatarImgs++; f.avatarBytes += len(v); }
  }
  return f;
}

/** 给存档瘦身：剥离图片，原地改写存档。
    mode 'story'：只剥正文配图（保留头像/装备，角色仍有脸）；'all'：连头像/装备一起剥（最省）。
    onlyId：只处理某个存档；省略=全部存档。
    返回处理的存档数 + 释放字节估算。 */
export async function stripSaveImages(mode: 'story' | 'all', onlyId?: string): Promise<{ slots: number; freedBytes: number }> {
  const ids = onlyId ? [onlyId] : (await saveDb.keys()).map(String);
  let slots = 0, freed = 0;
  for (const id of ids) {
    let slot: any;
    try { slot = await saveDb.get(id); } catch { continue; }
    if (!slot?.data) continue;
    let changed = false;
    for (const m of slot.data.messages ?? []) {
      if (m.images?.length) { for (const im of m.images) freed += len(im?.url); m.images = []; changed = true; }
    }
    // undo 回退点里也可能嵌着一份带图的 messages，一并剥
    for (const m of slot.data.undo?.messages ?? []) {
      if (m.images?.length) { for (const im of m.images) freed += len(im?.url); m.images = []; changed = true; }
    }
    if (mode === 'all' && slot.data.images && Object.keys(slot.data.images).length) {
      for (const v of Object.values(slot.data.images)) freed += len(v);
      slot.data.images = {};
      changed = true;
    }
    if (changed) { try { await saveDb.put(slot); slots++; } catch { /* 单档写失败跳过，不阻断整批 */ } }
  }
  return { slots, freedBytes: freed };
}

/** 剥离当前对话(live messages)的正文配图：返回新数组交给 setMessages。
    剥完 chatDb 会随消息变化自动 putChanged 缩小，下次存档也不再带这些图。 */
export function stripLiveStoryImages<T extends { images?: unknown[] }>(messages: T[]): T[] {
  return messages.map((m) => (m.images && (m.images as unknown[]).length ? { ...m, images: [] } : m));
}

/** 人类可读体积 */
export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
