import { create } from 'zustand';
import { modelsFetchArgs } from '../systems/apiUrl';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import type { Deed } from './characterStore';
import teamDefaultPreset from '../data/teamDefaultPreset.json';
import { parseAttrBonus, ATTR_KEYS, type AttrDelta } from '../systems/attrBonus';

/* ════════════════════════════════════════════
   冒险团（adventure team）——**仅主角自己的冒险团**，单一记录
   - 阶位 E→D→C→B→A→S→SS→SSS（团队权限随阶位增大）
   - 双计量晋级：teamExp(经验，晋级主轴) + activity(活跃度，每回合衰减、太低卡晋级)
   - 小阶位 E→A 满足条件自动晋级；大阶位 →S/→SS/→SSS + 首次建立 需进「冒险团考核世界」(纯剧情)，pass 晋级 / fail 减员、极端解散
   - 只有正文明确提出"建立冒险团"后才 establish，否则不运作
   - 跨任务世界保留（属轮回乐园侧）；数据+演化设置+独立 API 合一（仿 territoryStore）
════════════════════════════════════════════ */

export const TEAM_RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type TeamRank = typeof TEAM_RANKS[number];
/** 晋升到这些阶位属"大阶位晋升"，需考核 */
const MAJOR_TARGETS: TeamRank[] = ['S', 'SS', 'SSS'];
export const ACTIVITY_GATE = 60;     // 晋级所需最低活跃度

/* 名称归一化匹配（去空白/标点/大小写后相等）：团队效果(perk)的"同名→更新、按名删除"用它，
   容忍 AI 不同回合给同名条目写出细微差异，避免重复堆叠或删不掉。 */
