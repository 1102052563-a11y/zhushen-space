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

export type BoonSchool = 'corruption' | 'martial' | 'guard' | 'undead' | 'domain' | 'gambler';
export type BoonTier = 'low' | 'mid' | 'high';
/** 效果原语词表（AI 只能从这里选；前端按档位×层深映射成真实数值）。 */
export type BoonPrim =
  | 'atk%' | 'crit' | 'aoe' | 'addDoT' | 'corruptionToDmg'
  | 'lifesteal' | 'def%' | 'shieldOnHit' | 'hp%' | 'summonN' | 'domain' | 'heal';

export interface BoonApply {
  atkMult?: number; defMult?: number; hpMult?: number; atkFlat?: number; heal?: number; lifesteal?: number;
}
export interface BoonCard {
  id: string;
  name: string;
  desc: string;
  school: BoonSchool;
  quality: 'common' | 'fine' | 'epic';
  apply: BoonApply;
  prims?: { id: BoonPrim; tier: BoonTier }[];  // API 生成时携带（展示/重算用）
  needCorruption?: number;                      // 需腐蚀≥X 才显著（§8.4，M2 auto-resolve 暂作展示）
  capstone?: boolean;                           // 流派质变核心
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
  battleLoot: 'abyss_battle', eliteLoot: 'abyss_elite', treasureLoot: 'abyss_treasure', bossLoot: 'abyss_boss',
};

/* ── 古战场（第 2 险地·亡灵/残兵） ── */
const GUZHANCHANG: BiomeData = {
  name: '古战场', zoneBoss: '枯骨统帅·无尽亡灵将军',
  mobs: [
    { id: 'g_skel', name: '枯骨战士', tier: '二阶', hp: 120, atk: 20, def: 8, rank: 'mob', tags: ['summon'] },
    { id: 'g_archer', name: '亡灵弓手', tier: '二阶', hp: 90, atk: 26, def: 4, rank: 'mob', tags: ['dot'] },
    { id: 'g_wail', name: '怨灵', tier: '二阶', hp: 110, atk: 22, def: 6, rank: 'mob', tags: ['dot'] },
  ],
  elites: [
    { id: 'g_horse', name: '无头骑士', tier: '三阶', hp: 340, atk: 40, def: 18, rank: 'elite', tags: ['charge'] },
    { id: 'g_officer', name: '亡灵将官', tier: '三阶', hp: 300, atk: 46, def: 14, rank: 'elite', tags: ['summon'] },
  ],
  boss: { id: 'gb_marshal', name: '枯骨统帅·无尽亡灵将军', tier: '四阶', hp: 1600, atk: 62, def: 26, rank: 'boss', tags: ['summon', 'hpLock', 'dot'] },
  battleLoot: 'abyss_battle', eliteLoot: 'abyss_elite', treasureLoot: 'abyss_treasure', bossLoot: 'abyss_boss',
};

/* ── 渊龙底（第 3 险地·古龙残骸/兽潮） ── */
const YUANLONGDI: BiomeData = {
  name: '渊龙底', zoneBoss: '极寒渊龙先祖',
  mobs: [
    { id: 'y_hatch', name: '渊龙幼体', tier: '三阶', hp: 200, atk: 34, def: 14, rank: 'mob', tags: ['control'] },
    { id: 'y_golem', name: '龙骸傀儡', tier: '三阶', hp: 300, atk: 30, def: 24, rank: 'mob', tags: ['shield'] },
    { id: 'y_swarm', name: '深渊兽群', tier: '三阶', hp: 160, atk: 40, def: 8, rank: 'mob', tags: ['aoe'] },
  ],
  elites: [
    { id: 'y_frost', name: '极寒龙裔', tier: '四阶', hp: 520, atk: 58, def: 30, rank: 'elite', tags: ['control', 'charge'] },
    { id: 'y_rage', name: '狂暴渊兽', tier: '四阶', hp: 600, atk: 66, def: 20, rank: 'elite', tags: ['charge'] },
  ],
  boss: { id: 'yb_frostlord', name: '极寒渊龙先祖', tier: '五阶', hp: 2600, atk: 88, def: 40, rank: 'boss', tags: ['control', 'charge', 'domain'] },
  battleLoot: 'abyss_battle', eliteLoot: 'abyss_elite', treasureLoot: 'abyss_treasure', bossLoot: 'abyss_boss',
};

