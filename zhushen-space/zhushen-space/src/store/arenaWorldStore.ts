import { create } from 'zustand';
import type { ArenaCard, ArenaMe, ArenaChallengeResult } from '../systems/arenaWorldProtocol';

// 世界竞技场·会话态。【不持久化】——和 assistStore / tradeStore 一样是 live 状态，刷新即断开重来。
// 由 systems/arenaWorldClient.ts 在收到 WS 事件时写入；ArenaWorldPanel 订阅它。
// （排名/参赛卡的权威在服务端 ArenaWorldDO；本 store 只是最近一次广播的快照。）

export type ArenaStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type { ArenaCard, ArenaMe };

interface ArenaState {
  status: ArenaStatus;
  me: ArenaMe | null;
  cards: ArenaCard[];                       // 已按 rank 升序（服务端下发即有序）
  online: number;
  error: string | null;
  lastResult: ArenaChallengeResult | null;  // 最近一次挑战结果（供战斗回放，消费后清空）
  _set: (p: Partial<ArenaState>) => void;
  reset: () => void;
}

const INIT = {
  status: 'idle' as ArenaStatus,
  me: null as ArenaMe | null,
  cards: [] as ArenaCard[],
  online: 0,
  error: null as string | null,
  lastResult: null as ArenaChallengeResult | null,
};

export const useArenaWorld = create<ArenaState>((set): ArenaState => ({
  ...INIT,
  _set: (p) => set(p),
  reset: () => set({ ...INIT }),
}));
