import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import type { Deed } from './characterStore';

/* 基础属性 */
export interface PlayerAttrs {
  str: number;  // 力量
  agi: number;  // 敏捷
  con: number;  // 体质
  int: number;  // 智力
  cha: number;  // 魅力
  luck: number; // 幸运
}

/* 限时状态效果（buff/debuff，引擎按回合/游戏时间自动过期）。主角与 NPC 共用此结构。 */
export interface StatusEffect {
  id: string;
  name: string;           // 名称（中毒/加速/护盾…）
  type?: string;          // 类型（增益/减益/控制/持续伤害/异常…）
  emoji?: string;
  tone?: 'buff' | 'debuff' | 'neutral';
  effect?: string;        // 效果说明
  desc?: string;          // 描述（flavor/机制说明）
  tags?: string[];        // 标签（火/毒/物理/精神…）
  source?: string;        // 来源
  startTurn: number;      // 施加时的回合号（引擎填）
  durationTurns?: number; // 回合制时效：经过这么多回合后过期（最可靠）
  durationDesc?: string;  // 原始时长描述（"5分钟"/"3回合"），展示用
  startGameMin?: number | null; // 施加时的游戏时间（分钟，引擎填，可空）
  expireAtMin?: number | null;  // 游戏时间到期点（分钟，引擎算，可空）
  addedAt: number;
}

/* 主角档案（身份 + 属性 + 背景 + 经历） */
export interface PlayerProfile {
  // 身份信息
  name: string;          // 姓名
  level: number;         // 等级
  advancePoints: number; // 进阶点数（升级消耗，正文获取则增加，初始0）
  worldSource: number;   // 世界之源（当前任务世界累计获取，回归乐园后归0）
  tier: string;          // 阶位（一阶/二阶…）
  title: string;         // 称号
  profession: string;    // 职业
  arenaRank: string;     // 竞技场排名
  identity: string;      // 身份
  brandLevel: string;    // 烙印等级
  contractorId: string;  // 契约者编号（ID）
  homeParadise: string;  // 所属乐园（开局选定，基本不变：轮回乐园/圣光/死亡/天启/守望/自定义）
  preParadiseJob: string;// 主角背景（进入乐园前从事的职业；开局设定，基本不变）
  bioStrength: string;   // 生物强度模板（T0杂鱼~T9源初，存如"T3·勇士"；按强度框架由AI维护）
  attrs: PlayerAttrs;    // 基础属性
  status: string;        // 当前状态/Buff（长期/无时限，自由文本，主角演化维护列4）
  statusEffects: StatusEffect[]; // 限时状态（引擎自动过期）
  appearance: string;    // 外观描写（会随剧情演化）
  baseAppearance?: string; // 基底外观（开局设定，不可变；生图始终包含——决定主角长相的最底层基准）
  location: string;      // 所处位置
  avatar?: string;       // 主角立绘（上传的图片 dataURL / AI 生成）
  avatarTags?: string;   // 生成当前立绘所用的 imageTags（"外观变化时刷新"判断用）
  imageTags?: string;    // 生图提示词（英文 NAI/Danbooru tags，主角演化生成；肖像生图优先用它保证一致）
  // 档案
  background: string;    // 主角背景/出身
  deedLog: Deed[];       // 主角经历时间线
}

export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  name: '', level: 1, advancePoints: 0, worldSource: 0, tier: '一阶', title: '', profession: '', arenaRank: '',
  identity: '', brandLevel: '', contractorId: '', homeParadise: '', preParadiseJob: '', bioStrength: '',
  attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 },
  status: '', statusEffects: [], appearance: '', location: '',
  background: '', deedLog: [],
};

export interface PlayerPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

export interface PlayerPresetSettings {
  enabled: boolean;
  frequency: number;
  entries: PlayerPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

/* ════════════════════════════════════════════
   成就（仅主角；固定格式，不计入叙事记忆注入）
   id|名称|说明|分类|类型|稀有度|是否隐藏|解锁条件|解锁时间
════════════════════════════════════════════ */
export interface Achievement {
  id: string;          // 唯一编号（程序识别，不可重复）
  name: string;        // 成就名称
  desc: string;        // 成就说明
  category: string;    // 分类：战斗/探索/任务/生存/隐藏…
  type: string;        // 类型：普通/累计/隐藏/阶段/特殊
  rarity: string;      // 稀有度（与装备品级一致：白/绿/蓝/紫/淡金/金/暗金…）
  hidden: boolean;     // 是否隐藏成就
  condition: string;   // 解锁条件
  unlockTime?: string; // 解锁时间
  addedAt: number;
}

interface PlayerState {
  settings: PlayerPresetSettings;
  profile: PlayerProfile;
  achievements: Achievement[];
  playerApi: ApiConfig;
  playerUseSharedApi: boolean;
  playerAvailableModels: string[];
  playerModelsLoading: boolean;
  playerModelsError: string;

