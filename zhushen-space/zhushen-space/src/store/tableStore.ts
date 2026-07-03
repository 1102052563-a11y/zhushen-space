/* ── ACU 表格数据库 · 运行时 store（drpg-tables）──────────────────────────
   持有 Record<uid, AcuSheet>，对 content 二维数组做增删改查。
   写入语义照抄 ACU（table-edit-parser）：
     · 行号(rowIndex) = 0 基数据行号；实际 content 下标 = rowIndex+1（content[0] 是表头）。
     · data 对象按「列索引」(0 基，跳过 row_id) 或「中文列名」为键，两者都认。
     · insertRow 新 row_id = String(content.length)（表头占 0，首条数据行 row_id="1"）。
     · 单行表禁 insert/delete，只 updateRow(0,...)。
   这是「表为单一真相」的权威持久层；后续 stateParser 写、stMacros 读、面板编辑都走这里。
   设计文档：`指导/ACU星数据库-移植-设计.md` §6 Step 2。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildDefaultTables, type AcuSheet, type AcuTableData } from '../systems/acuTableSpec';

/** 一行数据解析成 { 列名: 值, row_id }。 */
export type RowObject = Record<string, string>;

interface TableState {
  tables: AcuTableData;

  // ── 读 ──
  /** 取一张表。 */
  getSheet: (uid: string) => AcuSheet | undefined;
  /** 按 orderNo 排序的表数组（= ACU 的 tableIndex 顺序）。 */
  sortedSheets: () => AcuSheet[];
  /** 表的列名（不含 row_id）。 */
  headersOf: (uid: string) => string[];
  /** 数据行（不含表头），每行转成 { 列名: 值, row_id }。 */
  rows: (uid: string) => RowObject[];
  /** 取单元格：rowIndex 0 基，col 可传列名或列索引(0 基)。 */
  getCell: (uid: string, rowIndex: number, col: string | number) => string | undefined;
  /** 简单查询：可选 where { 列名: 值 } 精确匹配，返回行对象数组。 */
  query: (uid: string, where?: Record<string, string>) => RowObject[];

  // ── 写（ACU 语义）──
  /** 新增一行。data 按列索引或列名为键。单行表已有数据则拒绝。返回新行的 rowIndex，失败返回 -1。 */
  insertRow: (uid: string, data: Record<string, string>) => number;
  /** 改一行。data 只需含要改的列（列索引或列名）。 */
  updateRow: (uid: string, rowIndex: number, data: Record<string, string>) => boolean;
  /** 改一个单元格。 */
  updateCell: (uid: string, rowIndex: number, col: string | number, value: string) => boolean;
  /** 删一行。单行表拒绝。 */
  deleteRow: (uid: string, rowIndex: number) => boolean;
  /** 批量替换一张多行表的**全部数据行**（一次 set·高性能·投影每回合用）。row_id 重排 1..N。单行表拒绝。返回写入行数，失败 -1。 */
  replaceRows: (uid: string, rows: Record<string, string>[]) => number;

  // ── 表管理 / 持久化 ──
  /** 加/替换一张表定义。 */
  upsertSheet: (sheet: AcuSheet) => void;
  /** 删一张表。 */
  removeSheet: (uid: string) => void;
  /** 整库重置为默认表。 */
  resetAll: () => void;
  /** 整库替换（迁移/导入用）。 */
  replaceAll: (tables: AcuTableData) => void;
  /** 导出快照（configExport/saveManager 用）。 */
  exportSnapshot: () => AcuTableData;
  /** 导入快照。 */
  importSnapshot: (tables: AcuTableData) => void;
}

/** 解析列键（列名或 0 基列索引）→ 0 基列索引；找不到返回 -1。 */
function resolveColIndex(headers: string[], col: string | number): number {
  if (typeof col === 'number') return Number.isInteger(col) && col >= 0 && col < headers.length ? col : -1;
  const s = String(col).trim();
  if (/^\d+$/.test(s)) {
    const i = parseInt(s, 10);
    return i >= 0 && i < headers.length ? i : -1;
  }
  return headers.indexOf(s);
}

/** 从一行 content（含 row_id）+ 表头造行对象。 */
function toRowObject(headers: string[], row: string[]): RowObject {
  const obj: RowObject = { row_id: row[0] ?? '' };
  headers.forEach((h, i) => { obj[h] = row[i + 1] ?? ''; });
  return obj;
}

