import { useGemSets } from '../store/gemSetStore';
import { useEquipSets } from '../store/equipSetStore';
import { gemSetDetailLines, gemSetEquipEntry, gemSetPassive } from './gemSets';
import { equipSetDetailLines, equipSetEquipEntry, equipSetPassive } from './equipSets';
import { mergePassive, type PassiveMod } from './combatTags';

/* ════════════════════════════════════════════
   套装加成·单一口径（setBonus）
   宝石套装（gemSets·按已装备装备上镶嵌的同套宝石计数）+ 锻造装备套装（equipSets·按已装备的同套部件计数）
   这两套机制**并联生效、互不干扰**，但每个消费方都要"取两边 → 合并"，于是历来各写各的：
     属性面板 PlayerSidebar / 战斗 combatEngine.buildCombatant / 正文注入 structuredRecall / NPC 面板 NpcDetail
   —— 一处漏抄就是一处静默不一致（2026-08-01 用户报「正文AI不看宝石和套装效果」的根因：正文注入漏了六维那份、
   套装档更是从不注入；NpcDetail 同样漏）。此模块把"取两边+合并"收成三个函数，**新的消费方一律走这里**。

   三个出口对应三种用途：
   - setAttrEntries：六维 → 包成合成「装备条目」，混进 equipped 数组交 effectiveAttrs/computeAttrBreakdown（受阶位 cap 约束）
   - setPassive    ：战斗被动（暴击/减伤/穿透…）→ 合并进 buildCombatant 的 passive
   - setDetailLines：人类/AI 可读的逐套详情 → 正文注入、面板展示
   主角与 NPC 共用（NPC 也能镶宝石、也能拿到套装部件）。纯读 store，无副作用。
════════════════════════════════════════════ */

/** 消费方传进来的「已装备物品」：只需要这几个字段，主角 InventoryItem / NPC NpcOwnedItem 都满足。 */
type SetItemLike = { equipped?: boolean; equipSet?: string; gems?: unknown[] };

/** 套装六维加成 → 合成「装备条目」数组（无激活套装则空数组，可直接展开）。 */
export function setAttrEntries(equippedItems: SetItemLike[]): { effect: string }[] {
  const g = gemSetEquipEntry(equippedItems as never, useGemSets.getState().sets);
  const e = equipSetEquipEntry(equippedItems as never, useEquipSets.getState().sets);
  return [...(g ? [g] : []), ...(e ? [e] : [])];
}

/** 套装战斗被动（宝石套装 + 锻造套装合并）。 */
export function setPassive(equippedItems: SetItemLike[]): PassiveMod {
  return mergePassive(
    gemSetPassive(equippedItems as never, useGemSets.getState().sets),
    equipSetPassive(equippedItems as never, useEquipSets.getState().sets),
  );
}

/** 已激活套装的逐套详情行（宝石套装在前、锻造套装在后；无则空数组 → 调用方整块不渲染/不注入）。 */
export function setDetailLines(equippedItems: SetItemLike[]): string[] {
  return [
    ...gemSetDetailLines(equippedItems as never, useGemSets.getState().sets),
    ...equipSetDetailLines(equippedItems as never, useEquipSets.getState().sets),
  ];
}
