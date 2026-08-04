import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ══════════ 参谋（局外顾问）会话 · drpg-advisor ══════════
   借鉴 ST-SevenDaysCal「构画」的「间」：一个**不推进剧情**的场外对话窗——
   跟 AI 商量任务怎么设计、伏笔怎么埋、节日怎么定，它给「提案卡」，玩家点「应用」才落库。

   ⚠ 与正文彻底隔离：这里的对话**永不进正文上下文**，正文也不会知道你在这儿聊过什么；
     它只读存档现状（任务/伏笔/历/时间），产出提案卡。
   ⚠ 进度类 store：随存档快照走、新游戏清空（已进 saveManager STORES）。 */

const CAP = 40;   // 滑窗上限：新挤旧（顾问是工具不是日记，不必无限留）

export interface AdvisorMsg {
  id: number;
  role: 'user' | 'assistant';
  content: string;          // 原文（含 <proposal> 卡片块；渲染时才剥离）
  ts: number;
  applied?: number[];       // 本条消息里**已应用**的卡片序号（0 基）——防重复应用 + UI 打 ✓
}

interface AdvisorState {
  msgs: AdvisorMsg[];
  push: (role: AdvisorMsg['role'], content: string) => number;   // 返回新消息 id
  markApplied: (msgId: number, cardIdx: number) => void;
  removeMsg: (msgId: number) => void;
  clear: () => void;
}

let seq = 0;

export const useAdvisor = create<AdvisorState>()(
  persist(
    (set, get): AdvisorState => ({
      msgs: [],

      push: (role, content) => {
        const id = Math.max(0, ...get().msgs.map((m) => m.id), seq) + 1;
        seq = id;
        set((s) => ({ msgs: [...s.msgs, { id, role, content, ts: Date.now() }].slice(-CAP) }));
        return id;
      },

      markApplied: (msgId, cardIdx) => set((s) => ({
        msgs: s.msgs.map((m) => (m.id === msgId
          ? { ...m, applied: m.applied?.includes(cardIdx) ? m.applied : [...(m.applied ?? []), cardIdx] }
          : m)),
      })),

      removeMsg: (msgId) => set((s) => ({ msgs: s.msgs.filter((m) => m.id !== msgId) })),
      clear: () => set({ msgs: [] }),
    }),
    { name: 'drpg-advisor' },
  ),
);

export { CAP as ADVISOR_CAP };
