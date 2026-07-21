import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EquipSetDef, PendingEquipSetDef } from '../systems/equipSets';

/* ════════════════════════════════════════════
   装备套装 store（drpg-equipsets）——合成工坊「套装锻造」产出的套装定义。
   - sets：本局锻造出的套装列表；部件（InventoryItem.equipSet）按 key 引用。
   - 属**进度侧**（与 drpg-items 里的部件强耦合）：随存档快照、新游戏清空、读旧档缺失即清（saveManager 注册）。
   - AI 调用不在此（走 runCraftPhase / featureKey 'craft'），故无独立 Api 字段（apiSlots 免扫）。
════════════════════════════════════════════ */

let _seq = Date.now();
function mkKey(existing: EquipSetDef[]): string {
  let k = '';
  do { k = 'es' + (_seq++).toString(36); } while (existing.some((s) => s.key === k));
  return k;
}

interface EquipSetState {
  sets: EquipSetDef[];

  addSet: (def: PendingEquipSetDef) => string;   // 追加一套（补稳定 key/createdAt），返回 key
  upsertSet: (def: EquipSetDef) => void;
  removeSet: (key: string) => void;
  clearAll: () => void;
}

export const useEquipSets = create<EquipSetState>()(
  persist(
    (set, get): EquipSetState => ({
      sets: [],

      addSet: (def) => {
        const key = mkKey(get().sets);
        set((s) => ({ sets: [...s.sets, { ...def, key, createdAt: Date.now() }] }));
        return key;
      },
      upsertSet: (def) => set((s) => {
        const i = s.sets.findIndex((x) => x.key === def.key);
        if (i < 0) return { sets: [...s.sets, def] };
        const next = s.sets.slice(); next[i] = def; return { sets: next };
      }),
      removeSet: (key) => set((s) => ({ sets: s.sets.filter((x) => x.key !== key) })),
      clearAll: () => set({ sets: [] }),
    }),
    {
      name: 'drpg-equipsets',
      partialize: (s) => ({ sets: s.sets }),
      merge: (persisted: any, current) => ({
        ...current,
        sets: Array.isArray(persisted?.sets) ? persisted.sets : current.sets,
      }),
    },
  ),
);
