import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import cosmosDefaultPreset from '../data/cosmosDefaultPreset.json';
import cosmosDefaultData from '../data/cosmosDefaultData.json';

/* ════════════════════════════════════════════
   万族演化（cosmos）——轮回乐园「宇宙背景层」，跨世界永久
   - 一份带类型的宇宙花名册：七乐园 / 虚空万族 / 文明组织 / 原生世界 / 神灵 / 深渊
   - 在主角头顶自转：事件/战力/格局自行推演（前期纯背景，中后期主角才够格搅动）
   - 数据 + 演化设置 + 独立 API 合一持久化（drpg-cosmos），同 territoryStore 结构
════════════════════════════════════════════ */

export type CosmosCategory = '乐园' | '种族' | '文明组织' | '原生世界' | '神灵' | '深渊';
export const COSMOS_CATEGORIES: CosmosCategory[] = ['乐园', '种族', '文明组织', '原生世界', '神灵', '深渊'];
/** 合法状态（由低到高 / 终局在后） */
export const COSMOS_STATUSES = ['鼎盛', '扩张', '稳固', '衰退', '困顿', '沉寂', '封印', '复苏', '覆灭'];

export interface CosmosRelation { target: string; relation: string }
export interface CosmosDeed { time?: string; desc: string }

export interface CosmosEntity {
  id: string;
  name: string;
  category: CosmosCategory;
  priority: number;        // 0核心(常演化) 1次要 2边缘
  power: string;           // 战力档/描述
  rank?: number;           // 仅乐园：1-7 战力排名
  status: string;          // 鼎盛/扩张/稳固/衰退/困顿/沉寂/封印/复苏/覆灭
  territory: string;       // 疆域/持有世界数
  resources: string;
  goal: string;            // 当前动向
  towardParadise: string;  // 对轮回乐园/主角阵营态度
  relations: CosmosRelation[];
  extra: Record<string, string>;  // 原生世界:主导种族/内部派系/存亡; 深渊:污染度/原罪物
  deeds: CosmosDeed[];     // 大事记
  era: string;             // 纪元变动
  isPlayerKnown: boolean;  // 主角是否已接触/知晓（中后期参与的门槛标记）
  destroyed: boolean;      // 覆灭
  lastEvolvedTurn: number;
}

/* 名称归一化匹配（去空白/标点/大小写）——同名→更新、按名删除，容忍 AI 细微差异 */
function cNorm(s?: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
}
export function cosmosNameEq(a?: string, b?: string): boolean {
  const x = cNorm(a), y = cNorm(b);
  return !!x && !!y && x === y;
}

/* ── 预设条目（与领地/势力演化同构）── */
export interface CosmosPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

