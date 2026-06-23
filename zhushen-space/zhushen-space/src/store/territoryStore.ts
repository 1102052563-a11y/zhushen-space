import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import territoryDefaultPreset from '../data/territoryDefaultPreset.json';

/* ════════════════════════════════════════════
   领地（territory）——轮回乐园个人基地，单一记录
   - 等级走人物阶位体系（一阶 Lv.1-10 … 无上之境 Lv.140+）
   - 建设进度 buildProgress 经验条，满 100 升一级
   - 建筑全自定义，单栋等级 1~5（无经验条），数量上限 = 等级 + 2
   - 成员关联现有 NPC（存 C-id）
   - 保留一个仓库；跨任务世界保留（不随换世界清空，但纳入存档/新游戏清空）
   数据 + 演化设置 + 独立 API 合一持久化（drpg-territory），同 miscStore 结构
════════════════════════════════════════════ */

/** 单栋自定义建筑 */
export interface Building {
  id: string;
  name: string;
  level: number;        // 1~5，直接 set，无经验条
  effect: string;       // 建筑效果
  appearance: string;   // 建筑外观
  description?: string;
  builtAt: number;
}

/** 领地效果（由领地等级/建筑赋予） */
export interface TerritoryEffect {
  name: string;
  desc: string;
  source?: string;
}

/** 领地成员（关联 NPC 的 C-id） */
export interface TerritoryMember {
  id: string;           // C1/C2… 指向 npcStore
  role?: string;        // 职务
  note?: string;
}

/** 领地仓库物品（与主背包分离） */
export interface TerritoryItem {
  id: string;
  name: string;
  quantity: number;
  category?: string;
  gradeDesc?: string;
  effect?: string;
  desc?: string;
  appearance?: string;
  addedAt: number;
}

export const BUILDING_MAX_LEVEL = 5;

/* 名称归一化匹配（去空白/标点/大小写后相等）：建筑/效果/仓库物品 的"同名→更新、按名删除"统一用它，
   容忍 AI 在不同回合给同名条目写出细微差异（多空格、加减标点）——避免重复堆叠或删不掉。 */
function tNorm(s?: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
}
function nameEq(a?: string, b?: string): boolean {
  const x = tNorm(a), y = tNorm(b);
  return !!x && !!y && x === y;
}

/* 物资身份归一化：AI 常把"数量级括注"嵌进物品名（罪孽精华(微量) vs 罪孽精华），
   导致同一物资被当成两条囤积。识别物资身份时剥掉**结尾**的纯数量级括注；
   只剥纯数量词，**不动**元素/属性/部位等会区分物品的括注（如「强化石（火）」不剥）。 */
const QTY_QUALIFIER_RE = /[（(]\s*(?:微量|少量|大量|海量|巨量|极少量|极微量|些许|一点|一些|少许|若干|大批|数个|数件)\s*[）)]\s*$/;
function stripQtyQualifier(s?: string): string {
  return (s ?? '').replace(QTY_QUALIFIER_RE, '').trim();
}
/** 仓库同名累加/去重用的身份键（剥掉数量级括注后再归一化） */
function itemKey(s?: string): string {
  return tNorm(stripQtyQualifier(s));
}

/** 仓库去重：同一物资（按 itemKey）只留一条、数量累加、缺字段回填；顺手把残留的数量级括注从名字里清掉。 */
function dedupeStorageList(items: TerritoryItem[]): TerritoryItem[] {
  const out: TerritoryItem[] = [];
  const idx: Record<string, number> = {};
  for (const it of items ?? []) {
    const cleanName = stripQtyQualifier(it.name) || it.name;
    const key = itemKey(it.name);
    if (key && idx[key] != null) {
      const t = out[idx[key]];
      out[idx[key]] = {
        ...t,
        quantity: t.quantity + (it.quantity || 0),
        category: t.category ?? it.category,
        gradeDesc: t.gradeDesc ?? it.gradeDesc,
        effect: t.effect ?? it.effect,
        desc: t.desc ?? it.desc,
        appearance: t.appearance ?? it.appearance,
      };
    } else {
      if (key) idx[key] = out.length;
      out.push({ ...it, name: cleanName });
    }
  }
  return out;
}

/** 建筑数量上限：每升一级 +1，初始（Lv.1）3 栋 */
export function buildingCap(level: number): number {
  return Math.max(1, (level || 1) + 2);
}

/* ── 预设条目（与杂项/势力演化同构，可导入导出）── */
export interface TerritoryPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

