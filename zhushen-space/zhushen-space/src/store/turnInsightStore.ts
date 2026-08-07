import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';   // lz 压缩：每快照~59KB×14 挡=800KB+

/* 回合洞察：每回合结束抓一份精简快照，用于"本轮相对上一轮变了什么"的对比。 */

export interface TurnStatusEffect { name: string; type?: string; effect?: string; source?: string; desc?: string; durationDesc?: string }
export interface TurnNpc { name: string; favor: number; status: string; motiveNow: string; realm: string; onScene: boolean; statusEffects?: TurnStatusEffect[] }
export interface TurnFaction { name: string; favorToPlayer: number; status: string; inCurrentWorld: boolean; goal?: string; territory?: string; resources?: string; scale?: string; powerLevel?: string; relations?: string; leader?: string }

export interface TurnSnapshot {
  turn: number;
  time: number;
  worldName: string;
  player: {
    level?: number;
    attrs?: { str: number; agi: number; con: number; int: number; cha: number; luck: number };
    status?: string;
    statusEffects?: TurnStatusEffect[];
    hp?: number; maxHp?: number; mp?: number; maxMp?: number;
    skills?: string[];      // 技能名清单
    titlesEquipped?: string; // 当前佩戴称号
    parkCoin?: number;       // 乐园币
    soulCoin?: number;       // 灵魂钱币（魂币）
    equips?: { name: string; grade?: string; plus?: number }[];  // 已装备：名 / 品级 / 强化+N
  };
  npcs: Record<string, TurnNpc>;
  factions: Record<string, TurnFaction>;
  arbitration?: string[];   // ⚖️ 成长仲裁：本回合被闸门驳回/夹逼的 NPC 阶位·等级·bs·六维变更（npcGrowthGuard 日志）
  // 🤖 Agent 正文模式（P1）：本回合正文若由 Agent 工具循环生成，归档 run 概要（详情看 AgentTimeline 历史）
  agentRun?: { status: string; rounds: number; toolCalls: number; commits: number; durationMs?: number; errorCode?: string };
  // 🎡 设施动态（P4）：本窗口的场外设施动作一览（facilityBridge 旁路记·所有系统的心跳汇于洞察一处）
  facilityNotes?: string[];
}

/* 🧭 一致性哨兵（P0·evoGuard）：正文/演化与权威 store 的冲突流水（时间倒退被拦、发送屏障超时、
   切世界中止在途演化…）。只记录不拦截——排查「数值乱跳/时间漂移」的黑匣子，回合洞察面板可见。 */
export interface ConsistencyEntry { turn: number; time: number; kind: string; detail: string }

const MAX_SNAPSHOTS = 14;
const MAX_CONSISTENCY = 60;

interface TurnInsightState {
  snapshots: TurnSnapshot[];
  consistency: ConsistencyEntry[];
  pushSnapshot: (s: TurnSnapshot) => void;
  logConsistency: (e: ConsistencyEntry) => void;
  clear: () => void;
}

export const useTurnInsight = create<TurnInsightState>()(
  persist(
    (set): TurnInsightState => ({
      snapshots: [],
      consistency: [],
      pushSnapshot: (s) =>
        set((st) => {
          // 同一回合重复抓取则覆盖最后一条
          const arr = [...st.snapshots];
          if (arr.length && arr[arr.length - 1].turn === s.turn) arr[arr.length - 1] = s;
          else arr.push(s);
          return { snapshots: arr.slice(-MAX_SNAPSHOTS) };
        }),
      logConsistency: (e) =>
        set((st) => ({ consistency: [...(st.consistency ?? []), e].slice(-MAX_CONSISTENCY) })),   // ?? []：旧存档无此字段
      clear: () => set({ snapshots: [], consistency: [] }),
    }),
    { name: 'drpg-turn-insight', storage: lzStorage() }
  )
);
