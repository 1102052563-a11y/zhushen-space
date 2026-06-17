import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import type { StatusEffect } from './playerStore';
import type { DiceAttrs } from '../systems/diceEngine';

/* ════════════════════════════════════════════
   战斗系统 store（drpg-combat）—— 仿 fanren-remake 回合制战斗，重皮成轮回乐园风格。
   · config / 预设 / 独立 API：随设置长期持久（不随「新游戏」清空）
   · battle 运行态：属游戏进度，clearCombat() 由 saveManager 在新游戏时清空
   结算走 systems/diceEngine（确定性骰子），数值由代码算，AI 只叙事+判暴击。
════════════════════════════════════════════ */

export type CombatStage = 'idle' | 'awaiting_player' | 'awaiting_npc' | 'resolving' | 'ended';
export type Side = 'player' | 'enemy';
export type CombatActionKind = 'attack' | 'skill' | 'item' | 'defend' | 'flee' | 'charge' | 'cancel';

/* 领域/阵法：展开后每回合对一方持续生效，直到时限到或主人倒下。阵法视作领域的一种，不单列。 */
export interface DomainState {
  id: string;
  ownerId: string;
  ownerName: string;
  side: Side;                                    // 主人所属方
  name: string;
  emoji: string;
  profile: 'damage' | 'heal' | 'shield' | 'buff' | 'debuff';
  affects: 'enemy' | 'ally';                     // 作用对象（相对主人）
  amountPerRound: number;                         // 伤害/治疗/护盾定值，或 buff/debuff 的倍率
  roundsLeft: number;
  effectDesc: string;
}

/* 蓄力大招进行态（轮回乐园风：高威能技能需连续几回合蓄力，蓄满才轰出，被控制会中断） */
export interface ChargeState {
  skillId: string;
  name: string;
  targetIds: string[];   // 蓄力锁定的目标
  turnsTotal: number;    // 总蓄力回合
  turnsLeft: number;     // 剩余蓄力回合（=0 时本回合释放）
  epPerTurn: number;     // 每回合灌注的 EP
}

/* 参战者静态统计块：建战时算一次并锚定（存档/读档据此复原，避免六维漂移影响进行中的战斗） */
export interface CombatStatBlock {
  side: Side;
  name: string;
  attrs: DiceAttrs;       // 力/敏/体/智/魅/幸
  level: number;
  tier: string;           // 阶位（一阶~无上之境）
  bioStrength: string;    // 生物强度模板（T0~T9），对抗算绝对强度差
  favor?: number;         // NPC 好感（社交向修正用，战斗一般不计）
  patk: number; pdef: number; matk: number; mdef: number;  // 衍生攻防
  maxHp: number; maxEp: number;
  initHp?: number; initEp?: number;  // 入场时的当前 HP/EP（可带伤进场；缺省=满）
  isTransient?: boolean;  // battleData 内联生成的未建档敌人/召唤物
}

/* 参战者动态运行态 */
export interface Combatant {
  id: string;
  side: Side;
  initiative: number;
  curHp: number;
  curEp: number;
  curShield: number;
  maxShield: number;
  status: StatusEffect[];               // buff/debuff（复用主角/NPC 的限时状态结构）
  cooldowns: Record<string, number>;    // skillId -> 剩余冷却回合
  defending?: boolean;                  // 本回合处于防御姿态（承伤减免）
  charging?: ChargeState;               // 正在蓄力的大招（蓄满释放，被控制中断）
  left?: boolean;                       // 已撤退/逃离战场（不再排进出手顺序）
}

export interface CombatLogEntry {
  id: string;
  round: number;
  type: 'action' | 'system' | 'context' | 'opening';
  actorId?: string;
  text: string;          // 结算明细（命中/伤害/治疗/状态/d20 明细）
  narration?: string;    // AI 叙事
  dialogue?: string;     // 角色台词
  timestamp: number;
}

export interface BattleContext {
  reason: string;
  location: string;
  playerTeam: string[];
  enemyTeam: string[];
  endConditions: string[];
}

