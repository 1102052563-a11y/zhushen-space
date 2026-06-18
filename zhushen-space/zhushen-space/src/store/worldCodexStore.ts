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

/* worldName 由「杂项演化」每回合按正文改写：常见格式/空格/「世界名+地点」漂移，且刚进世界那一两回合
   worldName 往往还是空串 —— 此时深挖会把情报建在空键 byWorld[""] 上，等 AI 补上真实世界名后就再也找不回，
   表现为「退出百科/过一两个回合，生成的东西就消失了」。
   解决：照 App.tsx 既有 norm() 约定做归一匹配，且候选键同时含「存储键」与该条目的「作品名 ipName」——
   作品名是玩家手动输入、稳定不漂移的锚点，靠它即使 worldName 变了/当初建在空键上也能把旧条目找回来。 */
const norm = (s: string) => (s || '').replace(/[\s·•・\-—_,，。、|｜（）()【】]/g, '').toLowerCase();

/** 解析 worldName 在 byWorld 中的实际存储键：精确 > 归一相等 > 双向子串（键或作品名）；都没有则返回原值（用于新建）。 */
function resolveKey(byWorld: Record<string, WorldCodexEntry>, worldName: string): string {
  if (byWorld[worldName]) return worldName;     // 精确命中（含空串）
  const n = norm(worldName);
  if (n.length < 2) return worldName;           // 太短/空：不做模糊，避免误并不同世界
  let sub: string | null = null;                // 用 null 占位：命中的键可能是空串（当初 worldName 为空时建的），不能当 falsy 丢弃
  for (const k of Object.keys(byWorld)) {
    // 候选 = 存储键 + 条目作品名(ipName)：worldName 漂移、甚至当初建在空键上，靠作品名也能找回
    const cands = [norm(k), norm(byWorld[k]?.ipName || '')].filter(Boolean);
    if (cands.includes(n)) return k;                                              // 归一相等：最稳，直接复用
    if (sub === null && cands.some((c) => c.includes(n) || n.includes(c))) sub = k;  // 「世界名 + 地点」之类子串漂移
  }
  return sub ?? worldName;
}

/** 面板按当前 worldName 解析读取已缓存条目（返回存储对象引用，保持 Zustand 选择器引用稳定）。 */
export function resolveCodexEntry(
  byWorld: Record<string, WorldCodexEntry>,
  worldName: string,
): WorldCodexEntry | undefined {
  return byWorld[resolveKey(byWorld, worldName)];
}

export const useWorldCodex = create<WorldCodexState>()(
  persist(
    (set) => ({
      enabled: true,
      byWorld: {},

      setEnabled: (v) => set({ enabled: v }),

      ensureWorld: (worldName) =>
        set((s) => {
          const key = resolveKey(s.byWorld, worldName);
          return s.byWorld[key] ? s : { byWorld: { ...s.byWorld, [key]: blankEntry(worldName) } };
        }),

      setIp: (worldName, ipName) =>
        set((s) => {
          const key = resolveKey(s.byWorld, worldName);
          const cur = s.byWorld[key] ?? blankEntry();
          return { byWorld: { ...s.byWorld, [key]: { ...cur, ipName } } };
        }),

      setSection: (worldName, moduleKey, content) =>
        set((s) => {
          const key = resolveKey(s.byWorld, worldName);
          const cur = s.byWorld[key] ?? blankEntry(worldName);
          return {
            byWorld: {
              ...s.byWorld,
              [key]: {
                ...cur,
                sections: { ...cur.sections, [moduleKey]: { content, updatedAt: Date.now() } },
              },
            },
          };
        }),

      clearWorld: (worldName) =>
        set((s) => {
          const key = resolveKey(s.byWorld, worldName);
          if (!s.byWorld[key]) return s;
          const next = { ...s.byWorld };
          delete next[key];
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