function nameEq(a?: string, b?: string): boolean {
  const n = (s?: string) => (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
  const x = n(a), y = n(b);
  return !!x && !!y && x === y;
}

/** 成员上限：E 3 人，每升一阶 +1 */
export function memberCap(rank: TeamRank): number {
  return 3 + Math.max(0, TEAM_RANKS.indexOf(rank));
}
function nextRank(rank: TeamRank): TeamRank | null {
  const i = TEAM_RANKS.indexOf(rank);
  return i >= 0 && i < TEAM_RANKS.length - 1 ? TEAM_RANKS[i + 1] : null;
}

export interface TeamMember { id?: string; name?: string; tier?: string; role?: string; note?: string }   // id=关联 NPC 的 C-id（建档则可跳详情）；未建档的团队成员只填 name/tier；主角自建团时 B1=团长不单列，加入他人团时 B1 作为普通成员单列
export interface TeamPerk { name: string; desc: string; source?: string; locked?: boolean }   // 团队效果/权限；locked=玩家锁定，一键/批量清除时豁免

/* ════════════════════════════════════════════
   派遣（dispatch）——派 NPC 队伍去打限时委托，到点才出结算
   参考 FF14 冒险者小队 / Battle Brothers。三条设计铁则，改这块前先读：

   ① **封条**：`DispatchRecord.ledger` 在**倒数走完之前压根不存在**——不是 UI 藏起来，是数据里
      没有。到点由 dispatchEngine 一次性算出并写入。故「时间不到不能看结算」无法被翻 store 绕过。
   ② **结算由前端算死、AI 只写散文**：账本(评级/伤亡/战利品/货币)全在 dispatchEngine 确定性生成，
      AI 战报拿着已锁死的账本叙述。让 AI 决定"打赢没/掉了什么"＝每次派遣都通货膨胀（见 promptRules
      的数值铁则与 bioStrength 机械判定的由来）。
   ③ **本 store 只存数据、不做计算**：委托板生成/结算/发放全在 `systems/dispatchEngine.ts`。
      这样 npcAutonomy 能安全 import 本 store 做「派遣中的人不跑轨道A」过滤而不成环
      （npcAutonomy → adventureTeamStore ← dispatchEngine → npcAutonomy 是 DAG）。

   倒数用**绝对回合** `endTurn`，不做逐回合自减：漏跑一回合不会卡住，回退时间也能自然延长。
════════════════════════════════════════════ */
export const DISPATCH_KEEP = 12;        // 派遣历史保留条数
export const FATIGUE_GATE = 70;         // 疲劳 ≥ 此值不可出勤（强制轮换的闸门）
export const FATIGUE_DECAY = 6;         // 待命时每回合恢复的疲劳
export const BOARD_SIZE = 4;            // 委托板同时挂几条
export const BOARD_REFRESH = 6;         // 每 N 回合换一批委托

/** 委托奖励物品：字段与 `InventoryItem` 对齐（照物品演化的固定格式生成，入库时直接铺开）。
 *  ⚠ `gradeDesc` 由**前端按委托阶位定档**后锁死喂给 AI，AI 只填其余字段——同开箱的做法，杜绝越级爆品。 */
export interface DispatchReward {
  name: string;
  category: string;        // ItemCategory（前端校验，非法则回落）
  gradeDesc: string;       // 品级·前端锁死
  subType?: string;
  origin?: string;         // 产地/来历
  combatStat?: string;     // 攻击力/防御力（装备类）
  durability?: string;
  requirement?: string;    // 装备需求（六维门槛）
  attrBonus?: string;      // 六维/HP·EP 上限加成（入库时并进 effect 供 effectiveAttrs 读取）
  score?: string;
  affix?: string;          // 词缀（装备类）
  effect?: string;         // 定性特殊性质（非数值）
  activeEffect?: string;   // 需发动才生效
  activeDuration?: string;
  intro?: string;
  appearance?: string;     // 逐部件可视化描述（生图唯一依据·必填）
  killCount?: string;      // 武器类
  quantity?: number;
  tags?: string[];
}

/** 一条可接的委托。默认由语料库播种确定性生成（零 token）；也可手动点 AI 生成（带奖励物品）。 */
export interface DispatchOffer {
  id: string;
  title: string;        // 委托名
  world: string;        // 世界主题（取自轨道A 语料库 banks.worldTheme）
  tier: number;         // 1~9 阶：定难度、定奖励档、定货币种类
  turns: number;        // 需要几回合才归来
  slots: number;        // 建议出勤人数
  arch?: string;        // 偏好战斗原型（archOf 的 8 类之一），匹配得加成
  archLabel?: string;   // 原型中文名（展示 + 喂战报）
  minPower: number;     // 建议战力（powerOf 口径 0~9）
  danger: number;       // 0~1 危险度：影响受伤/陨落
  /* ── 以下仅 AI 生成的委托才有 ── */
  brief?: string;       // 委托简报（雇主/背景/为什么找上这支团）
  objective?: string;   // 具体目标
  risk?: string;        // 已知风险/情报
  employer?: string;    // 雇主
  reward?: DispatchReward;   // 达成奖励物品——**接单前就看得见**，这才是选委托的理由
  bySearch?: boolean;   // 生成时开了联网搜索
}

/** 单个成员在这次派遣里的遭遇（账本的一行，AI 不得改写） */
export interface DispatchMemberResult {
  id: string;
  name: string;
  fatigueAdd: number;
  hpLoss: number;
  injured?: string;      // 伤势名（有值＝受伤）
  injuryTurns?: number;
  dead?: boolean;
  lootName?: string;     // 个人战利品（走轨道A 的 makeEquipItem，吃同一套 8 件上限）
  note: string;          // 一句话遭遇（给战报当素材）
}

/** 结算账本：到点由引擎一次算死并封存，此后只读 */
export interface DispatchLedger {
  rating: string;                              // E~SSS
  success: boolean;
  score: number;                               // 判定分 0~100（透明化，面板展示"为什么是这个评级"）
  teamExp: number;
  activity: number;
  currency: { kind: string; amount: number };  // 三阶及下乐园币 / 四阶起魂币
  members: DispatchMemberResult[];
  casualties: string[];
  sealedAt: number;                            // 封存时的回合号
  rewardGranted?: string;                      // 委托酬劳物品名（达成才发；已入主角背包）
}

export interface DispatchRecord {
  id: string;
  offer: DispatchOffer;
  memberIds: string[];
  memberNames: string[];
  startTurn: number;
  endTurn: number;                             // 绝对回合：turn >= endTurn 即到点
  startTime?: string;                          // 出发时的主神空间时间（纯风味）
  endTime?: string;
  ledger?: DispatchLedger;                     // ⚠ 未到点＝undefined，见上方铁则①
  report?: string;                             // AI 战报（散文，可无）
  reportState?: 'none' | 'loading' | 'ok' | 'fail';
  reportErr?: string;
  read?: boolean;                              // 已读（未读在导航打红点）
}

/** 加入他人冒险团：负责冒险团的 API 全量生成后的团队信息（主角不为领导人）。*/
export interface JoinTeamPayload {
  name: string;
  rank?: TeamRank;
  leaderId?: string;          // 团长（领导人）的 C-id（已建档时）；主角永远不是团长
  leaderName?: string;        // 团长姓名（未建档时只有名字）
  members?: TeamMember[];     // 全部成员（应含团长 + 主角 B1 + 其余成员）
  perks?: TeamPerk[];
  deeds?: Deed[];
  teamExp?: number;
  activity?: number;
}
export type AssessmentStatus = 'none' | 'required' | 'in_progress' | 'passed' | 'failed';
export interface Assessment {
  pending: boolean;
  targetRank?: TeamRank | '';   // 本次考核要晋升到的阶位（建团时为 'E'）
  isEstablish?: boolean;        // 是否建团考核
  status: AssessmentStatus;
  note?: string;
}

/* ── 预设条目（与领地/杂项同构）── */
export interface TeamPresetEntry {
  identifier: string; name: string; content: string; enabled: boolean; role: string; source?: string;
}
export const DEFAULT_TEAM_ENTRIES: TeamPresetEntry[] =
  ((teamDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id, name: r.name, content: r.content, enabled: r.enabled !== false, role: r.role ?? 'system', source: 'entrySharedRules',
  }));
