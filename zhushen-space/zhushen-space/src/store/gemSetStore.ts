import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resolveApiChain, useSettings, type ApiConfig } from './settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { useEnhance } from './enhanceStore';
import {
  DEFAULT_GEM_SETS, SET_GEN_PROMPT, parseGeneratedSets, type GemSetDef,
} from '../systems/gemSets';

/** 宝石相关 AI（套装 / 自定义宝石生成）复用「装备强化」的 API 路由，玩家无需另配接口。 */
export function gemAiChain(): ApiConfig[] {
  const en = useEnhance.getState();
  const ss = useSettings.getState();
  const legacy = en.enhanceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : en.enhanceApi;
  return resolveApiChain('enhance', legacy);
}

/* ════════════════════════════════════════════
   宝石套装 store（drpg-gemsets）——套装定义**不写死**：玩家可自定义 / AI 可生成。
   - sets：套装定义列表（种子为 DEFAULT_GEM_SETS，玩家可增删改，AI 可追加）。属**全局配置**（走 configExport，不进存档）。
   - 宝石在生成时按 sets 的 members 归入某套装（gemEngine.setForGem）；改套装归属只影响**新**宝石，已烘焙宝石的 key 不动。
   - AI 生成复用「装备强化」的 API 路由（resolveApiChain('enhance', …)），无需另配接口。
   见记忆 gem-system-sets-drops-combatfix。
════════════════════════════════════════════ */

let _seq = Date.now();
function mkKey(existing: GemSetDef[]): string {
  let k = '';
  do { k = 'gs' + (_seq++).toString(36); } while (existing.some((s) => s.key === k));
  return k;
}

interface GemSetState {
  sets: GemSetDef[];
  generating: boolean;
  genError: string;

  upsertSet: (def: GemSetDef) => void;
  addBlankSet: () => string;              // 新建空白套装，返回其 key
  removeSet: (key: string) => void;
  resetSets: () => void;                  // 恢复内置默认（覆盖全部）
  addDefaultsBack: () => void;            // 把缺失的内置套装补回（不动玩家自定义）
  generateSet: (prompt?: string) => Promise<void>;   // AI 按玩家提示词生成一套并追加
}

export const useGemSets = create<GemSetState>()(
  persist(
    (set, get): GemSetState => ({
      sets: DEFAULT_GEM_SETS.map((s) => ({ ...s, tiers: s.tiers.map((t) => ({ ...t })), members: [...s.members] })),
      generating: false,
      genError: '',

      upsertSet: (def) => set((s) => {
        const i = s.sets.findIndex((x) => x.key === def.key);
        if (i < 0) return { sets: [...s.sets, def] };
        const next = s.sets.slice(); next[i] = def; return { sets: next };
      }),
      addBlankSet: () => {
        const key = mkKey(get().sets);
        set((s) => ({ sets: [...s.sets, {
          key, name: '新套装', emoji: '💎', theme: '自定义', desc: '',
          members: [], tiers: [{ need: 2, bonus: '' }, { need: 4, bonus: '' }, { need: 6, bonus: '' }],
        }] }));
        return key;
      },
      removeSet: (key) => set((s) => ({ sets: s.sets.filter((x) => x.key !== key) })),
      resetSets: () => set({ sets: DEFAULT_GEM_SETS.map((s) => ({ ...s, tiers: s.tiers.map((t) => ({ ...t })), members: [...s.members] })) }),
      addDefaultsBack: () => set((s) => {
        const have = new Set(s.sets.map((x) => x.key));
        const missing = DEFAULT_GEM_SETS.filter((d) => !have.has(d.key)).map((d) => ({ ...d, tiers: d.tiers.map((t) => ({ ...t })), members: [...d.members] }));
        return missing.length ? { sets: [...s.sets, ...missing] } : {};
      }),

      generateSet: async (prompt?: string) => {
        if (get().generating) return;
        set({ generating: true, genError: '' });
        try {
          const chain = gemAiChain();
          const existing = get().sets.map((s) => s.name).join('、');
          const req = (prompt ?? '').trim();
          const { content } = await apiChatFallback(chain, [
            { role: 'system', content: SET_GEN_PROMPT },
            { role: 'user', content: `请生成 1 套全新宝石套装。${req ? `玩家的具体要求（务必满足）：「${req}」。` : ''}已有套装名（务必避开、勿重复）：${existing || '（无）'}。只输出 JSON 数组。` },
          ], { timeoutMs: 120000, label: '宝石套装生成' });
          const parsed = parseGeneratedSets(content);
          if (!parsed.length) throw new Error('未能从模型输出解析出套装（格式不符，请重试或换非流式模型）');
          set((s) => {
            const acc = s.sets.slice();
            for (const p of parsed) acc.push({ ...p, key: mkKey(acc) });
            return { sets: acc };
          });
        } catch (e: any) {
          set({ genError: e?.message ?? '生成失败' });
        } finally {
          set({ generating: false });
        }
      },
    }),
    {
      name: 'drpg-gemsets',
      partialize: (s) => ({ sets: s.sets }),   // 仅持久化定义（generating/genError 是瞬时态）
      merge: (persisted: any, current) => ({
        ...current,
        sets: Array.isArray(persisted?.sets) && persisted.sets.length ? persisted.sets : current.sets,
      }),
    },
  ),
);
