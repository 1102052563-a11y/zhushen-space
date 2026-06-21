// 全局交易行·线协议（client ⇄ TradeDO）—— 前端侧单一事实来源（同 chatProtocol.ts 的范式）。
// 锁定 systems/tradeClient.ts 收发 + store/tradeStore.ts 存态 + components/TradePanel.tsx 渲染 三处一致。
// **改协议时同步比对 multiplayer-worker/src/TradeDO.js 的 webSocketMessage / 广播**（服务端校验仍在 TradeDO）。

// ── 公共载荷（既走线、也存进 store）────────────────────────────────
export interface TradeOffer {
  id: string;
  buyerId: string;
  buyerName: string;
  hue?: number; avv?: number; ds?: string; nc?: string;   // 出价人身份（与聊天室共用）
  price: number;
  message?: string;
  at: number;
}

export interface TradeListing {
  id: string;
  sellerId: string;
  sellerName: string;
  hue?: number; avv?: number; ds?: string; nc?: string;    // 卖家身份
  item: any;                                               // 游戏物品快照（结构复杂，保持宽松）
  price: number;
  currency: string;
  note?: string;
  at: number;
  offers: TradeOffer[];
  clientToken?: string;   // 服务端回显上架者的本地 token —— 托管对账用（reconcileEscrow）
}

export interface TradeMe { playerId: string; name: string; hue?: number }

// ── 服务端 → 客户端（dispatch 的入参联合）──────────────────────────
// 注：心跳 "pong" 是裸字符串、在 JSON.parse 之前被吃掉，不属于本联合。
export type TradeInbound =
  | { type: 'hello'; you?: TradeMe; listings: TradeListing[]; online: number }
  | { type: 'listing_added'; listing: TradeListing }
  | { type: 'offer_added'; listingId: string; offer: TradeOffer }
  | { type: 'listing_removed'; listingId: string }
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端（sendRaw 的入参联合）──────────────────────────
// 注：心跳 "ping" 同样是裸字符串、不走 JSON，不属于本联合。
export type TradeOutbound =
  | { type: 'list_item'; item: unknown; price: number; currency: string; note: string; clientToken: string }
  | { type: 'make_offer'; listingId: string; price: number; message: string }
  | { type: 'close_listing'; listingId: string };
