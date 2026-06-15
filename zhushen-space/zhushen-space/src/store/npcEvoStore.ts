import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';

export interface NpcPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

/* 调度设置（策略B）：对应"触发频率"+"NPC调度预算"两个面板 */
export interface NpcScheduling {
  defaultFreqMode: 'turn' | 'date';  // 全局默认频率模式
  defaultFreqInterval: number;        // 全局默认间隔 ≥1
  offSceneQuota: number;              // 离场活跃名额，默认 5
  cleanupEnabled: boolean;            // 长期不出场清理提醒
  cleanupCycle: number;               // 清理建议周期，默认 5
  concurrency: number;                // 策略B 逐NPC演化并发数（每批同时请求数），默认 2
  modelPerTurnLimit: number;          // 每回合最多演化几个 NPC（0=不限），默认 0
  requestTimeout: number;             // 单次 NPC 请求超时（秒），默认 90
  retryCount: number;                 // 单条请求失败后的额外重试次数，默认 2
  targetMode: 'auto' | 'manual';      // auto=系统自动调度 / manual=只推进手动重点列表
  skipDead: boolean;                  // 自动调度候选先过滤已死亡角色，默认 true
  manualFocusIds: string[];           // 手动重点列表（manual 模式生效）
  friendsPerTurn?: number;            // 好友栏每回合参与演化的人数（与在场/离场配额独立，按最久未演化轮换），默认 3
}

export interface NpcPresetSettings {
  enabled: boolean;
  strategy: 'A' | 'B';   // A=单次合并调用 / B=登场判断+逐NPC并发
  frequency: number;     // 策略A全局频率
  scheduling: NpcScheduling;
  entries: NpcPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

interface NpcEvoState {
  settings: NpcPresetSettings;
  npcApi: ApiConfig;
  npcUseSharedApi: boolean;
  npcAvailableModels: string[];
  npcModelsLoading: boolean;
  npcModelsError: string;

