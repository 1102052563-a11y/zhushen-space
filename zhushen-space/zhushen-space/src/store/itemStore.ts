import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import { normalizeEquipSlot } from '../systems/equipSlots';

export type ItemCategory =
  // 装备类
  | '武器' | '防具' | '饰品'
  // 消耗品/材料
  | '消耗品' | '材料' | '工具'
  // 特殊类
  | '重要物品' | '特殊物品' | '凡物' | '其他物品'
  // 旧版兼容（xianxia），保留以兼容旧存档
  | '功法' | '法宝' | '丹药' | '符箓' | '灵药' | '阵具';

export const ITEM_CATEGORIES: ItemCategory[] = [
  // 轮回乐园主分类（UI 只提供这些；旧版修仙分类 功法/法宝/丹药/符箓/灵药/阵具 仍保留在
  // ItemCategory 类型里以兼容老存档的既有物品，但不再作为可选项展示/生成）
  '武器', '防具', '饰品',
  '消耗品', '材料', '工具',
  '重要物品', '特殊物品', '凡物', '其他物品',
];

/** 轮回乐园物品/装备品级（颜色品质，由低到高），存入 gradeDesc。
 *  低阶 白→绿→蓝；中阶 紫→暗紫；高阶 淡金→金→暗金；顶阶 传说→史诗→圣灵；
 *  虚空阶 不朽→起源→永恒（永恒=成长终点档），创世为旧版保留的最高档（在永恒之上）。*/
export const ITEM_GRADES = [
  '白色', '绿色', '蓝色', '紫色', '暗紫色', '淡金', '金色', '暗金',
  '传说级', '史诗级', '圣灵级', '不朽级', '起源', '永恒', '创世',
] as const;
export type ItemGrade = typeof ITEM_GRADES[number];

/** 品级字串 → 数值档位（1=白色 … 15=创世，由低到高）。
 *  供装备判定/排序在 AI 未给出 numeric.grade 时按品级文字兜底取档。
 *  关键字按「更具体的在前」匹配（暗金先于金、淡金先于金、暗紫先于紫），避免子串误命中。*/
export function gradeToNum(grade?: string): number {
  const g = grade ?? '';
  const order: [string, number][] = [
    ['创世', 15], ['永恒', 14], ['起源', 13], ['不朽', 12], ['圣灵', 11], ['史诗', 10], ['传说', 9],
    ['暗金', 8], ['淡金', 6], ['金', 7], ['暗紫', 5], ['紫', 4], ['蓝', 3], ['绿', 2], ['白', 1],
  ];
  for (const [k, v] of order) if (g.includes(k)) return v;
  return 1;
}

/** 品级 → 文字配色（用于品级标签/字样上色，与世界书品质色阶一致）*/
export function gradeColorClass(grade?: string): string {
  const g = grade ?? '';
  if (g.includes('创世')) return 'text-rose-300';
  if (g.includes('永恒')) return 'text-cyan-200';
  if (g.includes('起源')) return 'text-fuchsia-300';
  if (g.includes('不朽')) return 'text-indigo-300';
  if (g.includes('圣灵')) return 'text-teal-200';
  if (g.includes('史诗')) return 'text-rose-400';
  if (g.includes('传说')) return 'text-orange-300';
  if (g.includes('暗金')) return 'text-amber-500';
  if (g.includes('淡金')) return 'text-amber-200';
  if (g.includes('金'))   return 'text-yellow-300';   // 金色
  if (g.includes('暗紫')) return 'text-violet-400';
  if (g.includes('紫'))   return 'text-purple-300';
  if (g.includes('蓝'))   return 'text-sky-300';
  if (g.includes('绿'))   return 'text-emerald-300';
  if (g.includes('白'))   return 'text-slate-200';
  return 'text-dim/70';
}

/** 品级 → 完整徽章样式（品级越高越华丽：颜色→发光→渐变→流光→脉冲）。用于品级标签醒目展示。
 *  配合 index.css 的 .grade-* 类。元素须只包含品级文字（渐变文字会把内容设为透明）。*/