const DEFAULT_PRESET_NAME: string = (teamDefaultPreset as any).name ?? '内置·冒险团演化';
const DEFAULT_PRESET_VERSION: number | undefined = (teamDefaultPreset as any).version;

export function buildTeamSystemPrompt(entries: TeamPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}
export function extractTeamPresetFromJson(raw: string): { name: string; version?: number; entries: TeamPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '冒险团演化预设';
    const version: number | undefined = data.version;
    const entries: TeamPresetEntry[] = [];
    const push = (rule: any, src: string) => {
      if (!rule || !rule.id || rule.content == null) return;
      entries.push({ identifier: rule.id, name: rule.name ?? rule.id, content: String(rule.content), enabled: rule.enabled !== false, role: rule.role ?? 'system', source: src });
    };
    if (Array.isArray(data.entrySharedRules)) for (const r of data.entrySharedRules) push(r, 'entrySharedRules');
    if (data.prompts && typeof data.prompts === 'object') for (const [k, sec] of Object.entries(data.prompts) as [string, any][]) if (sec && Array.isArray(sec.rules)) for (const r of sec.rules) push(r, `prompts.${k}`);
    if (Array.isArray(data.sharedRules)) for (const r of data.sharedRules) push(r, 'sharedRules');
    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch { return null; }
}

export interface TeamSettings {
  enabled: boolean; frequency: number; entries: TeamPresetEntry[]; presetName: string; presetVersion?: number;
}
const DEFAULT_SETTINGS: TeamSettings = {
  enabled: false, frequency: 1, entries: DEFAULT_TEAM_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION,
};

interface TeamState {
  /* ── 团队记录（游戏进度，newGame 清空）── */
  established: boolean;
  disbanded: boolean;
  name: string;
  rank: TeamRank;
  teamExp: number;        // 0~100
  activity: number;       // 0~100
  members: TeamMember[];
  perks: TeamPerk[];
  deeds: Deed[];
  assessment: Assessment;
  leaderId: string;       // 团长（领导人）：''/'B1'=主角自建团主角任团长；'C\d+'/'__npc'=加入他人团，团长是该 NPC，主角只是成员
  leaderName: string;     // 团长姓名（团长未建档为 NPC 时用于显示）