/* ── 死亡屋（第 4 险地·陷阱/诅咒/黑暗神教） ── */
const SIWANGWU: BiomeData = {
  name: '死亡屋', zoneBoss: '黑暗神教主教·死亡屋主',
  mobs: [
    { id: 's_doll', name: '诅咒人偶', tier: '四阶', hp: 280, atk: 50, def: 16, rank: 'mob', tags: ['curse'] },
    { id: 's_flesh', name: '血肉缝合体', tier: '四阶', hp: 420, atk: 46, def: 22, rank: 'mob', tags: ['shield'] },
    { id: 's_shadow', name: '影魔', tier: '四阶', hp: 240, atk: 60, def: 10, rank: 'mob', tags: ['dot'] },
  ],
  elites: [
    { id: 's_plague', name: '瘟疫使徒', tier: '五阶', hp: 760, atk: 78, def: 30, rank: 'elite', tags: ['curse', 'dot'] },
    { id: 's_keeper', name: '死亡屋管理者', tier: '五阶', hp: 900, atk: 72, def: 40, rank: 'elite', tags: ['shield', 'curse'] },
  ],
  boss: { id: 'sb_bishop', name: '黑暗神教主教·死亡屋主', tier: '六阶', hp: 4200, atk: 118, def: 54, rank: 'boss', tags: ['curse', 'phase', 'summon'] },
  battleLoot: 'abyss_battle', eliteLoot: 'abyss_elite', treasureLoot: 'abyss_treasure', bossLoot: 'abyss_boss',
};

/* ── 界之底（第 5 险地·界外存在/原罪物巢穴·终局） ── */
const JIEZHIDI: BiomeData = {
  name: '界之底', zoneBoss: '深渊先王眷属',
  mobs: [
    { id: 'j_tentacle', name: '界外触手', tier: '五阶', hp: 500, atk: 84, def: 26, rank: 'mob', tags: ['aoe'] },
    { id: 'j_priest', name: '深渊祭司', tier: '五阶', hp: 420, atk: 96, def: 20, rank: 'mob', tags: ['summon', 'curse'] },
    { id: 'j_sin', name: '原罪具现', tier: '五阶', hp: 600, atk: 90, def: 34, rank: 'mob', tags: ['pollute'] },
  ],
  elites: [
    { id: 'j_rune', name: '卢恩家族战狂', tier: '六阶', hp: 1500, atk: 150, def: 70, rank: 'elite', tags: ['charge', 'aoe'] },
    { id: 'j_herald', name: '先王眷属', tier: '六阶', hp: 1300, atk: 140, def: 60, rank: 'elite', tags: ['domain', 'summon'] },
  ],
  boss: { id: 'jb_forekin', name: '深渊先王眷属', tier: '七阶', hp: 9000, atk: 210, def: 90, rank: 'boss', tags: ['domain', 'summon', 'hpLock', 'charge'] },
  battleLoot: 'abyss_battle', eliteLoot: 'abyss_elite', treasureLoot: 'abyss_treasure', bossLoot: 'abyss_boss',
};