export function gradeBadgeClass(grade?: string): string {
  const g = grade ?? '';
  if (g.includes('创世')) return 'grade-badge grade-grad grade-grad-genesis grade-shimmer grade-pulse';
  if (g.includes('永恒')) return 'grade-badge grade-grad grade-grad-eternal grade-shimmer grade-pulse';
  if (g.includes('起源')) return 'grade-badge grade-grad grade-grad-origin grade-shimmer grade-glow-1';
  if (g.includes('不朽')) return 'grade-badge grade-grad grade-grad-immortal grade-shimmer grade-glow-1';
  if (g.includes('圣灵')) return 'grade-badge grade-grad grade-grad-holy grade-shimmer grade-glow-1';
  if (g.includes('史诗')) return 'grade-badge grade-grad grade-grad-epic grade-shimmer';
  if (g.includes('传说')) return 'grade-badge grade-grad grade-grad-legend grade-shimmer';
  if (g.includes('暗金')) return 'grade-badge grade-grad grade-grad-darkgold grade-shimmer';
  if (g.includes('金'))   return 'grade-badge grade-grad grade-grad-gold grade-glow-2';   // 淡金/金色
  if (g.includes('暗紫')) return 'grade-badge grade-grad grade-grad-darkpurple grade-glow-1';
  if (g.includes('紫'))   return 'grade-badge text-purple-300 grade-glow-1';
  if (g.includes('蓝'))   return 'grade-badge text-sky-300';
  if (g.includes('绿'))   return 'grade-badge text-emerald-300';
  if (g.includes('白'))   return 'grade-badge text-slate-200';
  return 'text-dim/70';
}

/** 品级 → 物品/装备**名称**配色（同 gradeBadgeClass 的逐级华丽特效，但无品级/未知品级时回退为常规白色，避免名称发暗）。*/
export function gradeNameClass(grade?: string): string {
  const g = (grade ?? '').trim();
  if (!g) return 'text-slate-100';
  const cls = gradeBadgeClass(g);
  return cls === 'text-dim/70' ? 'text-slate-100' : cls;
}

/** @deprecated 旧版灵石，仅用于 localStorage 迁移兜底 */
export interface SpiritStoneWallet { 下品: number; 中品: number; 上品: number; 极品: number; }

export interface CurrencyWallet {
  乐园币: number;
  灵魂钱币: number;
  技能点: number;
  黄金技能点: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  gradeDesc: string;
  effect: string;
  quantity: number;
  equipped: boolean;
  equipSlot?: string;
  tags: string[];
  appearance?: string;
  notes?: string;
  acquisition?: string;   // 获得途径
  locked?: boolean;       // 锁定后不可删除
  // ── 固定条目模板（物品/装备生成必填，对齐生成卡格式）──
  origin?: string;        // 产地（如 黑铁纪元·废都）
  subType?: string;       // 类型细分（如 单手短刀/劈砍武器；category 是大类）
  combatStat?: string;    // 攻击力/防御力数值（如 15-28 / 防御 8-12）—— 装备类
  durability?: string;    // 耐久度（如 45/45）—— 装备类
  requirement?: string;   // 装备需求（如 力量10可发挥最大威力…）—— 装备类
  affix?: string;         // 词缀（如 [撕裂] …）—— 装备类
  score?: string;         // 评分（含品质区间说明，如 28（绿色装备区间11~30分…））
  intro?: string;         // 简介（flavor 文本）
  killCount?: string;     // 杀敌数量（仅武器类，随战斗累计）
  enhanceLevel?: number;  // 强化等级 0-16（装备强化系统，仅装备类；0/缺省=未强化）
  image?: string;         // 物品图片（上传的自定义图片 dataURL / 未来生图位）
  addedAt: number;
}