  /* ── 派遣（游戏进度，newGame 清空）── */
  dispatchBoard: DispatchOffer[];
  boardTurn: number;                                    // 委托板上次刷新的回合
  boardSource: 'auto' | 'ai';                           // auto=语料库确定性生成（会到期换批）；ai=玩家手动生成（**不自动换批**，见 ensureBoard）
  boardBusy: boolean;                                   // AI 生成中（放 store 不放组件：切 tab / 关面板也不丢进度）
  boardError: string;
  dispatchActive: DispatchRecord | null;                // 同时只跑一支（团就一个）
  dispatchHistory: DispatchRecord[];                    // 最近 DISPATCH_KEEP 条
  fatigue: Record<string, number>;                      // npcId → 疲劳 0~100
  injury: Record<string, { turns: number; name: string }>;   // npcId → 伤势倒数

  /* ── 演化设置 + 独立 API（配置，newGame 保留）── */
  settings: TeamSettings;
  teamApi: ApiConfig;
  teamUseSharedApi: boolean;
  teamAvailableModels: string[];
  teamModelsLoading: boolean;
  teamModelsError: string;
  /* 派遣战报·独立接口（与冒险团演化分开：战报是叙事文本，往往想用更好的正文模型）*/
  dispatchApi: ApiConfig;
  dispatchUseSharedApi: boolean;
  dispatchReportAuto: boolean;                          // 到点自动生成战报（关掉则面板里手动点）
  dispatchWebSearch: boolean;                           // 生成委托时开 Gemini google_search（据真实世界/原作设定接地）；默认关

  /* ── 记录 actions ── */
  establish: (patch?: { name?: string }) => void;
  joinTeam: (payload: JoinTeamPayload) => void;   // 加入他人冒险团（主角非团长），全量写入团队信息
  setTeam: (patch: Partial<Pick<TeamState, 'name' | 'disbanded' | 'established'>>) => void;
  addExp: (n: number) => void;          // 累积经验，满则自动晋级(小阶位)或触发考核(大阶位/需活跃度)
  setExp: (v: number) => void;
  addActivity: (n: number) => void;
  setRank: (r: TeamRank) => void;
  startAssessment: (targetRank: TeamRank, isEstablish?: boolean) => void;
  resolveAssessment: (result: 'pass' | 'fail' | 'disband') => void;
  upsertMember: (id: string, patch?: { role?: string; note?: string }) => void;
  removeMember: (id: string) => void;
  upsertPerk: (p: TeamPerk) => void;
  removePerk: (name: string) => void;
  removePerks: (names: string[]) => void;              // 批量清除：按名删除（锁定的豁免）
  clearPerks: () => void;                              // 一键清除全部（锁定的豁免）
  togglePerkLock: (name: string) => void;              // 切换锁定：锁定后不会被清除
  appendDeed: (d: Deed) => void;
  clearTeam: () => void;

  /* ── 派遣 actions（全是哑 reducer，计算在 systems/dispatchEngine.ts）── */
  setBoard: (offers: DispatchOffer[], turn: number, source?: 'auto' | 'ai') => void;
  setBoardBusy: (busy: boolean, error?: string) => void;
  beginDispatch: (rec: DispatchRecord) => void;
  sealDispatch: (ledger: DispatchLedger) => void;       // 到点封存：写账本 + 移进历史
  abortDispatch: () => void;                            // 中途撤回（无账本，不发奖）
  setReport: (id: string, patch: Partial<Pick<DispatchRecord, 'report' | 'reportState' | 'reportErr'>>) => void;
  markDispatchRead: (id: string) => void;
  patchFatigue: (delta: Record<string, number>) => void;   // 增量（出勤 +N）
  decayFatigue: (exclude: string[]) => void;               // 待命的每回合恢复；出勤中的豁免
  setInjury: (id: string, v: { turns: number; name: string } | null) => void;
  tickInjury: () => void;                                  // 伤势倒数，归零自动痊愈
  clearDispatch: () => void;

