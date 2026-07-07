import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/* ── lz 压缩版 localStorage（给体积大的 zustand persist store 用）──────────────
   背景：localStorage 是**整个域共享 ~5-10MB 总配额**。`drpg-misc` 的「叙事长期事实」默认不限数量，
   累积到数千条后裸 JSON 就把配额顶满 → 报 `setItem 'drpg-settings' exceeded the quota`（配额没了，
   改 API / 存记忆 / 读档回退 全都写不进），并且每次变动都要序列化几千条=卡。
   修：这类 store 的 persist 值用 lz-string 压缩（中文文本压 ~5-10×），2000+ 事实轻松放下。

   兼容 & save 无碍：① 旧的**未压缩**值（无 LZ 前缀）原样读出、下次写入即转成压缩，自动迁移；
   ② saveManager.snapshotStores 读的是 localStorage 里的压缩串、读档写回也是压缩串 → reload 后本 storage
   解压即可（存档还顺带变小）；mergeKeepApi 会用 decompressMaybe/compressWithMark 处理压缩值、不丢 miscApi；
   ③ setItem 仍超配额时静默吞（别 throw 把主流程崩了）。 */

const MARK = 'LZ';   // 压缩标记前缀：zustand 存的 JSON 一定以 { 开头、绝不以 LZ 开头，用来区分「已压缩」vs「旧·未压缩」

/** 是否是本模块写出的压缩值（带 LZ 前缀）。 */
export function isCompressed(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(MARK);
}

/** 解压：带 LZ 前缀→解压；否则（旧·未压缩）原样返回。供 mergeKeepApi 等需读明文 JSON 的地方用。 */
export function decompressMaybe(v: string | null | undefined): string | null {
  if (v == null) return null;
  if (!v.startsWith(MARK)) return v;
  try { return decompressFromUTF16(v.slice(MARK.length)) || null; } catch { return null; }
}

/** 压缩：JSON 明文 → 带 LZ 前缀的压缩串。 */
export function compressWithMark(json: string): string {
  return MARK + compressToUTF16(json);
}

export const lzLocalStorage: StateStorage = {
  getItem: (name) => {
    let v: string | null = null;
    try { v = localStorage.getItem(name); } catch { return null; }
    return decompressMaybe(v);
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, compressWithMark(value)); }
    catch { /* 压缩后仍超配额：静默——总比 throw 中断整条状态更新链好（配额告警另有 UI） */ }
  },
  removeItem: (name) => { try { localStorage.removeItem(name); } catch { /* */ } },
};

/** 供 zustand persist 的 `storage` 用：createJSONStorage 包一层 JSON 序列化。 */
export const lzStorage = () => createJSONStorage(() => lzLocalStorage);

/** 一次性迁移：把列出的 key 里**旧·未压缩**的值就地重写成压缩值——**立即**释放配额，不用等各 store 下次状态变更才压。
    对 zustand persist 值(`{state}`) 与事件核心快照都通用（只按 LZ 前缀判压、compressWithMark 与内部格式无关）。
    ⚠只在有旧值且更小时才写（覆盖同一 key 为更小值即便配额已满也能成功），静默容错，绝不因它中断启动。 */
export function migrateCompressLegacy(keys: string[]): void {
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw && !isCompressed(raw) && raw.length > 2) {
        const packed = compressWithMark(raw);
        if (packed.length < raw.length) localStorage.setItem(k, packed);   // 只在确实变小时替换
      }
    } catch { /* 配额/异常都别中断启动 */ }
  }
}

/** 仍存 localStorage 的压缩 store 的 key（migrateCompressLegacy 用；新增压缩 store 记得加进来）。
    注：事件核心 npc-core/items-core/wallet 已搬 IndexedDB（阶段1），其旧 localStorage 值由 preloadEventCores 迁移，故不在此列。 */
export const COMPRESSED_KEYS = [
  'drpg-misc', 'drpg-turn-insight',
  'drpg-npc', 'drpg-faction', 'drpg-characters', 'drpg-fanfic', 'drpg-ledger', 'drpg-tables', 'drpg-channel',
];
