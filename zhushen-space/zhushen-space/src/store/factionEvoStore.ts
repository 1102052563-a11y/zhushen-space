import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';

export interface FactionPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;   // 'entrySharedRules'（当前世界判断阶段）/ 'prompts.faction'（重点演化）
}

export interface FactionScheduling {
  defaultFreqMode: 'turn' | 'date';
  defaultFreqInterval: number;
  offWorldQuota: number;     // 非当前世界势力每回合活跃名额
  cleanupEnabled: boolean;
  cleanupCycle: number;
  concurrency: number;
  modelPerTurnLimit: number;
  requestTimeout: number;
  retryCount: number;
  targetMode: 'auto' | 'manual';
  manualFocusIds: string[];
}

export interface FactionPresetSettings {
  enabled: boolean;
  strategy: 'A' | 'B';   // A=单次合并 / B=当前世界判断+逐势力并发
  frequency: number;
  scheduling: FactionScheduling;
  entries: FactionPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

interface FactionEvoState {
  settings: FactionPresetSettings;
  factionApi: ApiConfig;
  factionUseSharedApi: boolean;
  factionAvailableModels: string[];
  factionModelsLoading: boolean;
  factionModelsError: string;

  setSettings: (patch: Partial<Omit<FactionPresetSettings, 'entries' | 'scheduling'>>) => void;
  setScheduling: (patch: Partial<FactionScheduling>) => void;
  setPresetEntries: (entries: FactionPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<FactionPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  deleteDisabledEntries: () => number;
  setFactionApi: (patch: Partial<ApiConfig>) => void;
  setFactionUseSharedApi: (v: boolean) => void;
  fetchFactionModels: () => Promise<void>;
}

export const useFactionEvo = create<FactionEvoState>()(
  persist(
    (set) => ({
      settings: {
        enabled: false,
        strategy: 'B',
        frequency: 2,
        scheduling: {
          defaultFreqMode: 'turn', defaultFreqInterval: 1, offWorldQuota: 4,
          cleanupEnabled: true, cleanupCycle: 5, concurrency: 2, modelPerTurnLimit: 0,
          requestTimeout: 90, retryCount: 1, targetMode: 'auto', manualFocusIds: [],
        },
        entries: [],
        presetName: '',
      },
      factionApi: { baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.8, maxTokens: 2048, topP: 1 },
      factionUseSharedApi: true,
      factionAvailableModels: [],
      factionModelsLoading: false,
      factionModelsError: '',

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setScheduling: (patch) => set((s) => ({ settings: { ...s.settings, scheduling: { ...s.settings.scheduling, ...patch } } })),
      setPresetEntries: (entries, name, version) => set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (identifier) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === identifier ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (identifier, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === identifier ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      deleteDisabledEntries: () => {
        let removed = 0;
        set((s) => { const next = s.settings.entries.filter((e) => e.enabled); removed = s.settings.entries.length - next.length; return { settings: { ...s.settings, entries: next } }; });
        return removed;
      },
      setFactionApi: (patch) => set((s) => ({ factionApi: { ...s.factionApi, ...patch } })),
      setFactionUseSharedApi: (v) => set({ factionUseSharedApi: v }),
      fetchFactionModels: async () => {
        const s = useFactionEvo.getState();
        let api: ApiConfig;
        if (s.factionUseSharedApi) { const ss = useSettings.getState(); api = ss.textUseSharedApi ? ss.api : ss.textApi; }
        else api = s.factionApi;
        if (!api.baseUrl || !api.apiKey) { set({ factionModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ factionModelsLoading: true, factionModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ factionAvailableModels: models, factionModelsLoading: false });
        } catch (e: any) { set({ factionModelsError: e.message ?? '请求失败', factionModelsLoading: false }); }
      },
    }),
    {
      name: 'drpg-faction-evo',
      merge: (persisted: any, current) => ({
        ...current, ...persisted,
        settings: {
          ...current.settings, ...(persisted?.settings ?? {}),
          strategy: persisted?.settings?.strategy ?? current.settings.strategy,
          scheduling: { ...current.settings.scheduling, ...(persisted?.settings?.scheduling ?? {}) },
          entries: Array.isArray(persisted?.settings?.entries) ? persisted.settings.entries : current.settings.entries,
        },
        factionApi: { ...current.factionApi, ...(persisted?.factionApi ?? {}) },
        factionUseSharedApi: persisted?.factionUseSharedApi ?? current.factionUseSharedApi,
        factionAvailableModels: [], factionModelsLoading: false, factionModelsError: '',
      }),
    }
  )
);

/* 从 JSON 提取势力预设条目（仿 NPC：entrySharedRules + prompts.faction.rules）*/
export function extractFactionPresetFromJson(raw: string): { name: string; version?: number; entries: FactionPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '未命名势力预设';
    const version: number | undefined = data.version;
    const entries: FactionPresetEntry[] = [];
    const push = (rule: any, source: string) => {
      if (!rule.id || !rule.content) return;
      entries.push({ identifier: rule.id, name: rule.name ?? rule.id, content: rule.content, enabled: rule.enabled !== false, role: rule.role ?? 'system', source });
    };
    if (Array.isArray(data.entrySharedRules)) for (const r of data.entrySharedRules) push(r, 'entrySharedRules');
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [k, sec] of Object.entries(data.prompts) as [string, any][]) {
        if (sec && Array.isArray(sec.rules)) for (const r of sec.rules) push(r, `prompts.${k}`);
      }
    }
    if (Array.isArray(data.sharedRules)) for (const r of data.sharedRules) push(r, 'sharedRules');
    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch { return null; }
}

/* 重点演化阶段（非 entrySharedRules）*/
export function buildFactionSystemPrompt(entries: FactionPresetEntry[]): string {
  return entries.filter((e) => e.enabled && e.source !== 'entrySharedRules').map((e) => e.content).join('\n\n');
}
/* 当前世界判断阶段（entrySharedRules）*/
export function buildFactionEntryPrompt(entries: FactionPresetEntry[]): string {
  return entries.filter((e) => e.enabled && e.source === 'entrySharedRules').map((e) => e.content).join('\n\n');
}
