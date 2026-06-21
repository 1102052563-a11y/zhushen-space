import { create } from 'zustand';
import type { TradeOffer, TradeListing, TradeMe } from '../systems/tradeProtocol';

// 全局交易行·会话态。【不持久化】——和 chatRoomStore 一样是 live 状态，刷新即断开重来。
// 由 systems/tradeClient.ts 在收到 WS 事件时写入；TradePanel 订阅它。

export type TradeStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
// 载荷类型（TradeOffer/TradeListing/TradeMe）已上移到 systems/tradeProtocol.ts 作单一事实来源；
// 这里再导出，保持现有「从 store 引类型」（tradeClient / TradePanel）不变。
export type { TradeOffer, TradeListing, TradeMe };

interface TradeState {
  status: TradeStatus;
  me: TradeMe | null;
  listings: TradeListing[];
  online: number;
  error: string | null;
  _set: (p: Partial<TradeState>) => void;
  reset: () => void;
}

const MAX_LISTINGS = 200;

const INIT = {
  status: 'idle' as TradeStatus,
  me: null as TradeMe | null,
  listings: [] as TradeListing[],
  online: 0,
  error: null as string | null,
};

export const useTrade = create<TradeState>((set): TradeState => ({
  ...INIT,
  _set: (p) => set(p),
  reset: () => set({ ...INIT }),
}));

export const TRADE_MAX_LISTINGS = MAX_LISTINGS;
