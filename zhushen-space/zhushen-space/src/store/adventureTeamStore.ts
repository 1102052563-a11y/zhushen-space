import { create } from 'zustand';
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

  /* ── 演化设置 + 独立 API（配置，newGame 保留）── */
  settings: TeamSettings;
  teamApi: ApiConfig;
  teamUseSharedApi: boolean;
  teamAvailableModels: string[];
  teamModelsLoading: boolean;
  teamModelsError: string;

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

  /* ── 预设 / API actions ── */
  setSettings: (patch: Partial<Omit<TeamSettings, 'entries'>>) => void;
  setPresetEntries: (entries: TeamPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<TeamPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;
  setTeamApi: (patch: Partial<ApiConfig>) => void;
  setTeamUseSharedApi: (v: boolean) => void;
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

      settings: { ...DEFAULT_SETTINGS },
      teamApi: { baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.6, maxTokens: 4096, topP: 1 },
      teamUseSharedApi: true,
      teamAvailableModels: [], teamModelsLoading: false, teamModelsError: '',

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

      clearTeam: () => set({ established: false, disbanded: false, name: '', rank: 'E', teamExp: 0, activity: 50, members: [], perks: [], deeds: [], assessment: { pending: false, targetRank: '', status: 'none' }, leaderId: '', leaderName: '' }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) => set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) => set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) => set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_TEAM_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),
      setTeamApi: (patch) => set((s) => ({ teamApi: { ...s.teamApi, ...patch } })),
      setTeamUseSharedApi: (v) => set({ teamUseSharedApi: v }),
      fetchTeamModels: async () => {
        const s = get();
        const api = s.teamUseSharedApi ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })() : s.teamApi;
        if (!api.baseUrl || !api.apiKey) { set({ teamModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ teamModelsLoading: true, teamModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
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
