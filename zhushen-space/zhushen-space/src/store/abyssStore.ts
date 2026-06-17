import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  startRun, stepEnterRoom, applyBoon, descend, settleRun, corruptToFall,
  ABYSS_TUNING, type AbyssRun, type PlayerSnapshot,
} from '../systems/abyssEngine';
import type { AbyssLoot, BoonCard } from '../data/abyssData';
import { usePlayer } from './playerStore';
import { useItems, gradeToNum } from './itemStore';

/* ════════════════════════════════════════════
   深渊地牢 store（drpg-abyss）—— 设计见 指导/深渊地牢-堕落流-设计.md
   - run  = 进行中的单局（断点续存）；沙盒，撤退/死亡/通关后清空（§13.3）
   - meta = 跨周目永久（结晶/通关数/觉醒充能/解锁），唯一跨出沙盒的存档
   - 战利品(装备/原罪物/材料)+结晶 走结算白名单带出主线；加成/腐蚀永不外泄
════════════════════════════════════════════ */

export interface AbyssMeta {
  crystals: number;          // 堕落结晶
  deepestFloor: number;      // 最深层（全局层深）
  clearsCount: number;       // 通关累计
  awakenCharges: number;     // 觉醒充能（每 N 通关 +1）
  unlockedZones: number;     // 已解锁直达险地（M1 恒 1）
  endlessUnlocked: boolean;  // 无尽模式（M4）
  cardLibrary: BoonCard[];   // 卡牌库（M3）
  startDeck: string[];       // 起手卡组 id（M3）
}

const DEFAULT_META: AbyssMeta = {
  crystals: 0, deepestFloor: 0, clearsCount: 0, awakenCharges: 0,
  unlockedZones: 1, endlessUnlocked: false, cardLibrary: [], startDeck: [],
};

interface AbyssState {
  run: AbyssRun | null;
  meta: AbyssMeta;
  lastSettle: { note: string; crystals: number; carry: number; cleared: boolean } | null;

  /** 开一局：扣门票(乐园币) + 快照主角 → startRun。返回是否成功（余额不足返回 false）。 */
  start: () => boolean;
  /** 进入下一房间（自动结算战斗/事件）。 */
  enter: () => void;
  /** 战后三选一：选一张加成卡（并在 boss 层后自动下潜）。 */
  chooseBoon: (card: BoonCard) => void;
  /** 从回溯阵撤退（全额带出结算）。 */
  retreat: () => void;
  /** 确认死亡结算（保留 50%）。 */
  ackDeath: () => void;
  /** 确认通关结算。 */
  ackClear: () => void;
  /** 丢弃当前进行中的局（不结算，调试用）。 */
  abandon: () => void;
  clearLastSettle: () => void;
  /** clearProgress 用：清空 run + meta。 */
  clearAbyss: () => void;
}

/* 把引擎战利品带出主线（白名单 §13.3）：货币进钱包、物品/原罪物进背包 */
function carryLootToMainline(loot: AbyssLoot[]): void {
  const I = useItems.getState();
  for (const l of loot) {
    if (l.kind === 'currency') {
      if (l.name === '乐园币') I.adjustCurrency('乐园币', l.qty ?? 0);
      else if (l.name === '灵魂钱币') I.adjustCurrency('灵魂钱币', l.qty ?? 0);
      continue;
    }
    I.addItem({
      name: l.name,
      category: (l.category as any) ?? '其他物品',
      gradeDesc: l.quality ?? '',
      effect: l.effect ?? l.desc ?? '',
      quantity: Math.max(1, l.qty ?? 1),
      equipped: false,
      tags: l.sin ? ['原罪', '深渊'] : ['深渊'],
      acquisition: '深渊地牢',
      notes: l.sin ? '原罪物（深渊夺得，力量与诅咒并存）' : undefined,
    });
  }
}

function snapshotPlayer(): PlayerSnapshot {
  const p = usePlayer.getState().profile;
  const equipped = useItems.getState().items
    .filter((it) => it.equipped)
    .map((it) => ({ category: it.category as string, grade: gradeToNum(it.gradeDesc) }));
  return { name: p.name, attrs: p.attrs, level: p.level, tier: p.tier, equipped };
}

export const useAbyss = create<AbyssState>()(
  persist(
    (set, get) => ({
      run: null,
      meta: { ...DEFAULT_META },
      lastSettle: null,

      start: () => {
        if (get().run) return true;   // 已有进行中的局
        const I = useItems.getState();
        if ((I.currency.乐园币 ?? 0) < ABYSS_TUNING.ticketCost) return false;
        I.adjustCurrency('乐园币', -ABYSS_TUNING.ticketCost);
        set({ run: startRun(snapshotPlayer()), lastSettle: null });
        return true;
      },

      enter: () => {
        const run = get().run;
        if (!run || run.status !== 'exploring') return;
        const next = stepEnterRoom(run);
        set({ run: next, meta: { ...get().meta, deepestFloor: Math.max(get().meta.deepestFloor, next.globalDepth) } });
      },

      chooseBoon: (card) => {
        const run = get().run;
        if (!run || run.status !== 'choosingBoon') return;
        let next = applyBoon(run, card);
        // 若刚清掉的是「层主」（非区主）→ 自动下潜
        const room = next.map.rooms[next.posIdx];
        if (room?.type === 'boss' && next.floor < ABYSS_TUNING.floorsPerZone) {
          next = descend(next);
        }
        set({ run: next });
      },

      retreat: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'retreat');
        carryLootToMainline(r.carry);
        set((s) => ({
          run: null,
          lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: false },
          meta: { ...s.meta, crystals: s.meta.crystals + r.crystals, deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth) },
        }));
      },

      ackDeath: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'dead');
        carryLootToMainline(r.carry);
        set((s) => ({
          run: null,
          lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: false },
          meta: { ...s.meta, crystals: s.meta.crystals + r.crystals, deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth) },
        }));
      },

      ackClear: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'cleared');
        carryLootToMainline(r.carry);
        set((s) => {
          const clears = s.meta.clearsCount + 1;
          const awaken = s.meta.awakenCharges + (clears % ABYSS_TUNING.awakenEveryClears === 0 ? 1 : 0);
          return {
            run: null,
            lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: true },
            meta: {
              ...s.meta,
              crystals: s.meta.crystals + r.crystals,
              deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth),
              clearsCount: clears,
              awakenCharges: awaken,
              endlessUnlocked: true,
            },
          };
        });
      },

      abandon: () => set({ run: null }),
      clearLastSettle: () => set({ lastSettle: null }),
      clearAbyss: () => set({ run: null, meta: { ...DEFAULT_META }, lastSettle: null }),
    }),
    {
      name: 'drpg-abyss',
      partialize: (s) => ({ run: s.run, meta: s.meta }),
      merge: (persisted: any, current) => ({
        ...current,
        run: persisted?.run ?? null,
        meta: { ...DEFAULT_META, ...(persisted?.meta ?? {}) },
      }),
    },
  ),
);

/* 修正旧存档：腐蚀等级与腐蚀值一致 */
export function reconcileAbyssRun(): void {
  const run = useAbyss.getState().run;
  if (run && run.fallLevel !== corruptToFall(run.corruption)) {
    useAbyss.setState({ run: { ...run, fallLevel: corruptToFall(run.corruption) } });
  }
}
