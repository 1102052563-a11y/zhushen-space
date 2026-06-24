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
  clientToken?: string;   // 服务端回显出价者的本地 token —— 货币托管对账用（reconcileCoin）
  buyerDu?: number;       // 出价人显示号(自定义靓号·0/缺省=用内部 uid)
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
  sellerDu?: number;      // 卖家显示号(自定义靓号·0/缺省=用内部 uid)
}

/** 一笔完成的成交（卖家接受还价时生成；进历史看板）。 */
export interface TradeRecord {
  id: string;
  listingId: string;         // 原挂牌 id（卖家客户端据此匹配本地托管物来消费）
  offerId: string;           // 中标还价 id（买家客户端据此匹配本地托管的货币来消费）
  item: any;                 // 物品快照
  sellerId: string; sellerName: string; sellerDu?: number;
  buyerId: string; buyerName: string; buyerDu?: number;
  price: number;
  currency: string;
  at: number;
}

export interface TradeMe { playerId: string; name: string; hue?: number }

// ── 服务端 → 客户端（dispatch 的入参联合）──────────────────────────
// 注：心跳 "pong" 是裸字符串、在 JSON.parse 之前被吃掉，不属于本联合。
export type TradeInbound =
  | { type: 'hello'; you?: TradeMe; listings: TradeListing[]; online: number; history?: TradeRecord[] }
  | { type: 'listing_added'; listing: TradeListing }
  | { type: 'offer_added'; listingId: string; offer: TradeOffer }
  | { type: 'listing_removed'; listingId: string; reason?: string }   // reason: 'closed'|'expired'|'sold'（前端目前不读，仅记录线上真有此字段）
  | { type: 'trade_completed'; record: TradeRecord }                  // 卖家接受还价 → 一笔成交进历史
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端（sendRaw 的入参联合）──────────────────────────
// 注：心跳 "ping" 同样是裸字符串、不走 JSON，不属于本联合。
export type TradeOutbound =
  | { type: 'list_item'; item: unknown; price: number; currency: string; note: string; clientToken: string }
  | { type: 'make_offer'; listingId: string; price: number; message: string; clientToken: string }
  | { type: 'buy_listing'; listingId: string; clientToken: string }   // 立即购买：按挂牌价单方成交（无需卖家在线接受）
  | { type: 'close_listing'; listingId: string }
  | { type: 'accept_offer'; listingId: string; offerId: string };
