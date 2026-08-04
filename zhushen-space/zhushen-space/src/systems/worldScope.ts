/*
  世界作用域 · 冻结 / 解冻（轮回乐园适配 · 公理 1）
  ───────────────────────────────────────────────────────────────────────
  轮回乐园 = **短命任务世界 + 永久乐园** 的双层结构。任何"世界侧"的数据都必须声明作用域：

    · world    绑当前任务世界 → 离世**冻结**（退出活跃视图·仍在库房），同名再入可解冻
    · paradise 绑乐园 → 跨世界累积，切世界不受影响（契约者/随从/宠物/冒险团/公会/领地…）
    · cosmos   宇宙背景层 → 完全独立于主角行踪（万族/七乐园/深渊）

  ⚠ 冻结 ≠ 删除（铁律「库房只存不删」）：`frozenAt` 有值 = 已归档，玩家仍能翻到，
    同名世界再入 + 选「继承」即可原样捞回。物理删除只走 hardRemoveNpc。
  ⚠ 冻结与既有三态（在场 / 离场 / 归档）**正交**：
      归档 archived = 玩家主动收纳；冻结 frozenAt = 世界切换的系统行为。
    不变量：frozenAt ⟹ !onScene（人在我们已经离开的世界里，不可能还在场）。

  ★ 本文件是 `isHomeWorld` 的**单一真相**（原先在 playerVitals，现由那边 re-export 保持全部调用点不变）——
    放这里是因为"这是不是乐园"本质上是世界身份判定，且这样 playerVitals → worldScope 单向依赖、不成环。

  设计取舍：
  - **仅追加的历史流水**（如 miscStore.worldEvents）→ **读时按世界过滤**，不做冻结标记，
    这样天然满足"只存不删"，也不必为历史补写字段。
  - **有状态的档案**（势力 / 土著 NPC）→ 显式冻结，因为它们会被演化、自治、召回反复读写。
  - `worldName` 缺失（老存档）→ **一律不冻结**。宁可漏冻，绝不误冻别的世界的人。
*/
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { normWorldName } from '../store/worldRecordStore';
/* ⚠ 本文件**不 import miscStore**：miscStore 已经 import 了这里的 isHomeWorld/sameWorld，
   反向再引就成 ESM 循环。任务的封存/解封因此由调用点（App.enterWorld）紧挨着 freezeWorld/thawWorld 调，
   见下方 FreezeReport.tasksFrozen 的说明。 */

export type Scope = 'world' | 'paradise' | 'cosmos';

/** 带世界作用域的记录（NpcRecord / FactionRecord 都已满足这个形状） */
export interface WorldScoped {
  worldName?: string;
  frozenAt?: number;
}

/** 是不是轮回乐园/枢纽（含「主神空间」仅为兼容旧存档，非展示文案）。全仓单一真相。 */
export function isHomeWorld(name?: string): boolean {
  return /轮回乐园|专属房间|主神空间/.test(name ?? '');
}

/** 两个世界名是否同一个世界（复用 worldRecordStore 的归一，别再写第二套） */
export function sameWorld(a?: string, b?: string): boolean {
  const na = normWorldName(a ?? '');
  const nb = normWorldName(b ?? '');
  return !!na && !!nb && na === nb;
}

/** NPC 的作用域：土著绑世界，其余（契约者/随从/宠物/召唤物）跟着主角走 */
export function scopeOfNpc(n: Pick<NpcRecord, 'npcTag'>): Scope {
  return n.npcTag === '土著' ? 'world' : 'paradise';
}

/** 该条记录此刻是否活跃（未冻结 且 属于当前世界）。worldName 为空 = 未归属，视为活跃。 */
export function isActiveIn(rec: WorldScoped, currentWorld: string): boolean {
  if (rec.frozenAt) return false;
  if (!rec.worldName) return true;
  return sameWorld(rec.worldName, currentWorld);
}

