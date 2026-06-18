import { create } from 'zustand';

// 联机实时会话态。【不持久化】——和 imageViewerStore 一样是 live 状态，刷新即断开重来。
// 由 systems/mpClient.ts 在收到 WS 事件时写入；UI 订阅它。

export type MpRole = 'host' | 'player' | 'spectator' | null;
export type MpStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export interface MpSeat { seatId: string; name: string; playerId: string; hasCard?: boolean }
export interface MpSeatCard { seatId: string; name: string; snapshot: any | null }
export interface MpComment { id: string; name: string; role: string; text?: string; at: number; share?: { kind: string; data: any } }
export interface MpTurn { turnId: number; phase: string; inputs: Record<string, { name: string; text: string; at: number }> }
export interface MpRoom { roomId: string; name: string; hostId: string; hostName: string; maxSeats: number; status: string }

// 深度接入回调槽：App.tsx 在 effect 里注册，把联机事件接进主聊天/AI 循环（Phase 1 第二步用）。
export interface MpHandlers {
  onWorld?: (payload: any, isReplay?: boolean) => void;   // 来宾：世界快照 → 同步世界态(+非replay时渲染本回合正文)
  onNarrativeLog?: (entries: { role: string; content: string }[]) => void;  // 中途加入：补看房主正文进度
  onGuestJoin?: () => void;     // 来宾进房：快照单机存档以隔离（联机存档）
  onGuestRestore?: () => void;  // 来宾离开/关房：还原单机存档
  onCombat?: (payload: any) => void;       // 来宾：收到房主广播的战斗快照 → 渲染观战
  onCombatAction?: (payload: any) => void; // 房主：收到来宾的战斗出手 → 结算
  onRelay?: (m: { event: string; from: any; payload: any }) => void;  // 通用透传(赠予/分享)
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
  incomingGift: any | null;   // 收到的赠予 → 弹窗
  mpPresetOn: boolean;        // 房主：本局是否启用「联机专用正文规则」
  handlers: MpHandlers;
  _set: (p: Partial<MpState>) => void;
  setHandlers: (h: MpHandlers) => void;
  setMpPresetOn: (v: boolean) => void;
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
  incomingGift: null as any,
};

export const useMp = create<MpState>((set) => ({
  ...INIT,
  handlers: {},
  mpPresetOn: true,
  _set: (p) => set(p),
  setHandlers: (h) => set({ handlers: h }),
  setMpPresetOn: (v) => set({ mpPresetOn: v }),
  reset: () => set({ ...INIT }),
}));
