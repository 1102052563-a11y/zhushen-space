// NPC 名字守卫（约束生成试点·治重名/ghost）—— 建在通用 [[aliasGuard]] 之上
// ───────────────────────────────────────────────────────────────────────────
// 本回合正文若冒出一个「新 NPC」，用动态 enum（现有在场 NPC 名 + __NEW__）约束模型裁决它是不是某现有 NPC 的别名/错字，
// 是则改名到规范名 → 复用现成 `dedupeByName`（留信息最全的、并入其余·装备/唯一物不误吞）完成合并。直击 [[evolution-store-name-and-ghost-bugs]]。
// 纯附加、失败静默：任何异常都不改变主 NPC 演化结果。

import type { ApiConfig } from '../store/settingsStore';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { runAliasGuard } from './aliasGuard';

// 对既有引用/单测保持稳定：纯逻辑助手从通用核心再导出
export { buildAliasSchema, shouldMerge, type AliasDecision } from './aliasGuard';

/** 对本回合新出现的 NPC 逐个做别名裁决，命中则改名并入现有档。返回合并掉的数量。
 *  @param chain        resolveApiChain('npc', ...) 得到的接口链
 *  @param beforeIds    AI 演化「之前」已存在的 NPC id 集合（识别本回合新建的）
 *  @param onSceneNames 演化之前在场的真实 NPC 名（enum 基准 = 模型能引用的名单）
 *  @param narrativeTail 本回合正文尾段（判断上下文，调用方自行裁剪长度） */
export async function reconcileNewNpcNames(
  chain: ApiConfig[],
  beforeIds: Set<string>,
  onSceneNames: string[],
  narrativeTail = '',
): Promise<number> {
  const existing = Array.from(new Set(onSceneNames.filter(Boolean)));
  const fresh = (Object.values(useNpc.getState().npcs) as NpcRecord[])
    .filter((r) => !beforeIds.has(r.id) && !r.isDead && hasRealNpcName(r) && !existing.includes(r.name));

  return runAliasGuard<NpcRecord>({
    chain, kind: 'NPC', existingNames: existing, fresh, narrativeTail, label: 'npcAliasGuard',
    describe: (n) => `「${n.name}」（阶位：${n.realm || '未知'}；性格：${n.personality || '未知'}；背景：${(n.background || '未知').slice(0, 120)}）`,
    onAlias: (n, target) => {
      useNpc.getState().upsertNpc(n.id, { name: target });   // 改名到规范名（upsertNpc 内 resolveNpcName 放行真实名）
      console.warn(`[NPC名字守卫]「${n.name}」判定为现有「${target}」的别名 → 改名并入`);
    },
    finalize: () => useNpc.getState().dedupeByName(),   // 复用现成谨慎去重（留信息最全者，装备/唯一物不误吞）
  });
}