/* 玩家已投入心血的角色永不冻结——冻了等于"我的人凭空不见了"。
   与 npcAutonomy / 清理提醒 的保护名单同口径。 */
function isProtectedFromFreeze(n: NpcRecord): boolean {
  return !!(n.isBond || n.keepForever || n.isFriend || n.partyMember
    || n.monumentId || n.assistOwnerId || n.isCanonLocked);
}

export interface FreezeReport {
  world: string;
  npcFrozen: string[];      // 被冻结的 NPC id
  npcKept: string[];        // 命中保护名单、保留在活跃视图的 id
  npcBackfilled: string[];  // 冻结前顺手补了 worldName 的 id（老存档迁移）
  factionsClosed: string[]; // 被移出"当前世界"的势力 id
  tasksFrozen?: number;     // 被挪进 frozenTasks 的未结算任务数
}

export interface ThawReport {
  world: string;
  npcThawed: string[];
  factionsReopened: string[];
  tasksThawed?: number;     // 从 frozenTasks 挪回进行中的任务数
}

/**
 * 离开某个任务世界：把属于它的 `world` 作用域数据冻结。
 *
 * - 乐园/枢纽不冻结（那是 paradise 作用域的家）。
 * - 土著 NPC：`worldName` 明确等于该世界 → 打 `frozenAt` + 强制离场。保护名单跳过。
 * - **老存档补写**：在场且没有 `worldName` 的土著，此刻显然就在这个世界里 → 先补 worldName 再冻。
 *   （只补"在场"这一批，因为只有他们能被证明属于本世界；离场且无 worldName 的一律不动。）
 * - 势力：`worldName` 明确等于该世界 且 仍标 `inCurrentWorld` → 置 false。
 *   worldName 为空的势力**不动**——它可能是乐园势力，误关会让它从势力面板消失。
 */
export function freezeWorld(worldName: string, turn: number): FreezeReport {
  const report: FreezeReport = { world: worldName, npcFrozen: [], npcKept: [], npcBackfilled: [], factionsClosed: [] };
  if (!worldName || isHomeWorld(worldName)) return report;

  try {
    const N = useNpc.getState();
    for (const n of Object.values(N.npcs)) {
      if (n.frozenAt) continue;
      if (scopeOfNpc(n) !== 'world') continue;   // 契约者/随从/宠物 跟着主角走
      let belongs = sameWorld(n.worldName, worldName);
      if (!belongs && !n.worldName && n.onScene) { belongs = true; report.npcBackfilled.push(n.id); }
      if (!belongs) continue;
      if (isProtectedFromFreeze(n)) { report.npcKept.push(n.id); continue; }
      N.upsertNpc(n.id, { worldName, frozenAt: turn, onScene: false });
      report.npcFrozen.push(n.id);
    }
  } catch (e) { console.warn('[worldScope] 冻结 NPC 失败（跳过·不阻断切世界）:', e); }

  try {
    const F = useFaction.getState();
    for (const f of Object.values(F.factions)) {
      if (!f.inCurrentWorld) continue;
      if (!sameWorld(f.worldName, worldName)) continue;
      F.setWorld(f.id, false);
      report.factionsClosed.push(f.id);
    }
  } catch (e) { console.warn('[worldScope] 冻结势力失败（跳过）:', e); }

  // ⚠ 任务的封存不在这里做（避免 miscStore ⇄ worldScope 循环）：
  //   由 App.enterWorld 紧挨着本调用执行 `useMisc.freezeTasksOfWorld(prevWorld, turn)`，结果回填进 report.tasksFrozen。
  return report;
}

/**
 * 进入某个任务世界并选择「继承」：解冻上次留在这里的 `world` 作用域数据。
 *
 * ⚠ 只在玩家选「继承」时调用。选「重置」= 干净开局，冻结的旧数据留在库房里不动。
 * 解冻不自动把人拉回在场（他们只是重新可被演化/自治/召回），登场仍走登场判断。
 */
