// 全局实时聊天室·线协议（client ⇄ ChatDO）—— 前端侧单一事实来源。
// 后端 multiplayer-worker/src/ChatDO.js 是 JS、无法直接 import 本文件；此处先把【前端三处】
// （systems/chatClient.ts 收发 + store/chatRoomStore.ts 存态 + components/ChatRoomPanel.tsx 渲染）
// 锁在同一套形状上，消灭它们之间的字段漂移：加/改消息类型时，TS 会要求 dispatch 穷尽处理、
// sendRaw 形状正确、各处字段名一致。**改协议时请同步比对 ChatDO.js 的 webSocketMessage / #broadcast**
// （服务端校验仍在 ChatDO；本文件只保证前端不自相矛盾）。

// ── 公共载荷（既走线、也存进 store）────────────────────────────────
export type ShareKind = 'skill' | 'talent' | 'equip' | 'item' | 'npc';

/** 贴纸引用：只传白名单引用（内置 pack+id / https 外链 url / R2 hash），绝不传大图 data URI（见 ChatDO sticker 校验）。 */
export interface StickerRef { pack?: string; id?: string; url?: string; hash?: string; w?: number; h?: number }

/** 在线名单条目（hello.roster / presence.roster 的元素）。 */
export interface RosterEntry { playerId: string; name: string; hue?: number; avv?: number; ds?: string; nc?: string }

/** 自己的身份（hello.you）。 */
export interface ChatSelf { playerId: string; name: string; hue?: number; avv?: number; ds?: string; nc?: string }

/** 一条消息（hello.backlog / message.message 的元素；亦含客户端本地合成的 system 行）。 */
export interface ChatMsg {
  id: string;
  playerId?: string;
  name: string;
  hue?: number;
  text?: string;
  at: number;
  system?: string;                        // 客户端本地合成（进/出/改名提示）—— 不走线
  share?: { kind: string; data: any };    // kind 在线上被 ChatDO 截断成普通字符串，故此处宽松为 string
  sticker?: StickerRef;
  reactions?: Record<string, string[]>;   // emoji -> playerId[]
}

// ── 服务端 → 客户端（dispatch 的入参联合）──────────────────────────
// 注：心跳 "pong" 是裸字符串、在 JSON.parse 之前就被吃掉，不属于本联合。
export type ChatInbound =
  | { type: 'hello'; channel: string; you: ChatSelf; backlog: ChatMsg[]; roster: RosterEntry[] }
  | { type: 'message'; message: ChatMsg }
  | { type: 'presence'; roster: RosterEntry[]; join?: { name: string }; leave?: { name: string }; rename?: { from: string; to: string } }
  | { type: 'reaction_update'; id: string; reactions: Record<string, string[]> }
  | { type: 'rate_limited' };

// ── 客户端 → 服务端（sendRaw 的入参联合）──────────────────────────
// 注：心跳 "ping" 同样是裸字符串、不走 JSON，不属于本联合。
export type ChatOutbound =
  | { type: 'chat'; text: string }
  | { type: 'react'; id: string; emoji: string }
  | { type: 'sticker'; sticker: StickerRef }
  | { type: 'share'; kind: ShareKind; data: unknown }
  | { type: 'rename'; name: string };
