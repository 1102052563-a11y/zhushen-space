// 联机·线协议（client ⇄ RoomDO）—— 前端侧单一事实来源（envelope 层）。
// 载荷类型（MpRole/MpSeat/MpSeatCard/MpComment/MpTurn/MpRoom）沿用 store/multiplayerStore.ts 的定义——
// 它们是 store 态核心、被全 App 引用，故不搬家；本文件只把它们组装成线上消息 envelope。
// 重型负载（world/combat 快照、relay payload、角色 snapshot）天然是大块游戏态，保持 any/unknown 不强行建模。
// **改协议时同步比对 multiplayer-worker/src/RoomDO.js 的 webSocketMessage / 广播**（服务端权威 + 校验仍在 RoomDO）。
import type { MpRole, MpSeat, MpSeatCard, MpComment, MpTurn, MpRoom } from '../store/multiplayerStore';

// ── 服务端 → 客户端（dispatch 的入参联合）──────────────────────────
// 注：心跳 "pong" 是裸字符串、在 JSON.parse 之前被吃掉，不属于本联合。
export type MpInbound =
  | { type: 'room_state'; room?: MpRoom & { seats?: MpSeat[]; turn?: MpTurn | null }; you?: { role?: MpRole; seatId?: string | null } }
  | { type: 'seats_updated'; seats?: MpSeat[] }
  | { type: 'player_snapshots'; seats?: MpSeatCard[] }
  | { type: 'turn_started'; turn?: MpTurn | null }
  | { type: 'turn_updated'; turn?: MpTurn | null }
  | { type: 'turn_resolved'; turn?: MpTurn | null }
  | { type: 'world_snapshot'; payload: any; replay?: boolean }
  | { type: 'narrative_log'; entries?: { role: string; content: string }[] }
  | { type: 'combat_snapshot'; payload: any }
  | { type: 'combat_action_updated'; payload: any }
  | { type: 'relayed'; event: string; from: any; payload: any }
  | { type: 'room_comment'; backlog?: MpComment[]; comment?: MpComment }
  | { type: 'room_closed' }
  | { type: 'error'; reason?: string; error?: string };

// ── 客户端 → 服务端（sendRaw 的入参联合）──────────────────────────
// 注：心跳 "ping" 同样是裸字符串、不走 JSON，不属于本联合。
export type MpOutbound =
  | { type: 'leave_room' }
  | { type: 'start_turn' }
  | { type: 'submit_input'; text: string; snapshot?: unknown }
  | { type: 'publish_world_snapshot'; payload: unknown }
  | { type: 'publish_combat_snapshot'; payload: unknown }
  | { type: 'submit_combat_action'; payload: unknown }
  | { type: 'relay'; event: string; payload: unknown }
  | { type: 'send_room_comment'; text: string }
  | { type: 'close_room' };
