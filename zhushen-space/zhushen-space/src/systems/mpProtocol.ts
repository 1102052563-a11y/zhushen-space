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
  | ({ type: 'relayed' } & RelayedInbound)
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

// ── relay/relayed 通用通道之上的「内层事件协议」──────────────────────
// relay(event,payload) 发 → 服务端原样 relayed 广播 → onRelay(m) 收。事件名过去是裸 string、payload 全 any
//（最易漂的一摊：副本中继 / 赠予 / 分享）。这里把【事件名 + 各自 payload】钉成判别联合：
//   · 结构化小 payload（赠予/投点/分配/分享）精确建模 → 拦字段漂移；
//   · 重型 payload（boss/dungeon/reward 是大块游戏态、整体交各自领域函数消费）保持 unknown，只钉事件名。
// **新增一个 relay 事件 = 在 RelayPayloads 加一行**，发送(mpClient.relay)与接收(App.onRelay switch)两端同时被锁。
export interface GiftOfferPayload { giftId: string; toPlayerId: string; items: unknown[] }
export interface GiftResponsePayload { giftId?: string; accepted: boolean }
export interface ShareRelayPayload { kind: string; data: unknown }
export interface RaidLootPayload { lootId?: string; name?: string; currency?: number | string; items?: any[] }
export interface RaidRollPayload { lootId: string; picks: unknown }
export interface RaidLootResultPayload { lootId: string; results: Record<string, any> }
// 完整版双视角（主控-分支-对齐）：房主↔来宾三段透传
export interface SoloTogglePayload { seatId: string; solo: boolean }                 // 分头行动：某座位脱离主队独自行动/汇合（广播给全房做显示；行动仍由房主统一写进同一份正文）
export interface HiddenSyncPayload { conditions: { id: string; title: string; requiredItems: string[]; reward: string; met?: boolean }[] } // 隐藏结局：房主广播跨玩家条件库（目标显示+解锁状态）

export interface RelayPayloads {
  gift_offer: GiftOfferPayload;
  gift_response: GiftResponsePayload;
  share: ShareRelayPayload;
  raid_boss: unknown;            // BOSS 规格（raidBoss.ts），整体转发给来宾预览
  raid_loot: RaidLootPayload;
  raid_roll: RaidRollPayload;
  raid_loot_result: RaidLootResultPayload;
  raid_dungeon: unknown;         // 副本进度（可为 null=解散），整体同步
  raid_reward: unknown;          // 通关豪华奖励，整体交 applyRaidReward 入账
  solo_toggle: SoloTogglePayload;
  hidden_sync: HiddenSyncPayload;
}
export type RelayEvent = keyof RelayPayloads;

/** 收到的 relayed 消息：按 event 收窄 payload 的判别联合（from=发送者身份，宽松）。 */
export type RelayedInbound = { [E in RelayEvent]: { event: E; from: any; payload: RelayPayloads[E] } }[RelayEvent];