  /* ── 预设 / API actions ── */
  setSettings: (patch: Partial<Omit<TeamSettings, 'entries'>>) => void;
  setPresetEntries: (entries: TeamPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<TeamPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;
  setTeamApi: (patch: Partial<ApiConfig>) => void;
  setTeamUseSharedApi: (v: boolean) => void;
  setDispatchApi: (patch: Partial<ApiConfig>) => void;
  setDispatchUseSharedApi: (v: boolean) => void;
  setDispatchReportAuto: (v: boolean) => void;
  setDispatchWebSearch: (v: boolean) => void;
  fetchTeamModels: () => Promise<void>;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const useTeam = create<TeamState>()(
  persist(
    (set, get) => ({
      established: false, disbanded: false, name: '', rank: 'E', teamExp: 0, activity: 50,
      members: [], perks: [], deeds: [],
      assessment: { pending: false, targetRank: '', status: 'none' },
      leaderId: '', leaderName: '',

      dispatchBoard: [], boardTurn: -1, boardSource: 'auto', boardBusy: false, boardError: '',
      dispatchActive: null, dispatchHistory: [], fatigue: {}, injury: {},

      settings: { ...DEFAULT_SETTINGS },
      teamApi: { baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.6, maxTokens: 4096, topP: 1 },
      teamUseSharedApi: true,
      teamAvailableModels: [], teamModelsLoading: false, teamModelsError: '',
      dispatchApi: { baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.85, maxTokens: 4096, topP: 1 },
      dispatchUseSharedApi: true,
      dispatchReportAuto: true,
      dispatchWebSearch: false,

      // 建团：正文明确建立冒险团时才调；进入建团考核
      establish: (patch) =>
        set((s) => ({
          established: true, disbanded: false,
          name: patch?.name?.trim() || s.name || '',
          rank: s.established ? s.rank : 'E',
          teamExp: s.established ? s.teamExp : 0,
          leaderId: s.established ? s.leaderId : '',        // 主角自建团：主角任团长
          leaderName: s.established ? s.leaderName : '',
          assessment: s.established ? s.assessment : { pending: true, targetRank: 'E', isEstablish: true, status: 'required', note: '建团试炼' },
        })),
      // 加入他人冒险团：全量写入（主角非团长，B1 作为普通成员）；清空建团考核（不是自建团）
      joinTeam: (payload) =>
        set(() => {
          const rank = (payload.rank && TEAM_RANKS.includes(payload.rank)) ? payload.rank : 'C';
          const leaderId = (payload.leaderId || '').trim();
          // 成员：去重（按 C-id 或姓名），确保含主角 B1
          const seen = new Set<string>();
          const members: TeamMember[] = [];
          for (const m of payload.members ?? []) {
            const key = (m.id || m.name || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            members.push({ id: m.id?.trim() || undefined, name: m.name?.trim() || undefined, tier: m.tier?.trim() || undefined, role: m.role?.trim() || undefined, note: m.note?.trim() || undefined });
          }
          if (!members.some((m) => m.id === 'B1')) members.push({ id: 'B1', role: '新晋成员' });
          return {
            established: true, disbanded: false,
            name: payload.name?.trim() || '（未命名冒险团）',
            rank,
            teamExp: clamp(payload.teamExp ?? 0),
            activity: clamp(payload.activity ?? 60),
            members, perks: payload.perks ?? [], deeds: (payload.deeds ?? []).map((d) => ({ ...d, addedAt: d.addedAt ?? Date.now() })),
            assessment: { pending: false, targetRank: '', status: 'none' },
            leaderId: leaderId || '__npc',
            leaderName: (payload.leaderName || '').trim(),
          };
        }),
      setTeam: (patch) =>
        set((s) => ({
          ...s,
          ...(patch.name != null && patch.name.trim() ? { name: patch.name.trim() } : {}),
          ...(patch.disbanded != null ? { disbanded: patch.disbanded } : {}),
          ...(patch.established != null ? { established: patch.established } : {}),
        })),

      addExp: (n) =>
        set((s) => {
          if (!s.established || s.disbanded) return s;
          let exp = s.teamExp + (n || 0);
          if (exp < 100) return { teamExp: clamp(exp) };
          // 经验满：判断晋级路径
          const target = nextRank(s.rank);
          if (!target) return { teamExp: 100 };          // 已满阶 SSS
          // 建团考核未过：不晋级
          if (s.assessment.pending) return { teamExp: 100 };
          const major = MAJOR_TARGETS.includes(target);
          if (major) {
            // 大阶位：触发考核，不自动晋级
            return { teamExp: 100, assessment: { pending: true, targetRank: target, isEstablish: false, status: 'required', note: `${s.rank}→${target} 晋阶考核` } };
          }
          // 小阶位：需活跃度达标才自动晋级
          if (s.activity >= ACTIVITY_GATE) return { rank: target, teamExp: clamp(exp - 100) };
          return { teamExp: 100 };                        // 活跃度不足，卡在满经验
        }),
      setExp: (v) => set({ teamExp: clamp(v) }),
      addActivity: (n) => set((s) => ({ activity: clamp(s.activity + (n || 0)) })),
      setRank: (r) => set({ rank: r, teamExp: 0 }),

      startAssessment: (targetRank, isEstablish) =>
        set({ assessment: { pending: true, targetRank, isEstablish: !!isEstablish, status: 'in_progress', note: isEstablish ? '建团试炼' : `晋阶考核 →${targetRank}` } }),
      resolveAssessment: (result) =>
        set((s) => {
          const a = s.assessment;
          if (result === 'pass') {
            const newRank = (!a.isEstablish && a.targetRank) ? (a.targetRank as TeamRank) : s.rank;
            return { rank: newRank, teamExp: 0, assessment: { pending: false, targetRank: '', status: 'passed' } };
          }
          if (result === 'disband') {
            return { disbanded: true, established: false, assessment: { pending: false, targetRank: '', status: 'failed', note: '考核惨败·解散' } };
          }
          // fail：减员为主（成员由 AI 走 removeTeamMember），此处回退经验+扣活跃；建团失败则未建成
          return {
            teamExp: 50, activity: clamp(s.activity - 20),
            established: a.isEstablish ? false : s.established,
            assessment: { pending: false, targetRank: '', status: 'failed', note: a.isEstablish ? '建团失败' : '晋阶考核失败' },
          };
        }),

      upsertMember: (id, patch) =>
        set((s) => {
          const cid = id.trim(); if (!cid) return s;
          const i = s.members.findIndex((m) => m.id === cid);
          if (i >= 0) { const next = [...s.members]; next[i] = { ...next[i], ...(patch?.role != null ? { role: patch.role } : {}), ...(patch?.note != null ? { note: patch.note } : {}) }; return { members: next }; }
          return { members: [...s.members, { id: cid, role: patch?.role, note: patch?.note }] };
        }),
      removeMember: (id) => set((s) => ({ members: s.members.filter((m) => m.id !== id) })),
      upsertPerk: (p) =>
        set((s) => {
          const nm = (p.name ?? '').trim(); if (!nm) return s;
          const i = s.perks.findIndex((x) => nameEq(x.name, nm));
          if (i >= 0) { const next = [...s.perks]; next[i] = { ...next[i], desc: p.desc ?? next[i].desc, source: p.source ?? next[i].source }; return { perks: next }; }
          return { perks: [...s.perks, { name: nm, desc: p.desc ?? '', source: p.source }] };
        }),
      removePerk: (name) => set((s) => ({ perks: s.perks.filter((x) => !nameEq(x.name, name)) })),
      // 批量清除：删掉传入名单里的效果，但**锁定的一律豁免**（防误删）
      removePerks: (names) => set((s) => ({ perks: s.perks.filter((x) => x.locked || !names.some((n) => nameEq(x.name, n))) })),
      // 一键清除：只保留锁定的
      clearPerks: () => set((s) => ({ perks: s.perks.filter((x) => x.locked) })),
      togglePerkLock: (name) => set((s) => ({ perks: s.perks.map((x) => nameEq(x.name, name) ? { ...x, locked: !x.locked } : x) })),
      appendDeed: (d) => set((s) => ({ deeds: [...s.deeds, { ...d, addedAt: d.addedAt ?? Date.now() }].slice(-50) })),

      clearTeam: () => set({
        established: false, disbanded: false, name: '', rank: 'E', teamExp: 0, activity: 50, members: [], perks: [], deeds: [], assessment: { pending: false, targetRank: '', status: 'none' }, leaderId: '', leaderName: '',
        dispatchBoard: [], boardTurn: -1, boardSource: 'auto', boardBusy: false, boardError: '',
        dispatchActive: null, dispatchHistory: [], fatigue: {}, injury: {},
      }),

      /* ── 派遣 ───────────────────────────────────────────────
         ⚠ 这里一行计算都不做（见文件头铁则③）：账本由 dispatchEngine 算好后整份传进来。*/
      setBoard: (offers, turn, source = 'auto') => set({ dispatchBoard: offers, boardTurn: turn, boardSource: source, boardError: '' }),
      setBoardBusy: (busy, error = '') => set({ boardBusy: busy, boardError: error }),
      beginDispatch: (rec) => set((s) => (s.dispatchActive ? s : { dispatchActive: rec })),   // 已有在跑的不覆盖
      sealDispatch: (ledger) =>
        set((s) => {
          const a = s.dispatchActive;
          if (!a) return s;
          const done: DispatchRecord = { ...a, ledger, read: false, reportState: a.reportState ?? 'none' };
          return { dispatchActive: null, dispatchHistory: [...s.dispatchHistory, done].slice(-DISPATCH_KEEP) };
        }),
      abortDispatch: () => set({ dispatchActive: null }),
      setReport: (id, patch) =>
        set((s) => ({ dispatchHistory: s.dispatchHistory.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      markDispatchRead: (id) =>
        set((s) => ({ dispatchHistory: s.dispatchHistory.map((r) => (r.id === id ? { ...r, read: true } : r)) })),
      patchFatigue: (delta) =>
        set((s) => {
          const next = { ...s.fatigue };
          for (const [id, d] of Object.entries(delta ?? {})) next[id] = clamp((next[id] ?? 0) + (d || 0));
          return { fatigue: next };
        }),
      decayFatigue: (exclude) =>
        set((s) => {
          const skip = new Set(exclude ?? []);
          const next: Record<string, number> = {};
          for (const [id, v] of Object.entries(s.fatigue)) {
            if (skip.has(id)) { next[id] = v; continue; }
            const nv = Math.max(0, v - FATIGUE_DECAY);
            if (nv > 0) next[id] = nv;                    // 归零的直接不留键，防长局堆垃圾
          }
          return { fatigue: next };
        }),
      setInjury: (id, v) =>
        set((s) => {
          const next = { ...s.injury };
          if (v && v.turns > 0) next[id] = v; else delete next[id];
          return { injury: next };
        }),
      tickInjury: () =>
        set((s) => {
          const next: Record<string, { turns: number; name: string }> = {};
          for (const [id, v] of Object.entries(s.injury)) {
            const t = v.turns - 1;
            if (t > 0) next[id] = { ...v, turns: t };     // 归零＝痊愈，键一并去掉
          }
          return { injury: next };
        }),
      clearDispatch: () => set({ dispatchBoard: [], boardTurn: -1, boardSource: 'auto', boardBusy: false, boardError: '', dispatchActive: null, dispatchHistory: [], fatigue: {}, injury: {} }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) => set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) => set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) => set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_TEAM_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),
      setTeamApi: (patch) => set((s) => ({ teamApi: { ...s.teamApi, ...patch } })),
      setTeamUseSharedApi: (v) => set({ teamUseSharedApi: v }),
      setDispatchApi: (patch) => set((s) => ({ dispatchApi: { ...s.dispatchApi, ...patch } })),
      setDispatchUseSharedApi: (v) => set({ dispatchUseSharedApi: v }),
      setDispatchReportAuto: (v) => set({ dispatchReportAuto: v }),
      setDispatchWebSearch: (v) => set({ dispatchWebSearch: v }),
      fetchTeamModels: async () => {
        const s = get();
        const api = s.teamUseSharedApi ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })() : s.teamApi;
        if (!api.baseUrl || !api.apiKey) { set({ teamModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ teamModelsLoading: true, teamModelsError: '' });
        try {
          const res = await fetch(...modelsFetchArgs(api));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ teamAvailableModels: models, teamModelsLoading: false });
        } catch (e: any) { set({ teamModelsError: e.message ?? '请求失败', teamModelsLoading: false }); }
      },
    }),
    {
      name: 'drpg-team',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        assessment: { ...current.assessment, ...(persisted?.assessment ?? {}) },
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          entries: Array.isArray(persisted?.settings?.entries) && persisted.settings.entries.length > 0 ? persisted.settings.entries : DEFAULT_TEAM_ENTRIES,
        },
        teamApi: { ...current.teamApi, ...(persisted?.teamApi ?? {}) },
        teamUseSharedApi: persisted?.teamUseSharedApi ?? current.teamUseSharedApi,
        teamAvailableModels: [], teamModelsLoading: false, teamModelsError: '',
        // 派遣：旧档没有这些键 → 用 current 的默认值补齐（?? 不能用 ||，boardTurn 合法值有 -1、fatigue 合法值是 {}）
        dispatchApi: { ...current.dispatchApi, ...(persisted?.dispatchApi ?? {}) },
        dispatchUseSharedApi: persisted?.dispatchUseSharedApi ?? current.dispatchUseSharedApi,
        dispatchReportAuto: persisted?.dispatchReportAuto ?? current.dispatchReportAuto,
        dispatchWebSearch: persisted?.dispatchWebSearch ?? current.dispatchWebSearch,
        dispatchBoard: persisted?.dispatchBoard ?? [],
        boardTurn: persisted?.boardTurn ?? -1,
        boardSource: persisted?.boardSource === 'ai' ? 'ai' : 'auto',
        boardBusy: false, boardError: '',      // 生成中途关页/刷新 → 一律回落成「不忙」，免得卡在转圈
        dispatchActive: persisted?.dispatchActive ?? null,
        dispatchHistory: persisted?.dispatchHistory ?? [],
        fatigue: persisted?.fatigue ?? {},
        injury: persisted?.injury ?? {},
      }),
    },
  ),
);