  setSettings: (patch: Partial<Omit<NpcPresetSettings, 'entries' | 'scheduling'>>) => void;
  setScheduling: (patch: Partial<NpcScheduling>) => void;
  setPresetEntries: (entries: NpcPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<NpcPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  deleteDisabledEntries: () => number;
  smartFilterEntries: () => number;
  setNpcApi: (patch: Partial<ApiConfig>) => void;
  setNpcUseSharedApi: (v: boolean) => void;
  fetchNpcModels: () => Promise<void>;
}

/* NPC演化智能筛选名单（策略A：排除单角色约束条目）*/
const NPC_KEEP_NAMES = new Set([
  // 角色上下文注入
  '技能品级与等级系统',
  '生物强度生成框架(T0-T9属性预算)',
  '技能天赋称号固定格式',
  '限时状态系统',
  'NPC属性更新与正文一致',
  '同人作品联网检索',
  '身份定义',
  '角色档案',
  '角色ID列表',
  '本轮正文',
  '用户行为',
  '关系一致性与好感度锚点',
  '共享技能字段与层级规则',
  '防全知协议',
  '时间粒度法则',
  // NPC 列模型定义
  'NPC状态字段认知边界',
  'NPC基础信息列',
  'NPC心理与社交列',
  'NPC经济与目标列',
  '备注列详解',
  'JSON语法铁则',
  '品阶显示规则',
  // 指令与规则（策略A下排除 Standalone NPC Target Scope 和并发演化输出约束）
  '可用指令',
  '推演法则',
  '死亡逻辑',
  '绝对禁令',
  '输出格式',
  'NPC新建规则',
  'NPC重新上场规则',
  '加强的NPC生成原则',
  'NPC情景指令示例集',
  '最终审查协议',
  '人际关系参考',
  // Standalone 规范（保留兼容多角色的）
  'Standalone 角色短指令格式',
  'Standalone 词条属性格式',
  'Standalone 最终属性写入边界',
  'Standalone 境界字段规范',
  'Standalone 角色坐标归属',
  'Standalone 肖像刷新标记',
  // User 类推理步骤
  'COT开始',
  '第一步：扫描与状态',
  '第二步：行为演化',
  '第三步：资源流转',
  '第四步：反差纠错',
  '第四点五步：第16列动作审查',
  '第五步：最终审查',
  // 其他
  '物价和金融系统',
]);

/* 策略B专属：单角色作用域约束条目（A下禁用，B下启用）*/
const B_CONSTRAINT_NAMES = new Set([
  'Standalone NPC Target Scope',
  '并发演化输出约束',
  'Standalone NPC 世界因子 COT 审视',
]);

/* 登场判断阶段（entrySharedRules）智能筛选名单 */
const ENTRY_KEEP_NAMES = new Set([
  'Standalone 状态命令契约（SSOT）',
  '全部角色索引',
  '全地图坐标参考',
  '上一回合场景',
  '本轮正文',
  '用户行为',
  '世界因子',
  '在场人物',
  '离场人物传记',
  '玩家灵兽列表',
  '重点演化列表',
  'NPC登场骨架格式',
  '数据列参考',
  '性格与行为生成指南',
  'JSON语法铁则',
  '登场阶段时间地点边界',
  '输出格式',
  '身份-境界对应参考',
  '人物称谓与境界规则',
  '原著剧情指导使用边界',
  '登场阶段原著角色身份锚定边界',
  'Standalone 登场阶段 Beast 创建',
]);

export const useNpcEvo = create<NpcEvoState>()(
  persist(
    (set) => ({
      settings: {
        enabled: false,
        strategy: 'B',
        frequency: 2,
        scheduling: {
          defaultFreqMode: 'turn',
          defaultFreqInterval: 1,
          offSceneQuota: 5,
          cleanupEnabled: true,
          cleanupCycle: 5,
          concurrency: 2,
          modelPerTurnLimit: 0,
          requestTimeout: 90,
          retryCount: 2,
          targetMode: 'auto',
          skipDead: true,
          manualFocusIds: [],
          friendsPerTurn: 3,
        },
        entries: [],
        presetName: '',
      },
      npcApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
        topP: 1,
      },
      npcUseSharedApi: true,
      npcAvailableModels: [],
      npcModelsLoading: false,
      npcModelsError: '',

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

      deleteDisabledEntries: () => {
        let removed = 0;
        set((s) => {
          const next = s.settings.entries.filter((e) => e.enabled);
          removed = s.settings.entries.length - next.length;
          return { settings: { ...s.settings, entries: next } };
        });
        return removed;
      },

      smartFilterEntries: () => {
        let kept = 0;
        set((s) => {
          const isB = s.settings.strategy === 'B';
          const next = s.settings.entries.map((e) => {
            const isEntryRule = e.source === 'entrySharedRules';
            // 登场判断条目：策略B保留，策略A禁用
            // NPC演化条目：按 NPC_KEEP_NAMES；B下额外开启单角色约束条目
            const enable = isEntryRule
              ? (isB && ENTRY_KEEP_NAMES.has(e.name))
              : (NPC_KEEP_NAMES.has(e.name) || (isB && B_CONSTRAINT_NAMES.has(e.name)));
            if (enable) kept++;
            return { ...e, enabled: enable };
          });
          return { settings: { ...s.settings, entries: next } };
        });
        return kept;
      },

      setNpcApi: (patch) =>
        set((s) => ({ npcApi: { ...s.npcApi, ...patch } })),

      setNpcUseSharedApi: (v) => set({ npcUseSharedApi: v }),

      fetchNpcModels: async () => {
        let api: ApiConfig;
        const s = useNpcEvo.getState();
        if (s.npcUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.npcApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ npcModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ npcModelsLoading: true, npcModelsError: '' });
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
          set({ npcAvailableModels: models, npcModelsLoading: false });
        } catch (e: any) {
          set({ npcModelsError: e.message ?? '请求失败', npcModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-npc-evo',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...current.settings,
          ...(persisted?.settings ?? {}),
          strategy: persisted?.settings?.strategy ?? current.settings.strategy,
          scheduling: { ...current.settings.scheduling, ...(persisted?.settings?.scheduling ?? {}) },
          entries: Array.isArray(persisted?.settings?.entries)
            ? persisted.settings.entries
            : current.settings.entries,
        },
        npcApi: { ...current.npcApi, ...(persisted?.npcApi ?? {}) },
        npcUseSharedApi: persisted?.npcUseSharedApi ?? current.npcUseSharedApi,
        npcAvailableModels: [],
        npcModelsLoading: false,
        npcModelsError: '',
      }),
    }
  )
);

/* 从 JSON 提取 NPC 预设条目 */
export function extractNpcPresetFromJson(
  raw: string
): { name: string; version?: number; entries: NpcPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '未命名NPC预设';
    const version: number | undefined = data.version;
    const entries: NpcPresetEntry[] = [];

    function push(rule: any, source: string) {
      if (!rule.id || !rule.content) return;
      entries.push({
        identifier: rule.id,
        name:       rule.name ?? rule.id,
        content:    rule.content,
        enabled:    rule.enabled !== false,
        role:       rule.role ?? 'system',
        source,
      });
    }

    if (Array.isArray(data.entrySharedRules)) {
      for (const rule of data.entrySharedRules) push(rule, 'entrySharedRules');
    }
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [sectionKey, section] of Object.entries(data.prompts) as [string, any][]) {
        if (section && Array.isArray(section.rules)) {
          for (const rule of section.rules) push(rule, `prompts.${sectionKey}`);
        }
      }
    }
    if (Array.isArray(data.sharedRules)) {
      for (const rule of data.sharedRules) push(rule, 'sharedRules');
    }

    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}

/* 重点演化阶段 system prompt：只取非登场判断（source !== entrySharedRules）条目 */
export function buildNpcSystemPrompt(entries: NpcPresetEntry[]): string {
  return entries
    .filter((e) => e.enabled && e.source !== 'entrySharedRules')
    .map((e) => e.content)
    .join('\n\n');
}

/* 登场判断阶段 system prompt：只取 source === entrySharedRules 条目 */
export function buildEntrySystemPrompt(entries: NpcPresetEntry[]): string {
  return entries
    .filter((e) => e.enabled && e.source === 'entrySharedRules')
    .map((e) => e.content)
    .join('\n\n');
}

/* 拆分两阶段条目（供 App 做占位符替换） */
export function splitNpcEntries(entries: NpcPresetEntry[]): { npc: NpcPresetEntry[]; entry: NpcPresetEntry[] } {
  const npc: NpcPresetEntry[] = [];
  const entry: NpcPresetEntry[] = [];
  for (const e of entries) {
    if (!e.enabled) continue;
    (e.source === 'entrySharedRules' ? entry : npc).push(e);
  }
  return { npc, entry };
}
