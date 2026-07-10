import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage, lzLocalStorage } from '../systems/compressedStorage';   // 长期事实数千条→drpg-misc 裸JSON撑爆localStorage配额；压缩存
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import miscDefaultPreset from '../data/miscDefaultPreset.json';

/* ════════════════════════════════════════════
   杂项演化（misc evolution）
   维护世界级杂项：分段总结 / 双时间 / 天气 / 世界大事 / 主角任务
   （小地图相关规则保留为可关闭条目，渲染暂未实现）
════════════════════════════════════════════ */

/* 任务环（questline 的单个阶段）。主线/多环支线的路线图由若干环组成。
   planned=已规划只给提示 / active=当前进行 / done=已达成 / skipped=被跨越跳过。*/
export interface QuestRing {
  idx: number;        // 环序号（1-based，路线图排序的规范键）
  goal: string;       // 这一环的目标
  hint?: string;      // 提示（planned 环未落地时的一句钩子）
  status: 'planned' | 'active' | 'done' | 'skipped';
  reward?: string;    // 本环成功奖励（可与任务顶层不同）
  penalty?: string;   // 本环失败惩罚
  optional?: boolean; // 贪婪环(可选)：高潮之后的延伸；失败仅损失本环额外奖励、不致死。强制环不设此项
  startTime?: string; // 本环执行窗口（绝对游戏时间）
  endTime?: string;
  summary?: string;   // 本环达成时·主角这一环的关键行为/结果总结（1~2句，杂项AI在 ringAdvance 时给）；面板展示 + 结算逐环评价用
  rating?: string;    // 本环评级 S/A/B/C/D/E（达成时由杂项AI给）；面板展示 + 结算逐环参考
}

export interface MiscTask {
  id: string;        // "T_17"
  name: string;      // 列1
  desc: string;      // 列2
  reward: string;    // 列3 成功奖励
  penalty: string;   // 列4 失败惩罚
  status: string;    // 列5 "进行中/三阶中期"
  startTime: string;
  endTime: string;
  addedAt: number;
  // ── 多环任务线（v2，全部可选；老存档无这些字段=单环扁平任务，按支线处理）──
  kind?: '主线' | '支线';   // 任务线类型；缺省/未标=支线。主线每世界通常仅一条 active
  rings?: QuestRing[];      // 环路线图（多环任务才有；单环任务可不设）
  currentRing?: number;     // 当前 active 环的 idx（非数组下标）
  finale?: string;          // 终局目标——定义这条线的"尽头"，最后一环达成即整条完成
  rating?: string;          // 任务评分（S/A/B/C/D/E，完成/失败时由 AI 给定；显示在已结束列表 + 供世界结算参考）
  progress?: string;        // 当前任务进度：上回合主角对该任务的实质推进（1~2句·杂项AI每轮更新·纯展示+续作连贯，不参与结算判定）
}

/* 主线判定：只有显式 kind==='主线' 才算主线，其余（含未标 kind）一律支线 */
export function isMainQuest(t: { kind?: string }): boolean {
  return t?.kind === '主线';
}

/* 合并环数组（按稳定 idx 作身份）：把 AI 增量传来的 rings 并进既有 rings —— 治"老是吃掉前面几环"。
   ① 保留既有但本次未提及的环（尤其已 done/skipped 的前面环，绝不被整组替换吞掉）；
   ② 同 idx 的环用传入的「已定义」字段覆盖、缺省字段保留旧值（不被 undefined 清空 reward/penalty 等）；
   ③ 归一成唯一 active —— 以本次指定的 active 为准，更早的旧 active 落 done、更晚的落 planned。 */
