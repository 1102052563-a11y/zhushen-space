import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompiledEntry, RowMeta } from '../systems/chronicle';

/* ════════════════════════════════════════════
   编年史 store（drpg-chronicle）—— 📜 传奇模式的两样"不能从别处推出来"的东西

   ① rowMeta：纪要行 row_id → { turn, world } 旁路索引。
      纪要表本身只有 AI 写的自由文本「时间」列（对史书而言比回合号好用），
      但**分卷**需要技术键 —— 这份索引就是分卷的地基，由前端在纪要行落库时旁路记，
      不改表结构、不污染 AI 看到的表内容。老存档没有 rowMeta → buildVolumes 优雅降级到散佚卷。

   ② compiled：AI「删繁就简」编纂出的正史，按 WorldRecord.id 存。
      史观：**当朝为实录、前朝才有正史** —— 未编纂的卷现场投影实录，编纂过的卷显示正史。
      正史不覆盖实录（实录源数据原样留着），随时可重修。

   两者都是**本存档的进度**，随 saveManager 快照、新游戏清空。
════════════════════════════════════════════ */

export interface CompiledVolume {
  entries: CompiledEntry[];
  compiledAt: number;
  turnAt?: number;        // 编纂时的回合（重修时对比）
  preface?: string;       // AI 写的卷首题记（一两句）
  sourceCount?: number;   // 编纂时吃进去多少条实录（看压缩比）
}

const ROW_META_CAP = 4000;   // 纪要行索引上限：一条约 40B，4000 条 ≈ 160KB（压缩前）

interface ChronicleState {
  rowMeta: Record<string, RowMeta>;
  compiled: Record<string, CompiledVolume>;   // key = WorldRecord.id

  /** 纪要行落库时旁路记索引（幂等：同 row_id 覆盖）。 */
  noteRow: (rowId: string | number, meta: RowMeta) => void;
  /** 批量记（一次 set，避免逐行刷持久化）。 */
  noteRows: (items: { rowId: string | number; meta: RowMeta }[]) => void;
  setCompiled: (volumeId: string, v: CompiledVolume) => void;
  removeCompiled: (volumeId: string) => void;
  clearChronicle: () => void;   // 新游戏
}

export const useChronicle = create<ChronicleState>()(
  persist(
    (set): ChronicleState => ({
      rowMeta: {},
      compiled: {},

      noteRow: (rowId, meta) =>
        set((s) => ({ rowMeta: capMeta({ ...s.rowMeta, [String(rowId)]: meta }) })),

      noteRows: (items) =>
        set((s) => {
          if (!items.length) return {};
          const next = { ...s.rowMeta };
          for (const it of items) next[String(it.rowId)] = it.meta;
          return { rowMeta: capMeta(next) };
        }),

      setCompiled: (volumeId, v) => set((s) => ({ compiled: { ...s.compiled, [volumeId]: v } })),
      removeCompiled: (volumeId) =>
        set((s) => { const next = { ...s.compiled }; delete next[volumeId]; return { compiled: next }; }),

      clearChronicle: () => set({ rowMeta: {}, compiled: {} }),
    }),
    {
      name: 'drpg-chronicle',
      partialize: (s: any) => ({ rowMeta: s.rowMeta, compiled: s.compiled }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        rowMeta: typeof persisted?.rowMeta === 'object' && persisted.rowMeta ? persisted.rowMeta : {},
        compiled: typeof persisted?.compiled === 'object' && persisted.compiled ? persisted.compiled : {},
      }),
    },
  ),
);

/** 索引上限：超了就丢**最老的 row_id**（纪要表本身不删行，丢的只是分卷索引，那些行会降级进散佚卷而不是消失）。 */
function capMeta(m: Record<string, RowMeta>): Record<string, RowMeta> {
  const keys = Object.keys(m);
  if (keys.length <= ROW_META_CAP) return m;
  const sorted = keys.sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const out: Record<string, RowMeta> = {};
  for (const k of sorted.slice(sorted.length - ROW_META_CAP)) out[k] = m[k];
  return out;
}
