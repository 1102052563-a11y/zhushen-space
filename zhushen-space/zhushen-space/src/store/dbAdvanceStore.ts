/* 数据库推进管线 · store（Stitches 格式推进预设 + 运行态）───────────────────
   preset/config + 运行态 lastTabletop/stage/scene/recall 都持久化（drpg-dbadvance）。
   **一键两域**（2026-08-07）：预设/开关=全局配置（读档不回滚）；运行态=本时间线记忆（读档/回退**跟着回滚**）——
   已登记进 saveManager.STORES，回滚规则见 systems/dbAdvanceRuntime.ts（原来整个 store 不进快照，
   导致回档后推进还拿着被回退掉那几回合的桌面态、"还记着之前内容"）。
   **运行态也持久化**（2026-07-03·用户报「关了再开/刷新就记忆断层」）：桌面态 {{tabletop}} 是跨回合传递的表状态，
   原来只存内存、刷新即清 → 再开推进从空桌面起步、最近这段表记忆断了。现随 drpg-dbadvance 持久化（用 lzStorage 压缩存，
   桌面态可能不小、且用户刚爆过 localStorage 配额），刷新后接着上次的表推进。**新游戏由 clearProgress 显式 clearRuntime**
   （不再靠"内存态 reload 自然清"，因为现在持久化了）。编排见 App.tsx runDbAdvancePipeline。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';   // 桌面态压缩存·不占 localStorage 配额
import { parseDbAdvancePreset, type DbAdvancePreset } from '../systems/dbAdvancePreset';

/** 等待上限夹取：15~600 秒；非法值(NaN/旧档缺省)回默认 120。管线与设置面板共用同一口径。 */
export function clampWaitSec(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(15, Math.min(600, n)) : 120;
}

interface DbAdvanceState {
  preset: DbAdvancePreset | null;   // 解析后的活动推进预设（Stitches 等）
  presetName: string;
  enabled: boolean;                 // 启用管线：正文前跑「召回→推进」规划层，产出注入正文预设
  useRecall: boolean;               // 是否跑「召回」子调用（关＝跳过·省一次调用·{{recall}} 留空）
  waitSec: number;                  // 「召回/推进」每次子调用的等待上限(秒)——超时中止该次调用并跳过。慢速中转/思考模型总时长常超旧写死的 45s（用户报「前端已判空回、后台还在流式生成」），故做成可调；范围 15~600
  // ── 运行态（仅内存·partialize 排除持久化）──
  lastTabletop: string;             // 上轮 <tabletop> → 本轮 {{tabletop}}
  lastStage: string; lastScene: string; lastRecall: string;   // 最近产出（注入正文 + 诊断）

  importPreset: (raw: unknown, name?: string) => boolean;
  setEnabled: (v: boolean) => void;
  setUseRecall: (v: boolean) => void;
  setWaitSec: (v: number) => void;
  setOutputs: (o: { tabletop?: string; stage?: string; scene?: string; recall?: string }) => void;
  clearRuntime: () => void;         // 清上轮产出（新剧情线/手动重置用；保留预设+配置）
  clearPreset: () => void;
  setPreset: (preset: DbAdvancePreset) => void;   // 预设编辑器保存·直接写回解析后的预设（缝破限/改模块提示词用）
}

export const useDbAdvance = create<DbAdvanceState>()(
  persist(
    (set) => ({
      preset: null, presetName: '', enabled: false, useRecall: true, waitSec: 120,
      lastTabletop: '', lastStage: '', lastScene: '', lastRecall: '',

      importPreset: (raw, name) => {
        const p = parseDbAdvancePreset(raw);
        if (!p) return false;
        set({ preset: p, presetName: name || p.name });
        return true;
      },
      setEnabled: (v) => set({ enabled: v }),
      setUseRecall: (v) => set({ useRecall: v }),
      setWaitSec: (v) => set({ waitSec: clampWaitSec(v) }),
      setOutputs: (o) => set((s) => ({
        lastTabletop: o.tabletop !== undefined ? o.tabletop : s.lastTabletop,
        lastStage: o.stage !== undefined ? o.stage : s.lastStage,
        lastScene: o.scene !== undefined ? o.scene : s.lastScene,
        lastRecall: o.recall !== undefined ? o.recall : s.lastRecall,
      })),
      clearRuntime: () => set({ lastTabletop: '', lastStage: '', lastScene: '', lastRecall: '' }),
      clearPreset: () => set({ preset: null, presetName: '' }),
      setPreset: (preset) => set({ preset, presetName: preset.name || '（已编辑）' }),
    }),
    {
      name: 'drpg-dbadvance',
      storage: lzStorage(),   // 压缩存：桌面态 tabletop 可能不小，别占 localStorage 配额（用户刚爆过 quota）
      // 预设/配置 + 运行态一起持久化，让「桌面态刷新/关开不丢」——运行态在新游戏时由 clearProgress 显式 clearRuntime 清掉
      partialize: (s) => ({
        preset: s.preset, presetName: s.presetName, enabled: s.enabled, useRecall: s.useRecall, waitSec: s.waitSec,
        lastTabletop: s.lastTabletop, lastStage: s.lastStage, lastScene: s.lastScene, lastRecall: s.lastRecall,
      }),
    },
  ),
);
