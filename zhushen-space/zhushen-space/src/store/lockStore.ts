import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ── 字段级锁定 / Pin（数据库引入①）──
   给某个实体的某个字段挂锁 → 演化闸门（drift-guard）对锁定字段**无条件退回基线**，
   连"有没有正文理由"都不判，锁了就钉死。专治"精心调好的数值，推几层楼就被 AI 改完了"。
   锁键统一用 `域:实体id:类别:字段` 字符串，前端 UI 与闸门共用下面的 lk* 构造器，保证拼法一致。*/

export type LockState = {
  locks: Record<string, true>;
  lock: (key: string) => void;
  unlock: (key: string) => void;
  toggle: (key: string) => void;
  isLocked: (key: string) => boolean;
  locksWithPrefix: (prefix: string) => string[];   // 列出某实体所有锁（如 `npc:C1:`）
  clearLocks: () => void;
};

export const useLocks = create<LockState>()(
  persist(
    (set, get): LockState => ({
      locks: {},
      lock: (key) => { if (key) set((s) => ({ locks: { ...s.locks, [key]: true } })); },
      unlock: (key) => set((s) => { const n = { ...s.locks }; delete n[key]; return { locks: n }; }),
      toggle: (key) => { if (!key) return; if (get().locks[key]) get().unlock(key); else get().lock(key); },
      isLocked: (key) => !!get().locks[key],
      locksWithPrefix: (prefix) => Object.keys(get().locks).filter((k) => k.startsWith(prefix)),
      clearLocks: () => set({ locks: {} }),
    }),
    { name: 'drpg-locks' },
  ),
);

/* ── 锁键构造器（UI + 闸门唯一来源，勿手拼字符串）── */
export const lkNpcAttr = (id: string, dim: string) => `npc:${id}:attr:${dim}`;
export const lkNpcField = (id: string, field: string) => `npc:${id}:field:${field}`;
export const lkPlayerAttr = (dim: string) => `player:attr:${dim}`;
export const lkPlayerField = (field: string) => `player:field:${field}`;
export const lkItemField = (id: string, field: string) => `item:${id}:field:${field}`;
export const lkFactionField = (id: string, field: string) => `faction:${id}:field:${field}`;
export const lkCharSkill = (charId: string, skillName: string, field: string) => `char:${charId}:skill:${skillName}:${field}`;
export const lkCharTrait = (charId: string, traitName: string, field: string) => `char:${charId}:trait:${traitName}:${field}`;

/* 非 React 上下文（闸门里）直接查锁 */
export const isLockedKey = (key: string) => useLocks.getState().isLocked(key);
