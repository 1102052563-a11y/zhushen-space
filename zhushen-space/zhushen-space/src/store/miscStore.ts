import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import miscDefaultPreset from '../data/miscDefaultPreset.json';

/* ════════════════════════════════════════════
   杂项演化（misc evolution）
   维护世界级杂项：分段总结 / 双时间 / 天气 / 世界大事 / 主角任务
   （小地图相关规则保留为可关闭条目，渲染暂未实现）
════════════════════════════════════════════ */

/* 任务环（questline 的单个阶段）。主线/多环支线的路线图由若干环组成。
   planned=已规划只给提示 / active=当前进行 / done=已达成 / skipped=被跨越跳过。*/
export interface QuestRing {
  idx: number;        // 环序号（1-based，路线图排序的规范键）
  goal: string;       // 这一环的目标
  hint?: string;      // 提示（planned 环未落地时的一句钩子）
  status: 'planned' | 'active' | 'done' | 'skipped';
  reward?: string;    // 本环成功奖励（可与任务顶层不同）
  penalty?: string;   // 本环失败惩罚
  optional?: boolean; // 贪婪环(可选)：高潮之后的延伸；失败仅损失本环额外奖励、不致死。强制环不设此项
  startTime?: string; // 本环执行窗口（绝对游戏时间）
  endTime?: string;
}

export interface MiscTask {
  id: string;        // "T_17"
  name: string;      // 列1
  desc: string;      // 列2
  reward: string;    // 列3 成功奖励
  penalty: string;   // 列4 失败惩罚
  status: string;    // 列5 "进行中/三阶中期"
  startTime: string;
  endTime: string;
  addedAt: number;
  // ── 多环任务线（v2，全部可选；老存档无这些字段=单环扁平任务，按支线处理）──
  kind?: '主线' | '支线';   // 任务线类型；缺省/未标=支线。主线每世界通常仅一条 active
  rings?: QuestRing[];      // 环路线图（多环任务才有；单环任务可不设）
  currentRing?: number;     // 当前 active 环的 idx（非数组下标）
  finale?: string;          // 终局目标——定义这条线的"尽头"，最后一环达成即整条完成
}

/* 主线判定：只有显式 kind==='主线' 才算主线，其余（含未标 kind）一律支线 */
export function isMainQuest(t: { kind?: string }): boolean {
  return t?.kind === '主线';
}

/* 已结算（完成/失败/放弃）的任务：移出"进行中"列表，留档供面板查看，不再注入提示词 */
export interface ArchivedTask extends MiscTask {
  settledAt: number;
}

export interface WorldEvent {
  id: string;        // "W_1"
  time: string;
  location: string;
  desc: string;
}

/* 叙事长期事实（回复后由 LLM 抽取，供关键词召回）*/
export interface NarrativeFact {
  id: string;        // "F_1"
  title: string;
  text: string;
  keywords: string[];
  addedAt: number;
}

/* ── 预设条目（与主角/NPC 演化同构，可导入导出）── */
export interface MiscPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

