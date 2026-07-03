// 世界竞技场·线协议（client ⇄ ArenaWorldDO）—— 前端侧单一事实来源（同 assistProtocol.ts 的范式）。
// 锁定 systems/arenaWorldClient.ts 收发 + store/arenaWorldStore.ts 存态 + components/ArenaWorldPanel.tsx 渲染 三处一致。
// **改协议时同步比对 multiplayer-worker/src/ArenaWorldDO.js 的 webSocketMessage / 广播**（服务端校验/裁判仍在 DO）。

import type { AssistSnapshot } from './assistProtocol';
export type { AssistSnapshot };

export type ArenaKind = 'player' | 'npc';

// 一张参赛卡（同 owner 同 srcKey 一卡；按 ownerId+srcKey upsert，每账号最多 3 张）。
export interface ArenaCard {
  id: string;
  ownerId: string;                  // "chat:<uid>"
  ownerName: string;                // 上传者聊天昵称
  hue?: number; avv?: number; ds?: string; nc?: string;   // 上传者聊天身份（头像/名牌色）
  ownerDu?: number;                 // 上传者显示号（自定义靓号）
  kind: ArenaKind;                  // 主角 / NPC
  srcKey?: string;                  // 来源标识：主角='B1'，NPC=该 NPC 本地 id
  snapshot: AssistSnapshot;         // 完整面板快照（六维/技能/天赋/装备/物品/立绘）
  rank: number;                     // 占位排名（1=榜首）
  wins: number;
  losses: number;
  at: number;                       // 首次上传时间
  bumpedAt: number;                 // 最后更新时间
}

export interface ArenaMe { playerId: string; name: string; hue?: number }

// 服务端裁判后的挑战结果（只发给挑战者，据 winner 播过场动画；胜负服务端已定，客户端改不了）。
export interface ArenaChallengeResult {
  matchId: string;
  seed: number;
  winner: 'challenger' | 'opponent';
  challenger: ArenaCard;
  opponent: ArenaCard;
  rankBefore: number;
  rankAfter: number;
}

// ── 服务端 → 客户端 ──────────────────────────
export type ArenaInbound =
  | { type: 'hello'; you?: ArenaMe; cards: ArenaCard[]; online: number }
  | { type: 'ladder'; cards: ArenaCard[] }                       // 榜单全量同步（上传/删卡/挑战后广播）
  | ({ type: 'challenge_result' } & ArenaChallengeResult)
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端 ──────────────────────────
export type ArenaOutbound =
  | { type: 'publish_card'; kind: ArenaKind; snapshot: AssistSnapshot; srcKey: string }
  | { type: 'remove_card'; cardId: string }
  | { type: 'challenge'; myCardId: string; opponentCardId: string }
  | { type: 'report_result'; myCardId: string; opponentCardId: string; win: boolean };   // 手动应战·上报真实战斗胜负
