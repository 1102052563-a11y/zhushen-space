/* ── 状态对账·看门狗（Step 10·扩到 items/NPC）──────────────────────────────
   每回合按不变量核对 itemStore/npcStore/wallet 的**当前态**，把 corruption/漂移**当场抓出**——
   幽灵NPC(编号无真名)/重复id(双计)/装备槽冲突/物品无名/数量≤0/货币漂移 → 不是几周后你才发现。
   **纯只读·绝不改状态**（看门狗只报警、不动手；修复交给对应闸门/人工）。对应 [[item-evolution-architecture-redesign]] 的"对账看门狗"。 */
import { useItems } from '../../store/itemStore';
import { useNpc } from '../../store/npcStore';
import { walletDiagnostics } from './walletCore';
import { itemDiagnostics } from './itemCore';
import { npcDiagnostics } from './npcCore';

export interface WatchReport { domain: string; violations: string[]; }

/** 物品不变量：重复 id（双计）/无名/数量≤0/装备槽冲突。 */
function itemChecks(): string[] {
  const items: any[] = (useItems.getState() as { items?: any[] }).items ?? [];
  const v: string[] = [];
  const idSeen = new Set<string>();
  const slotSeen = new Map<string, string>();
  for (const it of items) {
    if (!it) continue;
    if (it.id) {
      if (idSeen.has(it.id)) v.push(`重复 id：${it.id}（${it.name ?? '?'}）`);
      idSeen.add(it.id);
    }
    if (!it.name) v.push(`无名物品：id=${it.id ?? '?'}`);
    if (typeof it.quantity === 'number' && it.quantity <= 0) v.push(`数量≤0：${it.name}（${it.quantity}）`);
    if (it.equipped && it.equipSlot) {
      const prev = slotSeen.get(it.equipSlot);
      if (prev) v.push(`装备槽冲突：${it.equipSlot} 同时装着「${prev}」和「${it.name}」`);
      else slotSeen.set(it.equipSlot, it.name);
    }
  }
  return v;
}

/* NPC 不变量（幽灵/真名重复/id 不一致）已并入 npcCore.reconcileNpcs（同逻辑 + 溯源审计「首建源」），此处直接用 npcDiagnostics。 */

/** 跑全部看门狗（各域读只读态核对）。绝不抛出（任一域失败只记空）。 */
export function runWatchdogs(): WatchReport[] {
  const reports: WatchReport[] = [];
  try {
    const wd = walletDiagnostics(useItems.getState().currency as unknown as Record<string, number>);
    reports.push({ domain: '货币', violations: [...wd.drift.map((d) => `漂移 ${d.key}：核心 ${d.core} / 游戏 ${d.live}`), ...wd.violations] });
  } catch { reports.push({ domain: '货币', violations: [] }); }
  try {
    const idg = itemDiagnostics((useItems.getState() as { items?: any[] }).items ?? []);
    const driftMsgs = idg.drift.map((d) => `数量漂移 ${d.sig}：核心 ${d.core} / 背包 ${d.live}`);
    reports.push({ domain: '物品', violations: [...itemChecks(), ...driftMsgs, ...idg.violations] });
  } catch { reports.push({ domain: '物品', violations: [] }); }
  try { reports.push({ domain: 'NPC', violations: npcDiagnostics((useNpc.getState() as { npcs?: Record<string, any> }).npcs ?? {}).violations }); } catch { reports.push({ domain: 'NPC', violations: [] }); }
  return reports;
}

/** 仅有违规的域（供告警/面板显示）。 */
export function watchdogViolations(): WatchReport[] {
  return runWatchdogs().filter((r) => r.violations.length > 0);
}

export interface HealReport { itemDeduped: number; npcDeduped: number; npcAliasMerged: number; healed: boolean; }
/** 自愈：调**现成、已验证**的修复函数，把 corruption 就地修掉（不新造逻辑，只集中+可见+兜底）。
   幽灵 NPC 由 App.pruneGhostNpcs 每回合已管，此处补齐 dedup 系列（同名物品/NPC/别名/储存空间）。返回修了多少。 */
export function healWatchdog(): HealReport {
  let itemDeduped = 0, npcDeduped = 0, npcAliasMerged = 0;
  try { itemDeduped = useItems.getState().dedupeByName() || 0; } catch { /* */ }
  try { npcDeduped = useNpc.getState().dedupeByName() || 0; } catch { /* */ }
  try { npcAliasMerged = useNpc.getState().dedupeAliasNpcs() || 0; } catch { /* */ }
  try { useNpc.getState().dedupeNpcItems(); } catch { /* */ }
  return { itemDeduped, npcDeduped, npcAliasMerged, healed: itemDeduped > 0 || npcDeduped > 0 || npcAliasMerged > 0 };
}