/* 内置默认预设：双时间规则 + 原版 13 条 misc_management 规则（轮回乐园适配，从 data/miscDefaultPreset.json 载入）*/
export const DEFAULT_MISC_ENTRIES: MiscPresetEntry[] =
  ((miscDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled !== false,
    role: r.role ?? 'system',
    source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (miscDefaultPreset as any).name ?? '内置·杂项演化';
const DEFAULT_PRESET_VERSION: number | undefined = (miscDefaultPreset as any).version;

/** 把启用条目拼成 system prompt（运行时再替换 ${...} 占位符）*/
export function buildMiscSystemPrompt(entries: MiscPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

/** 从预设 JSON 提取条目（支持 entrySharedRules / prompts.* / sharedRules）*/
export function extractMiscPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: MiscPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '杂项演化预设';
    const version: number | undefined = data.version;
    const entries: MiscPresetEntry[] = [];
    const push = (rule: any, src: string) => {
      if (!rule || !rule.id || rule.content == null) return;
      entries.push({
        identifier: rule.id,
        name: rule.name ?? rule.id,
        content: String(rule.content),
        enabled: rule.enabled !== false,
        role: rule.role ?? 'system',
        source: src,
      });
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
  } catch {
    return null;
  }
}

export interface MiscSettings {
  enabled: boolean;
  entries: MiscPresetEntry[];
  presetName: string;
  presetVersion?: number;
  smallKeep: number;
  largeKeep: number;
  largeEvery: number;   // 大总结周期：每 N 个杂项演化回合才产出一条大总结（聚合压缩近期小总结），其余回合只出小总结
  questInjectEnabled?: boolean;  // 是否把当前任务(主线重/支线轻)注入正文上下文（默认开）
  questSideCap?: number;         // 注入正文的支线条数上限（相关性排序后封顶，默认 3）
}

const DEFAULT_SETTINGS: MiscSettings = {
  enabled: false,
  entries: DEFAULT_MISC_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
  smallKeep: 8,
  largeKeep: 6,
  largeEvery: 6,
  questInjectEnabled: true,
  questSideCap: 3,
};

interface MiscState {
  tasks: MiscTask[];
  archivedTasks: ArchivedTask[];   // 已结算任务（完成/失败/放弃），移出进行中列表
  worldEvents: WorldEvent[];
  smallSummaries: string[];
  largeSummaries: string[];
  summaryRound: number;   // 杂项演化已运行的回合计数（用于大总结周期判断，持久化）
  narrativeFacts: NarrativeFact[];
  weather: string;
  paradiseTime: string;
  worldTime: string;
  worldName: string;

  settings: MiscSettings;
  miscApi: ApiConfig;
  miscUseSharedApi: boolean;
  miscAvailableModels: string[];
  miscModelsLoading: boolean;
  miscModelsError: string;

  upsertTask: (t: MiscTask) => void;
  updateTask: (id: string, patch: Partial<MiscTask>) => void;
  removeTask: (id: string) => void;
  settleTask: (id: string, status: string) => void;   // 结算：移出进行中→归档
  advanceRing: (id: string) => void;   // 推进：当前 active 环→done，下一 planned 环→active，同步顶层快照
  clearArchivedTasks: () => void;
  nextTaskId: () => string;
  addWorldEvent: (e: Omit<WorldEvent, 'id'>) => void;
  updateWorldEvent: (id: string, patch: Partial<Omit<WorldEvent, 'id'>>) => void;
  removeWorldEvent: (id: string) => void;
  pushSmall: (s: string) => void;
  pushLarge: (s: string) => void;
  bumpSummaryRound: () => number;   // +1 并返回新值
  addNarrativeFacts: (items: { title: string; text: string; keywords: string[] }[]) => void;
  removeNarrativeFact: (id: string) => void;
  clearNarrativeFacts: () => void;
  setWeather: (w: string) => void;
  setTime: (patch: { paradiseTime?: string; worldTime?: string; worldName?: string }) => void;
  clearMisc: () => void;

  setSettings: (patch: Partial<Omit<MiscSettings, 'entries'>>) => void;
  setPresetEntries: (entries: MiscPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<MiscPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;

  setMiscApi: (patch: Partial<ApiConfig>) => void;
  setMiscUseSharedApi: (v: boolean) => void;
  fetchMiscModels: () => Promise<void>;
}

export const useMisc = create<MiscState>()(
  persist(
    (set, get) => ({
      tasks: [],
      archivedTasks: [],
      worldEvents: [],
      smallSummaries: [],
      largeSummaries: [],
      summaryRound: 0,
      narrativeFacts: [],
      weather: '',
      paradiseTime: '',
      worldTime: '',
      worldName: '',

      settings: { ...DEFAULT_SETTINGS },
      miscApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.6, maxTokens: 4096, topP: 1,
      },
      miscUseSharedApi: true,
      miscAvailableModels: [],
      miscModelsLoading: false,
      miscModelsError: '',

      upsertTask: (t) =>
        set((s) => {
          const i = s.tasks.findIndex((x) => x.id === t.id);
          const next = [...s.tasks];
          if (i >= 0) next[i] = { ...next[i], ...t };
          else next.push(t);
          return { tasks: next };
        }),
      updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
      settleTask: (id, status) =>
        set((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return s;   // 进行中列表里没有 → 不结算（防误删/重复）
          const archived: ArchivedTask = { ...t, status: status || t.status || '已完成', settledAt: Date.now() };
          return {
            tasks: s.tasks.filter((x) => x.id !== id),
            archivedTasks: [archived, ...s.archivedTasks.filter((x) => x.id !== id)].slice(0, 40),
          };
        }),
      advanceRing: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id || !Array.isArray(t.rings) || t.rings.length === 0) return t;
            const rings = t.rings.map((r) => ({ ...r }));
            const cur = rings.find((r) => r.status === 'active');
            if (cur) cur.status = 'done';
            // 晋升下一个 planned 环（按 idx 最小者）为 active
            const next = rings
              .filter((r) => r.status === 'planned')
              .sort((a, b) => a.idx - b.idx)[0];
            if (next) next.status = 'active';
            const active = rings.find((r) => r.status === 'active');
            return {
              ...t,
              rings,
              currentRing: active ? active.idx : t.currentRing,
              // 顶层 desc/奖惩同步到新 active 环，保证旧序列化/面板显示当前目标
              ...(active
                ? {
                    desc: active.goal || t.desc,
                    reward: active.reward ?? t.reward,
                    penalty: active.penalty ?? t.penalty,
                  }
                : {}),
            };
          }),
        })),
      clearArchivedTasks: () => set({ archivedTasks: [] }),
      nextTaskId: () => {
        // 进行中 + 已归档的编号都算"已占用"，避免复用完成任务的编号
        const all = [...get().tasks, ...get().archivedTasks];
        const nums = all.map((t) => Number(/^T_(\d+)$/.exec(t.id)?.[1])).filter((n) => Number.isFinite(n));
        return `T_${nums.length ? Math.max(...nums) + 1 : 1}`;
      },

      addWorldEvent: (e) =>
        set((s) => {
          const nums = s.worldEvents.map((w) => Number(/^W_(\d+)$/.exec(w.id)?.[1])).filter((n) => Number.isFinite(n));
          const id = `W_${nums.length ? Math.max(...nums) + 1 : 1}`;
          return { worldEvents: [...s.worldEvents, { id, ...e }].slice(-40) };
        }),
      updateWorldEvent: (id, patch) =>
        set((s) => ({ worldEvents: s.worldEvents.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      removeWorldEvent: (id) => set((s) => ({ worldEvents: s.worldEvents.filter((w) => w.id !== id) })),

      pushSmall: (str) => set((s) => ({ smallSummaries: [...s.smallSummaries, str].slice(-s.settings.smallKeep) })),
      pushLarge: (str) => set((s) => ({ largeSummaries: [...s.largeSummaries, str].slice(-s.settings.largeKeep) })),
      bumpSummaryRound: () => { const n = get().summaryRound + 1; set({ summaryRound: n }); return n; },
      addNarrativeFacts: (items) =>
        set((s) => {
          let max = s.narrativeFacts.reduce((m, f) => Math.max(m, Number(/^F_(\d+)$/.exec(f.id)?.[1]) || 0), 0);
          const add = items
            .filter((it) => it.text && it.text.trim())
            .map((it) => ({ id: `F_${++max}`, title: (it.title || it.text.slice(0, 14)).trim(), text: it.text.trim(), keywords: it.keywords ?? [], addedAt: Date.now() }));
          return { narrativeFacts: [...s.narrativeFacts, ...add].slice(-300) };
        }),
      removeNarrativeFact: (id) => set((s) => ({ narrativeFacts: s.narrativeFacts.filter((f) => f.id !== id) })),
      clearNarrativeFacts: () => set({ narrativeFacts: [] }),
      setWeather: (w) => set({ weather: w }),
      setTime: (patch) => set((s) => ({
        paradiseTime: patch.paradiseTime ?? s.paradiseTime,
        worldTime: patch.worldTime ?? s.worldTime,
        worldName: patch.worldName ?? s.worldName,
      })),
      clearMisc: () => set({ tasks: [], archivedTasks: [], worldEvents: [], smallSummaries: [], largeSummaries: [], summaryRound: 0 }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_MISC_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setMiscApi: (patch) => set((s) => ({ miscApi: { ...s.miscApi, ...patch } })),
      setMiscUseSharedApi: (v) => set({ miscUseSharedApi: v }),
      fetchMiscModels: async () => {
        const s = get();
        const api = s.miscUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.miscApi;
        if (!api.baseUrl || !api.apiKey) { set({ miscModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ miscModelsLoading: true, miscModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ miscAvailableModels: models, miscModelsLoading: false });
        } catch (e: any) {
          set({ miscModelsError: e.message ?? '请求失败', miscModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-misc',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries) && persisted.settings.entries.length > 0
            ? persisted.settings.entries
            : DEFAULT_MISC_ENTRIES,
        },
        miscApi: { ...current.miscApi, ...(persisted?.miscApi ?? {}) },
        miscUseSharedApi: persisted?.miscUseSharedApi ?? current.miscUseSharedApi,
        miscAvailableModels: [],
        miscModelsLoading: false,
        miscModelsError: '',
      }),
    },
  ),
);
