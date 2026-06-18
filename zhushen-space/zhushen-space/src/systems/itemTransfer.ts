import { useItems, ITEM_CATEGORIES, type ItemCategory } from '../store/itemStore';
import { useNpc, type NpcOwnedItem } from '../store/npcStore';

/* 主角 ⇄ NPC 储存空间·手动物品转移（确定性，AI 不参与）。
   - 整件（整堆）转移：扣源、入目标；目标侧同名可堆叠类自动累加（addItem/addNpcItem 内已处理）。
   - 装备中的物品需先卸下；NPC 不存在/物品找不到会返回 error。
   与 dmTrade.ts 的交易转账互不相干：这里是玩家在 NPC 详情页主动「给/取」。 */

export interface TransferResult { ok: boolean; error?: string; name?: string }

function normCat(c?: string): ItemCategory {
  const s = (c || '').trim();
  return (ITEM_CATEGORIES as readonly string[]).includes(s) ? (s as ItemCategory) : '其他物品';
}

/* 给 NPC 生成一个不与现有物品撞车的储存 id（沿用 I_<npcId>_NN_xxx 风格）*/
function newNpcItemId(npcId: string, existing: NpcOwnedItem[]): string {
  return `I_${npcId}_${(existing.length + 1).toString().padStart(2, '0')}_${Math.random().toString(36).slice(2, 5)}`;
}

/* 把主角储存空间的某件物品整堆转入指定 NPC 的储存空间。*/
export function movePlayerItemToNpc(npcId: string, playerItemId: string): TransferResult {
  const items = useItems.getState();
  const npc = useNpc.getState();
  const rec = npc.npcs[npcId];
  if (!rec) return { ok: false, error: '目标角色不存在' };
  const src = items.items.find((it) => it.id === playerItemId);
  if (!src) return { ok: false, error: '在你的储存空间里找不到该物品' };
  if (src.equipped) return { ok: false, error: `「${src.name}」正装备中，请先到「⚔ 装备」卸下再转移` };
  const qty = Math.max(1, src.quantity || 1);

  const owned: NpcOwnedItem = {
    id: newNpcItemId(npcId, rec.items ?? []),
    name: src.name,
    category: src.category,
    gradeDesc: src.gradeDesc,
    effect: src.effect,
    quantity: qty,
    equipped: false,
    appearance: src.appearance,
    acquisition: `主角转交`,
    notes: src.notes,
    tags: src.tags,
    origin: src.origin, subType: src.subType, combatStat: src.combatStat, durability: src.durability,
    requirement: src.requirement, affix: src.affix, score: src.score, intro: src.intro, killCount: src.killCount,
    enhanceLevel: src.enhanceLevel, sockets: src.sockets, gems: src.gems, gemSlot: src.gemSlot, gemAttr: src.gemAttr,
    image: src.image, numeric: src.numeric,
    addedAt: Date.now(),
  };
  npc.addNpcItem(npcId, owned);     // 先入目标，再扣源（任一步异常都不会凭空蒸发物品）
  items.consumeItem(playerItemId, qty);
  return { ok: true, name: src.name };
}

/* 把某 NPC 储存空间的某件物品整堆转入主角储存空间。*/
export function moveNpcItemToPlayer(npcId: string, npcItemId: string): TransferResult {
  const items = useItems.getState();
  const npc = useNpc.getState();
  const rec = npc.npcs[npcId];
  if (!rec) return { ok: false, error: '目标角色不存在' };
  const src = (rec.items ?? []).find((it) => it.id === npcItemId);
  if (!src) return { ok: false, error: '该角色储存空间里找不到此物品' };
  if (src.equipped) return { ok: false, error: `「${src.name}」是 ${rec.name || '对方'} 的装备，请先到「🛡 装备」卸下再取走` };
  const qty = Math.max(1, src.quantity || 1);

  items.addItem({
    name: src.name,
    category: normCat(src.category),
    gradeDesc: src.gradeDesc,
    effect: src.effect,
    quantity: qty,
    equipped: false,
    tags: src.tags ?? [],
    appearance: src.appearance,
    notes: src.notes,
    acquisition: `取自 ${rec.name || '某契约者'} 的储存空间`,
    origin: src.origin, subType: src.subType, combatStat: src.combatStat, durability: src.durability,
    requirement: src.requirement, affix: src.affix, score: src.score, intro: src.intro, killCount: src.killCount,
    enhanceLevel: src.enhanceLevel, sockets: src.sockets, gems: src.gems, gemSlot: src.gemSlot, gemAttr: src.gemAttr,
    image: src.image, numeric: src.numeric,
  });
  npc.consumeNpcItem(npcId, npcItemId, qty);
  return { ok: true, name: src.name };
}
