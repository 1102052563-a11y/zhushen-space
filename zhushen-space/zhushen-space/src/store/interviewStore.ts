import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   🎤 大采访（借鉴 色色灵感状态栏V3.2）：局外花絮栏目的成品存档。
   - 生成走独立旁路（systems/interview.ts·resolveApiChain('interview', 正文兜底)），不进正文上下文；
   - 记录含解析后的分段（segments）供杂志皮渲染 + 原文（rawText）兜底；
   - 进度类 store（聊的是本档人物）：已注册 saveManager STORES 带 clear；CAP 40 条。
════════════════════════════════════════════ */

export interface InterviewSeg { kind: 'q' | 'a' | 'nar'; speaker?: string; text: string }

export interface InterviewRecord {
  id: string;
  title: string;
  intro: string;
  epilogue: string;
  segments: InterviewSeg[];
  rawText: string;          // 原始输出（解析失败兜底展示/导出）
  interviewers: string[];
  interviewees: string[];
  location: string;
  worldName: string;
  worldTime: string;
  createdAt: number;
}

interface InterviewState {
  records: InterviewRecord[];
  addRecord: (r: Omit<InterviewRecord, 'id' | 'createdAt'>) => string;
  removeRecord: (id: string) => void;
  clearAll: () => void;
}

const CAP = 40;

export const useInterviews = create<InterviewState>()(
  persist(
    (set): InterviewState => ({
      records: [],
      addRecord: (r) => {
        const id = 'iv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        set((s) => ({ records: [{ ...r, id, createdAt: Date.now() }, ...s.records].slice(0, CAP) }));
        return id;
      },
      removeRecord: (id) => set((s) => ({ records: s.records.filter((x) => x.id !== id) })),
      clearAll: () => set({ records: [] }),
    }),
    { name: 'drpg-interviews' },
  ),
);
