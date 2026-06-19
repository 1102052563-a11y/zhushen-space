/* 组队讨伐 · 胜利掉落生成（前端确定性骨架，难度档定品质/数量；AI 配文留作后续）。
   货币全员均得；物品走 need/greed ROLL 分配。 */

const TIER_LOOT: Record<string, { coin: number; itemN: number; grade: string }> = {
  C: { coin: 600,   itemN: 1, grade: '绿色' },
  B: { coin: 1800,  itemN: 2, grade: '蓝色' },
  A: { coin: 5000,  itemN: 2, grade: '紫色' },
  S: { coin: 12000, itemN: 3, grade: '橙色' },
};

const LOOT_KINDS = [
  { name: '战利残片', category: '材料', effect: '讨伐战利材料，可用于强化/合成' },
  { name: '精魄宝石', category: '材料', effect: '可镶嵌的宝石原石' },
  { name: '秘传技卷', category: '技能书', effect: '可参悟习得一门技能' },
  { name: '讨伐勋甲', category: '防具', effect: '讨伐 BOSS 掉落的护甲' },
  { name: '噬魂之刃', category: '武器', effect: '凝结 BOSS 之力的武器' },
  { name: '复元灵药', category: '消耗品', effect: '战斗中恢复大量生命' },
];

export interface RaidLoot {
  lootId: string;
  bossName: string;
  currency: number;   // 乐园币（全员均得）
  items: { id: string; name: string; category: string; gradeDesc: string; effect: string; quantity: number }[];
}

export function generateRaidLoot(rewardTier: string, bossName: string): RaidLoot {
  const cfg = TIER_LOOT[rewardTier] || TIER_LOOT.C;
  const items: RaidLoot['items'] = [];
  const used = new Set<number>();
  for (let i = 0; i < cfg.itemN; i++) {
    let idx = Math.floor(Math.random() * LOOT_KINDS.length);
    let guard = 0;
    while (used.has(idx) && guard++ < 10) idx = Math.floor(Math.random() * LOOT_KINDS.length);
    used.add(idx);
    const k = LOOT_KINDS[idx];
    items.push({
      id: `L_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`,
      name: `${bossName}·${k.name}`,
      category: k.category,
      gradeDesc: cfg.grade,
      effect: k.effect,
      quantity: 1,
    });
  }
  return { lootId: `loot_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, bossName, currency: cfg.coin, items };
}
