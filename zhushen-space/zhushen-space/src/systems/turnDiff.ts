/* 每回合净变化 diff（数据库引入④·安全地基）——把"本回合演化前(快照) → 演化后(现状)"的净变化算出来，
 * 写进账本(drpg-ledger)，让审计面板能看到**完整**的变量改动（不只物品闸门路由的那几笔）。
 *
 * 这是"账本成为单一真相源"的前置：先让账本**完整记录**每回合每个域的净变化；后续真把状态投影自账本(event-sourcing)
 * 再换写入路径。本步只新增记录、**不改任何写入语义**，零回归风险。纯函数，便于测试。
 */

export interface DiffEvent { entity: string; op: string; ref: string; detail: string }

/** 通用"实体表" diff（NPC / 势力 …）：本回合新增 / 移除 / 指定字段变动。 */
export function diffEntityMap(before: Record<string, any> | undefined, after: Record<string, any> | undefined, entity: string, fields: readonly string[]): DiffEvent[] {
  const out: DiffEvent[] = [];
  const b = before || {}, a = after || {};
  for (const id of Object.keys(a)) {
    const av = a[id];
    if (!b[id]) { out.push({ entity, op: 'add', ref: av?.name || id, detail: '本回合新增' }); continue; }
    const changed = fields.filter((f) => JSON.stringify(b[id][f]) !== JSON.stringify(av[f]));
    if (changed.length) out.push({ entity, op: 'change', ref: av?.name || id, detail: `改:${changed.join(',')}` });
  }
  for (const id of Object.keys(b)) { if (!a[id]) out.push({ entity, op: 'remove', ref: b[id]?.name || id, detail: '本回合移除' }); }
  return out;
}

/** 物品清单 diff（主角背包 / 某 NPC 持有物）：入袋 / 离袋 / 数量变动。 */
export function diffItemList(before: any[] | undefined, after: any[] | undefined, owner = ''): DiffEvent[] {
  const out: DiffEvent[] = [];
  const b = before || [], a = after || [];
  const pre = owner ? `${owner}:` : '';
  const bById = new Map(b.map((x) => [x.id, x]));
  const aById = new Map(a.map((x) => [x.id, x]));
  for (const it of a) { if (!bById.has(it.id)) out.push({ entity: 'item', op: 'add', ref: `${pre}${it.name}`, detail: '入袋' }); }
  for (const it of b) {
    const ci = aById.get(it.id);
    if (!ci) { out.push({ entity: 'item', op: 'remove', ref: `${pre}${it.name}`, detail: '离袋' }); continue; }
    if ((it.quantity ?? 1) !== (ci.quantity ?? 1)) out.push({ entity: 'item', op: 'qty', ref: `${pre}${it.name}`, detail: `数量 ${it.quantity ?? 1}→${ci.quantity ?? 1}` });
  }
  return out;
}

/** 单实体（主角）指定字段 diff。 */
export function diffFields(before: any, after: any, entity: string, ref: string, fields: readonly string[]): DiffEvent[] {
  if (!before || !after) return [];
  const changed = fields.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  return changed.length ? [{ entity, op: 'change', ref, detail: `改:${changed.join(',')}` }] : [];
}
