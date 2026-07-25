import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  BUILTIN_PROCESSES, sanitizeProcess, affixName, gradeNumOfEssence,
  type CraftProcessDef, type EssenceEntry,
} from '../systems/equipCraft';

/* ════════════════════════════════════════════
   装备工艺 store（drpg-equipcraft）

   两类数据、两种生命周期（照 drpg-skilltree「模板是配置、进度随存档」的既有口径）：
   · processes 工艺库（内置 3 条 + 玩家 AI 自创）＝**配置**：进 configExport、可上传创意工坊、跨新游戏保留
   · essences  精髓图鉴（拆解装备录得的词缀）＝**进度**：进 saveManager 快照，新游戏清空
     ⚠ 图鉴遵守「库房只存不删」铁律 —— 录入的精髓永久留存可反复灌注，
       消耗闸门由【锻造潜力】与【品级门槛】承担，而不是靠销毁图鉴条目。

   API 复用装备强化的接口（enhanceApi / enhanceUseSharedApi），与品级进阶同口径，不另开一路。
════════════════════════════════════════════ */

export interface EquipCraftSettings {
  enabled: boolean;
  processes: CraftProcessDef[];
  builtinVersion: number;   // 内置工艺默认值版本：变更后按 id 刷新内置条目（保留玩家自创）
}

const BUILTIN_VERSION = 1;

const DEFAULT_SETTINGS: EquipCraftSettings = {
  enabled: true,
  processes: BUILTIN_PROCESSES.map((p) => ({ ...p })),
  builtinVersion: BUILTIN_VERSION,
};

interface EquipCraftState {
  settings: EquipCraftSettings;
  essences: EssenceEntry[];

  setSettings: (patch: Partial<Omit<EquipCraftSettings, 'processes'>>) => void;
  /** 新增/更新工艺。入库前一律过 sanitizeProcess 夹取参数（AI 自创、工坊下载、旧存档都走这里）。 */
  upsertProcess: (raw: any, opts?: { id?: string; author?: string }) => CraftProcessDef;
  removeProcess: (id: string) => void;
  resetProcesses: () => void;

  addEssence: (e: Omit<EssenceEntry, 'id' | 'at' | 'name'>) => EssenceEntry | null;
  removeEssence: (id: string) => void;
  clearCraftProgress: () => void;   // 新游戏：清图鉴，留工艺库
}

let _seq = 0;
const rid = (p: string) => `${p}_${Date.now().toString(36)}${(++_seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const useEquipCraft = create<EquipCraftState>()(
  persist(
    (set, get): EquipCraftState => ({
      settings: { ...DEFAULT_SETTINGS },
      essences: [],

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      upsertProcess: (raw, opts = {}) => {
        const id = opts.id || raw?.id || rid('cp');
        const def = sanitizeProcess(raw, { id, author: opts.author ?? raw?.author });
        set((s) => {
          const exists = s.settings.processes.some((p) => p.id === id);
          const processes = exists
            ? s.settings.processes.map((p) => (p.id === id ? (p.builtin ? p : def) : p))   // 内置工艺不可被覆盖
            : [...s.settings.processes, def];
          return { settings: { ...s.settings, processes } };
        });
        return def;
      },

      removeProcess: (id) =>
        set((s) => ({ settings: { ...s.settings, processes: s.settings.processes.filter((p) => p.id !== id || p.builtin) } })),

      resetProcesses: () =>
        set((s) => ({
          settings: {
            ...s.settings,
            // 内置回默认，玩家自创的一条不动（自创工艺可能已上传工坊/被他人下载，不该被"恢复默认"抹掉）
            processes: [...BUILTIN_PROCESSES.map((p) => ({ ...p })), ...s.settings.processes.filter((p) => !p.builtin)],
            builtinVersion: BUILTIN_VERSION,
          },
        })),

      addEssence: (e) => {
        const text = String(e.text ?? '').trim();
        if (!text) return null;
        const name = affixName(text);
        const dup = get().essences.find((x) => x.name === name && x.text === text);
        if (dup) return dup;   // 同名同文重复提取 → 复用既有条目，不堆叠
        const entry: EssenceEntry = { ...e, text, name, id: rid('es'), at: Date.now() };
        set((s) => ({ essences: [entry, ...s.essences].slice(0, 300) }));
        return entry;
      },

      removeEssence: (id) => set((s) => ({ essences: s.essences.filter((x) => x.id !== id) })),

      clearCraftProgress: () => set({ essences: [] }),
    }),
    {
      name: 'drpg-equipcraft',
      partialize: (s: any) => ({ settings: s.settings, essences: s.essences }),
      merge: (persisted: any, current) => {
        const pp = persisted?.settings?.processes;
        let processes: CraftProcessDef[] = Array.isArray(pp) && pp.length
          ? pp.map((p: any) => (p?.builtin ? p : sanitizeProcess(p, { id: p?.id })))   // 自创工艺回读时重新夹取（防手改 localStorage 绕过平衡阀）
          : BUILTIN_PROCESSES.map((p) => ({ ...p }));
        // 内置版本迁移：按 id 把内置工艺刷成最新默认，缺的补上；玩家自创的原样保留
        if (persisted?.settings?.builtinVersion !== BUILTIN_VERSION) {
          processes = processes.map((p) => { const d = BUILTIN_PROCESSES.find((x) => x.id === p?.id); return d ? { ...d } : p; });
          for (const d of BUILTIN_PROCESSES) if (!processes.some((p) => p?.id === d.id)) processes.push({ ...d });
        }
        return {
          ...current,
          ...persisted,
          settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}), processes, builtinVersion: BUILTIN_VERSION },
          essences: (Array.isArray(persisted?.essences) ? persisted.essences : [])
            .map((e: any) => ({ ...e, gradeNum: gradeNumOfEssence(e) }))
            .filter((e: any) => e?.id && e?.text),
        };
      },
    },
  ),
);
