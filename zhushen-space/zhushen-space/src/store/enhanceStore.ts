import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import { getAllImg, putImg, delImg } from '../systems/imageDb';
import {
  DEFAULT_BOSSES, DEFAULT_TABLES,
  type BossDef, type EnhanceTables, type EnhanceOutcome, type EnhanceResult,
} from '../systems/enhanceEngine';

/* ════════════════════════════════════════════
   装备强化系统 store（drpg-enhance）
   - 老板名册 / 率表 / 选中老板 = 全局配置（走 configExport，立绘除外）
   - pity 垫子计数 = 账号级全局进度（持久化但不进存档、不导出）
   - session = 当前一轮强化的会话日志（喂给吐槽 / 收尾 AI，不持久化）
   - 立绘大图 partialize 出 localStorage → 存 IndexedDB（key: enhance-boss:<id>）
   - 设计见记忆 equip-enhance-feature
════════════════════════════════════════════ */

/** 当前正在强化的一件装备的会话统计 */
export interface EnhanceSession {
  itemId: string;
  itemName: string;
  startLevel: number;   // 本轮开始时的强化等级
  curLevel: number;     // 当前等级（destroy 后 = -1）
  success: number;
  fail: number;
  downgrade: number;
  reset: number;        // 强化归零次数（+7~+9 失败）
  destroy: number;
  spent: number;        // 本轮累计花费乐园币
  protectUsed: number;
  amuletUsed: number;
  lastOutcome?: EnhanceOutcome;
  destroyed: boolean;
  log: { outcome: EnhanceOutcome; level: number; ts: number }[];
}

export interface EnhanceSettings {
  enabled: boolean;
  bosses: BossDef[];
  tables: EnhanceTables;
  selectedBossId: string;
  bossesVersion: number;   // 内置老板默认值版本：变更后旧存档的内置老板自动刷新成最新默认（保留立绘/自建老板）
}

const DEFAULT_SETTINGS: EnhanceSettings = {
  enabled: true,
  bosses: DEFAULT_BOSSES,
  tables: DEFAULT_TABLES,
  selectedBossId: DEFAULT_BOSSES[0].id,
  bossesVersion: 3,
};

function newSession(itemId: string, itemName: string, startLevel: number): EnhanceSession {
  return {
    itemId, itemName, startLevel, curLevel: startLevel,
    success: 0, fail: 0, downgrade: 0, reset: 0, destroy: 0,
    spent: 0, protectUsed: 0, amuletUsed: 0, destroyed: false, log: [],
  };
}

interface EnhanceState {
  settings: EnhanceSettings;
  pity: number;                // 垫子计数（只在爆装后 +1，满 PITY_THRESHOLD 下次必成清零）
  session: EnhanceSession | null;

  enhanceApi: ApiConfig;
  enhanceUseSharedApi: boolean;   // true = 复用正文生成 API
  enhanceAvailableModels: string[];
  enhanceModelsLoading: boolean;
  enhanceModelsError: string;

  setSettings: (patch: Partial<Omit<EnhanceSettings, 'bosses' | 'tables'>>) => void;
  upsertBoss: (b: BossDef) => void;
  removeBoss: (id: string) => void;
  setBossPortrait: (id: string, portrait: string | undefined) => void;
  selectBoss: (id: string) => void;
  setTables: (patch: Partial<EnhanceTables>) => void;
  resetTables: () => void;
  resetBosses: () => void;

  setPity: (n: number) => void;
  startSession: (itemId: string, itemName: string, startLevel: number) => void;
  applyAttempt: (r: EnhanceResult, cost: number, usedProtect: boolean, usedAmulet: boolean) => void;
  endSession: () => void;

  setEnhanceApi: (patch: Partial<ApiConfig>) => void;
  setEnhanceUseSharedApi: (v: boolean) => void;
  fetchEnhanceModels: () => Promise<void>;
}

let _bossSeq = Date.now();

