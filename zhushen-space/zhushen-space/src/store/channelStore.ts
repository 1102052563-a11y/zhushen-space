import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';   // lz 压缩
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import channelDefaultPreset from '../data/channelDefaultPreset.json';   // v4: 公共频道改用 ${home_paradise} 占位（按主角所属乐园渲染）

/* ════════════════════════════════════════════
   公共频道（一期：纯氛围·只读）
   轮回乐园的契约者公共广场——AI 模拟一群虚拟契约者发帖（交易/组队/综合/情报）。
   一期只读：展示帖子，不接结算；交易/组队的结构化字段已保留，供二期接入。
════════════════════════════════════════════ */

export type ChannelKey = 'general' | 'trade' | 'team' | 'battle' | 'world' | 'intel' | 'system';

export const CHANNEL_DEFS: { key: ChannelKey; label: string; icon: string; desc: string }[] = [
  { key: 'general', label: '综合', icon: '💬', desc: '互联网混沌中心：梗 / 情绪 / 整活' },
  { key: 'trade',   label: '交易', icon: '💰', desc: '买卖装备 / 物品 / 资源（功能化·简洁）' },
  { key: 'team',    label: '组队', icon: '🤝', desc: '行动层：招募 / 副本匹配 / 职业分配' },
  { key: 'battle',  label: '战斗', icon: '⚔', desc: '实时战况 / 求支援 / 集火指令' },
  { key: 'world',   label: '世界', icon: '🌐', desc: '世界见闻 / 剧情向闲谈' },
  { key: 'intel',   label: '情报', icon: '🛰', desc: '认知层：机制解析 / 攻略 / 敌情' },
  { key: 'system',  label: '系统', icon: '📢', desc: '轮回乐园公告 / 结算 / 判定（冷静无情绪）' },
];

/* 物品固定格式字段（出售/报价时完整展示 + 购买入背包时带入，与 InventoryItem 同名键对齐）*/
export interface ChannelItemInfo {
  origin?: string; subType?: string; combatStat?: string; durability?: string;
  requirement?: string; affix?: string; score?: string; intro?: string;
  appearance?: string; effect?: string; killCount?: string; tags?: string[];
}
/* 套装出售帖里的单件（成交时据 itemId 逐件扣除，带完整固定格式字段供展示/带入）*/
export interface ChannelBundleEntry extends ChannelItemInfo {
  itemId?: string; itemName?: string; category?: string; gradeDesc?: string; qty?: number;
}
/* 交易单：NPC 出售帖（一键购买）/ 玩家求购帖（求 itemName，预算 price）/ 玩家出售帖（卖 itemId，期望 price）*/
export interface ChannelOffer extends ChannelItemInfo {
  itemName?: string; category?: string; gradeDesc?: string;
  price?: string; currency?: string; qty?: number;
  itemId?: string;   // 玩家出售帖：所卖背包物品的真实 id（成交时据此扣除）
  note?: string;     // 玩家挂单时的留言/附言
  bundle?: ChannelBundleEntry[];   // 套装出售帖：一次打包多件（成交时逐件扣除）；单件帖不填
}
/* 报价/出价：契约者对玩家求购/出售帖的回应（每条带留言）。求购→卖家报价(给物品要价)；出售→买家出价(给钱) */
export interface ChannelQuote extends ChannelItemInfo {
  id: string;
  fromName: string; fromTier?: string; fromTag?: string;
  itemName?: string; category?: string; gradeDesc?: string; qty?: number;   // 求购时=卖家提供的物品；出售帖以物换物时=买家拿来换的物品（均带固定格式字段）
  price: number; currency: string;     // 报价/出价金额；以物换物时=买家额外找补给玩家的现金（平换为 0）
  note?: string;                       // 卖家/买家的留言
  barter?: boolean;                    // 出售帖：买家提议「以物换物」（用 itemName 那件物品+price 现金 换玩家的出售物）
  accepted?: boolean;
}
/* 组队帖（二期接入队用，一期仅展示）*/
export interface ChannelRecruit {
  role?: string; targetWorld?: string; reqTier?: string; slots?: string; reward?: string;
}