/* ── 主角所属冒险团「团队效果(perk)」对主角的数值加成（仅已建立且未解散时生效）──
   团队效果是自由文本，这里复用与装备/技能/天赋同一套解析：
   - 六维加成：解析 perk 的 名称+描述 里的「力量+10 / 体质+5」等，折进主角有效六维 base，
     让战斗/骰子/属性面板/衍生属性/HP·EP（HP=体×20、EP=智×15）等所有用到属性的功能一并生效。
   - HP/EP 上限加成：把 perk 当作「能力文本」({effect,desc}) 交给 abilityMaxHp/EpBonus 系列解析，
     使「生命上限+100 / 10%法力加成」之类显式上限文本同样计入主角 HP/EP 上限。
   仅作用于主角（团队增益只加主角，不影响 NPC 的属性计算）。*/
export function playerTeamAttrBonus(): AttrDelta {
  const t = useTeam.getState();
  if (!t.established || t.disbanded) return {};
  const out: AttrDelta = {};
  for (const p of t.perks ?? []) {
    const d = parseAttrBonus(`${p.name ?? ''} ${p.desc ?? ''}`);
    for (const k of ATTR_KEYS) if (d[k]) out[k] = (out[k] ?? 0) + d[k]!;
  }
  return out;
}
export function playerTeamPerkAbilities(): { effect?: string; desc?: string }[] {
  const t = useTeam.getState();
  if (!t.established || t.disbanded) return [];
  return (t.perks ?? []).map((p) => ({ effect: p.desc, desc: p.name }));
}
