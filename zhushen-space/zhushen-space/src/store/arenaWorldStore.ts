import { create } from 'zustand';
import type { ArenaCard, ArenaMe, ArenaChallengeResult, DuelFighter, DuelSide } from '../systems/arenaWorldProtocol';

// 世界竞技场·会话态。【不持久化】——和 assistStore / tradeStore 一样是 live 状态，刷新即断开重来。
// 由 systems/arenaWorldClient.ts 在收到 WS 事件时写入；ArenaWorldPanel 订阅它。
// （排名/参赛卡的权威在服务端 ArenaWorldDO；本 store 只是最近一次广播的快照。）

export type ArenaStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type { ArenaCard, ArenaMe };

// 手动/切磋对战后的专属战报（AI 读赌场战斗世界书生成·≥500字·只显示在竞技场面板·不进正文）
export interface ArenaSparResult { text: string; winnerName: string; loserName: string; iWon: boolean; ranked: boolean; loading: boolean }

// 实时对战·本地会话态（由 client 据 WS 事件写入；面板订阅渲染血条/回合日志/出招框）
export interface DuelLive {
  duelId: string;
  ranked: boolean;
  you: DuelSide;
  isJudge: boolean;                         // 我是否评委（发起方·负责跑 AI 裁定）
  status: 'active' | 'ended';
  round: number;                            // 当前待出招回合
  a: DuelFighter; b: DuelFighter;           // 静态档案（名/卡/owner/立绘）
  hpA: number; hpB: number; maxHpA: number; maxHpB: number;
  rounds: { round: number; narrative: string; hpA: number; hpB: number }[];   // 已裁定回合日志
  submitted: { A: boolean; B: boolean };    // 本回合双方出招状态
  judging: boolean;                         // 评委正在跑 AI
  winner: DuelSide | null;
  endedReason?: string;                     // forfeit / disconnect / cancel
}
export interface DuelInvite { duelId: string; ranked: boolean; challengerCard: ArenaCard }   // 收到的邀请
export interface DuelPending { duelId: string; opponent: ArenaCard }                          // 我方发起后等待接受
export interface DuelJudgeReq { duelId: string; round: number; actionA: string; actionB: string }   // 仅评委：待裁定

interface ArenaState {
  status: ArenaStatus;
  me: ArenaMe | null;
  cards: ArenaCard[];                       // 已按 rank 升序（服务端下发即有序）
  online: number;
  onlineOwners: string[];                   // 当前在线玩家 id（标记可实时对战的在线对手）
  error: string | null;
  lastResult: ArenaChallengeResult | null;  // 最近一次挑战结果（供战斗回放，消费后清空）
  sparResult: ArenaSparResult | null;       // 手动/切磋战报（面板展示，返回榜单时清空）
  duel: DuelLive | null;                    // 进行中的实时对战
  incomingInvite: DuelInvite | null;        // 收到的对战邀请（弹窗接受/拒绝）
  pendingInvite: DuelPending | null;        // 我方已发起·等待对方接受
  pendingJudge: DuelJudgeReq | null;        // 仅评委：待跑 AI 裁定（面板 effect 消费后清空）
  _set: (p: Partial<ArenaState>) => void;
  reset: () => void;
}

const INIT = {
  status: 'idle' as ArenaStatus,
  me: null as ArenaMe | null,
  cards: [] as ArenaCard[],
  online: 0,
  onlineOwners: [] as string[],
  error: null as string | null,
  lastResult: null as ArenaChallengeResult | null,
  sparResult: null as ArenaSparResult | null,
  duel: null as DuelLive | null,
  incomingInvite: null as DuelInvite | null,
  pendingInvite: null as DuelPending | null,
  pendingJudge: null as DuelJudgeReq | null,
};

export const useArenaWorld = create<ArenaState>((set): ArenaState => ({
  ...INIT,
  _set: (p) => set(p),
  reset: () => set({ ...INIT }),
}));