export interface ChannelMessage {
  id: string;
  channel: ChannelKey;
  authorName: string;        // 发帖契约者（姓+名）
  authorTier?: string;       // 阶位·Lv（如 三阶·Lv.25）
  authorTag?: string;        // 契约者 / 土著 / 随从 …
  authorJob?: string;        // 职业（多样化/隐藏职业，如 毁灭术士/龙之子/噬魂者）——供后续生成临时队友 NPC
  authorPersona?: string;    // 性格（简短）
  authorStrength?: string;   // 生物强度档（T0~T9，如 T3·勇士）
  kind: 'sell' | 'buy' | 'recruit' | 'seek' | 'chat' | 'intel' | 'battle' | 'system' | 'world';
  content: string;           // 帖子正文
  offer?: ChannelOffer;
  recruit?: ChannelRecruit;
  quotes?: ChannelQuote[];   // 玩家求购/出售帖收到的报价/出价列表
  byPlayer?: boolean;        // 玩家自己发的（求购/出售帖）
  traded?: boolean;          // 交易帖已成交（确定性结算后置 true，按钮变"已购买"）
  fulfilled?: boolean;       // 玩家求购/出售帖已成交（选定某条报价后置 true）
  speak?: boolean;           // 主角发言 / 其回复（发言功能产生：单独限 10 条、免于刷新清理）
  replyTo?: string;          // 回复针对的主角发言帖 id
  replyToName?: string;      // 主角主动回复某契约者时记录对象名，用于展示「↩ 回复 @X」
  postedAt: number;          // 落库时间戳（排序/过期用）
  gameTime?: string;         // 发帖时的游戏内时间（展示）
}

/* 预设条目（与各演化预设同构，可导入导出）*/
export interface ChannelPresetEntry {
  identifier: string; name: string; content: string; enabled: boolean; role: string; source?: string;
}