/** 从 data（列索引或列名为键）按表头顺序取第 i 列的值。 */
function pickCol(data: Record<string, string>, headers: string[], i: number): string {
  const h = headers[i];
  const byIndex = data[i as unknown as string] ?? data[String(i)];
  const byName = h != null ? data[h] : undefined;
  const v = byIndex ?? byName;
  return v == null ? '' : String(v);
}

const emptyHeaders: string[] = [];

/** 行对象数组 → 完整 content（含表头·row_id 重排 1..N）。纯函数，供投影一次性重建多表用（避免逐表 set 多次 persist）。 */
export function rowsToContent(header: string[], rowObjs: Record<string, string>[]): string[][] {
  const headers = header.slice(1);
  return [header, ...rowObjs.map((d, i) => [String(i + 1), ...headers.map((_h, ci) => pickCol(d, headers, ci))])];
}

/** 表结构演进（持久化 migrate 用·纯函数便于测试）：以最新默认表结构为准，把旧表按**列名**重映射进新表头
   （新列留空、旧数据一律不丢、行序保留），用户自建的非默认表原样保留。 */
export function evolveTables(oldTables: AcuTableData): AcuTableData {
  const fresh = buildDefaultTables();
  const merged: AcuTableData = {};
  for (const [uid, freshSheet] of Object.entries(fresh)) {
    const old = oldTables[uid];
    if (!old?.content?.length) { merged[uid] = freshSheet; continue; }
    const freshHeader = freshSheet.content[0];
    const freshCols = freshHeader.slice(1);
    const oldCols = (old.content[0] ?? []).slice(1);
    const dataRows = old.content.slice(1).map((r, i) => [
      String(i + 1),
      ...freshCols.map((h) => { const oi = oldCols.indexOf(h); return oi >= 0 ? (r[oi + 1] ?? '') : ''; }),
    ]);
    merged[uid] = { ...freshSheet, content: [freshHeader, ...dataRows] };
  }
  for (const [uid, sheet] of Object.entries(oldTables)) if (!merged[uid]) merged[uid] = sheet;   // 保留用户自建表
  return merged;
}

