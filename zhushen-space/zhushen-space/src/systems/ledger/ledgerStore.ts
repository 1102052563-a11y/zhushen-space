/* 演化账本（ledger）· 第0期
 *
 * 「物品演化底层重构」的地基之一：一条**只读、追加式**的事件流，记录闸门(applyItemCommands)
 * 对每条编辑做出的裁决（已应用 / 去重跳过 / 定位失败 / 异常）。带 turn + source + ref/uid + 原因。
 *
 * 第0期定位 = **审计 + 可查历史**（不是幂等的真相源——幂等用"状态判重"实现，见 stateParser.preflightItemEdit，
 * 这样回退/重开会随 store 状态自愈，无需清账本）。后续阶段可把它升级为"投影真相源"(事件→store)。
 *
 * 仅 entity:'item' 一种事件；扩到 NPC/角色等时复用同一结构（加 entity 取值即可）。
 * 持久化 drpg-ledger（纯文本、体积小），随存档快照(saveManager) + 新游戏清空(clear)。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LedgerEntity = 'item' | 'npc' | 'char' | 'faction' | 'territory' | 'team' | 'misc';
export type LedgerOutcome = 'applied' | 'dup' | 'fail' | 'error';

export interface LedgerEvent {
  seq: number;        // 单调递增序号
  turn: number;       // 游戏回合
  ts: number;         // 时间戳
  source: string;     // 写入方：narrative / item-phase / item-phase-retry / audit / auto …
  entity: LedgerEntity;
  op: string;         // create / consume / destroy / currency / equip / …
  ref?: string;       // AI 使用的人类可读引用（物品名/编号）
  uid?: string;       // 解析到的稳定实例 id
  outcome: LedgerOutcome;
  detail?: string;    // 原因 / 报错 / 最接近项
}

/** 事件环形缓冲上限（防 localStorage 膨胀）。*/
const CAP = 1200;

interface LedgerState {
  events: LedgerEvent[];
  seq: number;
  append: (e: Omit<LedgerEvent, 'seq' | 'ts'>) => void;
  eventsOfTurn: (turn: number) => LedgerEvent[];
  recent: (n?: number) => LedgerEvent[];
  purge: (fn: (e: LedgerEvent) => boolean) => void;   // 移除匹配事件（回合回滚/重生成时清掉作废的历史，防 history-based 去重误伤）
  clear: () => void;
}

export const useLedger = create<LedgerState>()(
  persist(
    (set, get): LedgerState => ({
      events: [],
      seq: 0,
      append: (e) =>
        set((s) => {
          const seq = s.seq + 1;
          const ev: LedgerEvent = { ...e, seq, ts: Date.now() };
          const next = [...s.events, ev];
          // 超出上限只保留最近 CAP 条（账本是审计辅助，旧事件可丢）
          const events = next.length > CAP ? next.slice(next.length - CAP) : next;
          return { events, seq };
        }),
      eventsOfTurn: (turn) => get().events.filter((e) => e.turn === turn),
      recent: (n = 100) => get().events.slice(-n),
      purge: (fn) => set((s) => ({ events: s.events.filter((e) => !fn(e)) })),
      clear: () => set({ events: [], seq: 0 }),
    }),
    { name: 'drpg-ledger' },
  ),
);
