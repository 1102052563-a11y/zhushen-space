/* ── ACU 表格数据库 · 表编辑日志（drpg-table-journal）────────────────────────
   给 `<tableEdit>` 写路径补三件事（对齐"数据库=图书馆只存不删"铁则 + 事件溯源审计思路）：
   1. **幂等**：同一回合同一批填表指令的摘要(digest)只应用一次——同会话重复应用(意外双调/重复 settle)=no-op。
      注意：重生成/回退/重算变量走「回退点 loadSlot→reload」全量恢复(含本 store)，恢复后摘要也随之回退，
      重放同一批指令**不会**被误判为重复——一致性由 saveManager STORES 注册保证。
   2. **审计流水**：每条 insert/update/delete 记 before/after 行镜像 →"这回合表改了什么"永远可查(回合事务报告用)。
   3. **删除找回**：deleteRow 的整行镜像在此保底，restoreDeleted 一键放回原位（含原 row_id·防二次恢复重复）。
   另存 lastErrors(上回合填表失败清单)，供 buildTableFillPrompt 下回合回喂 AI 自纠（零额外 API 调用）。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';
import { useTables } from './tableStore';

export interface TableEditLogEntry {
  id: number;                                      // 递增序号（restoreDeleted 按它定位）
  turn: number;                                    // 回合号（无从得知时 -1）
  uid: string;                                     // 表 uid
  sheetName: string;                               // 表中文名（展示用）
  command: 'insertRow' | 'updateRow' | 'deleteRow';
  rowId: string;                                   // 涉及行的永久编号（row_id）
  pos: number;                                     // 操作时的 0 基行号（restore 放回原位用）
  before: string[] | null;                         // 整行镜像（含 row_id）：update/delete 记，insert=null
  after: string[] | null;                          // 整行镜像：insert/update 记，delete=null
  restored?: boolean;                              // 被删行已通过 restoreDeleted 放回
}

const ENTRY_CAP = 300;    // 流水封顶（进度数据·随存档快照，别无限涨）
const DIGEST_CAP = 80;    // 幂等摘要封顶（只需覆盖近期回合；回退点恢复会整体回卷）

/** 轻量字符串摘要（djb2）：给"回合号|指令批原文"算幂等键，无需加密强度。 */
export function tableEditDigest(turn: number, rawCmds: string[]): string {
  const s = `${turn}|${rawCmds.join('\n')}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${turn}:${(h >>> 0).toString(36)}:${s.length}`;
}

interface TableJournalState {
  entries: TableEditLogEntry[];
  digests: string[];        // 已应用的指令批摘要（幂等判重）
  lastErrors: string[];     // 最近一次填表的失败清单（下回合回喂 AI 自纠；成功批会清空）
  lastErrorsTurn: number;
  seq: number;

  /** 指令批是否已应用过（幂等判重）。 */
  wasApplied: (digest: string) => boolean;
  /** 登记已应用的指令批摘要。 */
  markApplied: (digest: string) => void;
  /** 追加一批编辑流水（应用成功的每条一记）。 */
  record: (list: Omit<TableEditLogEntry, 'id'>[]) => void;
  /** 覆盖式记录本批失败清单（空数组=清空·成功批调它清旧账）。 */
  setLastErrors: (errors: string[], turn: number) => void;
  /** 把一条 deleteRow 流水的整行放回原表原位（含原 row_id）。成功返回 true 并标记 restored。 */
  restoreDeleted: (entryId: number) => boolean;
  /** 清空（新游戏/重置用）。 */
  clear: () => void;
}

export const useTableJournal = create<TableJournalState>()(
  persist(
    (set, get): TableJournalState => ({
      entries: [],
      digests: [],
      lastErrors: [],
      lastErrorsTurn: -1,
      seq: 0,

      wasApplied: (digest) => get().digests.includes(digest),

      markApplied: (digest) =>
        set((s) => ({ digests: [...s.digests.slice(-(DIGEST_CAP - 1)), digest] })),

      record: (list) =>
        set((s) => {
          let seq = s.seq;
          const withIds = list.map((e) => ({ ...e, id: ++seq }));
          return { seq, entries: [...s.entries, ...withIds].slice(-ENTRY_CAP) };
        }),

      setLastErrors: (errors, turn) => set({ lastErrors: errors.slice(0, 12), lastErrorsTurn: turn }),

      restoreDeleted: (entryId) => {
        const entry = get().entries.find((e) => e.id === entryId);
        if (!entry || entry.command !== 'deleteRow' || !entry.before || entry.restored) return false;
        const ok = useTables.getState().restoreRow(entry.uid, entry.before, entry.pos);
        if (ok) set((s) => ({ entries: s.entries.map((e) => (e.id === entryId ? { ...e, restored: true } : e)) }));
        return ok;
      },

      clear: () => set({ entries: [], digests: [], lastErrors: [], lastErrorsTurn: -1, seq: 0 }),
    }),
    { name: 'drpg-table-journal', version: 1, storage: lzStorage() }
  )
);