export const useTables = create<TableState>()(
  persist(
    (set, get): TableState => ({
      tables: buildDefaultTables(),

      getSheet: (uid) => get().tables[uid],

      sortedSheets: () =>
        Object.values(get().tables).sort((a, b) => a.orderNo - b.orderNo),

      headersOf: (uid) => {
        const sheet = get().tables[uid];
        if (!sheet || !sheet.content[0]) return emptyHeaders;
        return sheet.content[0].slice(1);
      },

      rows: (uid) => {
        const sheet = get().tables[uid];
        if (!sheet) return [];
        const headers = sheet.content[0]?.slice(1) ?? [];
        return sheet.content.slice(1).map((row) => toRowObject(headers, row));
      },

      getCell: (uid, rowIndex, col) => {
        const sheet = get().tables[uid];
        if (!sheet) return undefined;
        const headers = sheet.content[0]?.slice(1) ?? [];
        const ci = resolveColIndex(headers, col);
        if (ci < 0) return undefined;
        const row = sheet.content[rowIndex + 1];
        return row ? row[ci + 1] : undefined;
      },

      query: (uid, where) => {
        const all = get().rows(uid);
        if (!where || Object.keys(where).length === 0) return all;
        const entries = Object.entries(where);
        return all.filter((r) => entries.every(([k, v]) => String(r[k] ?? '') === String(v)));
      },

      insertRow: (uid, data) => {
        const sheet = get().tables[uid];
        if (!sheet) { console.warn(`[tableStore] insertRow: 表不存在 ${uid}`); return -1; }
        const headers = sheet.content[0]?.slice(1) ?? [];
        if (sheet.single && sheet.content.length > 1) {
          console.warn(`[tableStore] insertRow 被拒：${sheet.name} 是单行表，请用 updateRow(0,...)`);
          return -1;
        }
        const newRowId = String(sheet.content.length); // 表头占 [0]
        const newRow = [newRowId, ...headers.map((_h, i) => pickCol(data, headers, i))];
        const rowIndex = sheet.content.length - 1; // 0 基数据行号
        set((s) => ({
          tables: { ...s.tables, [uid]: { ...sheet, content: [...sheet.content, newRow] } },
        }));
        return rowIndex;
      },

      updateRow: (uid, rowIndex, data) => {
        const sheet = get().tables[uid];
        if (!sheet) return false;
        const headers = sheet.content[0]?.slice(1) ?? [];
        const target = sheet.content[rowIndex + 1];
        if (!target) return false;
        const newRow = [...target];
        headers.forEach((h, i) => {
          const has = data[i as unknown as string] ?? data[String(i)] ?? data[h];
          if (has !== undefined) newRow[i + 1] = String(has);
        });
        const newContent = sheet.content.map((r, idx) => (idx === rowIndex + 1 ? newRow : r));
        set((s) => ({ tables: { ...s.tables, [uid]: { ...sheet, content: newContent } } }));
        return true;
      },

      updateCell: (uid, rowIndex, col, value) => {
        const sheet = get().tables[uid];
        if (!sheet) return false;
        const headers = sheet.content[0]?.slice(1) ?? [];
        const ci = resolveColIndex(headers, col);
        if (ci < 0 || !sheet.content[rowIndex + 1]) return false;
        const newRow = [...sheet.content[rowIndex + 1]];
        newRow[ci + 1] = String(value);
        const newContent = sheet.content.map((r, idx) => (idx === rowIndex + 1 ? newRow : r));
        set((s) => ({ tables: { ...s.tables, [uid]: { ...sheet, content: newContent } } }));
        return true;
      },

      deleteRow: (uid, rowIndex) => {
        const sheet = get().tables[uid];
        if (!sheet) return false;
        if (sheet.single) { console.warn(`[tableStore] deleteRow 被拒：${sheet.name} 是单行表`); return false; }
        if (!sheet.content[rowIndex + 1]) return false;
        const newContent = sheet.content.filter((_r, idx) => idx !== rowIndex + 1);
        set((s) => ({ tables: { ...s.tables, [uid]: { ...sheet, content: newContent } } }));
        return true;
      },

      replaceRows: (uid, rowsData) => {
        const sheet = get().tables[uid];
        if (!sheet) { console.warn(`[tableStore] replaceRows: 表不存在 ${uid}`); return -1; }
        if (sheet.single) { console.warn(`[tableStore] replaceRows 被拒：${sheet.name} 是单行表`); return -1; }
        const header = sheet.content[0] ?? ['row_id'];
        const headers = header.slice(1);
        const dataRows = rowsData.map((d, i) => [String(i + 1), ...headers.map((_h, ci) => pickCol(d, headers, ci))]);
        set((s) => ({ tables: { ...s.tables, [uid]: { ...sheet, content: [header, ...dataRows] } } }));
        return dataRows.length;
      },

      upsertSheet: (sheet) =>
        set((s) => ({ tables: { ...s.tables, [sheet.uid]: sheet } })),

      removeSheet: (uid) =>
        set((s) => {
          const next = { ...s.tables };
          delete next[uid];
          return { tables: next };
        }),

      resetAll: () => set({ tables: buildDefaultTables() }),

      replaceAll: (tables) => set({ tables }),

      exportSnapshot: () => get().tables,

      importSnapshot: (tables) => set({ tables }),
    }),
    {
      name: 'drpg-tables',
      version: 8,
      /* 结构演进（…v5→v6 加 NPC明细表 + 重要角色表补标量；v6→v7 重要角色表加真实六维列·六维改回基础值；
         v7→v8 加 3 张剧情记忆表：进程/伏笔/约定表·AI 维护·非镜像）。
         `evolveTables` 幂等：以最新 buildDefaultTables() 为准，按**列名**把旧行重映射进新表头 →
         新表补齐、新列留空、旧数据一律不丢、用户自建表保留。加表/加列后 bump version 即可让老存档自动补上。 */
      migrate: (persisted: unknown, version: number): { tables: AcuTableData } => {
        const p = persisted as { tables?: AcuTableData } | null;
        if (!p || typeof p !== 'object') return { tables: buildDefaultTables() };
        if (version >= 8) return { tables: p.tables ?? buildDefaultTables() };
        return { tables: evolveTables(p.tables ?? {}) };   // 结构演进（列名重映射·数据不丢·见 evolveTables）
      },
    }
  )
);
