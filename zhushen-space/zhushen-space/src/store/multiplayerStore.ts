import { create } from 'zustand';

// 联机实时会话态。【不持久化】——和 imageViewerStore 一样是 live 状态，刷新即断开重来。
// 由 systems/mpClient.ts 在收到 WS 事件时写入；UI 订阅它。

export type MpRole = 'host' | 'player' | 'spectator' | null;
export type MpStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export interface MpSeat { seatId: string; name: string; playerId: string; hasCard?: boolean }
export interface MpSeatCard { seatId: string; name: string; snapshot: any | null }
export interface MpComment { id: string; name: string; role: string; text: string; at: number }
export interface MpTurn { turnId: number; phase: string; inputs: Record<string, { name: string; text: string; at: number }> }
export interface MpRoom { roomId: string; name: string; hostId: string; hostName: string; maxSeats: number; status: string }

// 深度接入回调槽：App.tsx 在 effect 里注册，把联机事件接进主聊天/AI 循环（Phase 1 第二步用）。
export interface MpHandlers {
  onWorld?: (payload: any) => void;        // 来宾：收到房主广播的世界快照 → 渲染正文 + 同步世界态
  onCombat?: (payload: any) => void;       // 来宾：收到房主广播的战斗快照 → 渲染观战
  onTurnStarted?: (turn: MpTurn | null) => void;
  onTurnResolved?: (turn: MpTurn | null) => void;
}

interface MpState {
  status: MpStatus;
  role: MpRole;
  mySeatId: string | null;
  room: MpRoom | null;
  seats: MpSeat[];
  cards: MpSeatCard[];
  turn: MpTurn | null;
  comments: MpComment[];
  worldSnapshot: any | null;
  combatSnapshot: any | null;
  lastWorldAt: number;
  error: string | null;
  handlers: MpHandlers;
  _set: (p: Partial<MpState>) => void;
  setHandlers: (h: MpHandlers) => void;
  reset: () => void;
}

const INIT = {
  status: 'idle' as MpStatus,
  role: null as MpRole,
  mySeatId: null as string | null,
  room: null as MpRoom | null,
  seats: [] as MpSeat[],
  cards: [] as MpSeatCard[],
  turn: null as MpTurn | null,
  comments: [] as MpComment[],
  worldSnapshot: null as any,
  combatSnapshot: null as any,
  lastWorldAt: 0,
  error: null as string | null,
};

export const useMp = create<MpState>((set) => ({
  ...INIT,
  handlers: {},
  _set: (p) => set(p),
  setHandlers: (h) => set({ handlers: h }),
  reset: () => set({ ...INIT }),
}));
