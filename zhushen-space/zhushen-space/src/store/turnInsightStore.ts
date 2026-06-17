import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

const MAX_SNAPSHOTS = 14;

interface TurnInsightState {
  snapshots: TurnSnapshot[];
  pushSnapshot: (s: TurnSnapshot) => void;
  clear: () => void;
}

export const useTurnInsight = create<TurnInsightState>()(
  persist(
    (set) => ({
      snapshots: [],
      pushSnapshot: (s) =>
        set((st) => {
          // 同一回合重复抓取则覆盖最后一条
          const arr = [...st.snapshots];
          if (arr.length && arr[arr.length - 1].turn === s.turn) arr[arr.length - 1] = s;
          else arr.push(s);
          return { snapshots: arr.slice(-MAX_SNAPSHOTS) };
        }),
      clear: () => set({ snapshots: [] }),
    }),
    { name: 'drpg-turn-insight' }
  )
);