/* 预设条目（对应 JSON 里每个 rule / entry） */
export interface ItemPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;        // 'system' | 'user' | 'assistant'
  source?: string;     // 来自哪个 section，如 'entrySharedRules' / 'prompts.player'
}

export interface ItemPresetSettings {
  enabled: boolean;
  frequency: number;
  entries: ItemPresetEntry[];
  presetName: string;
  presetVersion?: number;
  auditEnabled?: boolean;   // 物品阶段后追加一次"对账纠错"调用（默认开）
}

interface ItemState {
  items: InventoryItem[];
  currency: CurrencyWallet;
  settings: ItemPresetSettings;

  // 独立 API 配置
  itemApi: ApiConfig;
  itemUseSharedApi: boolean;   // true = 复用正文生成 API
  itemAvailableModels: string[];
  itemModelsLoading: boolean;
  itemModelsError: string;

  addItem: (item: Omit<InventoryItem, 'id' | 'addedAt'> & { id?: string }) => void;
  updateItem: (id: string, patch: Partial<InventoryItem>) => void;
  removeItem: (id: string) => void;
  consumeItem: (id: string, quantity: number) => void;
  equipItem: (id: string, slot: string) => void;
  unequipItem: (id: string) => void;
  normalizeEquipSlots: () => void;   // 规范化所有已装备物品的槽位（修复历史非规范槽）
  clearBag: () => number;   // 清空背包（保留已装备 / 已锁定），返回清除数量
  dedupeByName: () => number;   // 合并背包内同名重复物品（防 AI 重复 createItem），返回合并掉的数量
  clearAll: () => void;

  adjustCurrency: (type: keyof CurrencyWallet, delta: number) => void;
  setCurrency: (wallet: Partial<CurrencyWallet>) => void;

  setSettings: (patch: Partial<Omit<ItemPresetSettings, 'entries'>>) => void;
  setPresetEntries: (entries: ItemPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<ItemPresetEntry, 'name' | 'content' | 'role'>>) => void;
  smartFilterEntries: () => number;   // 智能过滤，返回保留的条目数
  clearPreset: () => void;
  deleteDisabledEntries: () => number;

  setItemApi: (patch: Partial<ApiConfig>) => void;
  setItemUseSharedApi: (v: boolean) => void;
  fetchItemModels: () => Promise<void>;
}

function generateId(items: InventoryItem[]): string {
  const max = items.reduce((m, it) => {
    const n = parseInt(it.id.replace(/^I_B1_/, '')) || 0;
    return Math.max(m, n);
  }, 0);
  return `I_B1_${String(max + 1).padStart(2, '0')}`;
}

/* 可堆叠判定：消耗品/材料等同名累加；装备类（武器/防具/饰品/特殊/法宝）不堆叠——保留各自杀敌数/耐久/词缀等单件数据 */
const NO_STACK_CATS = new Set<string>(['武器', '防具', '饰品', '特殊物品', '法宝']);
export const isStackableCat = (cat?: string) => !NO_STACK_CATS.has(cat ?? '');
// 归一化：去标点/空格，并去掉「的/之」等填充虚词——让"劣质餐刀"与"劣质的餐刀"视为同名
const stackNorm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').toLowerCase();

