import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import type { LadderEntry } from '../systems/arena';

/* ════════════════════════════════════════════
   竞技场 store（drpg-arena）
   · ladders / defeated / pendingChallenge：游戏进度，clearArena() 由 saveManager 在新游戏时清空
   · config / 独立 API：随设置长期持久（不随「新游戏」清空）
   榜单一旦生成就缓存进 ladders（这就是「记忆」）；前50为资格榜，主角打进后固定不再重 roll。
════════════════════════════════════════════ */

export interface ArenaLadder {
  playerRank: number;     // 主角当前名次
  bestRank: number;       // 历史最佳（资格判定用）
  streak: number;         // 连胜
  entries: LadderEntry[]; // 当前缓存的榜单窗口
  windowKey: string;      // 当前缓存窗口标识：'home' | `t${target}`
  top50: LadderEntry[];   // 资格榜：主角进过前50后固定记忆
  generatedAt: number;
}

export interface DefeatedRec {
  id: string;
  arenaId: string;
  arenaName: string;
  name: string;
  tier: string;
  job: string;
  strength: string;
  persona?: string;
  rank: number;           // 被击败者当时的名次
  at: number;
  summary?: string;       // 一句话战报
  reward?: string;        // 这场拿到的奖励摘要
}

export interface PendingChallenge {
  arenaId: string;
  arenaName: string;
  opponentCid: string;    // 临时对手的 NPC id（C*）
  targetRank: number;     // 挑战的名次（胜则主角名次取代为此）
  opponent: { name: string; tier: string; job: string; strength: string; persona?: string; rank: number };
}

export interface ArenaConfig {
  enabled: boolean;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = { enabled: true };

export function emptyLadder(seedRank: number): ArenaLadder {
  return { playerRank: seedRank, bestRank: seedRank, streak: 0, entries: [], windowKey: '', top50: [], generatedAt: 0 };
}

interface ArenaState {
  ladders: Record<string, ArenaLadder>;
  defeated: DefeatedRec[];
  pendingChallenge: PendingChallenge | null;

  config: ArenaConfig;
  arenaApi: ApiConfig;
  arenaUseSharedApi: boolean;
  arenaAvailableModels: string[];
  arenaModelsLoading: boolean;
  arenaModelsError: string;

  // ── 榜单 / 记忆 ──
  ensureLadder: (arenaId: string, seedRank: number) => ArenaLadder;       // 无则按种子建，有则返回
  setEntries: (arenaId: string, entries: LadderEntry[], windowKey: string) => void;
  setTop50: (arenaId: string, entries: LadderEntry[]) => void;
  setLadder: (arenaId: string, patch: Partial<ArenaLadder>) => void;
  winAtRank: (arenaId: string, targetRank: number) => number;             // 胜：名次取代为 targetRank，返回新名次

  // ── 挑战流程 ──
  setPendingChallenge: (p: PendingChallenge | null) => void;
  addDefeated: (rec: Omit<DefeatedRec, 'id' | 'at'> & { at?: number }) => void;
  clearDefeated: () => void;

  // ── 维护 ──
  clearArena: () => void;     // 仅清进度（榜单/击败/挑战），保留 config/API

  // ── 配置 / API ──
  setConfig: (patch: Partial<ArenaConfig>) => void;
  setArenaApi: (patch: Partial<ApiConfig>) => void;
  setArenaUseSharedApi: (v: boolean) => void;
}

let defSeq = 0;

export const useArena = create<ArenaState>()(
  persist(
    (set, get) => ({
      ladders: {},
      defeated: [],
      pendingChallenge: null,

      config: { ...DEFAULT_ARENA_CONFIG },
      arenaApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.85, maxTokens: 2048, topP: 1,
      },
      arenaUseSharedApi: true,
      arenaAvailableModels: [],
      arenaModelsLoading: false,
      arenaModelsError: '',

      ensureLadder: (arenaId, seedRank) => {
        const existing = get().ladders[arenaId];
        if (existing) return existing;
        const fresh = emptyLadder(seedRank);
        set((s) => ({ ladders: { ...s.ladders, [arenaId]: fresh } }));
        return fresh;
      },
      setEntries: (arenaId, entries, windowKey) => set((s) => {
        const cur = s.ladders[arenaId] ?? emptyLadder(entries.find((e) => e.isPlayer)?.rank ?? 1000);
        return { ladders: { ...s.ladders, [arenaId]: { ...cur, entries, windowKey, generatedAt: Date.now() } } };
      }),
      setTop50: (arenaId, entries) => set((s) => {
        const cur = s.ladders[arenaId]; if (!cur) return s;
        return { ladders: { ...s.ladders, [arenaId]: { ...cur, top50: entries } } };
      }),
      setLadder: (arenaId, patch) => set((s) => {
        const cur = s.ladders[arenaId]; if (!cur) return s;
        return { ladders: { ...s.ladders, [arenaId]: { ...cur, ...patch } } };
      }),
      winAtRank: (arenaId, targetRank) => {
        const cur = get().ladders[arenaId] ?? emptyLadder(targetRank);
        const newRank = Math.max(1, Math.min(cur.playerRank, Math.round(targetRank)));   // 直接取代被挑战者名次（只升不降）
        const bestRank = Math.min(cur.bestRank, newRank);
        set((s) => ({ ladders: { ...s.ladders, [arenaId]: { ...cur, playerRank: newRank, bestRank, streak: cur.streak + 1 } } }));
        return newRank;
      },

      setPendingChallenge: (p) => set({ pendingChallenge: p }),
      addDefeated: (rec) => set((s) => ({
        defeated: [{ ...rec, id: `def_${Date.now()}_${defSeq++}`, at: rec.at ?? Date.now() }, ...s.defeated].slice(0, 200),
      })),
      clearDefeated: () => set({ defeated: [] }),

      clearArena: () => set({ ladders: {}, defeated: [], pendingChallenge: null }),

      setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setArenaApi: (patch) => set((s) => ({ arenaApi: { ...s.arenaApi, ...patch } })),
      setArenaUseSharedApi: (v) => set({ arenaUseSharedApi: v }),
    }),
    {
      name: 'drpg-arena',
      version: 1,
      // 模型列表瞬时态不持久化
      partialize: (s) => ({
        ladders: s.ladders, defeated: s.defeated, pendingChallenge: s.pendingChallenge,
        config: s.config, arenaApi: s.arenaApi, arenaUseSharedApi: s.arenaUseSharedApi,
      }) as ArenaState,
    },
  ),
);
