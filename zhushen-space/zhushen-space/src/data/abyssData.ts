/* ════════════════════════════════════════════
   深渊地牢 内置数据（M1：黑渊）
   忠于原著深渊体系（指导/轮回乐园_势力与种族.md 第七节）。
   M2 起：五险地全量 / 加成卡改 API 生成 / 原罪物 SinTemplate 抽取源。
════════════════════════════════════════════ */

export interface MonsterDef {
  id: string;
  name: string;
  tier: string;
  hp: number;
  atk: number;
  def: number;
  rank: 'mob' | 'elite' | 'boss';
  tags?: string[];   // 战斗机制标签（M2 接战斗 Layer2）
}

export interface AbyssLoot {
  kind: 'currency' | 'item' | 'sin';
  name: string;
  qty?: number;
  desc?: string;
  quality?: string;       // 品级（对齐 itemStore gradeDesc）
  category?: string;      // itemStore 分类（带出背包用）
  effect?: string;        // 装备/物品效果文案
  sin?: boolean;          // 原罪物标记
}

export interface BoonCard {
  id: string;
  name: string;
  desc: string;
  school: 'corruption' | 'martial' | 'guard' | 'undead' | 'domain' | 'gambler';
  quality: 'common' | 'fine' | 'epic';
  apply: { atkMult?: number; defMult?: number; hpMult?: number; atkFlat?: number; heal?: number };
}

export interface BiomeData {
  name: string;
  zoneBoss: string;
  mobs: MonsterDef[];
  elites: MonsterDef[];
  boss: MonsterDef;
  battleLoot: string;
  eliteLoot: string;
  treasureLoot: string;
  bossLoot: string;
}

/* ── 黑渊（第 1 险地·入门污染区） ── */
const HEIYUAN: BiomeData = {
  name: '黑渊',
  zoneBoss: '黑雾母体·腐渊之核',
  mobs: [
    { id: 'm_worm', name: '渊蛆', tier: '一阶', hp: 60, atk: 12, def: 3, rank: 'mob', tags: ['pollute'] },
    { id: 'm_slime', name: '腐蚀史莱姆', tier: '一阶', hp: 80, atk: 9, def: 5, rank: 'mob', tags: ['dot', 'split'] },
    { id: 'm_crawler', name: '黑雾爬虫', tier: '一阶', hp: 50, atk: 15, def: 2, rank: 'mob', tags: ['pollute'] },
    { id: 'm_wraith', name: '污染残魂', tier: '一阶', hp: 70, atk: 13, def: 4, rank: 'mob', tags: ['dot'] },
  ],
  elites: [
    { id: 'e_mud', name: '污泥巨怪', tier: '二阶', hp: 220, atk: 22, def: 12, rank: 'elite', tags: ['shield'] },
    { id: 'e_fallen', name: '堕落契约者', tier: '二阶', hp: 180, atk: 28, def: 8, rank: 'elite', tags: ['dot', 'pollute'] },
  ],
  boss: { id: 'b_heiwu', name: '黑雾母体·腐渊之核', tier: '三阶', hp: 900, atk: 38, def: 16, rank: 'boss', tags: ['domain', 'summon', 'pollute'] },
  battleLoot: 'heiyuan_battle',
  eliteLoot: 'heiyuan_elite',
  treasureLoot: 'heiyuan_treasure',
  bossLoot: 'heiyuan_boss',
};

export const ABYSS_BIOMES: BiomeData[] = [HEIYUAN];

/* ── 怪物投放 ── */
export function pickMonsters(biome: BiomeData, kind: 'battle' | 'elite' | 'boss', rng: () => number): MonsterDef[] {
  if (kind === 'boss') return [biome.boss];
  if (kind === 'elite') {
    const e = biome.elites[Math.floor(rng() * biome.elites.length)];
    // 精英可带 1 只杂兵
    if (rng() < 0.5) return [e, biome.mobs[Math.floor(rng() * biome.mobs.length)]];
    return [e];
  }
  const count = 1 + Math.floor(rng() * 3);   // 1-3 杂兵
  const out: MonsterDef[] = [];
  for (let i = 0; i < count; i++) out.push(biome.mobs[Math.floor(rng() * biome.mobs.length)]);
  return out;
}

/* ── 掉落表 ── */
type LootRoll = { weight: number; loot: () => AbyssLoot };
const GRADES_LOW = ['白色', '绿色', '蓝色'];
const GRADES_MID = ['蓝色', '紫色', '暗紫色'];
const GRADES_HIGH = ['暗紫色', '淡金', '金色', '暗金'];

function gear(name: string, category: string, grade: string, effect: string): AbyssLoot {
  return { kind: 'item', name, category, quality: grade, effect, desc: effect };
}
function material(name: string, qty: number): AbyssLoot {
  return { kind: 'item', name, category: '材料', quality: '绿色', qty, desc: '深渊材料' };
}