export const useItems = create<ItemState>()(
  persist(
    (set) => ({
      items: [],
      currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 },
      settings: {
        enabled: false,
        frequency: 1,
        entries: [],
        presetName: '',
        auditEnabled: true,
      },

      itemApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
        topP: 1,
      },
      itemUseSharedApi: true,
      itemAvailableModels: [],
      itemModelsLoading: false,
      itemModelsError: '',

      addItem: (item) =>
        set((s) => {
          const wantId = (item as { id?: string }).id;
          const wantEquipped = !!(item as { equipped?: boolean }).equipped;
          // ① 指定 id 且该 id 已存在：同名→原地更新（防重复生成、保留装备/锁定）；异名→落到堆叠/新增
          if (wantId) {
            const existing = s.items.find((it) => it.id === wantId);
            if (existing && (existing.name ?? '') === (item.name ?? '')) {
              return { items: s.items.map((it) => it.id === wantId ? { ...it, ...item, id: wantId, equipped: it.equipped, equipSlot: it.equipSlot, locked: it.locked } as InventoryItem : it) };
            }
            if (existing) console.warn(`[Item] id ${wantId} 已被「${existing.name}」占用，新物品「${item.name}」改用新 id 防覆盖`);
          }
          // ② 同名堆叠：可堆叠类（消耗品/材料…）、未装备 → 累加数量到已有同名同品质条目，不再新建行
          if (!wantEquipped && isStackableCat(item.category)) {
            const stack = s.items.find((it) =>
              !it.equipped && isStackableCat(it.category) &&
              stackNorm(it.name) === stackNorm(item.name) && stackNorm(it.gradeDesc) === stackNorm(item.gradeDesc));
            if (stack) {
              return { items: s.items.map((it) => it.id === stack.id ? { ...it, quantity: (it.quantity || 1) + (item.quantity || 1) } : it) };
            }
          }
          // ③ 新增（id 未占用则沿用，否则生成）
          const id = wantId && !s.items.some((it) => it.id === wantId) ? wantId : generateId(s.items);
          return { items: [...s.items, { ...item, id, addedAt: Date.now() } as InventoryItem] };
        }),

      updateItem: (id, patch) =>
        set((s) => ({ items: s.items.map((it) => it.id === id ? { ...it, ...patch } : it) })),

      removeItem: (id) =>
        set((s) => ({ items: s.items.filter((it) => it.id !== id) })),

      consumeItem: (id, quantity) =>
        set((s) => ({
          items: s.items.flatMap((it) => {
            if (it.id !== id) return [it];
            const next = it.quantity - quantity;
            return next > 0 ? [{ ...it, quantity: next }] : [];
          }),
        })),

      equipItem: (id, slot) =>
        set((s) => {
          const target = s.items.find((it) => it.id === id);
          const norm = normalizeEquipSlot(slot, target?.category);   // 规范化槽位（armor:armor→armor:upper 等），与装备面板一致
          return { items: s.items.map((it) => {
            if (it.id === id) return { ...it, equipped: true, equipSlot: norm };
            // 同槽位的旧装备先卸回背包，避免被新装备"覆盖"后看不见
            if (norm && it.equipped && it.equipSlot === norm) return { ...it, equipped: false, equipSlot: undefined };
            return it;
          }) };
        }),

      /* 把已装备物品的槽位全部规范化（修复历史存档里 armor:armor/armor:legs 等非规范槽导致装备面板不显示）*/
      normalizeEquipSlots: () =>
        set((s) => ({ items: s.items.map((it) => (it.equipped && it.equipSlot ? { ...it, equipSlot: normalizeEquipSlot(it.equipSlot, it.category) } : it)) })),

      unequipItem: (id) =>
        set((s) => ({ items: s.items.map((it) => it.id === id ? { ...it, equipped: false, equipSlot: undefined } : it) })),

      clearBag: () => {
        let removed = 0;
        set((s) => {
          const kept = s.items.filter((it) => it.equipped || it.locked);
          removed = s.items.length - kept.length;
          return { items: kept };
        });
        return removed;
      },

      dedupeByName: () => {
        let removed = 0;
        set((s) => {
          const norm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();
          const idxByKey = new Map<string, number>();
          const out: InventoryItem[] = [];
          for (const it of s.items) {
            const key = norm(it.name);
            const at = key ? idxByKey.get(key) : undefined;
            if (!key || at === undefined) {
              if (key) idxByKey.set(key, out.length);
              out.push(it);
              continue;
            }
            const a = out[at];
            // 两件同名且都已装备在不同槽 → 视为合法双持/多件，不合并
            if (a.equipped && it.equipped && a.equipSlot !== it.equipSlot) { out.push(it); continue; }
            // 合并：主条优先 已装备/已锁定，其次先出现者；保留主条 id/装备/锁定；数量取较大值（不累加，避免误增）
            const primary = (a.equipped || a.locked) ? a : ((it.equipped || it.locked) ? it : a);
            const secondary = primary === a ? it : a;
            out[at] = { ...secondary, ...primary, quantity: Math.max(a.quantity || 1, it.quantity || 1) };
            removed++;
          }
          return removed ? { items: out } : s;
        });
        return removed;
      },

      clearAll: () => set({ items: [], currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } }),

      adjustCurrency: (type, delta) =>
        set((s) => ({ currency: { ...s.currency, [type]: Math.max(0, s.currency[type] + delta) } })),

      setCurrency: (wallet) =>
        set((s) => ({ currency: { ...s.currency, ...wallet } })),

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

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

      smartFilterEntries: () => {
        // 精确匹配名称：只保留以下条目，其余全部禁用
        const KEEP_NAMES = new Set([
          '身份定义',
          '进阶点数与技能点区分',
          'Standalone 物品装备固定条目模板',
          'Standalone 容器开启与一次性消耗强制自检',
          'Standalone 状态命令契约（SSOT）',
          'JSON语法铁则',
          '品阶显示规则',
          '词条稀有度',
          '品阶语义对应表',
          '物品ID规则',
          '背包物品列定义',
          'numeric.v1装备数值模板',
          '装备特性介绍表',
          '物价和金融系统',
          '物品格式规范',
          '物品与装备领域契约',
          '原著剧情指导使用边界',
          '场景信息',
          '本轮正文',
          '用户行为',
          '在场人物与物品清单',
          '物品创建规则',
          'Standalone 属性解析边界',
          'Standalone 功法属性语义规则',          // 旧名（保留兼容已导入预设）
          'Standalone 技能书属性语义规则',        // 新名（去修仙）
          'Standalone 领悟类技能分流',
          'Standalone 丹药堆叠单位',              // 旧名（保留兼容）
          'Standalone 消耗品堆叠单位',            // 新名（去修仙）
          'Standalone 物品分类 enum',
          'Standalone 丹药/消耗品命名边界',        // 旧名（保留兼容）
          'Standalone 消耗品命名边界',            // 新名（去修仙）
          'Standalone 杂物入库硬边界',
          '操作判定规则',
          '离场角色经历参考',
          '轻便多槽位强制结算',
          'Standalone 功法属性语义思维链',        // 旧名（保留兼容）
          'Standalone 技能书属性语义思维链',      // 新名（去修仙）
          '思考流程',
          '既有角色补全边界',
          '输出格式',
          'Standalone Item Task Outcome Context',
          'Standalone Item Spirit Stone Currency',
          'Standalone Item Structured Grade Render',
        ]);
        let kept = 0;
        useItems.setState((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) => {
              const isKeep = KEEP_NAMES.has(e.name);
              if (isKeep) kept++;
              return { ...e, enabled: isKeep };
            }),
          },
        }));
        return kept;
      },

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

      setItemApi: (patch) =>
        set((s) => ({ itemApi: { ...s.itemApi, ...patch } })),

      setItemUseSharedApi: (v) => set({ itemUseSharedApi: v }),

      fetchItemModels: async () => {
        // 动态读取当前有效 API（shared 时用 settingsStore 的 textApi）
        const s = useItems.getState();
        let api: ApiConfig;
        if (s.itemUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.itemApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ itemModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ itemModelsLoading: true, itemModelsError: '' });
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
          set({ itemAvailableModels: models, itemModelsLoading: false });
        } catch (e: any) {
          set({ itemModelsError: e.message ?? '请求失败', itemModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-items',
      // 物品图(image)体积大，不写 localStorage（改存 IndexedDB）
      partialize: (s: any) => ({ ...s, items: Array.isArray(s.items) ? s.items.map((it: any) => ({ ...it, image: undefined })) : s.items }),
      // 迁移：旧版用 systemPrompt: string，新版改为 entries[]
      // merge 确保旧 localStorage 数据不会因为缺 entries 字段而崩溃
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...current.settings,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries)
            ? persisted.settings.entries
            : current.settings.entries,
          systemPrompt: undefined,
        },
        // 货币迁移：旧版 spiritStones → 新版 currency（直接用默认值，旧数据丢弃）
        currency: { ...current.currency, ...(persisted?.currency ?? {}) },
        // 旧版没有 itemApi 时用默认值
        itemApi: { ...current.itemApi, ...(persisted?.itemApi ?? {}) },
        itemUseSharedApi: persisted?.itemUseSharedApi ?? current.itemUseSharedApi,
        // 运行时状态不持久化
        itemAvailableModels: [],
        itemModelsLoading: false,
        itemModelsError: '',
      }),
    }
  )
);

