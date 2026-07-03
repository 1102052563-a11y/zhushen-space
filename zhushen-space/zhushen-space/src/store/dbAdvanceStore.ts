/* 数据库推进管线 · store（Stitches 格式推进预设 + 运行态）───────────────────
   preset/config 持久化（drpg-dbadvance·全局·不进存档快照，免 50KB×每档）；
   运行态 lastTabletop/stage/scene/recall 仅内存（partialize 排除）——reload/新游戏自然清空，
   跨回合在同一会话内传递 {{tabletop}}。编排见 App.tsx runDbAdvancePipeline。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseDbAdvancePreset, type DbAdvancePreset } from '../systems/dbAdvancePreset';

interface DbAdvanceState {
  preset: DbAdvancePreset | null;   // 解析后的活动推进预设（Stitches 等）
  presetName: string;
  enabled: boolean;                 // 启用管线：正文前跑「召回→推进」规划层，产出注入正文预设
  useRecall: boolean;               // 是否跑「召回」子调用（关＝跳过·省一次调用·{{recall}} 留空）
  // ── 运行态（仅内存·partialize 排除持久化）──
  lastTabletop: string;             // 上轮 <tabletop> → 本轮 {{tabletop}}
  lastStage: string; lastScene: string; lastRecall: string;   // 最近产出（注入正文 + 诊断）

  importPreset: (raw: unknown, name?: string) => boolean;
  setEnabled: (v: boolean) => void;
  setUseRecall: (v: boolean) => void;
  setOutputs: (o: { tabletop?: string; stage?: string; scene?: string; recall?: string }) => void;
  clearRuntime: () => void;         // 清上轮产出（新剧情线/手动重置用；保留预设+配置）
  clearPreset: () => void;
}

export const useDbAdvance = create<DbAdvanceState>()(
  persist(
    (set) => ({
      preset: null, presetName: '', enabled: false, useRecall: true,
      lastTabletop: '', lastStage: '', lastScene: '', lastRecall: '',

      importPreset: (raw, name) => {
        const p = parseDbAdvancePreset(raw);
        if (!p) return false;
        set({ preset: p, presetName: name || p.name });
        return true;
      },
      setEnabled: (v) => set({ enabled: v }),
      setUseRecall: (v) => set({ useRecall: v }),
      setOutputs: (o) => set((s) => ({
        lastTabletop: o.tabletop !== undefined ? o.tabletop : s.lastTabletop,
        lastStage: o.stage !== undefined ? o.stage : s.lastStage,
        lastScene: o.scene !== undefined ? o.scene : s.lastScene,
        lastRecall: o.recall !== undefined ? o.recall : s.lastRecall,
      })),
      clearRuntime: () => set({ lastTabletop: '', lastStage: '', lastScene: '', lastRecall: '' }),
      clearPreset: () => set({ preset: null, presetName: '' }),
    }),
    {
      name: 'drpg-dbadvance',
      // 仅持久化预设与配置；运行态（tabletop/stage/scene/recall）留内存，reload/新游戏自然清空
      partialize: (s) => ({ preset: s.preset, presetName: s.presetName, enabled: s.enabled, useRecall: s.useRecall }),
    },
  ),
);