export function thawWorld(worldName: string): ThawReport {
  const report: ThawReport = { world: worldName, npcThawed: [], factionsReopened: [] };
  if (!worldName || isHomeWorld(worldName)) return report;

  try {
    const N = useNpc.getState();
    for (const n of Object.values(N.npcs)) {
      if (!n.frozenAt) continue;
      if (!sameWorld(n.worldName, worldName)) continue;
      N.upsertNpc(n.id, { frozenAt: undefined });
      report.npcThawed.push(n.id);
    }
  } catch (e) { console.warn('[worldScope] 解冻 NPC 失败（跳过）:', e); }

  try {
    const F = useFaction.getState();
    for (const f of Object.values(F.factions)) {
      if (f.inCurrentWorld || f.isDestroyed) continue;
      if (!sameWorld(f.worldName, worldName)) continue;
      F.setWorld(f.id, true);
      report.factionsReopened.push(f.id);
    }
  } catch (e) { console.warn('[worldScope] 解冻势力失败（跳过）:', e); }

  // ⚠ 任务解封同理由 App.enterWorld 调 `useMisc.thawTasksOfWorld(world)`（见上方注释）
  return report;
}

/**
 * 每回合兜底：把**归属于「当前世界以外的任务世界」**的 world 作用域 NPC 补冻。
 *
 * 覆盖 `freezeWorld` 抓不到的路径：读档、AI 直接改写 worldName、玩家手动改世界名、
 * 以及历史存档里早就该冻却没冻的人。幂等（已冻的跳过），可以每回合调。
 *
 * - 人在乐园 → 所有任务世界土著都被冻
 * - 人在任务世界 B → A 的土著被冻，B 的不动
 * - `worldName` 为空 → **永不冻**（宁可漏冻，绝不误冻）
 *
 * 注意它做不了 `freezeWorld` 的"在场无归属者补写 worldName"——那必须在切世界那一刻做，
 * 因为切完之后已经无从判断那些人属于哪个世界。两者各司其职。
 */
export function reconcileWorldScope(currentWorld: string, turn: number): FreezeReport {
  const report: FreezeReport = { world: currentWorld, npcFrozen: [], npcKept: [], npcBackfilled: [], factionsClosed: [] };
  try {
    const N = useNpc.getState();
    for (const n of Object.values(N.npcs)) {
      if (n.frozenAt) continue;
      if (scopeOfNpc(n) !== 'world') continue;
      if (!n.worldName || isHomeWorld(n.worldName)) continue;   // 无归属 / 乐园土著 → 不动
      if (sameWorld(n.worldName, currentWorld)) continue;       // 就是当前世界的人 → 不动
      if (isProtectedFromFreeze(n)) { report.npcKept.push(n.id); continue; }
      N.upsertNpc(n.id, { frozenAt: turn, onScene: false });
      report.npcFrozen.push(n.id);
    }
  } catch (e) { console.warn('[worldScope] 作用域兜底冻结失败（跳过）:', e); }
  return report;
}

/** 当前活跃（未冻结）的 NPC —— 演化选焦点 / 轨道A 自治 / 召回 都该用这个口径 */
export function activeNpcs(): NpcRecord[] {
  try { return Object.values(useNpc.getState().npcs).filter((n) => !n.frozenAt); } catch { return []; }
}

/** 已冻结的 NPC（按世界分组）—— 供档案面板「🧊 往世」视图 */
export function frozenNpcsByWorld(): Record<string, NpcRecord[]> {
  const out: Record<string, NpcRecord[]> = {};
  try {
    for (const n of Object.values(useNpc.getState().npcs)) {
      if (!n.frozenAt) continue;
      const k = n.worldName || '未知世界';
      (out[k] ??= []).push(n);
    }
  } catch { /* */ }
  return out;
}
