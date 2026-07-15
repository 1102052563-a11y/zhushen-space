import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import type { NpcPresetEntry, NpcPresetSettings, NpcScheduling } from './npcEvoStore';

/* 宠物/召唤物演化配置 store。
   与 npcEvoStore 同构（复用 NpcPresetSettings/NpcScheduling 类型），但**独立**：
   独立的启用开关、独立的预设条目、独立的 API 路由(feature key 'pet')、独立的演化频率。
   宠物/召唤物演化用「精简合并版」——一次调用演化在场+羁绊宠物，strategy 固定走 A(合并)，UI 不暴露 B。 */
interface PetEvoState {
  settings: NpcPresetSettings;
  petApi: ApiConfig;
  petUseSharedApi: boolean;
  petAvailableModels: string[];
  petModelsLoading: boolean;
  petModelsError: string;

  setSettings: (patch: Partial<Omit<NpcPresetSettings, 'entries' | 'scheduling'>>) => void;
  setScheduling: (patch: Partial<NpcScheduling>) => void;
  setPresetEntries: (entries: NpcPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<NpcPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  setPetApi: (patch: Partial<ApiConfig>) => void;
  setPetUseSharedApi: (v: boolean) => void;
  fetchPetModels: () => Promise<void>;
}

export const usePetEvo = create<PetEvoState>()(
  persist(
    (set): PetEvoState => ({
      settings: {
        enabled: false,
        strategy: 'A',        // 宠物演化固定走合并版（一次调用演化所有在场+羁绊宠物）
        frequency: 1,         // 每 N 回合演化一次
        scheduling: {
          defaultFreqMode: 'turn',
          defaultFreqInterval: 1,
          offSceneQuota: 5,
          cleanupEnabled: false,
          cleanupCycle: 5,
          concurrency: 2,
          modelPerTurnLimit: 0,
          requestTimeout: 90,
          retryCount: 2,
          targetMode: 'auto',
          skipDead: true,
          manualFocusIds: [],
          friendsPerTurn: 3,
          autoPurgeDead: false,
          deadPurgeDelay: 3,
        },
        entries: [],
        presetName: '',
      },
      petApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
        topP: 1,
      },
      petUseSharedApi: true,
      petAvailableModels: [],
      petModelsLoading: false,
      petModelsError: '',

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setScheduling: (patch) =>
        set((s) => ({ settings: { ...s.settings, scheduling: { ...s.settings.scheduling, ...patch } } })),

      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),

      togglePresetEntry: (identifier) =>
        set((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) =>
              e.identifier === identifier ? { ...e, enabled: !e.enabled } : e
            ),
          },
        })),

      updatePresetEntry: (identifier, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) =>
              e.identifier === identifier ? { ...e, ...patch } : e
            ),
          },
        })),

      clearPreset: () =>
        set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),

      setPetApi: (patch) =>
        set((s) => ({ petApi: { ...s.petApi, ...patch } })),

      setPetUseSharedApi: (v) => set({ petUseSharedApi: v }),

      fetchPetModels: async () => {
        let api: ApiConfig;
        const s = usePetEvo.getState();
        if (s.petUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.petApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ petModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ petModelsLoading: true, petModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', {
            headers: { Authorization: `Bearer ${api.apiKey}` },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? [])
            .map((m: any) => m.id ?? m.name ?? '')
            .filter(Boolean)
            .sort();
          set({ petAvailableModels: models, petModelsLoading: false });
        } catch (e: any) {
          set({ petModelsError: e.message ?? '请求失败', petModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-pet-evo',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...current.settings,
          ...(persisted?.settings ?? {}),
          strategy: 'A',   // 宠物演化恒为合并版
          scheduling: { ...current.settings.scheduling, ...(persisted?.settings?.scheduling ?? {}) },
          entries: Array.isArray(persisted?.settings?.entries)
            ? persisted.settings.entries
            : current.settings.entries,
        },
        petApi: { ...current.petApi, ...(persisted?.petApi ?? {}) },
        petUseSharedApi: persisted?.petUseSharedApi ?? current.petUseSharedApi,
        petAvailableModels: [],
        petModelsLoading: false,
        petModelsError: '',
      }),
    }
  )
);