export const ABYSS_BIOMES: BiomeData[] = [HEIYUAN, GUZHANCHANG, YUANLONGDI, SIWANGWU, JIEZHIDI];

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
  abyss_battle: [
    { weight: 40, loot: () => material('腐蚀结晶碎屑', 1 + Math.floor(Math.random() * 2)) },
    { weight: 30, loot: () => material('渊兽残骸', 1) },
    { weight: 18, loot: () => gear('污浊短刃', '武器', pickG(GRADES_LOW), '攻击力小幅提升，附带轻微腐蚀') },
    { weight: 12, loot: () => gear('渊皮护腕', '防具', pickG(GRADES_LOW), '防御力小幅提升') },
  ],
  abyss_elite: [
    { weight: 35, loot: () => gear('腐渊战刃', '武器', pickG(GRADES_MID), '攻击力提升，斩击附带流血') },
    { weight: 30, loot: () => gear('污泥重甲', '防具', pickG(GRADES_MID), '防御力显著提升') },
    { weight: 20, loot: () => material('深渊强化石', 1) },
    { weight: 15, loot: () => gear('堕者之戒', '饰品', pickG(GRADES_MID), '腐蚀越高，攻击越强') },
  ],
  abyss_treasure: [
    { weight: 30, loot: () => gear('封存利器', '武器', pickG(GRADES_MID), '尘封已久的深渊兵器') },
    { weight: 30, loot: () => gear('封存护具', '防具', pickG(GRADES_MID), '尘封已久的深渊护甲') },
    { weight: 25, loot: () => material('深渊打孔石', 1) },
    { weight: 15, loot: () => material('深渊宝石原矿', 1) },
  ],
  abyss_boss: [
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

/* ════════ M2：加成卡 API 生成支撑 ════════ */
export const BOON_SCHOOLS: BoonSchool[] = ['corruption', 'martial', 'guard', 'undead', 'domain', 'gambler'];
export const BOON_PRIM_LIST: BoonPrim[] = ['atk%', 'crit', 'aoe', 'addDoT', 'corruptionToDmg', 'lifesteal', 'def%', 'shieldOnHit', 'hp%', 'summonN', 'domain', 'heal'];
export const BOON_PRIM_LABELS: Record<BoonPrim, string> = {
  'atk%': '攻击提升', crit: '暴击', aoe: '群体杀伤', addDoT: '持续伤害', corruptionToDmg: '腐蚀转伤害',
  lifesteal: '吸血', 'def%': '防御提升', shieldOnHit: '受击护盾', 'hp%': '生命上限', summonN: '召唤强化', domain: '领域笼罩', heal: '即时回复',
};
export const BOON_TIER_MUL: Record<BoonTier, number> = { low: 0.6, mid: 1, high: 1.7 };
/** 每个原语在「mid 档·层深 1」的基础数值 + 落到哪个 apply 字段（auto-resolve 口径；完整机制随 CombatPanel 复用补）。 */
export const BOON_PRIM_BASE: Record<BoonPrim, { field: keyof BoonApply; base: number }> = {
  'atk%': { field: 'atkMult', base: 0.14 },
  crit: { field: 'atkMult', base: 0.10 },
  aoe: { field: 'atkMult', base: 0.09 },
  addDoT: { field: 'atkMult', base: 0.08 },
  corruptionToDmg: { field: 'atkMult', base: 0.12 },
  lifesteal: { field: 'lifesteal', base: 0.06 },
  'def%': { field: 'defMult', base: 0.16 },
  shieldOnHit: { field: 'defMult', base: 0.10 },
  'hp%': { field: 'hpMult', base: 0.16 },
  summonN: { field: 'hpMult', base: 0.10 },
  domain: { field: 'atkMult', base: 0.10 },   // 领域：引擎特判，attack+defense 各半
  heal: { field: 'heal', base: 0.25 },
};

/* ════════ M2：随机原罪物 SinTemplate 抽取源 ════════ */
export type SinAttrKey = 'str' | 'agi' | 'con' | 'int' | 'cha' | 'luck';
export interface SinTypeDef { category: string; subs: string[]; primary: SinAttrKey[]; }
export const SIN_TYPES: SinTypeDef[] = [
  { category: '武器', subs: ['噬主之刃', '断罪巨斧', '渊蛇软鞭', '腐骨长矛', '碎魂战镰'], primary: ['str', 'agi'] },
  { category: '防具', subs: ['母体甲壳', '怨魂披风', '腐皮重铠', '渊铁胸甲'], primary: ['con'] },
  { category: '饰品', subs: ['死灵指环', '低语颅骨', '原罪之眼', '堕者徽记'], primary: ['int', 'luck'] },
];
export const SIN_ACTIVE_POOL: { id: string; tag: string }[] = [
  { id: 'rend', tag: '范围斩击+流血' },
  { id: 'devour', tag: '噬血重击并回复生命' },
  { id: 'curse_burst', tag: '诅咒爆发（腐蚀转化为伤害）' },
  { id: 'summon_wraith', tag: '召唤怨魂助战' },
  { id: 'domain_corrupt', tag: '展开腐蚀领域，持续侵蚀全场' },
];
export const SIN_PASSIVE_POOL: { id: string; tag: string }[] = [
  { id: 'corruption_power', tag: '腐蚀越高，攻击越强' },
  { id: 'lifedrain', tag: '攻击吸取生命' },
  { id: 'ironflesh', tag: '受击时生成护盾' },
  { id: 'undying_will', tag: '濒死时保底不倒（限次）' },
  { id: 'crit_up', tag: '暴击率显著提升' },
];
export const SIN_CURSE_POOL: { id: string; tag: string }[] = [
  { id: 'hp_drain', tag: '每回合自损生命并增加腐蚀' },
  { id: 'ep_burn', tag: '每回合灼烧法力' },
  { id: 'fragile', tag: '防御被侵蚀而下降' },
  { id: 'corruption_creep', tag: '持有期间持续积累腐蚀' },
];
/** 品级按「层深 + 腐蚀」打分映射（由低到高，对齐 itemStore gradeDesc）。 */
export const SIN_QUALITY_LADDER = ['紫色', '暗紫色', '淡金', '金色', '暗金', '传说级', '史诗级'];

/* ════════ M2：堕落星图（meta 永久树，§3.2）——堕落结晶解锁，影响每局起手/加成池 ════════ */
export type StarBranch = 'core' | 'martial' | 'guard' | 'corruption' | 'common';
export interface StarEffect {
  startAtkMul?: number;     // 起始攻击 +%
  startDefMul?: number;     // 起始防御 +%
  startHpMul?: number;      // 起始生命上限 +%
  berserkReduce?: number;   // 失控概率 ×(1-x)（失控缓和）
  crystalMul?: number;      // 堕落结晶产出 +%
  extraBoon?: boolean;      // 战后三选一 → 四选一
  boonWeight?: BoonSchool;  // 加成卡池偏向该流派
  startBoon?: BoonSchool;   // 开局白送一张该流派加成
}
export interface StarNode {
  id: string; name: string; desc: string;
  cost: number;             // 堕落结晶
  branch: StarBranch;
  prereq?: string[];        // 需先解锁的节点
  eff: StarEffect;
}
export const ABYSS_STARMAP: StarNode[] = [
  { id: 'core', name: '深渊烙印', desc: '点亮星图核心，生命上限 +5%', cost: 2, branch: 'core', eff: { startHpMul: 0.05 } },
  // 武道分支
  { id: 'm1', name: '渊刃', desc: '起始攻击 +8%，加成卡偏向武道', cost: 3, branch: 'martial', prereq: ['core'], eff: { startAtkMul: 0.08, boonWeight: 'martial' } },
  { id: 'm2', name: '嗜杀', desc: '起始攻击 +12%，开局白送一张武道加成', cost: 6, branch: 'martial', prereq: ['m1'], eff: { startAtkMul: 0.12, startBoon: 'martial' } },
  // 守护分支
  { id: 'g1', name: '渊盾', desc: '起始防御 +10%，加成卡偏向守护', cost: 3, branch: 'guard', prereq: ['core'], eff: { startDefMul: 0.10, boonWeight: 'guard' } },
  { id: 'g2', name: '不朽躯壳', desc: '起始生命上限 +15%，开局白送一张守护加成', cost: 6, branch: 'guard', prereq: ['g1'], eff: { startHpMul: 0.15, startBoon: 'guard' } },
  // 腐蚀分支
  { id: 'c1', name: '神智安抚', desc: '失控概率 -40%', cost: 3, branch: 'corruption', prereq: ['core'], eff: { berserkReduce: 0.4 } },
  { id: 'c2', name: '噬力', desc: '加成卡偏向腐蚀，开局白送一张腐蚀加成', cost: 6, branch: 'corruption', prereq: ['c1'], eff: { boonWeight: 'corruption', startBoon: 'corruption' } },
  { id: 'c3', name: '魔化精通', desc: '起始攻击 +10%（强化堕落形态流）', cost: 8, branch: 'corruption', prereq: ['c2'], eff: { startAtkMul: 0.10 } },
  // 通用分支
  { id: 'u1', name: '探渊者', desc: '堕落结晶产出 +30%', cost: 4, branch: 'common', prereq: ['core'], eff: { crystalMul: 0.30 } },
  { id: 'u2', name: '深渊馈赠', desc: '战后加成改为四选一', cost: 8, branch: 'common', prereq: ['u1'], eff: { extraBoon: true } },
];
export const STAR_BRANCH_LABEL: Record<StarBranch, string> = {
  core: '核心', martial: '⚔武道', guard: '🛡守护', corruption: '🩸腐蚀', common: '🌑通用',
};

