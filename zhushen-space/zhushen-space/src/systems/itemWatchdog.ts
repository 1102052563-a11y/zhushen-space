/* 物品演化底层重构 · Phase 1「看门狗对账」(+1b 随从/宠物)
 *
 * 不变量：一件回合开始时在背包/随从包里的物品，回合演化全部跑完后，要么 ①还在、要么 ②已正常进「最近删除」
 * (主角侧 binItem 销毁/消耗)、要么 ③经官方 store 方法登记移除(交易/赌坊/赠予/转出 → markAccountedRemoval)、
 * 要么 ④可堆叠物被合并进同名同品质的存活条目(数量已保留)。
 * 凡不满足者——即「凭空消失、最近删除还查不到」——一律判为**静默丢失**，自动捞回 + 上报。
 *
 * 这是「单一闸门」尚未完全收口前的结构性安全网：不管现在/将来有多少条移除路径漏了护栏，
 * 只要东西从墙缝溜走了，这里都能逮到并还回来。纯增量、只恢复不删除，风险最低。
 */
import { useItems, isStackableCat, clearAccountedRemovals, isAccountedRemoval, logItemEvent, type InventoryItem } from '../store/itemStore';
import { useNpc } from '../store/npcStore';

const norm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();

/** 一回合的快照：主角背包 + 随行随从/宠物的持有物。结构对 App 不透明，由本模块自洽消费。 */
export interface BagSnapshot {
  player: InventoryItem[];
  npc: { ownerId: string; name: string; items: any[] }[];
}

/** 回合演化阶段开始前调用：快照主角背包 + 随从/宠物持有物（浅拷贝每条）。
 *  同时清空「已登记移除」集合，让本回合窗口内经官方 store 方法的移除都能被对账正确排除。 */
export function snapshotPlayerBag(): BagSnapshot {
  clearAccountedRemovals();
  const player = useItems.getState().items.map((it) => ({ ...it }));
  const npc = Object.values(useNpc.getState().npcs)
    .filter((r: any) => !r.isDead && (r.npcTag === '随从' || r.npcTag === '宠物'))   // 随行的随从/宠物：相当于主角的延伸背包
    .map((r: any) => ({ ownerId: r.id as string, name: (r.name || r.id) as string, items: (r.items ?? []).map((it: any) => ({ ...it })) }));
  return { player, npc };
}

/** 某件已消失的可堆叠物是否被合并进同名同品质的存活条目（数量已保留）→ 不算丢失。装备/唯一物不参与合并，没了就是真没了。 */
function mergedAway(gone: { category?: string; name?: string; gradeDesc?: string }, current: any[]): boolean {
  if (!isStackableCat(gone.category)) return false;
  const n = norm(gone.name), g = norm(gone.gradeDesc);
  return current.some((it) => isStackableCat(it.category) && norm(it.name) === n && norm(it.gradeDesc) === g);
}

/** 回合演化全部 settle 后调用：对账主角 + 随从/宠物背包，自动捞回静默丢失的物品（恢复为未装备态，避免槽位冲突）。
 *  返回捞回件数与名称（>0 时调用方弹横幅）。 */
export function reconcilePlayerBag(snap: BagSnapshot | null | undefined): { restored: number; names: string[] } {
  if (!snap) return { restored: 0, names: [] };
  const names: string[] = [];

  // ── 主角背包 ──
  const I = useItems.getState();
  // 全局存在性：物品现在还在「玩家背包」或「任意 NPC(含从者/宠物)的储存/装备栏」里（按 id 或 同名同品级）
  //   → 不是丢失，是被移走了（转移/穿到从者身上，转移时还会换新 id）→ **绝不找回**，否则会复制出第二份（刷装备漏洞）。
  const everywhere = [...I.items, ...Object.values(useNpc.getState().npcs).flatMap((r: any) => r.items ?? [])];
  const allIds = new Set<string>(everywhere.map((it: any) => it.id).filter(Boolean));
  const allKeys = new Set<string>(everywhere.map((it: any) => norm(it.name) + '|' + norm(it.gradeDesc)));
  const existsSomewhere = (it: any) => allIds.has(it.id) || allKeys.has(norm(it.name) + '|' + norm(it.gradeDesc));
  const curIds = new Set(I.items.map((it) => it.id));
  const binIds = new Set(I.recentlyDeleted.map((d) => d.id));
  const lostP: InventoryItem[] = [];
  for (const it of snap.player) {
    if (curIds.has(it.id)) continue;          // 还在背包
    if (binIds.has(it.id)) continue;          // 已进「最近删除」(销毁/消耗)
    if (isAccountedRemoval(it.id)) continue;   // 经官方方法登记的移除(交易/赌坊/赠予)——主动、不可恢复，不误捞
    if (mergedAway(it, I.items)) continue;      // 可堆叠物被合并——数量已保留
    if (existsSomewhere(it)) continue;          // ★ 已被移到某个 NPC/从者身上(同id或同名同品级) → 是转移不是丢失，绝不找回(防刷装备)
    lostP.push(it);
  }
  if (lostP.length) {
    useItems.setState((s) => {
      const have = new Set(s.items.map((x) => x.id));
      const add = lostP.filter((x) => !have.has(x.id)).map((x) => ({ ...x, equipped: false, equipSlot: undefined }));
      return add.length ? { items: [...s.items, ...add] } : s;
    });
    const turn = useItems.getState().itemTurn;
    for (const x of lostP) { names.push(x.name); logItemEvent(turn, '守护捞回', x.name, '演化阶段静默消失→自动找回'); }
  }

  // ── 随从/宠物背包 ──
  for (const { ownerId, name: ownerName, items } of snap.npc) {
    const rec: any = useNpc.getState().npcs[ownerId];
    if (!rec || rec.isDead) continue;          // NPC 已不在/已死 → 不恢复
    const npcCurIds = new Set((rec.items ?? []).map((it: any) => it.id));
    const lostN = items.filter((it) =>
      !npcCurIds.has(it.id) && !isAccountedRemoval(it.id) && !mergedAway(it, rec.items ?? []) && !existsSomewhere(it));   // ★ 已移到玩家/别的NPC身上 → 不是丢失，不找回(防刷)
    if (!lostN.length) continue;
    useNpc.setState((s) => {
      const r2: any = s.npcs[ownerId];
      if (!r2) return s;
      const have = new Set((r2.items ?? []).map((it: any) => it.id));
      const add = lostN.filter((x) => !have.has(x.id)).map((x) => ({ ...x, equipped: false, equipSlot: undefined }));
      return add.length ? { npcs: { ...s.npcs, [ownerId]: { ...r2, items: [...(r2.items ?? []), ...add], updatedAt: Date.now() } } } : s;
    });
    const turn = useItems.getState().itemTurn;
    for (const x of lostN) { names.push(`${x.name}(${ownerName})`); logItemEvent(turn, '守护捞回', x.name, `随从 ${ownerName} 处静默消失→自动找回`); }
  }

  if (names.length) console.warn(`[Watchdog] ${names.length} 件物品在演化阶段静默消失（不在最近删除、未登记、非合并），已自动捞回：`, names);
  return { restored: names.length, names };
}
