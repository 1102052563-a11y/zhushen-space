import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import type { DiceMode, Difficulty, OutcomeLevel, AttrKey, Advantage, ResolveResult, DiceTuning } from '../systems/diceEngine';
import { DEFAULT_TUNING } from '../systems/diceEngine';
import type { JudgeOutcome } from '../systems/diceJudge';

/* ════════════════════════════════════════════
   ROLL 点 / 摇骰子判定 —— 设置 + 历史 + 独立 API（drpg-dice）
   - 掷骰是纯前端确定性计算（systems/diceEngine.ts），不花 API
   - API 仅供骰子页可选的「✨AI建议属性/难度」按钮（featureKey:'dice'）
   - 设计见仓库根 `摇骰子判定-集成指导.md`
════════════════════════════════════════════ */

/** 一次检定的历史记录 */
export interface DiceCheckRecord {
  id: number;
  ts: number;
  actorName: string;
  actionText: string;
  attrLabel: string;
  difficulty?: Difficulty;
  opposed: boolean;
  opponentName?: string;
  mode: DiceMode;
  dice: number[];
  chosen: number;
  total: number;
  dc: number;
  P: number;
  level: OutcomeLevel;
  success: boolean;
  multiplier: number;
  backlash: boolean;
}

export interface DiceSettings {
  enabled: boolean;
  autoMode: boolean;          // 自动检定：发送消息即判定（关键词命中才 roll，结果只喂正文API+弹骰子卡）；关=走手动骰子面板
  diceReview: boolean;        // 检定审核窗：自动检定出结果后先弹窗给玩家（可重掷/编辑检定块），确认才进正文
  mode: DiceMode;             // 'd20'（默认）/ 'd100'
  judgeMode: 'frontend' | 'ai' | 'ai-full';  // frontend=纯前端确定性 / ai=骰子锚定+AI裁判(前端算数值·AI只裁定) / ai-full=AI全包(数值+成败全交AI·仿插件·放弃确定性·失败回退前端)
  rerollOnFail: number;       // 自动检定·失败自动重掷次数(0=关/1/2)：失败后最多再掷 N 次，一成功即停，全失败取最好一次（保留失败可能）
  animMs: number;            // 摇骰动画时长（常驻，不做跳过开关）
  includeLuck: boolean;      // 幸运修正是否计入
  /** 难度基础率/DC 覆盖（留空用引擎默认 DIFFICULTY_BASE） */
  diffOverride: Partial<Record<Difficulty, { rate: number; dc: number }>>;
  /** 技能/天赋/装备封顶 + 递减强度（防装备池碾压；可调，留空用 DEFAULT_TUNING） */
  tuning: DiceTuning;
}

const DEFAULT_SETTINGS: DiceSettings = {
  enabled: true,
  autoMode: false,
  diceReview: false,
  rerollOnFail: 0,
  mode: 'd20',
  judgeMode: 'frontend',
  animMs: 760,
  includeLuck: true,
  diffOverride: {},
  tuning: { ...DEFAULT_TUNING },
};

/** 骰子页草稿：关闭面板后保留，再次打开恢复上次/进行中的检定（含结果） */
export interface DiceDraft {
  action: string;
  attrKey: AttrKey;
  difficulty: Difficulty;
  advantage: Advantage;
  extraMod: number;
  opposed: boolean;
  social: boolean;
  opponent: string;
  enemyAttrKey: AttrKey;
  result: ResolveResult | null;
  verdict: JudgeOutcome | null;
}

interface DiceState {
  settings: DiceSettings;
  history: DiceCheckRecord[];
  draft: DiceDraft | null;

  diceApi: ApiConfig;
  diceUseSharedApi: boolean;
  diceAvailableModels: string[];
  diceModelsLoading: boolean;
  diceModelsError: string;

  setSettings: (patch: Partial<DiceSettings>) => void;
  setDiffOverride: (d: Difficulty, v: { rate: number; dc: number } | null) => void;
  addHistory: (rec: Omit<DiceCheckRecord, 'id' | 'ts'>) => void;
  clearHistory: () => void;
  setDraft: (d: DiceDraft) => void;
  clearDraft: () => void;

  setDiceApi: (patch: Partial<ApiConfig>) => void;
  setDiceUseSharedApi: (v: boolean) => void;
  fetchDiceModels: () => Promise<void>;
}

const HISTORY_CAP = 50;

export const useDice = create<DiceState>()(
  persist(
    (set, get) => ({
      settings: { ...DEFAULT_SETTINGS },
      history: [],
      draft: null,

      diceApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o-mini',
        temperature: 0.4, maxTokens: 1024, topP: 1,
      },
      diceUseSharedApi: true,
      diceAvailableModels: [],
      diceModelsLoading: false,
      diceModelsError: '',

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setDiffOverride: (d, v) =>
        set((s) => {
          const next = { ...s.settings.diffOverride };
          if (v == null) delete next[d];
          else next[d] = v;
          return { settings: { ...s.settings, diffOverride: next } };
        }),
      addHistory: (rec) =>
        set((s) => ({
          history: [{ ...rec, id: Date.now() + Math.floor(Math.random() * 1000), ts: Date.now() }, ...s.history].slice(0, HISTORY_CAP),
        })),
      clearHistory: () => set({ history: [] }),
      setDraft: (d) => set({ draft: d }),
      clearDraft: () => set({ draft: null }),

      setDiceApi: (patch) => set((s) => ({ diceApi: { ...s.diceApi, ...patch } })),
      setDiceUseSharedApi: (v) => set({ diceUseSharedApi: v }),
      fetchDiceModels: async () => {
        const s = get();
        const api = s.diceUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.diceApi;
        if (!api.baseUrl || !api.apiKey) { set({ diceModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ diceModelsLoading: true, diceModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ diceAvailableModels: models, diceModelsLoading: false });
        } catch (e: any) {
          set({ diceModelsError: e.message ?? '请求失败', diceModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-dice',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}), tuning: { ...DEFAULT_TUNING, ...(persisted?.settings?.tuning ?? {}) } },
        history: Array.isArray(persisted?.history) ? persisted.history : [],
        draft: persisted?.draft ?? null,
        diceApi: { ...current.diceApi, ...(persisted?.diceApi ?? {}) },
        diceUseSharedApi: persisted?.diceUseSharedApi ?? current.diceUseSharedApi,
        diceAvailableModels: [],
        diceModelsLoading: false,
        diceModelsError: '',
      }),
    },
  ),
);
