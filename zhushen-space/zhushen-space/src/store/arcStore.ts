import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   🧭 故事弧线（借鉴 story-oracle「故事弧线」思想·代码全自写）：多拍长线幕后引导的进度数据。
   - 一条弧线 = 贯穿线 + 3~6 拍（每拍一个可检验的事件性目标 + 现编的幕后指令缓存）；
   - 每回合把「当前拍指令」注入正文（systems/storyArc.buildArcInjection·紧邻剧情指导槽）；
   - 完成判定挂杂项演化阶段（arcJudgeInjection/applyArcJudgment·零新增 API）；
   - 进度类 store：已注册 saveManager STORES 带 clear，并进 ROLLBACK_KEYS（判定随杂项阶段漂移，
     回滚本回合演化时拍进度必须一起回卷，否则「正文回退了、拍却过了」）。
════════════════════════════════════════════ */

export type ArcDifficulty = '平和' | '常规' | '凛冽';

export interface ArcBeat {
  idx: number;                       // 1-based
  goal: string;                      // 本拍目标（事件性·可检验）
  instruction?: string;              // 现编幕后指令（缓存·每回合注入；盲盒模式仅 UI 遮罩，注入照常）
  status: 'pending' | 'active' | 'done';
  startedTurn?: number;
  doneTurn?: number;
}

export interface ArcDraft {
  title: string;
  throughline: string;               // 贯穿线
  landmarks: string;                 // 路标（自由文本·仅规划时用）
  difficulty: ArcDifficulty;
  redlines: string;                  // 红线（绝对禁区）
  blind: boolean;                    // 盲盒：UI 隐藏每拍指令（注入不受影响）
}

interface ArcState {
  active: boolean;
  title: string;
  throughline: string;
  landmarks: string;
  difficulty: ArcDifficulty;
  redlines: string;
  blind: boolean;
  beats: ArcBeat[];
  log: string[];                     // 事件日志（启动/过拍/退出）cap 30
  endedReason: string;               // active=false 且 beats 有货时的收尾说明（走完/退出/破线）

  startArc: (draft: ArcDraft, beats: { idx: number; goal: string }[], turn?: number) => void;
  setBeatInstruction: (idx: number, text: string) => void;
  setBlind: (v: boolean) => void;
  /** 当前拍→done、下一拍→active；返回新当前拍 idx（0=全部走完，弧线自动收官）。 */
  advanceBeat: (reason: string, turn?: number) => number;
  exitArc: (reason: string) => void;
  pushLog: (line: string) => void;
  clearAll: () => void;
}

const LOG_CAP = 30;
const pushCap = (log: string[], line: string): string[] => [...log, line].slice(-LOG_CAP);

export const useArc = create<ArcState>()(
  persist(
    (set): ArcState => ({
      active: false,
      title: '',
      throughline: '',
      landmarks: '',
      difficulty: '常规',
      redlines: '',
      blind: false,
      beats: [],
      log: [],
      endedReason: '',

      startArc: (draft, beats, turn) => set(() => ({
        active: true,
        title: draft.title.trim().slice(0, 40) || '未命名弧线',
        throughline: draft.throughline.trim(),
        landmarks: draft.landmarks.trim(),
        difficulty: draft.difficulty,
        redlines: draft.redlines.trim(),
        blind: draft.blind,
        beats: beats.slice(0, 6).map((b, i) => ({
          idx: i + 1,
          goal: String(b.goal ?? '').trim().slice(0, 300),
          status: i === 0 ? 'active' as const : 'pending' as const,
          startedTurn: i === 0 ? turn : undefined,
        })),
        endedReason: '',
        log: pushCap([], `🚀 弧线启动（${beats.length} 拍·${draft.difficulty}${draft.blind ? '·盲盒' : ''}）`),
      })),

      setBeatInstruction: (idx, text) => set((s) => ({
        beats: s.beats.map((b) => (b.idx === idx ? { ...b, instruction: String(text ?? '').trim().slice(0, 1600) } : b)),
      })),

      setBlind: (v) => set({ blind: !!v }),

      advanceBeat: (reason, turn) => {
        let next = 0;
        set((s) => {
          const cur = s.beats.find((b) => b.status === 'active');
          if (!cur) return s;
          const beats = s.beats.map((b) => {
            if (b.idx === cur.idx) return { ...b, status: 'done' as const, doneTurn: turn };
            if (b.idx === cur.idx + 1) { next = b.idx; return { ...b, status: 'active' as const, startedTurn: turn }; }
            return b;
          });
          const finished = next === 0;
          return {
            ...s,
            beats,
            active: !finished,
            endedReason: finished ? '🎉 全部拍子走完，弧线收官' : s.endedReason,
            log: pushCap(s.log, finished ? `${reason}｜🎉 弧线收官` : reason),
          };
        });
        return next;
      },

      exitArc: (reason) => set((s) => ({
        active: false,
        endedReason: reason.trim().slice(0, 160) || '已退出',
        log: pushCap(s.log, `🚪 ${reason.trim().slice(0, 120) || '退出弧线'}`),
      })),

      pushLog: (line) => set((s) => ({ log: pushCap(s.log, String(line ?? '').slice(0, 160)) })),

      clearAll: () => set({ active: false, title: '', throughline: '', landmarks: '', difficulty: '常规', redlines: '', blind: false, beats: [], log: [], endedReason: '' }),
    }),
    { name: 'drpg-arc' },
  ),
);
