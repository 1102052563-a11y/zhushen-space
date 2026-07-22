import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 原著路线（canon route）进度 store。
   站点数据本体在 src/data/canonRoute.ts（生成物·由懒加载面板/注入方引用，这里不 import 以免拖进主 chunk）；
   本 store 只存「玩家跑到哪了 / 发生了什么」。进度域：随存档快照、新游戏清空（saveManager 已注册）。 */

export type SuxiaoTrackState = 'on-track' | 'derailed' | 'dead' | 'allied';

export interface CanonStationProgress {
  cleared: boolean;
  clearedAt?: number;
  rating?: string;       // 玩家该站评级（E-~S+）
  sourcePct?: number;    // 玩家该站世界之源 %
  beatCanon?: boolean;   // 是否超越苏晓基准
  encounters: string[];  // 与苏晓的相遇/合作/对抗记录（短句）
  questRelation?: '协同' | '对立' | '无关';   // 本站玩家主线与白夜任务的关系（进站时掷定·每站每档固定）
  checklist?: string[];  // 原著对照收集册：已复刻达成的原著支线/隐藏/猎杀条目（存原文条目串）
}

export interface CanonSuxiaoState {
  state: SuxiaoTrackState;   // on-track=按原著轨道；derailed=被玩家干涉转 NPC 演化；dead=已死亡；allied=结成同盟
  npcId?: string;            // 相遇建档后的 npcStore id
  derailedAt?: string;       // 脱轨位置说明（站id·锚点）
  note?: string;             // 当前动向补充（脱轨后由演化维护）
}

const DEFAULT_SUXIAO: CanonSuxiaoState = { state: 'on-track' };

interface CanonRouteState {
  enabled: boolean;       // 原著路线激活（创建角色时勾选）
  stationIndex: number;   // 当前站下标（0 起，对应 CANON_STATIONS）
  worldPhase: number;     // 当前站原著时间轴阶段（1 起，联动 suxiao.track 锚点）
  divergence: number;     // 当前站偏差度 0~100（只记录不惩罚）
  stations: Record<string, CanonStationProgress>;   // key = station.id
  suxiao: CanonSuxiaoState;

  setEnabled: (on: boolean) => void;
  enterStation: (index: number) => void;
  setWorldPhase: (n: number) => void;
  setDivergence: (n: number) => void;
  addEncounter: (stationId: string, note: string) => void;
  patchStation: (stationId: string, patch: Partial<CanonStationProgress>) => void;
  tickChecklist: (stationId: string, item: string) => void;
  markCleared: (stationId: string, r: { rating?: string; sourcePct?: number; beatCanon?: boolean }) => void;
  advance: () => void;
  setSuxiao: (patch: Partial<CanonSuxiaoState>) => void;
  clearAll: () => void;
}

const emptyProgress = (): CanonStationProgress => ({ cleared: false, encounters: [] });

export const useCanonRoute = create<CanonRouteState>()(
  persist(
    (set): CanonRouteState => ({
      enabled: false,
      stationIndex: 0,
      worldPhase: 1,
      divergence: 0,
      stations: {},
      suxiao: { ...DEFAULT_SUXIAO },

      setEnabled: (on) => set({ enabled: on }),
      // 进站：本站时间轴/偏差归位；历史进度（含重进）保留。
      // 换站时脱轨态复位回轨道（新世界=乐园给苏晓的新派发，他重新有自己的原著轨道）；同盟/死亡跨站保持。
      enterStation: (index) => set((st) => ({
        stationIndex: Math.max(0, index), worldPhase: 1, divergence: 0,
        suxiao: st.suxiao.state === 'derailed' ? { ...st.suxiao, state: 'on-track', note: undefined, derailedAt: undefined } : st.suxiao,
      })),
      setWorldPhase: (n) => set({ worldPhase: Math.max(1, Math.round(n) || 1) }),
      setDivergence: (n) => set({ divergence: Math.max(0, Math.min(100, Math.round(n) || 0)) }),
      addEncounter: (stationId, note) =>
        set((st) => {
          const cur = st.stations[stationId] ?? emptyProgress();
          return { stations: { ...st.stations, [stationId]: { ...cur, encounters: [...cur.encounters, note].slice(-30) } } };
        }),
      patchStation: (stationId, patch) =>
        set((st) => {
          const cur = st.stations[stationId] ?? emptyProgress();
          return { stations: { ...st.stations, [stationId]: { ...cur, ...patch } } };
        }),
      tickChecklist: (stationId, item) =>
        set((st) => {
          const cur = st.stations[stationId] ?? emptyProgress();
          const list = cur.checklist ?? [];
          if (list.includes(item)) return {};
          return { stations: { ...st.stations, [stationId]: { ...cur, checklist: [...list, item] } } };
        }),
      markCleared: (stationId, r) =>
        set((st) => {
          const cur = st.stations[stationId] ?? emptyProgress();
          return { stations: { ...st.stations, [stationId]: { ...cur, ...r, cleared: true, clearedAt: Date.now() } } };
        }),
      advance: () => set((st) => ({ stationIndex: st.stationIndex + 1, worldPhase: 1, divergence: 0 })),
      setSuxiao: (patch) => set((st) => ({ suxiao: { ...st.suxiao, ...patch } })),
      clearAll: () => set({ enabled: false, stationIndex: 0, worldPhase: 1, divergence: 0, stations: {}, suxiao: { ...DEFAULT_SUXIAO } }),
    }),
    { name: 'drpg-canon-route' }
  )
);
