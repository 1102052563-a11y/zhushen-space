import { generateGem } from './gemEngine';
import { useItems, type InventoryItem } from '../store/itemStore';

/* ════════════════════════════════════════════
   命运福袋（扭蛋）—— 花魂币抽奖池：装备/宝石/材料/技能书/乐园币/魂币
   - 纯前端确定性：稀有度加权 + 账号级保底（60 抽内必出史诗+）+ 十连保底≥稀有
   - 奖励即时发放（装备/宝石/材料/技能书 → 背包；货币 → 钱包）
   - 设计见记忆 casino-feature
════════════════════════════════════════════ */

export type GachaRarity = '普通' | '精良' | '稀有' | '史诗' | '传说';
export type GachaKind = 'currency' | 'soulcoin' | 'gem' | 'equip' | 'material' | 'skillbook';

export interface GachaReward {
  rarity: GachaRarity;
  kind: GachaKind;
  name: string;
  desc: string;
  grade: string;
  amount?: number;                              // currency / soulcoin
  item?: Omit<InventoryItem, 'id' | 'addedAt'>; // gem / equip / material / skillbook
}

export const GACHA_PITY = 60;   // 60 抽内必出史诗+
const RARITY_GRADE: Record<GachaRarity, string> = { 普通: '绿色', 精良: '蓝色', 稀有: '紫色', 史诗: '暗金', 传说: '传说级' };
const RARITY_RANK: Record<GachaRarity, number> = { 普通: 0, 精良: 1, 稀有: 2, 史诗: 3, 传说: 4 };