/* ── 从 JSON 构建有效 system prompt（仅 enabled 条目） ── */
export function buildItemSystemPrompt(entries: ItemPresetEntry[]): string {
  return entries
    .filter((e) => e.enabled)
    .map((e) => e.content)
    .join('\n\n');
}

/* ── 从 concurrent-evo preset JSON 中提取所有条目 ── */
/* ──────────────────────────────────────────────────────────────
   从 preset JSON 提取所有条目
   - entrySharedRules + prompts.* 全部提取
   - 物品相关条目默认启用，其他默认禁用
   - 用户可用「⚡ 智能筛选」进一步调整
────────────────────────────────────────────────────────────── */

// 这些 ID 的条目默认启用（物品/装备相关）
const ITEM_RELATED_IDS = new Set([
  'standalone-state-command-contract',
  'shared-item-domain-contract',
  'shared-item-format',
  'shared-item-id',
  'item-shared-item-columns',
  'shared-equipment-feature-table',
  'standalone-item-attribute-parse-boundary',
  'standalone-item-gongfa-attribute-semantics',
  'standalone-item-learned-ability-boundary',
  'standalone-item-stack-unit-boundary',
  'standalone-item-category-enum',
  'standalone-item-consumable-name-boundary',
  'standalone-item-misc-intake-boundary',
  'standalone-item-gongfa-attribute-cot',
  'standalone-item-task-outcome-context',
  'standalone-item-spirit-stone-currency',
  'standalone-item-structured-grade-render',
  'im-item-rules',
  'standalone-item-attribute-parse-boundary',
]);

