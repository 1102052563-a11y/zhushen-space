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

/* ════════════════════════════════════════════
   巴卡尔攻坚战 · 通关「豪华」结算奖励（副本全清触发，全员均得全套·不 ROLL）
   评级 = 难度档基线 + 恐惧剩余加成 → E~SSS；越高倍率越大。
   发放渠道全部映射现成接口：adjustCurrency(乐园币/灵魂钱币/技能点/黄金技能点)+grantBonusPP(潜能点)+addItem(装备/宝石/材料/宝箱)+addTitle(称号)。
════════════════════════════════════════════ */
const RATING_BANDS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const DIFF_FLOOR: Record<string, number> = { normal: 2, hard: 3, nightmare: 4, abyss: 5 };
const DIFF_REWARD: Record<string, { coin: number; soul: number; sp: number; gsp: number; pp: number; eqN: number; gemN: number; grade: string; treasure: string }> = {
  normal:    { coin: 80000,   soul: 8000,   sp: 20,  gsp: 1,  pp: 30,  eqN: 2, gemN: 1, grade: '紫色', treasure: '紫色' },
  hard:      { coin: 200000,  soul: 20000,  sp: 50,  gsp: 3,  pp: 80,  eqN: 3, gemN: 2, grade: '橙色', treasure: '橙色' },
  nightmare: { coin: 500000,  soul: 50000,  sp: 120, gsp: 6,  pp: 180, eqN: 3, gemN: 2, grade: '橙色', treasure: '红色' },
  abyss:     { coin: 1200000, soul: 120000, sp: 300, gsp: 12, pp: 400, eqN: 4, gemN: 3, grade: '红色', treasure: '红色' },
};
const DRAGON_MATERIALS = [
  { name: '冰之结晶', effect: '冰龙·斯皮拉齐之精，合成龙王套所需' },
  { name: '毒龙之鳞', effect: '毒龙·斯卡萨之鳞，合成龙王套所需' },
  { name: '雷髓',     effect: '眩龙·希斯麦之髓，合成龙王套所需' },
];
const DRAGON_EQUIP = [
  { name: '龙王·焚天战刃', category: '武器', effect: '凝龙王之炎的巨刃，攻击附带龙焰灼烧' },
  { name: '龙王·黑鳞重铠', category: '防具', effect: '黑龙鳞甲锻造的重铠，巨额减伤' },
  { name: '龙王·逆鳞护符', category: '饰品', effect: '逆鳞所制护符，受创时反震伤害' },
  { name: '龙王·龙瞳指环', category: '饰品', effect: '龙王之瞳，大幅提升暴击与命中' },
];
const DRAGON_GEMS = [
  { name: '龙王精魄·赤', effect: '炽炎之魄，镶嵌增幅攻击' },
  { name: '龙王精魄·玄', effect: '玄铁之魄，镶嵌增幅防御' },
  { name: '龙王精魄·金', effect: '王权之魄，镶嵌全属性增幅' },
];
const ANTON_MATERIALS = [
  { name: '黑曜核心碎片', effect: '擎天之柱崩解的黑曜核心，合成安图恩套所需' },
  { name: '异面结晶',     effect: '异面世界凝结的能量结晶，合成安图恩套所需' },
  { name: '魔能燃料',     effect: '驱动安图恩的魔能燃料，合成安图恩套所需' },
];
const ANTON_EQUIP = [
  { name: '安图恩·黑曜核心炮', category: '武器', effect: '凝异面能量的核心炮，攻击附带能量灼烧' },
  { name: '安图恩·魔能装甲',   category: '防具', effect: '异面合金锻造的重型装甲，巨额减伤' },
  { name: '安图恩·力场护盾仪', category: '饰品', effect: '受创时自动展开力场护盾' },
  { name: '安图恩·异面棱镜',   category: '饰品', effect: '折射异面之力，大幅提升能量伤害与暴击' },
];
const ANTON_GEMS = [
  { name: '安图恩精魄·赤', effect: '炽能之魄，镶嵌增幅攻击' },
  { name: '安图恩精魄·玄', effect: '装甲之魄，镶嵌增幅防御' },
  { name: '安图恩精魄·紫', effect: '异面之魄，镶嵌增幅全属性' },
];
const VYKAS_MATERIALS = [
  { name: '欲望结晶', effect: '比阿基斯欲望凝结的结晶，合成欲望套所需' },
  { name: '魅惑之翼', effect: '比阿基斯血色双翼的残片，合成欲望套所需' },
  { name: '心脏碎片', effect: '比阿基斯心脏崩裂的碎片，合成欲望套所需' },
];
const VYKAS_EQUIP = [
  { name: '比阿基斯·噬欲血镰', category: '武器', effect: '饮血而强的血色镰刃，攻击附带噬血' },
  { name: '比阿基斯·魅影软甲', category: '防具', effect: '魅影编织的软甲，闪避与减伤兼备' },
  { name: '比阿基斯·诱惑之冠', category: '饰品', effect: '诱惑之冠，大幅提升暴击与魅惑抗性' },
  { name: '比阿基斯·心脏护符', category: '饰品', effect: '以心脏碎片所制，受创时回血' },
];
const VYKAS_GEMS = [
  { name: '欲望精魄·赤', effect: '噬血之魄，镶嵌增幅攻击' },
  { name: '欲望精魄·玄', effect: '魅影之魄，镶嵌增幅防御' },
  { name: '欲望精魄·魅', effect: '欲望之魄，镶嵌增幅全属性' },
];

