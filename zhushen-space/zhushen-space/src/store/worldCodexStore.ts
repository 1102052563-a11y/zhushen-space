import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   世界百科（drpg-world-codex）—— 按「世界名」缓存的原著情报
   - 进入某个同人任务世界后，玩家手动「深挖」生成各模块情报，缓存在该世界名下
   - 换世界换缓存；纯玩家可读，不注入正文（与 fanficStore 回注式增强区分）
   - 属游戏进度：纳入 saveManager 存档 + clearProgress（API 路由在 settingsStore）
════════════════════════════════════════════ */

export interface CodexSection {
  content: string;
  updatedAt: number;
}

export interface WorldCodexEntry {
  ipName: string;                              // 玩家指定的检索目标作品名（默认=世界名）
  sections: Record<string, CodexSection>;      // moduleKey -> 已生成内容
}

interface WorldCodexState {
  enabled: boolean;
  byWorld: Record<string, WorldCodexEntry>;    // key = 世界名（miscStore.worldName）

  setEnabled: (v: boolean) => void;
  /** 确保某世界条目存在并返回（内部用） */
  ensureWorld: (worldName: string) => void;
  setIp: (worldName: string, ipName: string) => void;
  setSection: (worldName: string, moduleKey: string, content: string) => void;
  clearWorld: (worldName: string) => void;
  clearAll: () => void;
}

const blankEntry = (ipName = ''): WorldCodexEntry => ({ ipName, sections: {} });

export const useWorldCodex = create<WorldCodexState>()(
  persist(
    (set) => ({
      enabled: true,
      byWorld: {},

      setEnabled: (v) => set({ enabled: v }),

      ensureWorld: (worldName) =>
        set((s) => (s.byWorld[worldName] ? s : { byWorld: { ...s.byWorld, [worldName]: blankEntry(worldName) } })),

      setIp: (worldName, ipName) =>
        set((s) => {
          const cur = s.byWorld[worldName] ?? blankEntry();
          return { byWorld: { ...s.byWorld, [worldName]: { ...cur, ipName } } };
        }),

      setSection: (worldName, moduleKey, content) =>
        set((s) => {
          const cur = s.byWorld[worldName] ?? blankEntry(worldName);
          return {
            byWorld: {
              ...s.byWorld,
              [worldName]: {
                ...cur,
                sections: { ...cur.sections, [moduleKey]: { content, updatedAt: Date.now() } },
              },
            },
          };
        }),

      clearWorld: (worldName) =>
        set((s) => {
          if (!s.byWorld[worldName]) return s;
          const next = { ...s.byWorld };
          delete next[worldName];
          return { byWorld: next };
        }),

      clearAll: () => set({ byWorld: {} }),
    }),
    {
      name: 'drpg-world-codex',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        enabled: persisted?.enabled ?? current.enabled,
        byWorld: persisted?.byWorld ?? {},
      }),
    },
  ),
);