export function mergeRings(existing: QuestRing[] | undefined, incoming: QuestRing[]): QuestRing[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  const byIdx = new Map<number, QuestRing>();
  for (const r of existing) byIdx.set(r.idx, { ...r });
  for (const inc of incoming) {
    const prev = byIdx.get(inc.idx);
    if (!prev) continue;   // 路线图已锁定：不新增环（总环数冻结在创建时），忽略新 idx 的环
    const merged: QuestRing = { ...prev };
    // 路线图锁定铁则：环内容（goal/reward/penalty/hint/optional/时限）一经"定实"即冻结，之后 AI 只能推进 status、补 summary/rating——
    // 治"任务内容老是被 AI 重规划、缩水、跳环"。仅"占位环"（goal 空 / 形如"（待…规划/解锁）"）允许被填实（旧档渐进式的过渡）。
    const prevGoal = String(prev.goal || '').trim();
    const isPlaceholder = !prevGoal || /待[^，。]{0,10}(规划|解锁|推进|展开)/.test(prevGoal) || prevGoal.startsWith('（待');
    (Object.keys(inc) as (keyof QuestRing)[]).forEach((k) => {
      if (inc[k] === undefined) return;
      if (k === 'status' || k === 'summary' || k === 'rating' || k === 'idx') { (merged as any)[k] = inc[k]; return; }
      if (isPlaceholder) (merged as any)[k] = inc[k];   // 占位环才允许改内容；已定实的环内容冻结
    });
    byIdx.set(inc.idx, merged);
  }
  const out = [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  const incActive = incoming.find((r) => r.status === 'active');
  if (incActive) for (const r of out) {
    if (r.idx !== incActive.idx && r.status === 'active') r.status = r.idx < incActive.idx ? 'done' : 'planned';
  }
  return out;
}

/* 已结算（完成/失败/放弃）的任务：移出"进行中"列表，留档供面板查看，不再注入提示词 */
export interface ArchivedTask extends MiscTask {
  settledAt: number;
  worldName?: string;   // 结算入档时主角所处世界；供【结算任务】按世界筛出"本世界已完成任务"喂给结算 AI 对账
}

export interface WorldEvent {
  id: string;        // "W_1"
  time: string;
  location: string;
  desc: string;
}

/* 叙事长期事实（回复后由 LLM 抽取，供关键词召回）*/
export interface NarrativeFact {
  id: string;        // "F_1"
  title: string;
  text: string;
  keywords: string[];
  addedAt: number;
}

/* ── 预设条目（与主角/NPC 演化同构，可导入导出）── */
export interface MiscPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

/* 内置默认预设：双时间规则 + 原版 13 条 misc_management 规则（轮回乐园适配，从 data/miscDefaultPreset.json 载入）*/
export const DEFAULT_MISC_ENTRIES: MiscPresetEntry[] =
  ((miscDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled !== false,
    role: r.role ?? 'system',
    source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (miscDefaultPreset as any).name ?? '内置·杂项演化';
const DEFAULT_PRESET_VERSION: number | undefined = (miscDefaultPreset as any).version;

/** 把启用条目拼成 system prompt（运行时再替换 ${...} 占位符）*/
export function buildMiscSystemPrompt(entries: MiscPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

/** 从预设 JSON 提取条目（支持 entrySharedRules / prompts.* / sharedRules）*/
export function extractMiscPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: MiscPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '杂项演化预设';
    const version: number | undefined = data.version;
    const entries: MiscPresetEntry[] = [];
    const push = (rule: any, src: string) => {
      if (!rule || !rule.id || rule.content == null) return;
      entries.push({
        identifier: rule.id,
        name: rule.name ?? rule.id,
        content: String(rule.content),
        enabled: rule.enabled !== false,
        role: rule.role ?? 'system',
        source: src,
      });
    };
    if (Array.isArray(data.entrySharedRules)) for (const r of data.entrySharedRules) push(r, 'entrySharedRules');
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [k, sec] of Object.entries(data.prompts) as [string, any][]) {
        if (sec && Array.isArray(sec.rules)) for (const r of sec.rules) push(r, `prompts.${k}`);
      }
    }
    if (Array.isArray(data.sharedRules)) for (const r of data.sharedRules) push(r, 'sharedRules');
    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}

export interface MiscSettings {
  enabled: boolean;
  entries: MiscPresetEntry[];
  presetName: string;
  presetVersion?: number;
  largeEvery: number;   // 大总结周期：每 N 个杂项演化回合才产出一条大总结（聚合压缩近期小总结），其余回合只出小总结
  // 记忆保留上限（0/缺省 = 无限）：担心存档体积时设正数=只保留最近 N 条（仅影响存储/召回候选，不影响每回合注入）
  factCap?: number;    // 长期事实上限
  smallCap?: number;   // 小总结上限
  largeCap?: number;   // 大总结上限
  questInjectEnabled?: boolean;  // 是否把当前任务(主线重/支线轻)注入正文上下文（默认开）
  questSideCap?: number;         // 注入正文的支线条数上限（相关性排序后封顶，默认 3）
}

const DEFAULT_SETTINGS: MiscSettings = {
  enabled: false,
  entries: DEFAULT_MISC_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
  largeEvery: 6,
  factCap: 0,    // 0 = 长期事实不限数量
  smallCap: 0,   // 0 = 小总结不限数量
  largeCap: 0,   // 0 = 大总结不限数量
  questInjectEnabled: true,
  questSideCap: 3,
};

interface MiscState {
  tasks: MiscTask[];
  archivedTasks: ArchivedTask[];   // 已结算任务（完成/失败/放弃），移出进行中列表
  lastWorldSettleAt: number;       // 上次「世界结算/进入新任务世界」的时间戳；只结算 settledAt 晚于它的任务=本世界的，杜绝把之前世界重复结算
  worldEvents: WorldEvent[];
  smallSummaries: string[];
  largeSummaries: string[];
  summaryRound: number;   // 杂项演化已运行的回合计数（用于大总结周期判断，持久化）
  turnCount: number;      // 本存档**累计总回合数**（持久化）：每次玩家发送 +1，跨任务世界/刷新/读档都不归零（进入世界会清空对话，故不能再用"对话里的用户消息数"当回合数）
  narrativeFacts: NarrativeFact[];
  weather: string;
  weatherFxCss: string;   // AI 为奇异天气生成的纯 CSS 顶栏特效（已 sanitize）
  weatherFxKey: string;   // 该 CSS 对应的天气串（按天气缓存；与当前天气失配则不用）
  paradiseTime: string;
  worldTime: string;
  worldName: string;
  worldTier: string;   // 本世界难度/阶位——进入该世界时即锁定，全程不随主角升级变化（治"难度动态漂移"）
  contractors: { count: number; note: string };   // 本世界"其他契约者"人口：进世界按世界观设定初值，随世界时间演化（陨落/离场/新来），让世界不是单机

  settings: MiscSettings;
  miscApi: ApiConfig;
  miscUseSharedApi: boolean;
  miscAvailableModels: string[];
  miscModelsLoading: boolean;
  miscModelsError: string;

  upsertTask: (t: MiscTask) => void;
  updateTask: (id: string, patch: Partial<MiscTask>) => void;
  removeTask: (id: string) => void;
  settleTask: (id: string, status: string) => void;   // 结算：移出进行中→归档
  advanceRing: (id: string, done?: { summary?: string; rating?: string }) => void;   // 推进：当前 active 环→done（并记下该环行为总结/评级）、下一 planned 环→active，同步顶层快照
  clearArchivedTasks: () => void;
  markWorldSettled: () => void;    // 打一个"世界结算/进世界"边界戳（=现在）；此后完成的任务才计入下次结算
  nextTaskId: () => string;
  addWorldEvent: (e: Omit<WorldEvent, 'id'>) => void;
  updateWorldEvent: (id: string, patch: Partial<Omit<WorldEvent, 'id'>>) => void;
  removeWorldEvent: (id: string) => void;
  pushSmall: (s: string) => void;
  pushLarge: (s: string) => void;
  bumpSummaryRound: () => number;   // +1 并返回新值
  setTurnCount: (n: number) => void;   // 设置累计总回合数（持久化）
  addNarrativeFacts: (items: { title: string; text: string; keywords: string[] }[]) => void;
  removeNarrativeFact: (id: string) => void;
  clearNarrativeFacts: () => void;
  setWeather: (w: string) => void;
  setWeatherFx: (key: string, css: string) => void;
  setTime: (patch: { paradiseTime?: string; worldTime?: string; worldName?: string }) => void;
  setWorldTier: (tier: string) => void;   // 进入新世界时锁定本世界难度/阶位
  setContractors: (count: number, note?: string) => void;   // 更新本世界其他契约者人口（数量/分布）
  clearMisc: () => void;

  setSettings: (patch: Partial<Omit<MiscSettings, 'entries'>>) => void;
  setPresetEntries: (entries: MiscPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<MiscPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;

  setMiscApi: (patch: Partial<ApiConfig>) => void;
  setMiscUseSharedApi: (v: boolean) => void;
  fetchMiscModels: () => Promise<void>;
}

export const useMisc = create<MiscState>()(
  persist(
    (set, get) => ({
      tasks: [],
      archivedTasks: [],
      lastWorldSettleAt: 0,
      worldEvents: [],
      smallSummaries: [],
      largeSummaries: [],
      summaryRound: 0,
      turnCount: 0,
      narrativeFacts: [],
      weather: '',
      weatherFxCss: '',
      weatherFxKey: '',
      paradiseTime: '',
      worldTime: '',
      worldName: '',
      worldTier: '',
      contractors: { count: 0, note: '' },

      settings: { ...DEFAULT_SETTINGS },
      miscApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.6, maxTokens: 4096, topP: 1,
      },
      miscUseSharedApi: true,
      miscAvailableModels: [],
      miscModelsLoading: false,
      miscModelsError: '',

      upsertTask: (t) =>
        set((s) => {
          const i = s.tasks.findIndex((x) => x.id === t.id);
          const next = [...s.tasks];
          // 更新既有任务：rings 走按 idx 合并、不整组替换 → 不丢已完成的前面环
          if (i >= 0) { next[i] = Array.isArray(t.rings) ? { ...next[i], ...t, rings: mergeRings(next[i].rings, t.rings) } : { ...next[i], ...t }; return { tasks: next }; }
          // 新建任务·铁则「一个世界只有一条主线」：本世界已有主线（进行中 或 本世界已完成/已归档的）时，新主线强制降级为支线，杜绝一个世界冒出第二条主线。
          // 用边界戳把"本世界"框住：进行中主线看 addedAt、已归档主线看 settledAt 是否晚于 lastWorldSettleAt（=进入本世界之后），避免上个世界残留的旧主线误伤新世界建主线。
          const boundary = s.lastWorldSettleAt || 0;
          // boundary=0（尚未打过世界边界戳，多为旧存档）时不降级，避免把新世界的第一条主线误伤成支线；边界一旦建立（进世界/结算）即生效
          const worldHasMain = boundary > 0 && (s.tasks.some((x) => isMainQuest(x) && (x.addedAt || 0) > boundary)
            || s.archivedTasks.some((x) => isMainQuest(x) && x.settledAt > boundary));
          let nt = (isMainQuest(t) && worldHasMain) ? { ...t, kind: '支线' as const } : t;
          // 新建·铁则「全新任务的环只能：第1环 active、其余一律 planned」——杜绝 AI 刚建任务就把好几环标成 done/达成（治"刚登记就说打完了"的胡乱推进）。
          // 仅对"进行中"的全新任务重置；一次性给出的已完成/已失败任务(随后 settleTask 归档)不动。
          if (Array.isArray(nt.rings) && nt.rings.length && !/完成|达成|成功|失败|放弃|作废|取消/.test(nt.status || '')) {
            const sorted = [...nt.rings].sort((a, b) => a.idx - b.idx);
            const fixed = sorted.map((r, idx) => ({ ...r, status: (idx === 0 ? 'active' : 'planned') as QuestRing['status'] }));
            nt = { ...nt, rings: fixed, currentRing: fixed[0]?.idx ?? 1 };
          }
          next.push(nt);
          return { tasks: next };
        }),
      updateTask: (id, patch) =>
        set((s) => {
          // 一个世界一条主线：想把某任务升为主线、但本世界已另有主线（进行中或本世界已归档）→ 不允许提升，去掉 kind 提升
          const boundary = s.lastWorldSettleAt || 0;
          let p = patch;
          if (patch.kind === '主线' && boundary > 0
            && (s.tasks.some((x) => x.id !== id && isMainQuest(x) && (x.addedAt || 0) > boundary) || s.archivedTasks.some((x) => isMainQuest(x) && x.settledAt > boundary))) {
            p = { ...patch }; delete p.kind;
          }
          return { tasks: s.tasks.map((x) =>
            x.id !== id ? x
            : Array.isArray(p.rings) ? { ...x, ...p, rings: mergeRings(x.rings, p.rings) }
            : { ...x, ...p },
          ) };
        }),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
      settleTask: (id, status) =>
        set((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return s;   // 进行中列表里没有 → 不结算（防误删/重复）
          const archived: ArchivedTask = { ...t, status: status || t.status || '已完成', settledAt: Date.now(), worldName: s.worldName || undefined };
          return {
            tasks: s.tasks.filter((x) => x.id !== id),
            archivedTasks: [archived, ...s.archivedTasks.filter((x) => x.id !== id)].slice(0, 40),
          };
        }),
      advanceRing: (id, done) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id || !Array.isArray(t.rings) || t.rings.length === 0) return t;
            const rings = t.rings.map((r) => ({ ...r }));
            const cur = rings.find((r) => r.status === 'active');
            if (cur) {
              cur.status = 'done';
              // 记下主角这一环的行为总结与评级（供面板逐环展示 + 结算逐环评价；缺省不覆盖既有）
              if (done?.summary && String(done.summary).trim()) cur.summary = String(done.summary).trim();
              if (done?.rating && String(done.rating).trim()) cur.rating = String(done.rating).trim();
            }
            // 晋升下一个 planned 环（按 idx 最小者）为 active
            const next = rings
              .filter((r) => r.status === 'planned')
              .sort((a, b) => a.idx - b.idx)[0];
            if (next) next.status = 'active';
            const active = rings.find((r) => r.status === 'active');
            return {
              ...t,
              rings,
              currentRing: active ? active.idx : t.currentRing,
              // 顶层 desc/奖惩同步到新 active 环，保证旧序列化/面板显示当前目标
              ...(active
                ? {
                    desc: active.goal || t.desc,
                    reward: active.reward ?? t.reward,
                    penalty: active.penalty ?? t.penalty,
                  }
                : {}),
            };
          }),
        })),
      clearArchivedTasks: () => set({ archivedTasks: [] }),
      markWorldSettled: () => set({ lastWorldSettleAt: Date.now() }),
      nextTaskId: () => {
        // 进行中 + 已归档的编号都算"已占用"，避免复用完成任务的编号
        const all = [...get().tasks, ...get().archivedTasks];
        const nums = all.map((t) => Number(/^T_(\d+)$/.exec(t.id)?.[1])).filter((n) => Number.isFinite(n));
        return `T_${nums.length ? Math.max(...nums) + 1 : 1}`;
      },

      addWorldEvent: (e) =>
        set((s) => {
          const nums = s.worldEvents.map((w) => Number(/^W_(\d+)$/.exec(w.id)?.[1])).filter((n) => Number.isFinite(n));
          const id = `W_${nums.length ? Math.max(...nums) + 1 : 1}`;
          return { worldEvents: [...s.worldEvents, { id, ...e }].slice(-40) };
        }),
      updateWorldEvent: (id, patch) =>
        set((s) => ({ worldEvents: s.worldEvents.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      removeWorldEvent: (id) => set((s) => ({ worldEvents: s.worldEvents.filter((w) => w.id !== id) })),

      pushSmall: (str) => set((s) => { const arr = [...s.smallSummaries, str]; const cap = s.settings.smallCap ?? 0; return { smallSummaries: cap > 0 ? arr.slice(-cap) : arr }; }),   // 默认不限；smallCap>0 时保留最近 N 条
      pushLarge: (str) => set((s) => { const arr = [...s.largeSummaries, str]; const cap = s.settings.largeCap ?? 0; return { largeSummaries: cap > 0 ? arr.slice(-cap) : arr }; }),   // 默认不限；largeCap>0 时保留最近 N 条
      bumpSummaryRound: () => { const n = get().summaryRound + 1; set({ summaryRound: n }); return n; },
      setTurnCount: (n) => set({ turnCount: Math.max(0, Math.floor(n) || 0) }),
      addNarrativeFacts: (items) =>
        set((s) => {
          let max = s.narrativeFacts.reduce((m, f) => Math.max(m, Number(/^F_(\d+)$/.exec(f.id)?.[1]) || 0), 0);
          const add = items
            .filter((it) => it.text && it.text.trim())
            .map((it) => ({ id: `F_${++max}`, title: (it.title || it.text.slice(0, 14)).trim(), text: it.text.trim(), keywords: it.keywords ?? [], addedAt: Date.now() }));
          const arr = [...s.narrativeFacts, ...add];
          const cap = s.settings.factCap ?? 0;   // 默认 0=不限（旧版固定 300，已取消）；factCap>0 时保留最近 N 条
          return { narrativeFacts: cap > 0 ? arr.slice(-cap) : arr };
        }),
      removeNarrativeFact: (id) => set((s) => ({ narrativeFacts: s.narrativeFacts.filter((f) => f.id !== id) })),
      clearNarrativeFacts: () => set({ narrativeFacts: [] }),
      setWeather: (w) => set({ weather: w }),
      setWeatherFx: (key, css) => set({ weatherFxKey: key, weatherFxCss: css }),
      setTime: (patch) => set((s) => {
        // 世界名切到一个新的"非乐园"任务世界 → 立刻打结算边界戳（比 App 的 enteredNewWorld 更早、同回合生效）：
        // 此后完成的任务才算"本世界"，既用于结算范围，也用于"一个世界一条主线"判定，避免用旧世界残留主线/世界之源。
        const changedToNew = patch.worldName != null && patch.worldName !== s.worldName
          && !/轮回乐园|专属房间|主神空间/.test(patch.worldName);
        return {
          paradiseTime: patch.paradiseTime ?? s.paradiseTime,
          worldTime: patch.worldTime ?? s.worldTime,
          worldName: patch.worldName ?? s.worldName,
          // 切到新任务世界：清空旧世界难度戳（由 App 的 enteredNewWorld 钩子按进入时主角阶位重新锁定）+ 清空旧世界契约者人口（进新世界由杂项演化按世界观重设）
          ...(changedToNew ? { lastWorldSettleAt: Date.now(), worldTier: '', contractors: { count: 0, note: '' } } : {}),
        };
      }),
      setWorldTier: (tier) => set({ worldTier: tier || '' }),
      setContractors: (count, note) => set((s) => ({ contractors: {
        count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : s.contractors.count,
        note: note != null && String(note).trim() ? String(note).trim() : s.contractors.note,
      } })),
      clearMisc: () => set({ tasks: [], archivedTasks: [], lastWorldSettleAt: 0, worldTier: '', contractors: { count: 0, note: '' }, worldEvents: [], smallSummaries: [], largeSummaries: [], summaryRound: 0, turnCount: 0 }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_MISC_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setMiscApi: (patch) => set((s) => ({ miscApi: { ...s.miscApi, ...patch } })),
      setMiscUseSharedApi: (v) => set({ miscUseSharedApi: v }),
      fetchMiscModels: async () => {
        const s = get();
        const api = s.miscUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.miscApi;
        if (!api.baseUrl || !api.apiKey) { set({ miscModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ miscModelsLoading: true, miscModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ miscAvailableModels: models, miscModelsLoading: false });
        } catch (e: any) {
          set({ miscModelsError: e.message ?? '请求失败', miscModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-misc',
      storage: lzStorage(),   // ★压缩存：长期事实可累积数千条，裸 JSON 会把 localStorage 整域配额顶满（改API/存记忆/读档回退全报 quota）
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          // 强制覆盖（仿正文世界书的 builtin 重载）：预设条目每次加载都刷成最新内置默认，
          // 用户无需手动「恢复默认」就拿到内置更新。代价＝UI 里对预设条目的手改/导入只当次会话有效、
          // 不跨刷新保留；要长期改预设请改 src/data/miscDefaultPreset.json 或代码注入的 *_RULE。
          entries: DEFAULT_MISC_ENTRIES,
          presetName: DEFAULT_PRESET_NAME,
          presetVersion: DEFAULT_PRESET_VERSION,
        },
        miscApi: { ...current.miscApi, ...(persisted?.miscApi ?? {}) },
        miscUseSharedApi: persisted?.miscUseSharedApi ?? current.miscUseSharedApi,
        miscAvailableModels: [],
        miscModelsLoading: false,
        miscModelsError: '',
      }),
    },
  ),
);

// 一次性迁移：把旧的**未压缩** drpg-misc 就地压缩，立刻腾出 localStorage 配额——否则要等下一次 misc 变动才转压缩，
//   期间用户若先去改 API 仍会报 quota。模块加载即跑（persist 已 hydrate 完；幂等：已压缩值前缀是 LZ、下面 startsWith('{') 会跳过）。
try {
  const rawMisc = localStorage.getItem('drpg-misc');
  if (rawMisc && rawMisc.startsWith('{')) lzLocalStorage.setItem('drpg-misc', rawMisc);
} catch { /* */ }
