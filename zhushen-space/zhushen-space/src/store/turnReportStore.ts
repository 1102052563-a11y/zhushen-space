/* ── 回合级变量事务报告（内存态·不持久化）───────────────────────────────────
   把每次 applyAllUpdates 的结果收成一条可见记录：<state> 应用/失败明细、物品指令应用/拦截、
   填表应用/失败/幂等跳过、看门狗漂移快照——替代散落 console.warn，玩家在表格数据库页一眼看到
   "这回合变量动了什么、拦了什么、哪里失败了"，出错当回合就能发现（配合回退点当场回退）。
   刻意不持久化：这是诊断视图不是数据源；历史追溯走 演化账本(drpg-ledger)+表编辑日志(drpg-table-journal)。 */
import { create } from 'zustand';

export interface TurnApplyRecord {
  id: number;
  turn: number;              // 回合号（调用方没传 ctx 时 -1）
  source: string;            // 来源阶段（narrative / item-phase / …）
  at: number;                // 时间戳（展示用）
  stateApplied: number;      // <state> 成功应用条数
  stateFailed: string[];     // <state> 失败明细（key + 原因）
  itemApplied: number;       // 物品指令闸门放行条数
  itemRejected: string[];    // 物品指令未生效明细（not_found / dup …）
  itemBlocked: number;       // 拦截的 createItem/货币（奖励预告守卫 + 设施已发放抑制）
  tableApplied: number;      // 填表指令应用条数
  tableFailed: string[];     // 填表失败明细
  tableSkippedDup: boolean;  // 本批填表被幂等跳过（同回合重复应用）
  drift: string[];           // 应用后的看门狗违规快照（域：明细）
}

const CAP = 40;

interface TurnReportState {
  records: TurnApplyRecord[];
  seq: number;
  push: (r: Omit<TurnApplyRecord, 'id' | 'at'>) => void;
  clear: () => void;
}

export const useTurnReport = create<TurnReportState>()((set) => ({
  records: [],
  seq: 0,
  push: (r) =>
    set((s) => {
      const id = s.seq + 1;
      return { seq: id, records: [...s.records, { ...r, id, at: Date.now() }].slice(-CAP) };
    }),
  clear: () => set({ records: [], seq: 0 }),
}));

/** 一条记录是否"有事发生"（无事的阶段回复不进报告，防刷屏）。 */
export function recordHasActivity(r: Omit<TurnApplyRecord, 'id' | 'at'>): boolean {
  return (
    r.stateApplied > 0 || r.stateFailed.length > 0 ||
    r.itemApplied > 0 || r.itemRejected.length > 0 || r.itemBlocked > 0 ||
    r.tableApplied > 0 || r.tableFailed.length > 0 || r.tableSkippedDup
  );
}