export const useEnhance = create<EnhanceState>()(
  persist(
    (set, get) => ({
      settings: { ...DEFAULT_SETTINGS },
      pity: 0,
      session: null,

      enhanceApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o-mini',
        temperature: 0.9, maxTokens: 1024, topP: 1,
      },
      enhanceUseSharedApi: true,
      enhanceAvailableModels: [],
      enhanceModelsLoading: false,
      enhanceModelsError: '',

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      upsertBoss: (b) =>
        set((s) => {
          const id = b.id || `boss_${++_bossSeq}`;
          const exists = s.settings.bosses.some((x) => x.id === id);
          const bosses = exists
            ? s.settings.bosses.map((x) => (x.id === id ? { ...x, ...b, id } : x))
            : [...s.settings.bosses, { ...b, id }];
          return { settings: { ...s.settings, bosses } };
        }),

      removeBoss: (id) =>
        set((s) => {
          const bosses = s.settings.bosses.filter((b) => b.id !== id);
          const selectedBossId = s.settings.selectedBossId === id ? (bosses[0]?.id ?? '') : s.settings.selectedBossId;
          delImg(`enhance-boss:${id}`);
          return { settings: { ...s.settings, bosses, selectedBossId } };
        }),

      setBossPortrait: (id, portrait) => {
        if (portrait) putImg(`enhance-boss:${id}`, portrait); else delImg(`enhance-boss:${id}`);
        set((s) => ({ settings: { ...s.settings, bosses: s.settings.bosses.map((b) => (b.id === id ? { ...b, portrait } : b)) } }));
      },

      selectBoss: (id) => set((s) => ({ settings: { ...s.settings, selectedBossId: id } })),

      setTables: (patch) => set((s) => ({ settings: { ...s.settings, tables: { ...s.settings.tables, ...patch } } })),
      resetTables: () => set((s) => ({ settings: { ...s.settings, tables: { ...DEFAULT_TABLES } } })),
      resetBosses: () => set((s) => ({ settings: { ...s.settings, bosses: DEFAULT_BOSSES.map((b) => ({ ...b })), selectedBossId: DEFAULT_BOSSES[0].id } })),

      setPity: (n) => set({ pity: Math.max(0, n) }),

      startSession: (itemId, itemName, startLevel) => set({ session: newSession(itemId, itemName, startLevel) }),

      applyAttempt: (r, cost, usedProtect, usedAmulet) =>
        set((s) => {
          const sess = s.session;
          if (!sess) return { pity: r.pityAfter };
          const next: EnhanceSession = {
            ...sess,
            spent: sess.spent + cost,
            lastOutcome: r.outcome,
            protectUsed: sess.protectUsed + (usedProtect ? 1 : 0),
            amuletUsed: sess.amuletUsed + (usedAmulet ? 1 : 0),
            log: [{ outcome: r.outcome, level: r.toLevel, ts: Date.now() }, ...sess.log].slice(0, 40),
          };
          if (r.outcome === 'success' || r.outcome === 'crit' || r.outcome === 'guaranteed') { next.success += 1; next.curLevel = r.toLevel; }
          else if (r.outcome === 'downgrade') { next.downgrade += 1; next.curLevel = r.toLevel; }
          else if (r.outcome === 'reset') { next.reset += 1; next.curLevel = 0; }
          else if (r.outcome === 'destroy') { next.destroy += 1; next.destroyed = true; next.curLevel = -1; }
          else { next.fail += 1; }
          return { session: next, pity: r.pityAfter };
        }),

      endSession: () => set({ session: null }),

      setEnhanceApi: (patch) => set((s) => ({ enhanceApi: { ...s.enhanceApi, ...patch } })),
      setEnhanceUseSharedApi: (v) => set({ enhanceUseSharedApi: v }),
      fetchEnhanceModels: async () => {
        const s = get();
        const api = s.enhanceUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.enhanceApi;
        if (!api.baseUrl || !api.apiKey) { set({ enhanceModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ enhanceModelsLoading: true, enhanceModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ enhanceAvailableModels: models, enhanceModelsLoading: false });
        } catch (e: any) {
          set({ enhanceModelsError: e.message ?? '请求失败', enhanceModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-enhance',
      // 只持久化：配置(去掉立绘大图) + 账号级垫子计数 + API；session/瞬时模型态不存
      partialize: (s: any) => ({
        settings: { ...s.settings, bosses: (s.settings?.bosses ?? []).map((b: any) => ({ ...b, portrait: undefined })) },
        pity: s.pity,
        enhanceApi: s.enhanceApi,
        enhanceUseSharedApi: s.enhanceUseSharedApi,
      }),
      merge: (persisted: any, current) => {
        const pb = persisted?.settings?.bosses;
        return {
          ...current,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings ?? {}),
            bosses: (() => {
              let arr: any[] = Array.isArray(pb) && pb.length ? pb : DEFAULT_BOSSES.map((b) => ({ ...b }));
              // 老板默认值版本迁移：版本变更时，按 id 把内置老板的 名字/性格/预设/参数 刷新成最新默认（保留用户立绘 portrait 与自建老板）；版本一致后不再覆盖（护住 UI 自定义）
              if (persisted?.settings?.bossesVersion !== DEFAULT_SETTINGS.bossesVersion) {
                arr = arr.map((b) => { const d = DEFAULT_BOSSES.find((x) => x.id === b?.id); return d ? { ...d, portrait: b?.portrait } : b; });
                for (const d of DEFAULT_BOSSES) if (!arr.some((b) => b?.id === d.id)) arr.push({ ...d });
              }
              return arr;
            })(),
            bossesVersion: DEFAULT_SETTINGS.bossesVersion,
            tables: persisted?.settings?.tables?.version === DEFAULT_TABLES.version
              ? { ...DEFAULT_TABLES, ...persisted.settings.tables }
              : { ...DEFAULT_TABLES },   // 版本变更/旧存档无 version → 强制刷新成新率表（base+floor）
          },
          pity: typeof persisted?.pity === 'number' ? persisted.pity : 0,
          session: null,
          enhanceApi: { ...current.enhanceApi, ...(persisted?.enhanceApi ?? {}) },
          enhanceUseSharedApi: persisted?.enhanceUseSharedApi ?? current.enhanceUseSharedApi,
          enhanceAvailableModels: [],
          enhanceModelsLoading: false,
          enhanceModelsError: '',
        };
      },
    },
  ),
);

/** 启动 / 面板挂载时从 IndexedDB 回填老板立绘（大图不在 localStorage）*/
export async function hydrateEnhancePortraits(): Promise<void> {
  try {
    const all = await getAllImg();
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('enhance-boss:') && typeof v === 'string') patch[k.slice('enhance-boss:'.length)] = v;
    }
    if (Object.keys(patch).length === 0) return;
    useEnhance.setState((s) => ({
      settings: { ...s.settings, bosses: s.settings.bosses.map((b) => (patch[b.id] ? { ...b, portrait: patch[b.id] } : b)) },
    }));
  } catch { /* ignore */ }
}
