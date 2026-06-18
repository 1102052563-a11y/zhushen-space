import { useItems } from '../store/itemStore';
import { mpClient } from './mpClient';

// 联机·赠予物品 + 分享(技能/天赋/物品)到房间聊天，都走通用 relay。
// 赠予=托管转移：赠出即从自己背包扣下托管，对方接受→进其背包；拒收/90s无响应→退回自己（不丢不复制）。

function stripItem(it: any) {
  const { id, addedAt, image, equipped, ...rest } = it || {};   // 去掉本地 id/时间/大图/装备态
  return { ...rest };
}
function stripShare(data: any) {
  const d = { ...(data || {}) };
  delete (d as any).image; delete (d as any).avatar;   // 分享卡不带大图
  return d;
}

// 赠予方持有的托管（仅本机；giftId 命中才是本机赠出的）
const pending = new Map<string, { items: any[]; timer: any }>();

export function giveItems(toPlayerId: string, items: any[]) {
  if (!toPlayerId || !items?.length) return;
  const giftId = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const stripped = items.map(stripItem);
  for (const it of items) { try { useItems.getState().removeItem(it.id); } catch {} }   // 托管扣下
  const timer = setTimeout(() => refund(giftId), 90000);
  pending.set(giftId, { items: stripped, timer });
  mpClient.relay('gift_offer', { giftId, toPlayerId, items: stripped });
}
function refund(giftId: string) {
  const p = pending.get(giftId); if (!p) return;
  clearTimeout(p.timer); pending.delete(giftId);
  for (const it of p.items) { try { useItems.getState().addItem({ ...it }); } catch {} }
}
// 赠予方收到对方响应（拒收/超时退回；接受则丢弃托管）
export function onGiftResponse(payload: any) {
  const p = pending.get(payload?.giftId); if (!p) return;   // 非本机赠出 → 无 pending → 忽略
  clearTimeout(p.timer); pending.delete(payload.giftId);
  if (!payload?.accepted) for (const it of p.items) { try { useItems.getState().addItem({ ...it }); } catch {} }
}
// 接收方：接受=进背包+回执 / 拒绝=回执
export function acceptGift(gift: any) {
  for (const it of (gift?.items || [])) { try { useItems.getState().addItem({ ...it }); } catch {} }
  mpClient.relay('gift_response', { giftId: gift?.giftId, accepted: true });
}
export function declineGift(gift: any) {
  mpClient.relay('gift_response', { giftId: gift?.giftId, accepted: false });
}

// 分享到房间聊天（全房广播；发送者也会经 relayed 回显，故本地不重复追加）
export function shareToRoom(kind: 'item' | 'skill' | 'talent', data: any) {
  mpClient.relay('share', { kind, data: stripShare(data) });
}
