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

/* ── Phase 1c「空壳重复清理」──────────────────────────────────────────────
 * 症状：同一件物品在背包里躺着两条 —— 一条**有详细信息**（物品阶段按固定格式生成：攻防/词缀/评分/简介齐全），
 * 一条**只有名字/分类/品级**的空壳（正文简写 createItem 的形状）。成因是两条写法漂了（改名/换品级/换分类），
 * 各道判重（findIdenticalItem 同名+品级包含 / findStackTarget 同名+同分类 / dedupeByName 同名+同品级）逐一漏网。
 * 前面已在源头拦（deferredCreateSkipReason），这里是**收口安全网**：漏进来的、以及老存档里已经躺着的，回合末扫掉。
 *
 * 保守到近乎苛刻——「同名两件真装备」是合法的独立实例，悄悄吞掉一件就是老病根"经常丢装备"：
 *   · 只在【同一个背包内】比对；已装备 / 已锁定 / 已归档 的条目一律不参与（既不当空壳、也不当被并入方）。
 *   · 空壳方必须**一条实质细节都没有**（攻防/词缀/评分/简介/需求/耐久/强化/宝石全空）；
 *   · 留下方必须**至少有两条**实质细节（确实是"完整档"，不是两条都半残时乱挑一条）；
 *   · 并入前把空壳独有的字段（如正文写的获得方式）**回填**给留下方，可堆叠物再把数量累加 → 信息与数量都不丢。
 * 返回清理件数与名称。*/
const DETAIL_KEYS = ['combatStat', 'affix', 'score', 'intro', 'requirement', 'durability', 'killCount'] as const;
function detailCount(it: any): number {
  let n = DETAIL_KEYS.filter((k) => String(it?.[k] ?? '').trim()).length;
  if ((Number(it?.enhanceLevel) || 0) > 0) n++;
  if (Array.isArray(it?.gems) && it.gems.length > 0) n++;
  return n;
}
/** 与 stateParser.looseSameName 同口径的保守同名判定（全等 / 一方包含另一方），不做相似度猜测。 */
function sameNameLoose(a?: string, b?: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y || x.length < 2 || y.length < 2) return false;
  return x === y || x.includes(y) || y.includes(x);
}
/** 把空壳独有字段回填进留下方（只填留下方缺的），可堆叠则累加数量。 */
function absorb(rich: any, blank: any, stackable: boolean): any {
  const out: any = { ...rich };
  for (const k of ['effect', 'gradeDesc', 'category', 'subType', 'origin', 'acquisition', 'notes', 'appearance', 'tags']) {
    const rv = out[k], bv = blank?.[k];
    const richEmpty = Array.isArray(rv) ? rv.length === 0 : !String(rv ?? '').trim();
    const blankHas = Array.isArray(bv) ? bv.length > 0 : !!String(bv ?? '').trim();
    if (richEmpty && blankHas) out[k] = bv;
  }
  if (stackable) out.quantity = (Number(rich.quantity) || 1) + (Number(blank?.quantity) || 1);
  return out;
}
/** 在一个背包里找出「空壳重复」并就地合并，返回新数组（无改动则返回原数组）+ 被清掉的名字。 */
function pruneBlanksIn(list: any[]): { items: any[]; removed: string[] } {
  const removed: string[] = [];
  const free = (it: any) => it && !it.equipped && !it.equipSlot && !it.locked && !it.archived;
  const blanks = (list ?? []).filter((it) => free(it) && detailCount(it) === 0);
  if (blanks.length === 0) return { items: list, removed };
  const drop = new Map<string, any>();      // 空壳 id → 留下方
  for (const b of blanks) {
    const rich = (list ?? []).find((it) =>
      it.id !== b.id && free(it) && detailCount(it) >= 2 && !drop.has(it.id) && sameNameLoose(it.name, b.name));
    if (rich) drop.set(b.id, rich);
  }
  if (drop.size === 0) return { items: list, removed };
  const merged = new Map<string, any>();    // 留下方 id → 吸收后的新对象
  for (const [blankId, rich] of drop) {
    const b = list.find((it) => it.id === blankId);
    const base = merged.get(rich.id) ?? rich;
    merged.set(rich.id, absorb(base, b, isStackableCat(b?.category) && isStackableCat(rich.category)));
    removed.push(b?.name ?? blankId);
  }
  const items = list
    .filter((it) => !drop.has(it.id))
    .map((it) => merged.get(it.id) ?? it);
  return { items, removed };
}

/** 回合末调用：清理主角背包 + 各 NPC 持有物里的「空壳重复」条目。返回清理件数与名称。 */
export function pruneBlankDupItems(): { removed: number; names: string[] } {
  const names: string[] = [];
  try {
    const cur = useItems.getState().items;
    const r = pruneBlanksIn(cur);
    if (r.removed.length) {
      useItems.setState({ items: r.items as InventoryItem[] });
      const turn = useItems.getState().itemTurn;
      for (const n of r.removed) { names.push(n); logItemEvent(turn, '空壳重复清理', n, '与同名完整条目重复（无攻防/词缀/评分/简介等实质内容）→ 已并入完整条目'); }
    }
  } catch (e) { console.warn('[Watchdog] 主角背包空壳清理失败', e); }
  try {
    for (const [id, rec] of Object.entries(useNpc.getState().npcs)) {
      const r = pruneBlanksIn((rec as any).items ?? []);
      if (!r.removed.length) continue;
      useNpc.setState((s) => {
        const cur: any = s.npcs[id];
        if (!cur) return s;
        return { npcs: { ...s.npcs, [id]: { ...cur, items: r.items, updatedAt: Date.now() } } };
      });
      const turn = useItems.getState().itemTurn;
      for (const n of r.removed) { names.push(`${n}(${(rec as any).name || id})`); logItemEvent(turn, '空壳重复清理', n, `NPC ${id} 处与同名完整条目重复 → 已并入`); }
    }
  } catch (e) { console.warn('[Watchdog] NPC 空壳清理失败', e); }
  if (names.length) console.warn(`[Watchdog] 🧹 清理 ${names.length} 条空壳重复物品（同名已有完整档，空壳侧字段已回填/数量已累加）：`, names);
  return { removed: names.length, names };
}