/* 副本奖励主题：各副本各自的装备/宝石/材料/核心/宝箱/称号皮（结构相同，只换名） */
const REWARD_THEMES: Record<string, { emoji: string; themeName: string; fullName: string; equip: typeof DRAGON_EQUIP; gems: typeof DRAGON_GEMS; materials: typeof DRAGON_MATERIALS; core: { name: string; effect: string }; box: string; titles: [string, string, string]; titleEffect: string }> = {
  bakal: { emoji: '🐉', themeName: '巴卡尔攻坚战', fullName: '机械之乱·巴卡尔攻坚战', equip: DRAGON_EQUIP, gems: DRAGON_GEMS, materials: DRAGON_MATERIALS, core: { name: '龙王核心', effect: '黑龙·巴卡尔的本源核心，合成龙王套的核心材料' }, box: '巴卡尔宝藏', titles: ['讨龙勇士', '屠龙者', '灭龙者'], titleEffect: '对龙类伤害提升·威慑全场' },
  anton: { emoji: '🤖', themeName: '安图恩攻坚战', fullName: '黑色大地·安图恩攻坚战', equip: ANTON_EQUIP, gems: ANTON_GEMS, materials: ANTON_MATERIALS, core: { name: '安图恩核心', effect: '巨型安图恩的异面能量核心，合成安图恩套的核心材料' }, box: '安图恩宝藏', titles: ['讨伐勇士', '安图恩讨伐者', '黑色大地征服者'], titleEffect: '对机械·异面之敌伤害提升·威慑全场' },
  vykas: { emoji: '💋', themeName: '比阿基斯攻坚战', fullName: '欲望军团长·比阿基斯攻坚战', equip: VYKAS_EQUIP, gems: VYKAS_GEMS, materials: VYKAS_MATERIALS, core: { name: '比阿基斯之心', effect: '欲望军团长的心脏本源，合成欲望套的核心材料' }, box: '比阿基斯宝藏', titles: ['诱惑征服者', '欲望终结者', '欲望军团终结者'], titleEffect: '对魅惑·异能之敌伤害提升·威慑全场' },
};

export interface BakalReward {
  rewardId: string;
  rating: string;
  difficultyLabel: string;
  emoji: string;
  themeName: string;
  currency: { 乐园币: number; 灵魂钱币: number; 技能点: number; 黄金技能点: number };
  potentialPoints: number;
  items: { id: string; name: string; category: string; gradeDesc: string; effect: string; quantity: number }[];
  title: { name: string; level: string; source: string; effect: string; desc: string };
}

/* 通关豪华奖励（主题化：kind=bakal/anton）。评级=难度floor+计时剩余加成→E~SSS，倍率随评级。 */
export function generateRaidReward(kind: string, difficulty: string, dreadRemainPct: number, difficultyLabel = ''): BakalReward {
  const t = REWARD_THEMES[kind] || REWARD_THEMES.bakal;
  const base = DIFF_REWARD[difficulty] || DIFF_REWARD.normal;
  const floor = DIFF_FLOOR[difficulty] ?? 2;
  const bonus = dreadRemainPct >= 0.6 ? 2 : dreadRemainPct >= 0.3 ? 1 : 0;   // 计时剩余越多（越高效）评级越高
  const idx = Math.min(RATING_BANDS.length - 1, floor + bonus);
  const rating = RATING_BANDS[idx];
  const mul = 1 + bonus * 0.5;   // 评级越高·倍率越大（1.0 / 1.5 / 2.0）
  const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
  const items: BakalReward['items'] = [];
  [...t.equip].sort(() => Math.random() - 0.5).slice(0, base.eqN).forEach((e, i) =>
    items.push({ id: `BR_eq_${uid()}_${i}`, name: e.name, category: e.category, gradeDesc: base.grade, effect: e.effect, quantity: 1 }));
  [...t.gems].sort(() => Math.random() - 0.5).slice(0, base.gemN).forEach((g, i) =>
    items.push({ id: `BR_gem_${uid()}_${i}`, name: g.name, category: '宝石', gradeDesc: base.grade, effect: g.effect, quantity: 1 }));
  t.materials.forEach((m, i) =>
    items.push({ id: `BR_mat_${uid()}_${i}`, name: m.name, category: '材料', gradeDesc: '橙色', effect: m.effect, quantity: 1 }));
  items.push({ id: `BR_core_${uid()}`, name: t.core.name, category: '材料', gradeDesc: '红色', effect: t.core.effect, quantity: 1 });
  items.push({ id: `BR_box_${uid()}`, name: t.box, category: '宝箱', gradeDesc: base.treasure, effect: '开启获得宝物（装备/宝石/材料随机其一）', quantity: 1 });
  const titleName = idx >= 6 ? t.titles[2] : idx >= 4 ? t.titles[1] : t.titles[0];
  const title = { name: titleName, level: base.grade, source: t.themeName, effect: t.titleEffect, desc: `通关「${t.fullName}」（评级 ${rating}）所获的荣耀印记。` };
  return {
    rewardId: `BR_${uid()}`,
    rating, difficultyLabel, emoji: t.emoji, themeName: t.themeName,
    currency: { 乐园币: Math.round(base.coin * mul), 灵魂钱币: Math.round(base.soul * mul), 技能点: Math.round(base.sp * mul), 黄金技能点: Math.round(base.gsp * mul) },
    potentialPoints: Math.round(base.pp * mul),
    items, title,
  };
}

/* 兼容旧调用：巴卡尔奖励 = 主题 'bakal'。 */
export function generateBakalReward(difficulty: string, dreadRemainPct: number, difficultyLabel = ''): BakalReward {
  return generateRaidReward('bakal', difficulty, dreadRemainPct, difficultyLabel);
}
