import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   🌸 生理周期（借鉴 色色灵感状态栏V3.2 的经期孕育系统·确定性前端引擎）
   - 可选 NSFW 模块：全局开关默认**关**；按角色逐个启用；
   - 一切状态由 systems/bioCycle.ts 按世界时间日序**前端推算**（经期/排卵/孕周/预产/产后），AI 零参与计算，
     只在注入块里拿到「状态底色+描写参考」（同派遣「前端算死账本、AI 只写散文」哲学）；
   - 锚点用**绝对日序**（worldDayIndex(worldTime)），受孕/来潮都以「当天」为锚记录；
   - 进度类 store（绑本档角色与时间线）：已注册 saveManager STORES 带 clear。
════════════════════════════════════════════ */

export interface BioProfile {
  on: boolean;                  // 该角色纳入此系统
  lastPeriodStartDay: number;   // 末次经期开始的绝对日序（worldDayIndex）
  cycleLen: number;             // 周期长度 21~45（默认28）
  periodLen: number;            // 经期长度 2~10（默认5）
  pregnant?: { sinceDay: number };   // 受孕日序（存在=孕期状态接管周期显示）
}

interface BioCycleState {
  enabled: boolean;                       // 全局开关（默认关·可选成人向模块）
  chars: Record<string, BioProfile>;      // npcId → 档案
  setEnabled: (v: boolean) => void;
  upsertChar: (id: string, patch: Partial<BioProfile>) => void;
  removeChar: (id: string) => void;
  setPregnant: (id: string, sinceDay: number | null) => void;   // null=终止/清除
  clearAll: () => void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

export const DEFAULT_BIO: BioProfile = { on: true, lastPeriodStartDay: 0, cycleLen: 28, periodLen: 5 };

export const useBioCycle = create<BioCycleState>()(
  persist(
    (set): BioCycleState => ({
      enabled: false,
      chars: {},
      setEnabled: (v) => set({ enabled: !!v }),
      upsertChar: (id, patch) => set((s) => {
        const cur = s.chars[id] ?? { ...DEFAULT_BIO };
        const next: BioProfile = { ...cur, ...patch };
        next.cycleLen = clamp(next.cycleLen ?? 28, 21, 45);
        next.periodLen = clamp(next.periodLen ?? 5, 2, Math.min(10, next.cycleLen - 1));
        return { chars: { ...s.chars, [id]: next } };
      }),
      removeChar: (id) => set((s) => { const c = { ...s.chars }; delete c[id]; return { chars: c }; }),
      setPregnant: (id, sinceDay) => set((s) => {
        const cur = s.chars[id];
        if (!cur) return {};
        const next = { ...cur };
        if (sinceDay == null) delete next.pregnant;
        else next.pregnant = { sinceDay };
        return { chars: { ...s.chars, [id]: next } };
      }),
      clearAll: () => set({ enabled: false, chars: {} }),
    }),
    { name: 'drpg-biocycle' },
  ),
);
