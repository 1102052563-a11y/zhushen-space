import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ══════════ 表行·世界归属旁路索引 · drpg-row-scope ══════════
   给「AI 原生填写的表」（伏笔表等，非 13 张镜像表）补一个 row_id → 所属世界 的**旁路**索引。

   为什么不给表加一列「所属世界」：
     · 这类表的内容是 AI 直接写的，多一列就多一个它会填错/漏填/拿去推理的字段；
     · 改表结构要动 acuTableSpec + ddl + 迁移 + 提示词，面大风险高；
     · 项目已有同款先例并写明了取舍——见 chronicleStore.rowMeta 头注释
       「不改表结构、不污染 AI 看到的表内容」。这里照抄那套思路，只是换成世界归属。

   key = `${uid}:${rowId}`（**必须带表前缀**：row_id 是每张表各自从 1 递增的，裸 id 会跨表撞车）。

   ⚠ 查不到索引 ⇒ **一律当作"不确定"并保留可见**，绝不误藏：
     老存档的历史行、玩家在表格管理里手动加的行都没有索引，宁可多显示，不可把人家的伏笔弄没。 */

const CAP = 4000;   // 一条约 40B，4000 条 ≈ 160KB（压缩前）

export interface RowScope {
  world?: string;
  turn?: number;
}

function keyOf(uid: string, rowId: string | number): string {
  return `${uid}:${rowId}`;
}

interface RowScopeState {
  scopes: Record<string, RowScope>;
  note: (uid: string, rowId: string | number, meta: RowScope) => void;
  noteMany: (items: { uid: string; rowId: string | number; meta: RowScope }[]) => void;
  /** 该行记录的所属世界；没索引 → undefined（调用方按「不确定→保留」处理）。 */
  worldOf: (uid: string, rowId: string | number) => string | undefined;
  clearRowScopes: () => void;
}

function cap(map: Record<string, RowScope>): Record<string, RowScope> {
  const keys = Object.keys(map);
  if (keys.length <= CAP) return map;
  const out: Record<string, RowScope> = {};
  for (const k of keys.slice(-CAP)) out[k] = map[k];
  return out;
}

export const useRowScope = create<RowScopeState>()(
  persist(
    (set, get): RowScopeState => ({
      scopes: {},

      note: (uid, rowId, meta) =>
        set((s) => ({ scopes: cap({ ...s.scopes, [keyOf(uid, rowId)]: meta }) })),

      noteMany: (items) =>
        set((s) => {
          if (!items.length) return {};
          const next = { ...s.scopes };
          for (const it of items) next[keyOf(it.uid, it.rowId)] = it.meta;
          return { scopes: cap(next) };
        }),

      worldOf: (uid, rowId) => get().scopes[keyOf(uid, rowId)]?.world || undefined,
      clearRowScopes: () => set({ scopes: {} }),
    }),
    { name: 'drpg-row-scope' },
  ),
);

export { CAP as ROW_SCOPE_CAP, keyOf as rowScopeKey };
