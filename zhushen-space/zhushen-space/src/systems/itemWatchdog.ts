/* 物品演化底层重构 · Phase 1「看门狗对账」
 *
 * 不变量：一件回合开始时在背包里的物品，回合演化全部跑完后，要么 ①还在背包、要么 ②已正常进「最近删除」
 * (销毁/消耗/转出 都走 binItem)、要么 ③是可堆叠物被合并进同名同品质的存活条目(数量已保留)。
 * 凡不满足这三者的——即「凭空消失、最近删除还查不到」——一律判为**静默丢失**，自动捞回 + 上报。
 *
 * 这是「单一闸门」尚未收口前的结构性安全网：不管现在/将来有多少条移除路径漏了护栏，
 * 只要东西从墙缝溜走了，这里都能逮到并还回来。纯增量、只恢复不删除，风险最低。
 */
import { useItems, isStackableCat, clearAccountedRemovals, isAccountedRemoval, type InventoryItem } from '../store/itemStore';

const norm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();

/** 回合演化阶段开始前调用：快照当前主角背包（浅拷贝每条，避免被后续 set 改动）。返回快照供回合末对账。
 *  同时清空「已登记移除」集合，让本回合窗口内经官方 store 方法的移除（交易/赌坊/赠予/销毁）都能被对账正确排除。 */
export function snapshotPlayerBag(): InventoryItem[] {
  clearAccountedRemovals();
  return useItems.getState().items.map((it) => ({ ...it }));
}

/** 某件已消失的物品是否属于「被合并」：仅可堆叠物，且现背包里仍有同名同品质的存活条目（dedupe 累加后数量已保留）→ 不算丢失。
 *  装备/法宝/唯一物不参与按名合并，没了就是真没了。 */
function mergedAway(gone: InventoryItem, current: InventoryItem[]): boolean {
  if (!isStackableCat(gone.category)) return false;
  const n = norm(gone.name), g = norm(gone.gradeDesc);
  return current.some((it) => isStackableCat(it.category) && norm(it.name) === n && norm(it.gradeDesc) === g);
}

/** 回合演化全部 settle 后调用：对账 snap 与当前背包，自动捞回静默丢失的物品。
 *  返回捞回件数与名称（>0 时调用方弹横幅）。捞回时恢复为**未装备**态，避免与现有装备槽冲突。 */
export function reconcilePlayerBag(snap: InventoryItem[] | null | undefined): { restored: number; names: string[] } {
  if (!snap || snap.length === 0) return { restored: 0, names: [] };
  const I = useItems.getState();
  const curIds = new Set(I.items.map((it) => it.id));
  const binIds = new Set(I.recentlyDeleted.map((d) => d.id));
  const lost: InventoryItem[] = [];
  for (const it of snap) {
    if (curIds.has(it.id)) continue;          // 还在背包
    if (binIds.has(it.id)) continue;          // 已正常进「最近删除」(销毁/消耗)——不是静默丢失
    if (isAccountedRemoval(it.id)) continue;   // 经官方 store 方法登记的移除(交易/赌坊/赠予/转出)——玩家主动、不可恢复，绝不误捞
    if (mergedAway(it, I.items)) continue;     // 可堆叠物被合并——数量已保留
    lost.push(it);
  }
  if (lost.length === 0) return { restored: 0, names: [] };
  useItems.setState((s) => {
    const have = new Set(s.items.map((x) => x.id));
    const add = lost
      .filter((x) => !have.has(x.id))                                   // id 已被复用则跳过（已有同 id 占位，避免覆盖）
      .map((x) => ({ ...x, equipped: false, equipSlot: undefined }));   // 恢复为未装备，避免槽位冲突
    return add.length ? { items: [...s.items, ...add] } : s;
  });
  console.warn(`[Watchdog] ${lost.length} 件物品在演化阶段静默消失（不在最近删除、非合并），已自动捞回：`, lost.map((x) => x.name));
  return { restored: lost.length, names: lost.map((x) => x.name) };
}