export const DEFAULT_CHANNEL_ENTRIES: ChannelPresetEntry[] =
  ((channelDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id, name: r.name, content: r.content,
    enabled: r.enabled !== false, role: r.role ?? 'system', source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (channelDefaultPreset as any).name ?? '内置·公共频道';
const DEFAULT_PRESET_VERSION: number | undefined = (channelDefaultPreset as any).version;

export function buildChannelSystemPrompt(entries: ChannelPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

export function extractChannelPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: ChannelPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '公共频道预设';
    const version: number | undefined = data.version;
    const entries: ChannelPresetEntry[] = [];
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

export interface ChannelSettings {
  enabled: boolean;
  channels: Record<ChannelKey, boolean>;  // 各频道开关
  perChannelKeep: number;                  // 每个频道只保留最新 N 条（老消息刷掉）
  maxMessages: number;                     // 总池硬上限（兜底，防极端膨胀）
  staleTurns: number;                      // 距上次刷新超过 N 回合则打开时自动刷新
  genCount: number;                        // 每次刷新生成的消息条数
  entries: ChannelPresetEntry[];
  presetName: string;
  presetVersion?: number;
}

const DEFAULT_SETTINGS: ChannelSettings = {
  enabled: true,
  channels: { general: true, trade: true, team: true, battle: true, world: true, intel: true, system: true },
  perChannelKeep: 10,
  maxMessages: 140,
  staleTurns: 3,
  genCount: 12,
  entries: DEFAULT_CHANNEL_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
};

interface ChannelState {
  messages: ChannelMessage[];
  lastRefreshTurn: number;     // 上次刷新时的回合号
  refreshing: boolean;         // 正在刷新（UI 显示）

  settings: ChannelSettings;
  channelApi: ApiConfig;
  channelUseSharedApi: boolean;
  channelAvailableModels: string[];
  channelModelsLoading: boolean;
  channelModelsError: string;

  addMessages: (items: Omit<ChannelMessage, 'id' | 'postedAt'>[]) => void;
  addPlayerPost: (post: Omit<ChannelMessage, 'id' | 'postedAt'>) => string;   // 玩家发求购/出售帖，返回帖子 id
  addPlayerSpeak: (channel: ChannelKey, playerName: string, playerContent: string, replyToName?: string) => string;  // 主角发言：立即上墙，返回帖 id；replyToName=主动回复的对象
  addOneSpeakReply: (channel: ChannelKey, reply: { authorName: string; authorTier?: string; authorJob?: string; authorPersona?: string; authorStrength?: string; content: string }, replyToId: string) => void;  // 一条回复，插到主角发言上方
  addQuotes: (postId: string, quotes: Omit<ChannelQuote, 'id'>[]) => void;    // 给玩家帖追加报价/出价
  removeMessage: (id: string) => void;
  markTraded: (id: string) => void;
  markFulfilled: (postId: string) => void;   // 玩家帖成交
  clearChannel: () => void;
  setRefreshing: (v: boolean) => void;
  markRefreshed: (turn: number) => void;

  setSettings: (patch: Partial<Omit<ChannelSettings, 'entries'>>) => void;
  toggleChannel: (k: ChannelKey) => void;
  setPresetEntries: (entries: ChannelPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  resetPreset: () => void;

  setChannelApi: (patch: Partial<ApiConfig>) => void;
  setChannelUseSharedApi: (v: boolean) => void;
  fetchChannelModels: () => Promise<void>;
}

export const useChannel = create<ChannelState>()(
  persist(
    (set, get) => ({
      messages: [],
      lastRefreshTurn: -999,
      refreshing: false,

      settings: { ...DEFAULT_SETTINGS },
      channelApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.9, maxTokens: 4096, topP: 1,
      },
      channelUseSharedApi: true,
      channelAvailableModels: [],
      channelModelsLoading: false,
      channelModelsError: '',

      addMessages: (items) =>
        set((s) => {
          let max = s.messages.reduce((m, x) => Math.max(m, Number(/^M_(\d+)$/.exec(x.id)?.[1]) || 0), 0);
          const add: ChannelMessage[] = items
            .filter((it) => it && it.content && it.content.trim())
            .map((it) => ({ ...it, id: `M_${++max}`, postedAt: Date.now() }));
          // 新帖在前；**每个频道只保留最新 perChannelKeep 条**，超出的老消息刷掉
          // 例外：玩家自己未成交的求购/出售帖（byPlayer && !fulfilled）永不刷掉，等成交/取消
          const merged = [...add, ...s.messages];
          const keep = Math.max(1, s.settings.perChannelKeep || 10);
          const counts: Record<string, number> = {};
          const kept = merged.filter((m) => {
            if (m.byPlayer && !m.fulfilled) return true;   // 玩家活跃挂单豁免
            if (m.speak) return true;                      // 主角发言/回复豁免（由 addSpeak 单独限额）
            counts[m.channel] = (counts[m.channel] ?? 0) + 1;
            return counts[m.channel] <= keep;
          });
          // 兜底总上限不得低于「每频道 N × 频道数」，避免老存档里偏小的 maxMessages 误删满额频道
          const cap = Math.max(s.settings.maxMessages || 0, keep * CHANNEL_DEFS.length);
          return { messages: kept.slice(0, cap) };
        }),
      addPlayerPost: (post) => {
        let newId = '';
        set((s) => {
          const max = s.messages.reduce((m, x) => Math.max(m, Number(/^M_(\d+)$/.exec(x.id)?.[1]) || 0), 0);
          newId = `M_${max + 1}`;
          const msg: ChannelMessage = { ...post, id: newId, postedAt: Date.now(), byPlayer: true, quotes: post.quotes ?? [] };
          return { messages: [msg, ...s.messages] };
        });
        return newId;
      },
      addPlayerSpeak: (channel, playerName, playerContent, replyToName) => {
        let id = '';
        set((s) => {
          const max = s.messages.reduce((m, x) => Math.max(m, Number(/^M_(\d+)$/.exec(x.id)?.[1]) || 0), 0);
          id = `M_${max + 1}`;
          const post: ChannelMessage = { id, channel, authorName: playerName || '主角', content: playerContent, kind: 'chat', byPlayer: true, speak: true, postedAt: Date.now(), ...(replyToName ? { replyToName } : {}) };
          let merged = [post, ...s.messages];
          const speakIds = merged.filter((m) => m.speak).map((m) => m.id);
          if (speakIds.length > 10) { const rm = new Set(speakIds.slice(10)); merged = merged.filter((m) => !rm.has(m.id)); }
          return { messages: merged };
        });
        return id;
      },
      addOneSpeakReply: (channel, reply, replyToId) =>
        set((s) => {
          if (!reply || !reply.content || !String(reply.content).trim()) return s;
          const max = s.messages.reduce((m, x) => Math.max(m, Number(/^M_(\d+)$/.exec(x.id)?.[1]) || 0), 0);
          const msg: ChannelMessage = { id: `M_${max + 1}`, channel, authorName: String(reply.authorName || '某契约者').slice(0, 20), authorTier: reply.authorTier, authorJob: reply.authorJob, authorPersona: reply.authorPersona, authorStrength: reply.authorStrength, content: String(reply.content), kind: 'chat', speak: true, replyTo: replyToId, postedAt: Date.now() };
          let merged = [msg, ...s.messages];   // 插到最前 = 主角发言上方
          const speakIds = merged.filter((m) => m.speak).map((m) => m.id);
          if (speakIds.length > 10) { const rm = new Set(speakIds.slice(10)); merged = merged.filter((m) => !rm.has(m.id)); }
          return { messages: merged };
        }),
      addQuotes: (postId, quotes) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== postId) return m;
            const base = m.quotes ?? [];
            let n = base.reduce((mx, q) => Math.max(mx, Number(/_(\d+)$/.exec(q.id)?.[1]) || 0), 0);
            const add = quotes.filter((q) => q && (q.price != null || (q as any).barter || q.itemName)).map((q) => ({ ...q, id: `Q_${postId}_${++n}`, price: Math.max(0, Math.round(Number(q.price) || 0)) }));
            return { ...m, quotes: [...base, ...add] };
          }),
        })),
      removeMessage: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      markTraded: (id) => set((s) => ({ messages: s.messages.map((m) => m.id === id ? { ...m, traded: true } : m) })),
      markFulfilled: (postId) => set((s) => ({ messages: s.messages.map((m) => m.id === postId ? { ...m, fulfilled: true } : m) })),
      clearChannel: () => set({ messages: [], lastRefreshTurn: -999 }),
      setRefreshing: (v) => set({ refreshing: v }),
      markRefreshed: (turn) => set({ lastRefreshTurn: turn }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      toggleChannel: (k) => set((s) => ({ settings: { ...s.settings, channels: { ...s.settings.channels, [k]: !s.settings.channels[k] } } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_CHANNEL_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setChannelApi: (patch) => set((s) => ({ channelApi: { ...s.channelApi, ...patch } })),
      setChannelUseSharedApi: (v) => set({ channelUseSharedApi: v }),
      fetchChannelModels: async () => {
        const s = get();
        const api = s.channelUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.channelApi;
        if (!api.baseUrl || !api.apiKey) { set({ channelModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ channelModelsLoading: true, channelModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ channelAvailableModels: models, channelModelsLoading: false });
        } catch (e: any) {
          set({ channelModelsError: e.message ?? '请求失败', channelModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-channel',
      storage: lzStorage(),   // lz 压缩
      merge: (persisted: any, current) => {
        const ps = persisted?.settings ?? {};
        const pv = ps.presetVersion;
        // 内置预设版本升级（如 v1→v2）时自动替换为新默认；但不动用户自行导入的预设（其 version 缺失或非内置编号）
        const upgrade = !(Array.isArray(ps.entries) && ps.entries.length > 0)
          || (typeof pv === 'number' && pv < (DEFAULT_PRESET_VERSION ?? 0));
        return {
        ...current,
        ...persisted,
        refreshing: false,   // 刷新态不持久化
        settings: {
          ...DEFAULT_SETTINGS,
          ...ps,
          channels: { ...DEFAULT_SETTINGS.channels, ...(ps.channels ?? {}) },
          entries: upgrade ? DEFAULT_CHANNEL_ENTRIES : ps.entries,
          presetName: upgrade ? DEFAULT_PRESET_NAME : (ps.presetName ?? DEFAULT_PRESET_NAME),
          presetVersion: upgrade ? DEFAULT_PRESET_VERSION : ps.presetVersion,
        },
        channelApi: { ...current.channelApi, ...(persisted?.channelApi ?? {}) },
        channelUseSharedApi: persisted?.channelUseSharedApi ?? current.channelUseSharedApi,
        channelAvailableModels: [],
        channelModelsLoading: false,
        channelModelsError: '',
        };
      },
    },
  ),
);
