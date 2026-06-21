import { create } from 'zustand';

// 全局交易行·会话态。【不持久化】——和 chatRoomStore 一样是 live 状态，刷新即断开重来。
// 由 systems/tradeClient.ts 在收到 WS 事件时写入；TradePanel 订阅它。

export type TradeStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export interface TradeOffer { id: string; buyerId: string; buyerName: string; hue?: number; avv?: number; ds?: string; nc?: string; price: number; message?: string; at: number }
export interface TradeListing {
  id: string; sellerId: string; sellerName: string; hue?: number; avv?: number; ds?: string; nc?: string;
  item: any; price: number; currency: string; note?: string; at: number;
  offers: TradeOffer[];
}
export interface TradeMe { playerId: string; name: string; hue?: number }

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