export interface BattleState {
  active: boolean;
  battleId: string;
  stage: CombatStage;
  round: number;
  turn: number;                                   // order 中当前行动者下标
  order: string[];                                // 按先攻降序的参战者 id
  participants: Record<string, Combatant>;
  initialState: Record<string, CombatStatBlock>;
  context: BattleContext;
  log: CombatLogEntry[];
  transientEntities: Record<string, { name: string; side: Side; kind: string }>;
  activeArrays: DomainState[];                     // 已展开的领域/阵法
  endReason: string | null;
  victor: Side | null;
}

/* 4 阶段提示词预设（空串=用 promptRules.ts 的内置默认规则） */
export interface CombatPreset {
  id: string;
  name: string;
  isBuiltIn?: boolean;
  battleDataPrompt: string;
  npcActionPrompt: string;
  resultPrompt: string;
  summaryPrompt: string;
}

export interface CombatConfig {
  enabled: boolean;
  settlementMode: 'code' | 'ai';     // code=骰子引擎确定性结算（默认）/ ai=交给 AI 兜底裁定
  turnDriverMode: 'llm' | 'local';   // NPC 回合由 AI 决策 / 本地启发式（第二层）
  manualAllyControl: boolean;        // 手动控制玩家方队友（默认 AI 托管）
  retryCount: number;                // AI 阶段解析失败重试次数
  activePresetId: string;
  savedPresets: CombatPreset[];
}

const DEFAULT_PRESET: CombatPreset = {
  id: 'default', name: '默认战斗预设', isBuiltIn: true,
  battleDataPrompt: '', npcActionPrompt: '', resultPrompt: '', summaryPrompt: '',
};

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  enabled: false,
  settlementMode: 'code',
  turnDriverMode: 'llm',
  manualAllyControl: false,
  retryCount: 2,
  activePresetId: 'default',
  savedPresets: [{ ...DEFAULT_PRESET }],
};

export function emptyBattle(): BattleState {
  return {
    active: false, battleId: '', stage: 'idle', round: 0, turn: 0,
    order: [], participants: {}, initialState: {},
    context: { reason: '', location: '', playerTeam: [], enemyTeam: [], endConditions: [] },
    log: [], transientEntities: {}, activeArrays: [], endReason: null, victor: null,
  };
}

let logSeq = 0;
export function newLogId(): string { return `clog_${Date.now()}_${logSeq++}`; }

interface CombatState {
  battle: BattleState;
  config: CombatConfig;
  combatApi: ApiConfig;
  combatUseSharedApi: boolean;
  combatAvailableModels: string[];
  combatModelsLoading: boolean;
  combatModelsError: string;

  // UI 选择态（面板内）
  selectedAction: CombatActionKind | null;
  selectedSkillId: string | null;
  selectedItemId: string | null;
  selectedTargetIds: string[];
  actionInput: string;
  apiBusy: boolean;
  apiStatus: string;
  undoSnapshot: BattleState | null; // 玩家本回合出手前的战况快照（撤销用，不持久化）

  // ── 战斗运行态 ──
  setBattle: (b: BattleState) => void;
  updateBattle: (fn: (b: BattleState) => BattleState) => void;
  setStage: (stage: CombatStage) => void;
  addLog: (entry: Omit<CombatLogEntry, 'id' | 'timestamp'>) => void;
  endBattle: (victor: Side | null, reason: string) => void;
  exitCombat: () => void;
  clearCombat: () => void;

  // ── 配置 / 预设 ──
  setConfig: (patch: Partial<CombatConfig>) => void;
  getActivePreset: () => CombatPreset;
  setActivePreset: (id: string) => void;
  addPreset: () => string;
  updatePreset: (id: string, patch: Partial<Omit<CombatPreset, 'id'>>) => void;
  deletePreset: (id: string) => void;

  // ── API ──
  setCombatApi: (patch: Partial<ApiConfig>) => void;
  setCombatUseSharedApi: (v: boolean) => void;

  // ── UI ──
  setSelectedAction: (a: CombatActionKind | null) => void;
  setSelectedSkillId: (id: string | null) => void;
  setSelectedItemId: (id: string | null) => void;
  setSelectedTargetIds: (ids: string[]) => void;
  setActionInput: (t: string) => void;
  resetSelection: () => void;
  setApiBusy: (v: boolean) => void;
  setApiStatus: (s: string) => void;
  setUndoSnapshot: (s: BattleState | null) => void;
}

