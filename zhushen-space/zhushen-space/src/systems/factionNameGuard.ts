// 势力名字守卫（约束生成·治势力重名/别名）—— 建在通用 [[aliasGuard]] 之上
// ───────────────────────────────────────────────────────────────────────────
// 本回合正文若冒出一个「新势力」，用动态 enum（现有势力名 + __NEW__）约束模型裁决它是不是某现有势力的别名/错字/换称呼。
// 命中则并入现有档：用 ghost 的非空字段补全老档的空字段，再软删除 ghost（removeFaction·可归档恢复）。
// 势力无 NPC 那样的 dedupeByName，故就地做谨慎合并（老档优先保留，只补空）；纯附加、失败静默。

import type { ApiConfig } from '../store/settingsStore';
import { useFaction, type FactionRecord } from '../store/factionStore';
import { runAliasGuard } from './aliasGuard';

// 老档优先保留，仅用 ghost 补这些「文本类」空字段；数值/态度/标记不动，避免误改既有关系
const FILL_FIELDS: (keyof FactionRecord)[] = [
  'type', 'scale', 'powerLevel', 'territory', 'leader', 'members',
  'relations', 'goal', 'resources', 'status', 'background', 'assets', 'worldName',
];

const isRealFactionName = (f: FactionRecord): boolean => !!f.name && f.name !== f.id && !/^F\d+$/i.test(f.name);

/** 对本回合新出现的势力逐个做别名裁决，命中则并入现有档。返回合并掉的数量。
 *  @param chain        resolveApiChain('faction', ...) 接口链
 *  @param beforeIds    演化前已存在的势力 id 集合
 *  @param knownNames   演化前的真实势力名（enum 基准）
 *  @param narrativeTail 本回合正文尾段 */
export async function reconcileNewFactions(
  chain: ApiConfig[],
  beforeIds: Set<string>,
  knownNames: string[],
  narrativeTail = '',
): Promise<number> {
  const existing = Array.from(new Set(knownNames.filter(Boolean)));
  const fresh = (Object.values(useFaction.getState().factions) as FactionRecord[])
    .filter((f) => !beforeIds.has(f.id) && !f.isDestroyed && isRealFactionName(f) && !existing.includes(f.name));

  return runAliasGuard<FactionRecord>({
    chain, kind: '势力', existingNames: existing, fresh, narrativeTail, label: 'factionAliasGuard',
    describe: (f) => `「${f.name}」（类型：${f.type || '未知'}；规模：${f.scale || '未知'}；地盘：${f.territory || '未知'}；背景：${(f.background || '未知').slice(0, 120)}）`,
    onAlias: (ghost, target) => {
      const st = useFaction.getState();
      const keeper = (Object.values(st.factions) as FactionRecord[]).find((f) => f.name === target && f.id !== ghost.id);
      if (!keeper) return;
      const patch: Partial<FactionRecord> = {};
      for (const k of FILL_FIELDS) {
        const cur = keeper[k]; const inc = ghost[k];
        if ((cur == null || cur === '') && inc != null && inc !== '') (patch as Record<string, unknown>)[k] = inc;
      }
      if (Object.keys(patch).length) st.upsertFaction(keeper.id, patch);   // 只补老档的空字段
      st.removeFaction(ghost.id);                                          // 软删除 ghost（归档，可恢复）
      console.warn(`[势力名字守卫]「${ghost.name}」判定为现有「${target}」的别名 → 并入 ${keeper.id}`);
    },
  });
}
