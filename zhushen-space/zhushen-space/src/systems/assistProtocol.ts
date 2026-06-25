// 全局助战大厅·线协议（client ⇄ AssistDO）—— 前端侧单一事实来源（同 tradeProtocol.ts 的范式）。
// 锁定 systems/assistClient.ts 收发 + store/assistStore.ts 存态 + components/AssistPanel.tsx 渲染 三处一致。
// **改协议时同步比对 multiplayer-worker/src/AssistDO.js 的 webSocketMessage / 广播**（服务端校验仍在 AssistDO）。

// 主角面板快照（= systems/mpSnapshot.ts buildPlayerSnapshot() 的结果 + 压缩立绘 + 分类外挂）。
// 不含经历(deedLog)。结构复杂处保持宽松（与游戏内类型解耦，避免跨模块强耦合）。
export interface AssistSnapshot {
  name: string;
  tier?: string;
  profession?: string;
  race?: string;
  raceDetail?: string;
  gender?: string;
  personality?: string;
  personalityDetail?: string;
  appearance?: string;
  attrs?: Record<string, number>;   // 有效六维（力/敏/体/智/魅/幸）
  maxHp?: number;
  maxEp?: number;
  line?: string;                    // 「阶位·职业 力X 敏Y…」摘要行
  skills?: any[];
  traits?: any[];
  equipment?: any[];
  items?: any[];                    // 储存空间（已剥图）
  avatar?: string;                  // 压缩后的主角立绘 dataURL（可空）
}

export type AssistKind = 'player' | 'npc';   // 主角助战 / NPC 助战（两块独立排名）

// 一张助战卡（同 owner 同 kind 一卡，按 ownerId+kind upsert）。
export interface AssistCard {
  id: string;
  ownerId: string;                  // "chat:<uid>"
  ownerName: string;                // 上传者聊天昵称
  hue?: number; avv?: number; ds?: string; nc?: string;   // 上传者聊天身份（头像/名牌色，与聊天室共用）
  ownerDu?: number;                 // 上传者显示号（自定义靓号·0/缺省=用内部 uid）
  kind: AssistKind;                 // 'player' 主角助战 / 'npc' NPC 助战
  srcKey?: string;                  // 来源标识：NPC 卡=该 NPC 的本地 id（同一玩家可挂多张不同 NPC 卡）；主角卡=空
  category: string;                 // 分类（近战/远程/法师/辅助/坦克/召唤/刺客/全能）
  snapshot: AssistSnapshot;         // 主角面板快照
  assists: number;                  // 累计助战次数（排行榜）
  at: number;                       // 首次上传时间
  bumpedAt: number;                 // 最后更新时间
}

export interface AssistMe { playerId: string; name: string; hue?: number }

// ── 服务端 → 客户端（dispatch 的入参联合）──────────────────────────
// 注：心跳 "pong" 是裸字符串、在 JSON.parse 之前被吃掉，不属于本联合。
export type AssistInbound =
  | { type: 'hello'; you?: AssistMe; cards: AssistCard[]; online: number }
  | { type: 'card_added'; card: AssistCard }                       // 上传 / 更新（同 owner+kind+srcKey upsert）
  | { type: 'card_removed'; cardId: string }                       // 上传者删除自己某张卡
  | { type: 'assist_bumped'; cardId: string; assists: number }     // 某卡被邀请 → 助战次数 +1
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端（sendRaw 的入参联合）──────────────────────────
// 注：心跳 "ping" 同样是裸字符串、不走 JSON，不属于本联合。
export type AssistOutbound =
  | { type: 'publish_card'; kind: AssistKind; category: string; snapshot: AssistSnapshot; srcKey?: string }
  | { type: 'remove_card'; cardId: string }
  | { type: 'invite'; cardId: string };
