import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   🔗 调教系统（对剧情 NPC 的长线私密养成）
   - 隐私词条**不复制**：一切变化经 systems/training.ts 打在 `npc.extra`（NpcDetail「私密信息」同源），
     本 store 只存 名册 / 每人对话与偏好 / 快捷短语 / 开关。永不出现双账本漂移。
   - 生理周期数据仍在 bioCycleStore（时间锚点非隐私文本），本系统只是把它的 UI 并进来。
   - 可选成人向模块：总开关默认关；对话永不进正文/叙事记忆上下文。
   - 进度类 store：进 saveManager STORES 带 clear。
════════════════════════════════════════════ */

export interface TrainMsg { role: 'user' | 'npc'; text: string; scene?: string; ts: number }

/* 🖼 调教场景图元数据（图本体在 imageDb·key=train:<npcId>:<id>，见 systems/trainImages）。 */
export interface TrainShot { id: string; caption: string; prompt: string; stage?: number; at: number }

export interface TrainSession {
  msgs: TrainMsg[];
  selectedPlays: string[];   // 按选注入的玩法名（≤3·复用 joy-plays.json + expandStMacros）
  appellation: string;       // 她对主角的称呼（AI 可更新·也进注入）
  pregConfirmPending?: boolean;   // AI 提示本轮可能受孕 → 等玩家确认才落 bioCycle
  gallery?: TrainShot[];     // 🖼 场景图库（元数据·CAP 30·仅存 key 引用不存 dataURL）
}

/* 内置快捷短语（自定义组·可增删）：通用调教向短句，点击快发/填入。玩法/BDSM/姿势另走世界书与 joy-plays。*/
export const DEFAULT_QUICK_PHRASES: string[] = [
  '命令她跪好，报出今天的称呼',
  '奖励她方才的乖顺，轻抚她的发',
  '惩罚她的抗拒，加重一分力道',
  '在她耳边低声下达下一个指令',
  '停在临界，不许她越线，逼她开口求',
  '问她此刻在想什么，要她如实招来',
  '解开一处束缚，看她的反应',
  '要她自己说出想要什么',
  '许她高潮，但要她数着数',
  '结束今天，命她记住这份规矩',
];

interface TrainingState {
  enabled: boolean;
  roster: string[];                        // NPC id 顺序即显示顺序
  sessions: Record<string, TrainSession>;
  quickPhrases: string[];
  clickToSend: boolean;                    // 快捷动作点击=直接发送（否则填入输入框）
  narrativeSync: boolean;                  // 落痕正文（opt-in·默认关）
  currentId: string | null;               // 当前对话对象（不持久·打开面板重选）

  setEnabled: (v: boolean) => void;
  addToRoster: (id: string) => void;
  removeFromRoster: (id: string) => void;
  setCurrent: (id: string | null) => void;
  appendMsg: (id: string, m: Omit<TrainMsg, 'ts'>) => void;
  clearSession: (id: string) => void;
  setSelectedPlays: (id: string, names: string[]) => void;
  setAppellation: (id: string, s: string) => void;
  setPregConfirm: (id: string, v: boolean) => void;
  addShot: (id: string, shot: TrainShot) => void;                        // 🖼 图元数据入库（图本体由调用方先 trainImgSet）
  removeShot: (id: string, shotId: string) => void;                      // 移除元数据（图本体由调用方 trainImgDel）
  updateShotCaption: (id: string, shotId: string, caption: string) => void;
  setClickToSend: (v: boolean) => void;
  setNarrativeSync: (v: boolean) => void;
  addQuickPhrase: (s: string) => void;
  removeQuickPhrase: (i: number) => void;
  resetQuickPhrases: () => void;
  clearAll: () => void;
}

const CAP_MSGS = 200;
const emptySession = (): TrainSession => ({ msgs: [], selectedPlays: [], appellation: '' });

export const useTraining = create<TrainingState>()(
  persist(
    (set): TrainingState => ({
      enabled: false,
      roster: [],
      sessions: {},
      quickPhrases: [...DEFAULT_QUICK_PHRASES],
      clickToSend: true,
      narrativeSync: false,
      currentId: null,

      setEnabled: (v) => set({ enabled: !!v }),
      addToRoster: (id) => set((s) => (s.roster.includes(id) ? { currentId: id } : { roster: [...s.roster, id], currentId: id })),
      removeFromRoster: (id) => set((s) => {
        const sessions = { ...s.sessions }; delete sessions[id];
        return { roster: s.roster.filter((x) => x !== id), sessions, currentId: s.currentId === id ? null : s.currentId };
      }),
      setCurrent: (id) => set({ currentId: id }),
      appendMsg: (id, m) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        const msgs = [...sess.msgs, { ...m, ts: Date.now() }].slice(-CAP_MSGS);
        return { sessions: { ...s.sessions, [id]: { ...sess, msgs } } };
      }),
      clearSession: (id) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        return { sessions: { ...s.sessions, [id]: { ...sess, msgs: [] } } };
      }),
      setSelectedPlays: (id, names) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        return { sessions: { ...s.sessions, [id]: { ...sess, selectedPlays: (names ?? []).slice(0, 3) } } };
      }),
      setAppellation: (id, str) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        return { sessions: { ...s.sessions, [id]: { ...sess, appellation: String(str ?? '').slice(0, 40) } } };
      }),
      setPregConfirm: (id, v) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        return { sessions: { ...s.sessions, [id]: { ...sess, pregConfirmPending: v } } };
      }),
      addShot: (id, shot) => set((s) => {
        const sess = s.sessions[id] ?? emptySession();
        const gallery = [shot, ...(sess.gallery ?? [])].slice(0, 30);   // 新图在前·CAP 30
        return { sessions: { ...s.sessions, [id]: { ...sess, gallery } } };
      }),
      removeShot: (id, shotId) => set((s) => {
        const sess = s.sessions[id];
        if (!sess?.gallery) return {};
        return { sessions: { ...s.sessions, [id]: { ...sess, gallery: sess.gallery.filter((g) => g.id !== shotId) } } };
      }),
      updateShotCaption: (id, shotId, caption) => set((s) => {
        const sess = s.sessions[id];
        if (!sess?.gallery) return {};
        return { sessions: { ...s.sessions, [id]: { ...sess, gallery: sess.gallery.map((g) => g.id === shotId ? { ...g, caption: String(caption ?? '').slice(0, 120) } : g) } } };
      }),
      setClickToSend: (v) => set({ clickToSend: !!v }),
      setNarrativeSync: (v) => set({ narrativeSync: !!v }),
      addQuickPhrase: (str) => set((s) => { const t = String(str ?? '').trim().slice(0, 60); return t && !s.quickPhrases.includes(t) ? { quickPhrases: [...s.quickPhrases, t] } : {}; }),
      removeQuickPhrase: (i) => set((s) => ({ quickPhrases: s.quickPhrases.filter((_, idx) => idx !== i) })),
      resetQuickPhrases: () => set({ quickPhrases: [...DEFAULT_QUICK_PHRASES] }),
      clearAll: () => set({ enabled: false, roster: [], sessions: {}, currentId: null }),
    }),
    {
      name: 'drpg-training',
      // currentId 不持久（每次打开面板重选）；其余全存
      partialize: (s) => ({
        enabled: s.enabled, roster: s.roster, sessions: s.sessions,
        quickPhrases: s.quickPhrases, clickToSend: s.clickToSend, narrativeSync: s.narrativeSync,
      }),
    },
  ),
);
