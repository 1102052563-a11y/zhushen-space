import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 事实增强：已核实/需锁定的现实事实与时代锚点（逐回合累积，注入下回合正文，防穿帮/时代错位）*/
const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();

interface FactState {
  facts: string[];                 // 已锁定事实锚点（每条一句），累积去重，保留最近若干条
  add: (items: string[]) => void;
  clearAll: () => void;
}

export const useFact = create<FactState>()(
  persist(
    (set) => ({
      facts: [],
      add: (items) =>
        set((s) => {
          const clean = (items || []).map((x) => (x || '').trim()).filter(Boolean);
          if (clean.length === 0) return s;
          const seen = new Set(s.facts.map(norm));
          const next = [...s.facts];
          for (const f of clean) { const k = norm(f); if (k && !seen.has(k)) { seen.add(k); next.push(f); } }
          return { facts: next.slice(-40) };   // 上限 40 条，超出丢最旧
        }),
      clearAll: () => set({ facts: [] }),
    }),
    { name: 'drpg-fact' },
  ),
);