const LOOT_TABLES: Record<string, LootRoll[]> = {
  heiyuan_battle: [
    { weight: 40, loot: () => material('腐蚀结晶碎屑', 1 + Math.floor(Math.random() * 2)) },
    { weight: 30, loot: () => material('渊兽残骸', 1) },
    { weight: 18, loot: () => gear('污浊短刃', '武器', pickG(GRADES_LOW), '攻击力小幅提升，附带轻微腐蚀') },
    { weight: 12, loot: () => gear('渊皮护腕', '防具', pickG(GRADES_LOW), '防御力小幅提升') },
  ],
  heiyuan_elite: [
    { weight: 35, loot: () => gear('腐渊战刃', '武器', pickG(GRADES_MID), '攻击力提升，斩击附带流血') },
    { weight: 30, loot: () => gear('污泥重甲', '防具', pickG(GRADES_MID), '防御力显著提升') },
    { weight: 20, loot: () => material('深渊强化石', 1) },
    { weight: 15, loot: () => gear('堕者之戒', '饰品', pickG(GRADES_MID), '腐蚀越高，攻击越强') },
  ],
  heiyuan_treasure: [
    { weight: 30, loot: () => gear('封存利器', '武器', pickG(GRADES_MID), '尘封已久的深渊兵器') },
    { weight: 30, loot: () => gear('封存护具', '防具', pickG(GRADES_MID), '尘封已久的深渊护甲') },
    { weight: 25, loot: () => material('深渊打孔石', 1) },
    { weight: 15, loot: () => material('深渊宝石原矿', 1) },
  ],
  heiyuan_boss: [
    { weight: 50, loot: () => gear('腐渊之核·碎片', '材料', pickG(GRADES_HIGH), '区主精魄，可用于觉醒/合成') },
    { weight: 50, loot: () => gear('母体甲壳盾', '防具', pickG(GRADES_HIGH), '高防御，受击时生成护盾') },
  ],
};

function pickG(arr: string[]): string { return arr[Math.floor(Math.random() * arr.length)]; }

export function rollLootTable(tableId: string, depth: number, rng: () => number): AbyssLoot[] {
  const table = LOOT_TABLES[tableId];
  if (!table) return [];
  const drops = 1 + (rng() < Math.min(0.6, 0.2 + depth * 0.08) ? 1 : 0);   // 越深越可能多掉一件
  const total = table.reduce((s, r) => s + r.weight, 0);
  const out: AbyssLoot[] = [];
  for (let d = 0; d < drops; d++) {
    let roll = rng() * total;
    for (const r of table) { roll -= r.weight; if (roll <= 0) { out.push(r.loot()); break; } }
  }
  return out;
}

/* ── 内置原罪物：黑暗面具（canonical） ── */
export const SIN_BLACK_MASK: AbyssLoot = {
  kind: 'sin',
  name: '黑暗面具',
  sin: true,
  category: '饰品',
  quality: '史诗级',
  effect: '【原罪·黑暗面具】大幅提升攻击与法术强度；持有者每回合积累腐蚀，力量越强反噬越烈。',
  desc: '深渊原罪级造物之一，戴上它的人再难摘下。',
};

/* ── 加成卡种子池（M1 lite：确定性、无 synergy；M2 改 API 生成） ── */
export const BOON_SEED_POOL: BoonCard[] = [
  { id: 'b_rage', name: '渊怒', desc: '攻击力 +12%', school: 'martial', quality: 'common', apply: { atkMult: 0.12 } },
  { id: 'b_edge', name: '裂伤之刃', desc: '攻击力 +18%', school: 'martial', quality: 'fine', apply: { atkMult: 0.18 } },
  { id: 'b_iron', name: '渊铁之躯', desc: '防御力 +20%', school: 'guard', quality: 'common', apply: { defMult: 0.2 } },
  { id: 'b_vital', name: '污血膨胀', desc: '生命上限 +15%', school: 'guard', quality: 'common', apply: { hpMult: 0.15 } },
  { id: 'b_mend', name: '腐土愈合', desc: '立即回复 30% HP', school: 'guard', quality: 'common', apply: { heal: 0.3 } },
  { id: 'b_corrupt', name: '以蚀化力', desc: '攻击力 +25%（沾染更深的腐蚀）', school: 'corruption', quality: 'fine', apply: { atkMult: 0.25 } },
  { id: 'b_frenzy', name: '战狂', desc: '攻击力 +30%，防御 -10%', school: 'gambler', quality: 'fine', apply: { atkMult: 0.3, defMult: -0.1 } },
  { id: 'b_bulwark', name: '不动壁垒', desc: '防御力 +35%', school: 'guard', quality: 'fine', apply: { defMult: 0.35 } },
  { id: 'b_undeadlord', name: '亡灵亲和', desc: '生命上限 +25%', school: 'undead', quality: 'fine', apply: { hpMult: 0.25 } },
  { id: 'b_abysslord', name: '深渊领域', desc: '攻击力 +20%、防御 +20%', school: 'domain', quality: 'epic', apply: { atkMult: 0.2, defMult: 0.2 } },
  { id: 'b_sharp', name: '锐意', desc: '攻击力固定 +15', school: 'martial', quality: 'common', apply: { atkFlat: 15 } },
  { id: 'b_gamble', name: '孤注', desc: '攻击力 +45%，生命上限 -10%', school: 'gambler', quality: 'epic', apply: { atkMult: 0.45, hpMult: -0.1 } },
];