  setProfile: (patch: Partial<PlayerProfile>) => void;
  setAttr: (key: keyof PlayerAttrs, value: number) => void;
  setBackground: (text: string) => void;
  appendPlayerDeed: (deed: string | Deed) => void;
  removePlayerDeed: (index: number) => void;
  clearPlayerDeeds: () => void;
  addAchievement: (a: Omit<Achievement, 'addedAt'>) => void;   // upsert by id
  removeAchievement: (id: string) => void;
  addStatusEffect: (e: StatusEffect) => void;     // upsert by name
  removeStatusEffect: (idOrName: string) => void;
  setStatusEffects: (list: StatusEffect[]) => void;  // 过期清理整体重写
  setSettings: (patch: Partial<Omit<PlayerPresetSettings, 'entries'>>) => void;
  setPresetEntries: (entries: PlayerPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<PlayerPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  deleteDisabledEntries: () => number;
  smartFilterEntries: () => number;
  setPlayerApi: (patch: Partial<ApiConfig>) => void;
  setPlayerUseSharedApi: (v: boolean) => void;
  fetchPlayerModels: () => Promise<void>;
}

/* ── 主角演化智能筛选名单（精确匹配条目 name 字段）── */
const PLAYER_KEEP_NAMES = new Set([
  // ── 角色上下文注入 ──
  '生物强度生成框架(T0-T9属性预算)',
  '技能天赋称号固定格式',
  '成就系统固定格式',
  '所属乐园说明',
  '主角背景说明',
  '限时状态系统',
  '进阶点数与技能点区分',
  'NPC属性更新与正文一致',
  '副职业系统(配方)',
  '身份定义',
  '主角档案',
  '主角当前装备槽位',
  '主角物品表',
  '主角技能表',
  '共享技能字段与层级规则',
  '主角功法表',
  '主角叙事记忆',
  '上一回合场景',
  '上一回合合场景',   // 兼容两种写法
  '角色ID列表',
  '本轮正文',
  '用户行为',
  '主模型思维链',
  '本轮物品管理结果',
  '快速交谈记录',
  // ── 规则约束 ──
  '至高规则',
  '关系一致性与数值锚点',
  'JSON语法铁则',
  '属性白值/绿值规则',
  '主角变量列定义',
  '主角变量列定义(男性主角)',
  '主角出生年份与年龄规则',
  '可用指令',
  '主角身份背景强制校验',
  '主角修士身份校准',
  '词条定义',
  '品阶显示规则',
  '禁止事项',
  '并发演化输出约束',
  '输出格式',
  '主角情景指令示例集',
  '最终审查协议',
  '物价和金融系统',
  '等阶进阶与副职业熟练公式',
  // ── Standalone 规范 ──
  'Standalone Player Output Contract',
  'Standalone Player Task Outcome Context',
  'Standalone 最终属性写入边界',
  'Standalone 主角天赋写入边界',
  'Standalone 主角技能写入边界',
  'Standalone 调条属性格式',
  'Standalone 角色短指令格式',
  'Standalone 境界字段规范',
  'Standalone 副职业(非战斗技能)规范',
  'Standalone 角色坐标归属',
  'Standalone 肖像刷新标记',
  // ── User 类推理步骤 ──
  'COT开始',
  '数据识别',
  '数据识别(男性主角)',
  '出生年份与年龄校验',
  '属性写入边界',
  '指令生成',
  '最终审查',
  '最终审查(男性主角)',
  '出生年份与年龄终审',
]);

export const usePlayer = create<PlayerState>()(
  persist(
    (set) => ({
      settings: {
        enabled: false,
        frequency: 1,
        entries: [],
        presetName: '',
      },

      profile: { ...DEFAULT_PLAYER_PROFILE },
      achievements: [],

      playerApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
        topP: 1,
      },
      playerUseSharedApi: true,
      playerAvailableModels: [],
      playerModelsLoading: false,
      playerModelsError: '',

      setProfile: (patch) =>
        set((s) => ({ profile: { ...s.profile, ...patch } })),

      setAttr: (key, value) =>
        set((s) => ({ profile: { ...s.profile, attrs: { ...s.profile.attrs, [key]: value } } })),

      setBackground: (text) =>
        set((s) => ({ profile: { ...s.profile, background: text } })),

      appendPlayerDeed: (deed) =>
        set((s) => {
          const entry: Deed = typeof deed === 'string'
            ? { time: '', location: '', description: deed, addedAt: Date.now() }
            : { ...deed, addedAt: deed.addedAt ?? Date.now() };
          return { profile: { ...s.profile, deedLog: [...s.profile.deedLog, entry].slice(-20) } };
        }),

      removePlayerDeed: (index) =>
        set((s) => ({ profile: { ...s.profile, deedLog: s.profile.deedLog.filter((_, i) => i !== index) } })),

      addAchievement: (a) =>
        set((s) => {
          const list = s.achievements ?? [];
          const idx = list.findIndex((x) => x.id === a.id || x.name === a.name);
          const entry: Achievement = { ...a, addedAt: idx >= 0 ? (list[idx].addedAt ?? Date.now()) : Date.now() };
          const next = [...list];
          if (idx >= 0) next[idx] = entry; else next.push(entry);
          return { achievements: next };
        }),

      removeAchievement: (id) =>
        set((s) => ({ achievements: (s.achievements ?? []).filter((x) => x.id !== id && x.name !== id) })),

      addStatusEffect: (e) =>
        set((s) => {
          const list = s.profile.statusEffects ?? [];
          const idx = list.findIndex((x) => x.name === e.name);
          const next = [...list];
          if (idx >= 0) next[idx] = e; else next.push(e);
          return { profile: { ...s.profile, statusEffects: next } };
        }),

      removeStatusEffect: (idOrName) =>
        set((s) => ({ profile: { ...s.profile, statusEffects: (s.profile.statusEffects ?? []).filter((x) => x.id !== idOrName && x.name !== idOrName) } })),

      setStatusEffects: (list) =>
        set((s) => ({ profile: { ...s.profile, statusEffects: list } })),

      clearPlayerDeeds: () =>
        set((s) => ({ profile: { ...s.profile, deedLog: [] } })),

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
          const next = s.settings.entries.map((e) => {
            const enable = PLAYER_KEEP_NAMES.has(e.name);
            if (enable) kept++;
            return { ...e, enabled: enable };
          });
          return { settings: { ...s.settings, entries: next } };
        });
        return kept;
      },

