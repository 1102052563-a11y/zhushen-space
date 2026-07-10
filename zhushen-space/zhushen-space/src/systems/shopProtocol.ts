// 玩家产业·商城·线协议（client ⇄ ShopDO）—— 前端侧单一事实来源（范式同 assistProtocol / tradeProtocol）。
// 锁定 systems/shopClient.ts 收发 + store/shopMarketStore.ts 存态 + components/ProducePanel.tsx(商城 Tab) 渲染 三处一致。
// **改协议时同步比对 multiplayer-worker/src/ShopDO.js 的 webSocketMessage / 广播**（服务端校验仍在 ShopDO）。
// 看板型：上传店铺快照 / 下架 / 光顾计数；不做托管、不做跨端货币结算——买货 = 光顾者本地物化(addItem/createCompanion)+扣自己的币（同 AssistDO「邀请即前端物化」）。

export type ShopKind = 'store' | 'brothel' | 'smithy';

export interface ShopMe { playerId: string; name: string; hue?: number }

/** 一间已上传到商城的店铺（服务端存储 + 广播）。snapshot=完整店铺数据（立绘已缩略）供光顾者物化。 */
export interface PublishedShop {
  id: string;
  ownerId: string;
  ownerName: string;
  hue?: number; avv?: number; ds?: string; nc?: string;   // 上传者聊天身份（与聊天室共用·卡片显示）
  ownerDu?: number;                                        // 上传者显示号（自定义靓号·0=用内部 uid）
  type: ShopKind;
  name: string;
  snapshot: any;        // 完整店铺快照（type/name/intro/tagline/sign/currency/world/goods/girls/smith·立绘缩略）
  visits: number;       // 累计光顾次数（他人进店 +1·排行/热度用）
  at: number;           // 首次上传时间
  bumpedAt: number;     // 最近更新时间（淘汰按此）
}

// ── 服务端 → 客户端 ──（心跳 "pong" 裸字符串在 JSON.parse 前吃掉，不属本联合）
export type ShopInbound =
  | { type: 'hello'; you?: ShopMe; shops: PublishedShop[]; online: number }
  | { type: 'shop_added'; shop: PublishedShop }
  | { type: 'shop_removed'; shopId: string }
  | { type: 'shop_visited'; shopId: string; visits: number }
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端 ──（心跳 "ping" 同样裸字符串·不走 JSON）
export type ShopOutbound =
  | { type: 'publish_shop'; srcId: string; shopType: ShopKind; name: string; snapshot: any }   // srcId=本地店铺 id（同 owner+srcId 一店·upsert）
  | { type: 'remove_shop'; shopId: string }
  | { type: 'visit'; shopId: string };