function rng() { return Math.random(); }
function pick<T>(arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function randInt(a: number, b: number): number { return a + Math.floor(rng() * (b - a + 1)); }

function rollRarity(force: boolean): GachaRarity {
  if (force) return rng() < 0.2 ? '传说' : '史诗';   // 保底：触发即史诗+
  const r = rng();
  if (r < 0.52) return '普通';
  if (r < 0.82) return '精良';
  if (r < 0.95) return '稀有';
  if (r < 0.99) return '史诗';
  return '传说';
}

const EQUIP = [
  { cat: '武器', names: ['噬魂之刃', '裂空战戟', '幽冥短匕', '焚天枪', '断岳巨剑'], stat: '攻击', subType: '单手/双手武器' },
  { cat: '防具', names: ['玄铁重铠', '流光战袍', '星陨胸甲', '御灵战靴', '龙鳞护手'], stat: '防御', subType: '护甲' },
  { cat: '饰品', names: ['气运之戒', '守护项链', '虚空耳坠', '命运护符'], stat: '', subType: '饰品' },
  { cat: '法宝', names: ['翻天印', '缚灵幡', '九窍玲珑塔', '噬星珠'], stat: '', subType: '法宝' },
];
const STAT_RANGE: Record<string, [number, number]> = { 绿色: [20, 45], 蓝色: [45, 85], 紫色: [85, 150], 暗金: [150, 260], 传说级: [260, 420] };

const cat = (c: string) => c as InventoryItem['category'];

function buildEquip(rarity: GachaRarity): GachaReward {
  const grade = RARITY_GRADE[rarity];
  const e = pick(EQUIP);
  const name = `${grade}·${pick(e.names)}`;
  const [lo, hi] = STAT_RANGE[grade] ?? [20, 45];
  const v = randInt(lo, hi);
  const combatStat = e.stat ? `${e.stat} ${v}-${Math.round(v * 1.4)}` : undefined;
  const effect = e.stat ? `${e.stat}力大幅提升，自带随机词缀` : '全属性加成、附特殊机制';
  return {
    rarity, kind: 'equip', name, desc: `${e.cat} · ${grade}`, grade,
    item: { name, category: cat(e.cat), gradeDesc: grade, subType: e.subType, effect, combatStat, quantity: 1, equipped: false, tags: ['命运福袋'], acquisition: '命运福袋', intro: '自命运福袋开出的装备' },
  };
}
function buildGem(rarity: GachaRarity): GachaReward {
  const grade = RARITY_GRADE[rarity];
  const g = generateGem(grade);
  return { rarity, kind: 'gem', name: g.item.name, desc: `宝石 · ${grade}`, grade, item: { ...g.item, acquisition: '命运福袋' } };
}
function buildMaterial(rarity: GachaRarity): GachaReward {
  const grade = RARITY_GRADE[rarity];
  const name = `${grade}·${pick(['强化保护符', '淬炼精石', '虚空结晶', '混沌母液', '阶位之尘'])}`;
  return { rarity, kind: 'material', name, desc: `材料 · ${grade}`, grade, item: { name, category: cat('材料'), gradeDesc: grade, effect: '强化/合成用珍稀材料', quantity: randInt(1, 3), equipped: false, tags: ['命运福袋', '材料'], acquisition: '命运福袋', intro: '可用于装备强化或合成' } };
}
function buildSkillbook(rarity: GachaRarity): GachaReward {
  const grade = RARITY_GRADE[rarity];
  const name = `${grade}·${pick(['残卷·裂空诀', '秘典·星陨经', '功法·噬魂录', '心法·御灵章'])}`;
  return { rarity, kind: 'skillbook', name, desc: `技能书 · ${grade}`, grade, item: { name, category: cat('特殊物品'), gradeDesc: grade, effect: '参悟可习得其中招式', quantity: 1, equipped: false, tags: ['命运福袋', '技能书'], acquisition: '命运福袋', intro: '记载某门功法的典籍，可参悟修习' } };
}
function buildCurrency(rarity: GachaRarity): GachaReward {
  const ranges: Record<GachaRarity, [number, number]> = { 普通: [200, 800], 精良: [800, 2500], 稀有: [2500, 6000], 史诗: [6000, 15000], 传说: [15000, 40000] };
  const amount = randInt(ranges[rarity][0], ranges[rarity][1]);
  return { rarity, kind: 'currency', name: `乐园币 ×${amount}`, desc: '乐园币', grade: RARITY_GRADE[rarity], amount };
}
function buildSoulcoin(rarity: GachaRarity): GachaReward {
  const amount = rarity === '传说' ? randInt(2, 4) : 1;
  return { rarity, kind: 'soulcoin', name: `魂币 ×${amount}`, desc: '灵魂钱币', grade: RARITY_GRADE[rarity], amount };
}
const KINDS: Record<GachaRarity, GachaKind[]> = {
  普通: ['currency', 'material', 'equip'],
  精良: ['currency', 'gem', 'equip', 'material'],
  稀有: ['gem', 'equip', 'skillbook'],
  史诗: ['equip', 'gem', 'soulcoin'],
  传说: ['equip', 'gem', 'soulcoin'],
};
function buildReward(rarity: GachaRarity): GachaReward {
  switch (pick(KINDS[rarity])) {
    case 'gem': return buildGem(rarity);
    case 'equip': return buildEquip(rarity);
    case 'material': return buildMaterial(rarity);
    case 'skillbook': return buildSkillbook(rarity);
    case 'soulcoin': return buildSoulcoin(rarity);
    default: return buildCurrency(rarity);
  }
}

/** 抽 count 次：保底计数推进、十连保底≥稀有。返回奖励列表 + 新保底计数。 */
export function rollGachaBatch(count: number, pity: number): { rewards: GachaReward[]; pity: number } {
  let p = pity;
  const rewards: GachaReward[] = [];
  for (let i = 0; i < count; i++) {
    p++;
    const rarity = rollRarity(p >= GACHA_PITY);
    if (RARITY_RANK[rarity] >= 3) p = 0;   // 出史诗+ → 清空保底计数
    rewards.push(buildReward(rarity));
  }
  if (count >= 10 && !rewards.some((r) => RARITY_RANK[r.rarity] >= 2)) rewards[count - 1] = buildReward('稀有');
  return { rewards, pity: p };
}

/** 发放一份奖励（背包 / 钱包 / 档案）。 */
export function grantGachaReward(r: GachaReward): void {
  const I = useItems.getState();
  if (r.item) { I.addItem(r.item); return; }
  if (r.kind === 'currency') I.adjustCurrency('乐园币', r.amount || 0);
  else if (r.kind === 'soulcoin') I.adjustCurrency('灵魂钱币', r.amount || 0);
}

export const bestRarity = (rewards: GachaReward[]): GachaRarity =>
  rewards.reduce<GachaRarity>((b, r) => (RARITY_RANK[r.rarity] > RARITY_RANK[b] ? r.rarity : b), '普通');

export const RARITY_COLOR: Record<GachaRarity, string> = {
  普通: 'text-slate-300 border-edge bg-panel2/30',
  精良: 'text-sky-300 border-sky-500/40 bg-sky-500/5',
  稀有: 'text-fuchsia-300 border-fuchsia-500/50 bg-fuchsia-500/10',
  史诗: 'text-amber-300 border-amber-400/60 bg-amber-400/10',
  传说: 'text-orange-300 border-orange-400/70 bg-orange-500/15',
};