      setPlayerApi: (patch) =>
        set((s) => ({ playerApi: { ...s.playerApi, ...patch } })),

      setPlayerUseSharedApi: (v) => set({ playerUseSharedApi: v }),

      fetchPlayerModels: async () => {
        let api: ApiConfig;
        const s = usePlayer.getState();
        if (s.playerUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.playerApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ playerModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ playerModelsLoading: true, playerModelsError: '' });
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
          set({ playerAvailableModels: models, playerModelsLoading: false });
        } catch (e: any) {
          set({ playerModelsError: e.message ?? '请求失败', playerModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-player-evo',
      // 主角立绘(avatar)体积大，不写 localStorage（改存 IndexedDB，见 systems/imageDb+imageSync）
      partialize: (s: any) => ({ ...s, profile: { ...s.profile, avatar: undefined } }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...current.settings,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries)
            ? persisted.settings.entries
            : current.settings.entries,
        },
        profile: {
          ...DEFAULT_PLAYER_PROFILE,
          ...(persisted?.profile ?? {}),
          attrs: { ...DEFAULT_PLAYER_PROFILE.attrs, ...(persisted?.profile?.attrs ?? {}) },
          deedLog: Array.isArray(persisted?.profile?.deedLog) ? persisted.profile.deedLog : [],
        },
        achievements: Array.isArray(persisted?.achievements) ? persisted.achievements : [],
        playerApi: { ...current.playerApi, ...(persisted?.playerApi ?? {}) },
        playerUseSharedApi: persisted?.playerUseSharedApi ?? current.playerUseSharedApi,
        playerAvailableModels: [],
        playerModelsLoading: false,
        playerModelsError: '',
      }),
    }
  )
);

/* ── 从 preset JSON 提取条目（与 itemStore 同格式） ── */
export function extractPlayerPresetFromJson(
  raw: string
): { name: string; version?: number; entries: PlayerPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '未命名预设';
    const version: number | undefined = data.version;
    const entries: PlayerPresetEntry[] = [];

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
    if (Array.isArray(data.itemSharedRules)) {
      for (const rule of data.itemSharedRules) push(rule, 'itemSharedRules');
    }

    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}

export function buildPlayerSystemPrompt(entries: PlayerPresetEntry[]): string {
  return entries
    .filter((e) => e.enabled)
    .map((e) => e.content)
    .join('\n\n');
}