export const DEFAULT_TERRITORY_ENTRIES: TerritoryPresetEntry[] =
  ((territoryDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled !== false,
    role: r.role ?? 'system',
    source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (territoryDefaultPreset as any).name ?? '内置·领地演化';
const DEFAULT_PRESET_VERSION: number | undefined = (territoryDefaultPreset as any).version;

/** 把启用条目拼成 system prompt（运行时再替换 ${...} 占位符）*/
export function buildTerritorySystemPrompt(entries: TerritoryPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

/** 从预设 JSON 提取条目（支持 entrySharedRules / prompts.* / sharedRules）*/
export function extractTerritoryPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: TerritoryPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '领地演化预设';
    const version: number | undefined = data.version;
    const entries: TerritoryPresetEntry[] = [];
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

export interface TerritorySettings {
  enabled: boolean;
  frequency: number;     // 1=每回合，N=每 N 回合
  entries: TerritoryPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

const DEFAULT_SETTINGS: TerritorySettings = {
  enabled: false,
  frequency: 1,
  entries: DEFAULT_TERRITORY_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
};

interface TerritoryState {
  /* ── 领地记录（游戏进度，newGame 清空）── */
  unlocked: boolean;
  name: string;
  level: number;
  buildProgress: number;       // 0~100
  effects: TerritoryEffect[];
  appearance: string;
  passiveOutput: string;       // 被动产出说明（实际产出由 AI 走 storeItem/transferSpiritStones）
  members: TerritoryMember[];
  buildings: Building[];
  storageItems: TerritoryItem[];
  pendingActions: string[];

  /* ── 演化设置 + 独立 API（配置，newGame 保留）── */
  settings: TerritorySettings;
  territoryApi: ApiConfig;
  territoryUseSharedApi: boolean;
  territoryAvailableModels: string[];
  territoryModelsLoading: boolean;
  territoryModelsError: string;

  /* ── 领地记录 actions ── */
  unlock: (patch?: { name?: string; appearance?: string }) => void;
  setTerritory: (patch: Partial<Pick<TerritoryState, 'name' | 'appearance' | 'level' | 'passiveOutput' | 'unlocked'>>) => void;
  addProgress: (delta: number) => void;     // 涨经验，满自动升级
  setProgress: (v: number) => void;
  setLevel: (lv: number) => void;
  upsertBuilding: (b: Partial<Building> & { name: string }) => void;
  setBuildingLevel: (name: string, level: number) => void;
  removeBuilding: (name: string) => void;
  upsertEffect: (e: TerritoryEffect) => void;
  removeEffect: (name: string) => void;
  clearEffects: () => void;
  addMember: (id: string, patch?: { role?: string; note?: string }) => void;
  removeMember: (id: string) => void;
  /** 成员去重自愈：把"用 NPC 名字误当 id"的成员归位到真实 C-id，并合并同一 NPC 的重复条目 */
  reconcileMembers: (npcs: Record<string, { id: string; name: string }>) => void;
  storeItem: (it: Partial<TerritoryItem> & { name: string }) => void;
  takeItem: (name: string, qty?: number) => void;
  /** 仓库去重自愈：同名物资合并（含 "X(微量)" 与 "X" 这类被数量级括注拆开的重复） */
  dedupeStorage: () => void;
  clearTerritory: () => void;

  /* ── 预设 / 设置 actions ── */
  setSettings: (patch: Partial<Omit<TerritorySettings, 'entries'>>) => void;
  setPresetEntries: (entries: TerritoryPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<TerritoryPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;

  /* ── API actions ── */
  setTerritoryApi: (patch: Partial<ApiConfig>) => void;
  setTerritoryUseSharedApi: (v: boolean) => void;
  fetchTerritoryModels: () => Promise<void>;
}

/** 升级结算：进度 ≥100 时逐级升级、扣 100 */
function levelUp(level: number, progress: number): { level: number; buildProgress: number } {
  let lv = level || 1;
  let p = progress;
  while (p >= 100) { p -= 100; lv += 1; }
  return { level: lv, buildProgress: Math.max(0, Math.round(p)) };
}

export const useTerritory = create<TerritoryState>()(
  persist(
    (set, get) => ({
      unlocked: false,
      name: '',
      level: 1,
      buildProgress: 0,
      effects: [],
      appearance: '',
      passiveOutput: '',
      members: [],
      buildings: [],
      storageItems: [],
      pendingActions: [],

      settings: { ...DEFAULT_SETTINGS },
      territoryApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.6, maxTokens: 4096, topP: 1,
      },
      territoryUseSharedApi: true,
      territoryAvailableModels: [],
      territoryModelsLoading: false,
      territoryModelsError: '',

      unlock: (patch) =>
        set((s) => ({
          unlocked: true,
          // 名称读正文/玩家自定义，不硬编通用默认名；未提供则留空（UI 显示「未命名」可手动改）
          name: patch?.name?.trim() || s.name || '',
          appearance: patch?.appearance?.trim() || s.appearance,
        })),
      setTerritory: (patch) =>
        set((s) => {
          const next: any = {};
          if (patch.name != null && patch.name.trim()) next.name = patch.name.trim();
          if (patch.appearance != null) next.appearance = patch.appearance;
          if (patch.passiveOutput != null) next.passiveOutput = patch.passiveOutput;
          if (patch.unlocked != null) next.unlocked = patch.unlocked;
          if (patch.level != null) next.level = Math.max(1, Math.round(patch.level));
          return { ...s, ...next };
        }),
      addProgress: (delta) =>
        set((s) => {
          const { level, buildProgress } = levelUp(s.level, s.buildProgress + (delta || 0));
          return { level, buildProgress, unlocked: s.unlocked || delta > 0 ? true : s.unlocked };
        }),
      setProgress: (v) =>
        set((s) => {
          const { level, buildProgress } = levelUp(s.level, Math.max(0, v));
          return { level, buildProgress };
        }),
      setLevel: (lv) => set({ level: Math.max(1, Math.round(lv)) }),

      upsertBuilding: (b) =>
        set((s) => {
          const nm = b.name.trim();
          if (!nm) return s;
          const i = s.buildings.findIndex((x) => nameEq(x.name, nm));
          const lvl = b.level != null ? Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.round(b.level))) : undefined;
          if (i >= 0) {
            const next = [...s.buildings];
            next[i] = {
              ...next[i],
              ...(lvl != null ? { level: lvl } : {}),
              ...(b.effect != null ? { effect: b.effect } : {}),
              ...(b.appearance != null ? { appearance: b.appearance } : {}),
              ...(b.description != null ? { description: b.description } : {}),
            };
            return { buildings: next };
          }
          // 新建：受数量上限约束
          if (s.buildings.length >= buildingCap(s.level)) {
            console.warn(`[Territory] 建筑数量已达上限(${buildingCap(s.level)})，忽略新建：${nm}`);
            return s;
          }
          const nb: Building = {
            id: `BD_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            name: nm,
            level: lvl ?? 1,
            effect: b.effect ?? '',
            appearance: b.appearance ?? '',
            description: b.description,
            builtAt: Date.now(),
          };
          return { buildings: [...s.buildings, nb] };
        }),
      setBuildingLevel: (name, level) =>
        set((s) => ({
          buildings: s.buildings.map((x) =>
            nameEq(x.name, name) ? { ...x, level: Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.round(level))) } : x,
          ),
        })),
      removeBuilding: (name) => set((s) => ({ buildings: s.buildings.filter((x) => !nameEq(x.name, name)) })),

      upsertEffect: (e) =>
        set((s) => {
          const nm = (e.name ?? '').trim();
          if (!nm) return s;
          const i = s.effects.findIndex((x) => nameEq(x.name, nm));
          if (i >= 0) {
            const next = [...s.effects];
            next[i] = { ...next[i], desc: e.desc ?? next[i].desc, source: e.source ?? next[i].source };
            return { effects: next };
          }
          return { effects: [...s.effects, { name: nm, desc: e.desc ?? '', source: e.source }] };
        }),
      removeEffect: (name) => set((s) => ({ effects: s.effects.filter((x) => !nameEq(x.name, name)) })),
      clearEffects: () => set({ effects: [] }),

      addMember: (id, patch) =>
        set((s) => {
          const cid = id.trim();
          if (!cid) return s;
          const i = s.members.findIndex((m) => m.id === cid);
          if (i >= 0) {
            const next = [...s.members];
            next[i] = { ...next[i], ...(patch?.role != null ? { role: patch.role } : {}), ...(patch?.note != null ? { note: patch.note } : {}) };
            return { members: next };
          }
          return { members: [...s.members, { id: cid, role: patch?.role, note: patch?.note }] };
        }),
      removeMember: (id) => set((s) => ({ members: s.members.filter((m) => m.id !== id) })),
      reconcileMembers: (npcs) =>
        set((s) => {
          const resolve = (mid: string): string => {
            if (npcs[mid]) return mid;                                   // 已是有效 C-id
            const hit = Object.values(npcs).find((r) => nameEq(r.name, mid));
            return hit ? hit.id : mid;                                   // 把名字误当 id 的归位到 C-id
          };
          const out: TerritoryMember[] = [];
          const seen: Record<string, number> = {};
          let changed = false;
          for (const m of s.members) {
            const cid = resolve(m.id);
            if (cid !== m.id) changed = true;
            if (seen[cid] != null) {
              changed = true;                                           // 同一 NPC 重复条目 → 合并
              const t = out[seen[cid]];
              out[seen[cid]] = { ...t, role: t.role ?? m.role, note: t.note ?? m.note };
            } else {
              seen[cid] = out.length;
              out.push({ ...m, id: cid });
            }
          }
          return changed ? { members: out } : s;
        }),

      storeItem: (it) =>
        set((s) => {
          const rawNm = it.name.trim();
          if (!rawNm) return s;
          const nm = stripQtyQualifier(rawNm) || rawNm;   // 入库即剥掉"(微量)"等数量级括注，name 存纯净物资名
          const key = itemKey(nm);
          // 先精确匹配，再按"剥数量级括注"的身份键匹配（合并 "X(微量)" 与 "X"）
          const i = s.storageItems.findIndex((x) => nameEq(x.name, nm) || (!!key && itemKey(x.name) === key));
          if (i >= 0) {
            const next = [...s.storageItems];
            const addQty = it.quantity != null ? Math.round(it.quantity) : 1;
            next[i] = {
              ...next[i],
              name: stripQtyQualifier(next[i].name) || next[i].name,   // 顺手清掉旧条目残留的数量级括注
              quantity: next[i].quantity + addQty,
              ...(it.category != null ? { category: it.category } : {}),
              ...(it.gradeDesc != null ? { gradeDesc: it.gradeDesc } : {}),
              ...(it.effect != null ? { effect: it.effect } : {}),
              ...(it.desc != null ? { desc: it.desc } : {}),
              ...(it.appearance != null ? { appearance: it.appearance } : {}),
            };
            return { storageItems: next };
          }
          const ni: TerritoryItem = {
            id: it.id ?? `TI_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            name: nm,
            quantity: it.quantity != null ? Math.round(it.quantity) : 1,
            category: it.category, gradeDesc: it.gradeDesc, effect: it.effect,
            desc: it.desc, appearance: it.appearance, addedAt: Date.now(),
          };
          return { storageItems: [...s.storageItems, ni] };
        }),
      takeItem: (name, qty) =>
        set((s) => {
          const i = s.storageItems.findIndex((x) => nameEq(x.name, name) || x.id === name);
          if (i < 0) return s;
          const next = [...s.storageItems];
          const dec = qty != null ? Math.round(qty) : next[i].quantity;
          const remain = next[i].quantity - dec;
          if (remain <= 0) next.splice(i, 1);
          else next[i] = { ...next[i], quantity: remain };
          return { storageItems: next };
        }),
      dedupeStorage: () => set((s) => ({ storageItems: dedupeStorageList(s.storageItems) })),

      clearTerritory: () =>
        set({
          unlocked: false, name: '', level: 1, buildProgress: 0, effects: [], appearance: '',
          passiveOutput: '', members: [], buildings: [], storageItems: [], pendingActions: [],
        }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_TERRITORY_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setTerritoryApi: (patch) => set((s) => ({ territoryApi: { ...s.territoryApi, ...patch } })),
      setTerritoryUseSharedApi: (v) => set({ territoryUseSharedApi: v }),
      fetchTerritoryModels: async () => {
        const s = get();
        const api = s.territoryUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.territoryApi;
        if (!api.baseUrl || !api.apiKey) { set({ territoryModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ territoryModelsLoading: true, territoryModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ territoryAvailableModels: models, territoryModelsLoading: false });
        } catch (e: any) {
          set({ territoryModelsError: e.message ?? '请求失败', territoryModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-territory',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        // 读档即对仓库去重（修存量重复条目；成员归位需 NPC 表，放在领地演化阶段做）
        storageItems: dedupeStorageList(persisted?.storageItems ?? current.storageItems ?? []),
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries) && persisted.settings.entries.length > 0
            ? persisted.settings.entries
            : DEFAULT_TERRITORY_ENTRIES,
        },
        territoryApi: { ...current.territoryApi, ...(persisted?.territoryApi ?? {}) },
        territoryUseSharedApi: persisted?.territoryUseSharedApi ?? current.territoryUseSharedApi,
        territoryAvailableModels: [],
        territoryModelsLoading: false,
        territoryModelsError: '',
      }),
    },
  ),
);