export const DEFAULT_COSMOS_ENTRIES: CosmosPresetEntry[] =
  ((cosmosDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled !== false,
    role: r.role ?? 'system',
    source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (cosmosDefaultPreset as any).name ?? '内置·万族演化';
const DEFAULT_PRESET_VERSION: number | undefined = (cosmosDefaultPreset as any).version;

export function buildCosmosSystemPrompt(entries: CosmosPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

export function extractCosmosPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: CosmosPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '万族演化预设';
    const version: number | undefined = data.version;
    const entries: CosmosPresetEntry[] = [];
    const push = (rule: any, src: string) => {
      if (!rule || !rule.id || rule.content == null) return;
      entries.push({
        identifier: rule.id, name: rule.name ?? rule.id, content: String(rule.content),
        enabled: rule.enabled !== false, role: rule.role ?? 'system', source: src,
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
  } catch { return null; }
}

export interface CosmosSettings {
  enabled: boolean;
  frequency: number;            // 默认 3：每 3 回合推演一次
  seedMode: 'canon' | 'random' | 'blank';   // 种子模式
  seedTheme: string;            // random 模式的题材/风格提示
  participationGate: 'off' | 'auto' | 'manual';  // 中后期参与门槛：off=永不参与/auto=按阶位回合自动/manual=手动解锁
  participationUnlocked: boolean;   // 手动模式下的解锁标记 / auto 解锁后置 true
  injectIrrelevantCount: number;    // 注入正文时额外采样几个"不相关"势力增加真实感（默认2）
  focusPerTurn: number;         // 每次 AI 推演最多处理几个实体（默认8）
  entries: CosmosPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

const DEFAULT_SETTINGS: CosmosSettings = {
  enabled: false,
  frequency: 3,
  seedMode: 'canon',
  seedTheme: '',
  participationGate: 'auto',
  participationUnlocked: false,
  injectIrrelevantCount: 2,
  focusPerTurn: 8,
  entries: DEFAULT_COSMOS_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
};

/** 规范化一个实体（补默认字段，合法化 category/status） */
function normalizeEntity(e: Partial<CosmosEntity>, idHint?: string): CosmosEntity {
  const category = (COSMOS_CATEGORIES.includes(e.category as CosmosCategory) ? e.category : '种族') as CosmosCategory;
  return {
    id: e.id || idHint || `co_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: (e.name ?? '').trim() || '未知存在',
    category,
    priority: e.priority != null ? Math.max(0, Math.min(2, Math.round(e.priority))) : 1,
    power: e.power ?? '',
    rank: e.rank != null ? Math.round(e.rank) : undefined,
    status: COSMOS_STATUSES.includes(e.status ?? '') ? (e.status as string) : (e.status || '稳固'),
    territory: e.territory ?? '',
    resources: e.resources ?? '',
    goal: e.goal ?? '',
    towardParadise: e.towardParadise ?? '',
    relations: Array.isArray(e.relations) ? e.relations.filter((r) => r && r.target) : [],
    extra: e.extra && typeof e.extra === 'object' ? e.extra : {},
    deeds: Array.isArray(e.deeds) ? e.deeds.filter((d) => d && d.desc) : [],
    era: e.era ?? '',
    isPlayerKnown: e.isPlayerKnown === true,
    destroyed: e.destroyed === true || e.status === '覆灭',
    lastEvolvedTurn: e.lastEvolvedTurn ?? 0,
  };
}

interface CosmosState {
  entities: CosmosEntity[];
  seeded: boolean;

  settings: CosmosSettings;
  cosmosApi: ApiConfig;
  cosmosUseSharedApi: boolean;
  cosmosAvailableModels: string[];
  cosmosModelsLoading: boolean;
  cosmosModelsError: string;

  /* 数据 actions */
  seedFromCanon: () => void;
  seedEntities: (list: Partial<CosmosEntity>[], replace?: boolean) => void;
  upsertEntity: (e: Partial<CosmosEntity> & { name: string }) => void;
  removeEntity: (name: string) => void;
  appendDeed: (name: string, deed: CosmosDeed) => void;
  markKnown: (name: string) => void;
  markEvolved: (name: string, turn: number) => void;
  clearCosmos: () => void;

  /* 预设 / 设置 actions */
  setSettings: (patch: Partial<Omit<CosmosSettings, 'entries'>>) => void;
  setPresetEntries: (entries: CosmosPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<CosmosPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;

  /* API actions */
  setCosmosApi: (patch: Partial<ApiConfig>) => void;
  setCosmosUseSharedApi: (v: boolean) => void;
  fetchCosmosModels: () => Promise<void>;
}

export const useCosmos = create<CosmosState>()(
  persist(
    (set, get) => ({
      entities: [],
      seeded: false,

      settings: { ...DEFAULT_SETTINGS },
      cosmosApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.7, maxTokens: 4096, topP: 1,
      },
      cosmosUseSharedApi: true,
      cosmosAvailableModels: [],
      cosmosModelsLoading: false,
      cosmosModelsError: '',

      seedFromCanon: () =>
        set(() => ({
          entities: ((cosmosDefaultData as any).entities as any[]).map((e, i) => normalizeEntity(e, `co_canon_${i + 1}`)),
          seeded: true,
        })),

      seedEntities: (list, replace = true) =>
        set((s) => {
          const incoming = (list ?? []).map((e, i) => normalizeEntity(e, `co_seed_${i + 1}`));
          if (replace) return { entities: incoming, seeded: true };
          // 合并：同名更新，否则追加
          const next = [...s.entities];
          for (const e of incoming) {
            const i = next.findIndex((x) => cosmosNameEq(x.name, e.name));
            if (i >= 0) next[i] = { ...next[i], ...e, id: next[i].id };
            else next.push(e);
          }
          return { entities: next, seeded: true };
        }),

      upsertEntity: (e) =>
        set((s) => {
          const nm = (e.name ?? '').trim();
          if (!nm) return s;
          const i = s.entities.findIndex((x) => cosmosNameEq(x.name, nm));
          if (i >= 0) {
            const cur = s.entities[i];
            const merged: CosmosEntity = {
              ...cur,
              // 增量更新：只覆盖给了的字段，名字不改（防 AI 改名）
              category: e.category && COSMOS_CATEGORIES.includes(e.category) ? e.category : cur.category,
              priority: e.priority != null ? Math.max(0, Math.min(2, Math.round(e.priority))) : cur.priority,
              power: e.power != null ? e.power : cur.power,
              rank: e.rank != null ? Math.round(e.rank) : cur.rank,
              status: e.status != null ? e.status : cur.status,
              territory: e.territory != null ? e.territory : cur.territory,
              resources: e.resources != null ? e.resources : cur.resources,
              goal: e.goal != null ? e.goal : cur.goal,
              towardParadise: e.towardParadise != null ? e.towardParadise : cur.towardParadise,
              relations: Array.isArray(e.relations) ? e.relations.filter((r) => r && r.target) : cur.relations,
              extra: e.extra && typeof e.extra === 'object' ? { ...cur.extra, ...e.extra } : cur.extra,
              era: e.era != null ? e.era : cur.era,
              isPlayerKnown: e.isPlayerKnown === true ? true : cur.isPlayerKnown,
              destroyed: e.destroyed === true || e.status === '覆灭' ? true : cur.destroyed,
            };
            // 追加大事记（去重最近一条）
            if (Array.isArray(e.deeds)) {
              for (const d of e.deeds) {
                if (d && d.desc && !merged.deeds.some((x) => cNorm(x.desc) === cNorm(d.desc))) {
                  merged.deeds = [{ time: d.time, desc: d.desc }, ...merged.deeds].slice(0, 30);
                }
              }
            }
            const next = [...s.entities]; next[i] = merged;
            return { entities: next };
          }
          // 新增
          return { entities: [...s.entities, normalizeEntity(e)] };
        }),

      removeEntity: (name) => set((s) => ({ entities: s.entities.filter((x) => !cosmosNameEq(x.name, name) && x.id !== name) })),

      appendDeed: (name, deed) =>
        set((s) => {
          if (!deed || !deed.desc) return s;
          const i = s.entities.findIndex((x) => cosmosNameEq(x.name, name) || x.id === name);
          if (i < 0) return s;
          const next = [...s.entities];
          next[i] = { ...next[i], deeds: [{ time: deed.time, desc: deed.desc }, ...next[i].deeds].slice(0, 30) };
          return { entities: next };
        }),

      markKnown: (name) =>
        set((s) => ({ entities: s.entities.map((x) => (cosmosNameEq(x.name, name) || x.id === name) ? { ...x, isPlayerKnown: true } : x) })),

      markEvolved: (name, turn) =>
        set((s) => ({ entities: s.entities.map((x) => (cosmosNameEq(x.name, name) || x.id === name) ? { ...x, lastEvolvedTurn: turn } : x) })),

      clearCosmos: () => set({ entities: [], seeded: false }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_COSMOS_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setCosmosApi: (patch) => set((s) => ({ cosmosApi: { ...s.cosmosApi, ...patch } })),
      setCosmosUseSharedApi: (v) => set({ cosmosUseSharedApi: v }),
      fetchCosmosModels: async () => {
        const s = get();
        const api = s.cosmosUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.cosmosApi;
        if (!api.baseUrl || !api.apiKey) { set({ cosmosModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ cosmosModelsLoading: true, cosmosModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ cosmosAvailableModels: models, cosmosModelsLoading: false });
        } catch (e: any) {
          set({ cosmosModelsError: e.message ?? '请求失败', cosmosModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-cosmos',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries) && persisted.settings.entries.length > 0
            ? persisted.settings.entries
            : DEFAULT_COSMOS_ENTRIES,
        },
        cosmosApi: { ...current.cosmosApi, ...(persisted?.cosmosApi ?? {}) },
        cosmosUseSharedApi: persisted?.cosmosUseSharedApi ?? current.cosmosUseSharedApi,
        cosmosAvailableModels: [],
        cosmosModelsLoading: false,
        cosmosModelsError: '',
      }),
    },
  ),
);