export const useCombat = create<CombatState>()(
  persist(
    (set, get) => ({
      battle: emptyBattle(),
      config: { ...DEFAULT_COMBAT_CONFIG },
      combatApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.8, maxTokens: 2048, topP: 1,
      },
      combatUseSharedApi: true,
      combatAvailableModels: [],
      combatModelsLoading: false,
      combatModelsError: '',

      selectedAction: null,
      selectedSkillId: null,
      selectedItemId: null,
      selectedTargetIds: [],
      actionInput: '',
      apiBusy: false,
      apiStatus: '',
      undoSnapshot: null,

      setBattle: (b) => set({ battle: b }),
      updateBattle: (fn) => set((s) => ({ battle: fn(s.battle) })),
      setStage: (stage) => set((s) => ({ battle: { ...s.battle, stage } })),
      addLog: (entry) => set((s) => ({
        battle: { ...s.battle, log: [...s.battle.log, { ...entry, id: newLogId(), timestamp: Date.now() }] },
      })),
      endBattle: (victor, reason) => set((s) => ({
        battle: { ...s.battle, active: false, stage: 'ended', victor, endReason: reason },
        undoSnapshot: null,
      })),
      exitCombat: () => set({
        battle: emptyBattle(), selectedAction: null, selectedSkillId: null, selectedItemId: null,
        selectedTargetIds: [], actionInput: '', apiBusy: false, apiStatus: '', undoSnapshot: null,
      }),
      clearCombat: () => set({ battle: emptyBattle(), apiBusy: false, apiStatus: '', undoSnapshot: null }),

      setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      getActivePreset: () => {
        const c = get().config;
        return c.savedPresets.find((p) => p.id === c.activePresetId) ?? c.savedPresets[0] ?? { ...DEFAULT_PRESET };
      },
      setActivePreset: (id) => set((s) => ({ config: { ...s.config, activePresetId: id } })),
      addPreset: () => {
        const id = `combat_preset_${Date.now()}`;
        set((s) => {
          const base = s.config.savedPresets.find((p) => p.id === s.config.activePresetId) ?? DEFAULT_PRESET;
          const preset: CombatPreset = { ...base, id, name: `${base.name.replace(/-自定义$/, '')}-自定义`, isBuiltIn: false };
          return { config: { ...s.config, savedPresets: [...s.config.savedPresets, preset], activePresetId: id } };
        });
        return id;
      },
      updatePreset: (id, patch) => set((s) => ({
        config: { ...s.config, savedPresets: s.config.savedPresets.map((p) => (p.id === id ? { ...p, ...patch } : p)) },
      })),
      deletePreset: (id) => set((s) => {
        if (s.config.savedPresets.length <= 1) return s;
        const savedPresets = s.config.savedPresets.filter((p) => p.id !== id);
        const activePresetId = s.config.activePresetId === id ? (savedPresets[0]?.id ?? 'default') : s.config.activePresetId;
        return { config: { ...s.config, savedPresets, activePresetId } };
      }),

      setCombatApi: (patch) => set((s) => ({ combatApi: { ...s.combatApi, ...patch } })),
      setCombatUseSharedApi: (v) => set({ combatUseSharedApi: v }),

      setSelectedAction: (a) => set({ selectedAction: a }),
      setSelectedSkillId: (id) => set({ selectedSkillId: id }),
      setSelectedItemId: (id) => set({ selectedItemId: id }),
      setSelectedTargetIds: (ids) => set({ selectedTargetIds: ids }),
      setActionInput: (t) => set({ actionInput: t }),
      resetSelection: () => set({ selectedAction: null, selectedSkillId: null, selectedItemId: null, selectedTargetIds: [], actionInput: '' }),
      setApiBusy: (v) => set({ apiBusy: v }),
      setApiStatus: (s) => set({ apiStatus: s }),
      setUndoSnapshot: (snap) => set({ undoSnapshot: snap }),
    }),
    {
      name: 'drpg-combat',
      version: 1,
      // 模型列表/瞬时 UI 不持久化
      partialize: (s) => ({
        battle: s.battle, config: s.config,
        combatApi: s.combatApi, combatUseSharedApi: s.combatUseSharedApi,
      }) as CombatState,
    },
  ),
);
