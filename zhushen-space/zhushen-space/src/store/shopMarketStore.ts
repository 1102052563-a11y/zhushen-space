import { create } from 'zustand';
import type { PublishedShop, ShopMe } from '../systems/shopProtocol';

// 玩家产业·商城·会话态。【不持久化】——同 assistStore / tradeStore，live 状态刷新即断开重来。
// 由 systems/shopClient.ts 在收到 WS 事件时写入；ProducePanel「逛商城」Tab 订阅它。
// （买货物化出来的物品/随从是普通 itemStore/npcStore 记录，随存档持久化，与本 store 无关。）

export type ShopMpStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type { PublishedShop, ShopMe };

interface ShopMarketState {
  status: ShopMpStatus;
  me: ShopMe | null;
  shops: PublishedShop[];
  online: number;
  error: string | null;
  revenue: Record<string, number>;   // 我的云端待领营收 { 货币 → 额 }（他人光顾我上传的店累计）
  _set: (p: Partial<ShopMarketState>) => void;
  reset: () => void;
}

const INIT = {
  status: 'idle' as ShopMpStatus,
  me: null as ShopMe | null,
  shops: [] as PublishedShop[],
  online: 0,
  error: null as string | null,
  revenue: {} as Record<string, number>,
};

export const useShopMarket = create<ShopMarketState>((set): ShopMarketState => ({
  ...INIT,
  _set: (p) => set(p),
  reset: () => set({ ...INIT }),
}));
