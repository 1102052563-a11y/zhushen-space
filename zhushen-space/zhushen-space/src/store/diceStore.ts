import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import type { DiceMode, Difficulty, OutcomeLevel, AttrKey, Advantage, ResolveResult } from '../systems/diceEngine';
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
  mode: DiceMode;             // 'd20'（默认）/ 'd100'
  judgeMode: 'frontend' | 'ai';  // 判定方式：frontend=纯前端确定性 / ai=骰子锚定+AI裁判（失败回退前端）
  animMs: number;            // 摇骰动画时长（常驻，不做跳过开关）
  includeLuck: boolean;      // 幸运修正是否计入
  /** 难度基础率/DC 覆盖（留空用引擎默认 DIFFICULTY_BASE） */
  diffOverride: Partial<Record<Difficulty, { rate: number; dc: number }>>;
}

const DEFAULT_SETTINGS: DiceSettings = {
  enabled: true,
  mode: 'd20',
  judgeMode: 'frontend',
  animMs: 760,
  includeLuck: true,
  diffOverride: {},
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
        settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}) },
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
