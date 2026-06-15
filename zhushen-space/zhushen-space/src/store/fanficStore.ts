import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 同人增强：已锁定的虚构作品角色设定（按角色名累积，逐回合更新，注入下回合正文保持一致）*/
export interface FanficEntry {
  name: string;        // 角色名（显示用）
  work: string;        // 所属作品
  aliases: string;     // 别名 / 所属阵营
  keySettings: string; // 本轮参考的关键设定（口癖/能力/性格底色…）
  background: string;  // 补充背景信息
  updatedAt: number;
}

/* 归一化角色名做主键，避免「鸣人」「漩涡鸣人」分裂太多（仅去标点/空白/大小写）*/
const norm = (s: string) => (s || '').replace(/[\s·•・\-—_,，。、|｜()（）【】]/g, '').toLowerCase();

interface FanficState {
  entries: Record<string, FanficEntry>;   // key = 归一化角色名
  upsert: (e: Omit<FanficEntry, 'updatedAt'>) => void;
  remove: (name: string) => void;
  clearAll: () => void;
}

export const useFanfic = create<FanficState>()(
  persist(
    (set) => ({
      entries: {},
      upsert: (e) =>
        set((s) => {
          const key = norm(e.name);
          if (!key) return s;
          const prev = s.entries[key];
          // 合并：新值非空则覆盖，空则保留旧值（关键设定每轮都以最新为准）
          const keep = (a?: string, b?: string) => (b && b.trim() ? b.trim() : (a || ''));
          const next: FanficEntry = {
            name: e.name.trim() || prev?.name || '',
            work: keep(prev?.work, e.work),
            aliases: keep(prev?.aliases, e.aliases),
            keySettings: e.keySettings?.trim() || prev?.keySettings || '',
            background: keep(prev?.background, e.background),
            updatedAt: Date.now(),
          };
          return { entries: { ...s.entries, [key]: next } };
        }),
      remove: (name) =>
        set((s) => {
          const key = norm(name);
          if (!s.entries[key]) return s;
          const next = { ...s.entries };
          delete next[key];
          return { entries: next };
        }),
      clearAll: () => set({ entries: {} }),
    }),
    { name: 'drpg-fanfic' },
  ),
);
