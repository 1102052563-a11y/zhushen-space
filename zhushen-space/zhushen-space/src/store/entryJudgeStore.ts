import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { type NpcPresetEntry, extractNpcPresetFromJson } from './npcEvoStore';

/* ───────────────────────────────────────────────────────────────────────────
 * 登场判断（独立功能模块）：从 NPC 演化里分割出来的「谁登场/退场 + 定阶位/等级/生物强度档」阶段。
 * - 提示词预设：独立于 NPC 演化（默认从 public/presets/entry-judge.json 补种，每次启动覆盖成内置最新）。
 * - API：走集成路由 routeKey='npcEntry'（resolveApiChain），本 store 的 api/useSharedApi 仅作路由为空时的 legacy 回退。
 * - 世界书：登场判断常驻注入「阶位·生物强度战力图鉴」(builtinKey='twb-power')，在「正文世界书」列表里编辑。
 * - 联网搜索：开启后给请求体加 Gemini `tools:[{google_search:{}}]`，让模型联网查同人/角色资料后再定档。
 * ─────────────────────────────────────────────────────────────────────────── */
export interface EntryJudgeState {
  enabled: boolean;            // 是否运行登场判断（关掉则 NPC 管线跳过登场判断阶段）
  webSearch: boolean;          // 联网搜索（Gemini google_search）；默认关
  requestTimeout: number;      // 单次请求超时（秒），默认 90
  presetName: string;
  presetVersion?: number;
  entries: NpcPresetEntry[];   // 登场判断提示词（独立预设）
  api: ApiConfig;              // 集成路由 npcEntry 为空时的 legacy 回退接口
  useSharedApi: boolean;       // 回退时是否与正文生成共用 API

  setEnabled: (v: boolean) => void;
  setWebSearch: (v: boolean) => void;
  setRequestTimeout: (n: number) => void;
  setApi: (patch: Partial<ApiConfig>) => void;
  setUseSharedApi: (v: boolean) => void;
  setPresetEntries: (entries: NpcPresetEntry[], name: string, version?: number) => void;
  toggleEntry: (identifier: string) => void;
  updateEntry: (identifier: string, patch: Partial<Pick<NpcPresetEntry, 'name' | 'content' | 'role' | 'enabled'>>) => void;
  importPreset: (raw: string) => { ok: boolean; message: string };
}

const DEFAULT_API: ApiConfig = { baseUrl: '', apiKey: '', modelId: '', temperature: 0.7, maxTokens: 4096, topP: 0.9 };

export const useEntryJudge = create<EntryJudgeState>()(
  persist(
    (set): EntryJudgeState => ({
      enabled: true,
      webSearch: false,
      requestTimeout: 90,
      presetName: '登场判断·默认（轮回乐园）',
      presetVersion: undefined,
      entries: [],
      api: { ...DEFAULT_API },
      useSharedApi: true,

      setEnabled: (v) => set({ enabled: v }),
      setWebSearch: (v) => set({ webSearch: v }),
      setRequestTimeout: (n) => set({ requestTimeout: Math.max(10, Math.floor(n) || 90) }),
      setApi: (patch) => set((s) => ({ api: { ...s.api, ...patch } })),
      setUseSharedApi: (v) => set({ useSharedApi: v }),
      setPresetEntries: (entries, name, version) => set({ entries, presetName: name, presetVersion: version }),
      toggleEntry: (identifier) =>
        set((s) => ({ entries: s.entries.map((e) => (e.identifier === identifier ? { ...e, enabled: !e.enabled } : e)) })),
      updateEntry: (identifier, patch) =>
        set((s) => ({ entries: s.entries.map((e) => (e.identifier === identifier ? { ...e, ...patch } : e)) })),
      importPreset: (raw) => {
        const p = extractNpcPresetFromJson(raw);
        if (!p || p.entries.length === 0) return { ok: false, message: '解析失败：未找到可用条目（需含 entrySharedRules / prompts / sharedRules）' };
        set({ entries: p.entries, presetName: p.name, presetVersion: p.version });
        return { ok: true, message: `已导入「${p.name}」，共 ${p.entries.length} 条` };
      },
    }),
    {
      name: 'drpg-entry-judge',
      // entries 每次启动由 loadBuiltinDefaults 从 entry-judge.json 覆盖成内置最新（与其它演化预设同策略）；
      // 持久化只为留住 api/useSharedApi/webSearch/enabled 等开关，避免刷新丢配置。
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted ?? {}),
        api: { ...current.api, ...(persisted?.api ?? {}) },
      }),
    },
  ),
);