// ID 或名称含这些关键词的条目也默认启用
const ITEM_KEYWORDS = ['item', '物品', '装备', 'equipment', 'inventory', '背包', '灵石', '货币'];

function isItemRelated(id: string, name: string): boolean {
  if (ITEM_RELATED_IDS.has(id)) return true;
  const lower = (id + ' ' + name).toLowerCase();
  return ITEM_KEYWORDS.some((kw) => lower.includes(kw));
}

export function extractItemPresetFromJson(
  raw: string
): { name: string; version?: number; entries: ItemPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '未命名预设';
    const version: number | undefined = data.version;
    const entries: ItemPresetEntry[] = [];

    function push(rule: any, source: string) {
      if (!rule.id || !rule.content) return;
      entries.push({
        identifier: rule.id,
        name:       rule.name ?? rule.id,
        content:    rule.content,
        enabled:    rule.enabled !== false,   // 全部默认启用，需要精简时用智能筛选
        role:       rule.role ?? 'system',
        source,
      });
    }

    // 1. entrySharedRules
    if (Array.isArray(data.entrySharedRules)) {
      for (const rule of data.entrySharedRules) push(rule, 'entrySharedRules');
    }

    // 2. prompts.* — 所有 section
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [sectionKey, section] of Object.entries(data.prompts) as [string, any][]) {
        if (section && Array.isArray(section.rules)) {
          for (const rule of section.rules) push(rule, `prompts.${sectionKey}`);
        }
      }
    }

    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}
