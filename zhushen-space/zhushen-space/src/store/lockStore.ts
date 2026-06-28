import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ── 字段级锁定 / Pin（数据库引入①）──
   给某个实体的某个字段挂锁 → 锁定时**快照其当前值**，之后每回合 enforceLocks() **无条件把它钉回锁定值**，
   不管是主正文还是演化阶段改的、也不管"有没有正文理由"。专治"精心调好的数值/锁住的物品，推几层楼就被 AI 改了"。
   （旧版只靠 drift-guard 退回"回合初快照"，但快照在主正文改完之后才抓→主正文直接改锁定物时拦不住；改成存值钉死才真锁得住。）
   锁键统一用 `域:实体id:类别:字段` 字符串，前端 UI 与闸门共用下面的 lk* 构造器，保证拼法一致。*/

export interface LockEntry { v?: any }   // v = 锁定时的值快照（enforceLocks 据此钉死）；旧档可能是 true（无值，退回快照兜底）
export type LockState = {
  locks: Record<string, LockEntry | true>;
  lock: (key: string, value?: any) => void;          // value = 锁定瞬间的当前值（由 UI 传入）
  unlock: (key: string) => void;
  toggle: (key: string, value?: any) => void;
  isLocked: (key: string) => boolean;
  lockedValue: (key: string) => any;                 // 取锁定值（无值/旧式锁返回 undefined）
  locksWithPrefix: (prefix: string) => string[];     // 列出某实体所有锁（如 `npc:C1:`）
  clearLocks: () => void;
};

export const useLocks = create<LockState>()(
  persist(
    (set, get): LockState => ({
      locks: {},
      lock: (key, value) => { if (key) set((s) => ({ locks: { ...s.locks, [key]: { v: value } } })); },
      unlock: (key) => set((s) => { const n = { ...s.locks }; delete n[key]; return { locks: n }; }),
      toggle: (key, value) => { if (!key) return; if (get().locks[key]) get().unlock(key); else get().lock(key, value); },
      isLocked: (key) => !!get().locks[key],
      lockedValue: (key) => { const e = get().locks[key]; return e && typeof e === 'object' ? e.v : undefined; },
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
export const lockedValueOf = (key: string) => useLocks.getState().lockedValue(key);
