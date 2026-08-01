/* Agent 正文模式 · run journal store（drpg-agentrun）
   - active：当前运行（内存态·partialize 排除持久化）→ AgentTimeline 实时渲染
   - runs：最近 10 次 run 的归档（事件流+终态）→ 折叠条历史/排障
   - persistFiles（P1）：persist/ 跨回合记忆——run 开始时种进虚拟工作区，run **completed** 后 promote 回写这里
   - pendingGuidance（P1·内存态）：运行中玩家发的「中途指引」，运行时每轮开头 drain 注入
   进度类 store：已注册 saveManager STORES（随存档快照、新游戏清空）。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentRunEvent, AgentRunStatus } from '../systems/agent/agentTypes';

export interface AgentRunJournal {
  id: string;
  startedAt: number;
  status: AgentRunStatus;
  events: AgentRunEvent[];
  rounds: number;
  toolCalls: number;
  commits: number;
  durationMs?: number;
  errorCode?: string;
}

/* 指引限额（照抄 TauriTavern：8 条 / 单条 16k / 总 64k） */
export const GUIDANCE_MAX_ITEMS = 8;
export const GUIDANCE_MAX_CHARS = 16000;
const GUIDANCE_MAX_TOTAL = 64000;

interface AgentRunState {
  runs: AgentRunJournal[];          // 最近在前，capped 10
  active: AgentRunJournal | null;   // 内存态
  persistFiles: Record<string, string>;   // persist/xxx → 内容（跨回合记忆·持久化）
  pendingGuidance: string[];        // 内存态：待注入的中途指引
  startRun: () => string;
  pushEvent: (ev: AgentRunEvent) => void;
  patchActive: (patch: Partial<Pick<AgentRunJournal, 'rounds' | 'toolCalls' | 'commits'>>) => void;
  endRun: (status: Exclude<AgentRunStatus, 'running'>, errorCode?: string) => void;
  setPersistFiles: (files: Record<string, string>) => void;
  submitGuidance: (text: string) => { ok: boolean; reason?: string };
  drainGuidance: () => string[];
  clearAll: () => void;
}

const MAX_RUNS = 10;
const MAX_EVENTS = 200;   // 单 run 事件上限（防失控膨胀 localStorage）

export const useAgentRun = create<AgentRunState>()(
  persist(
    (set, get): AgentRunState => ({
      runs: [],
      active: null,
      persistFiles: {},
      pendingGuidance: [],
      startRun: () => {
        const id = `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
        set({ active: { id, startedAt: Date.now(), status: 'running', events: [], rounds: 0, toolCalls: 0, commits: 0 }, pendingGuidance: [] });
        return id;
      },
      pushEvent: (ev) => {
        const a = get().active;
        if (!a) return;
        const events = a.events.length >= MAX_EVENTS ? [...a.events.slice(-(MAX_EVENTS - 1)), ev] : [...a.events, ev];
        set({ active: { ...a, events, rounds: Math.max(a.rounds, ev.round) } });
      },
      patchActive: (patch) => {
        const a = get().active;
        if (a) set({ active: { ...a, ...patch } });
      },
      endRun: (status, errorCode) => {
        const a = get().active;
        if (!a) return;
        const done: AgentRunJournal = { ...a, status, errorCode, durationMs: Date.now() - a.startedAt };
        const dropped = get().pendingGuidance.length;   // 没来得及消化的中途指引 → 随运行结束丢弃（记一条 warn，对齐 guidance_discarded 语义）
        if (dropped) done.events = [...done.events, { id: done.events.length + 100000, t: Date.now(), round: done.rounds, type: 'guidance_discarded', label: `⚠ ${dropped} 条未消化的中途指引已随运行结束丢弃`, tone: 'warn' }];
        set({ active: null, runs: [done, ...get().runs].slice(0, MAX_RUNS), pendingGuidance: [] });
      },
      setPersistFiles: (files) => set({ persistFiles: files }),
      submitGuidance: (text) => {
        const t = String(text ?? '').trim();
        if (!t) return { ok: false, reason: '指引内容为空' };
        if (!get().active) return { ok: false, reason: 'Agent 未在运行，指引无处可去' };
        const pending = get().pendingGuidance;
        if (pending.length >= GUIDANCE_MAX_ITEMS) return { ok: false, reason: `待注入指引已达 ${GUIDANCE_MAX_ITEMS} 条上限，等它消化完再发` };
        const clipped = t.slice(0, GUIDANCE_MAX_CHARS);
        if (pending.reduce((s, g) => s + g.length, 0) + clipped.length > GUIDANCE_MAX_TOTAL) return { ok: false, reason: '待注入指引总量超限' };
        set({ pendingGuidance: [...pending, clipped] });
        return { ok: true };
      },
      drainGuidance: () => {
        const g = get().pendingGuidance;
        if (g.length) set({ pendingGuidance: [] });
        return g;
      },
      clearAll: () => set({ runs: [], active: null, persistFiles: {}, pendingGuidance: [] }),
    }),
    { name: 'drpg-agentrun', partialize: (s) => ({ runs: s.runs, persistFiles: s.persistFiles }) as Partial<AgentRunState> },
  ),
);
