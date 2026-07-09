/*
  轨道A · 离场角色自治引擎（零 API）
  ────────────────────────────────────────────────────────────────
  每回合 runNpcAutonomy(turn)：对「离场·有真名·未死」NPC 跑确定性模拟，产出经历(deedLog)、
  相位(auto)、关系(relations)、成长(realm/attrs)，全程不调 API。按 npcTag 分流：
    · 契约者/默认 → 双相循环「任务世界 ↔ 主神空间」(decideContractorTick)
    · 土著(native) → 留在故土过本地生活(decideNativeTick)，绝不碰乐园术语
  档A：关系网双向 + 复仇定向 + 公平轮换 + war/trial 触发。
  档B：档内有界成长(boundedGrowth·按 ATTR_CAP_BY_TIER 封顶不越档) + 陨落(npcAutonomyDeath 子开关)。
  档C(2026-06-20)：① 竞技场战力加权(arenaWinProb·治"一阶赢五阶") ② NPC-NPC 真联动(配对对决/组队/
    部族结盟，一次结算双方都受影响) ③ war/trial 差异化结算(胜→强成长·败→高死亡率)。
  安全：仅离场 NPC、不碰主角；致死护 好友/羁绊/长留/队友。
*/
import { useNpc, hasRealNpcName, type NpcRecord, type NpcAuto, type NpcOwnedItem } from '../store/npcStore';
import { useCharacters, type Deed, type Skill, type Talent } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import {
  pickDeed, seedFrom, behaviorBiasFor, makeRng, pickFrom, getCorpus, hashStr,
  type DeedCtx, type DeedEvent,
} from './autonomyCorpus';
import { attrCapForTier, ratioOf, computeMaxHp, computeMaxEp, npcBaseAttrs } from './derivedStats';

const MAX_TICKS_PER_TURN = 16;
const CADENCE = 3;                          // 背景离场 NPC 分 3 组轮流
const MISSION_MIN = 2, MISSION_SPAN = 3;
const HUB_REST_MIN = 1, HUB_REST_SPAN = 1;
const IDLE_WEIGHT = 1.3;
const NATIVE_IDLE = 0.45;
const WAR_CHANCE = 0.05, TRIAL_CHANCE = 0.05;
const DEATH_CHANCE = 0.3;                    // 普通 E 级致死率（war/trial 更高，见 missionSettle）
const PAIR_CHANCE = 0.45;                    // 一对同类 hub NPC 触发联动的概率
const MAX_AUTO_GEAR = 8;                     // 单 NPC 自治获得装备总量上限（防长局囤积；消耗品/物资不计）
const ATTR_KEYS = ['str', 'agi', 'con', 'int', 'cha'] as const;
const TIER_NAMES = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶'];

const HUB_TABLE: ReadonlyArray<{ action: string; biasKey: string; event?: DeedEvent }> = [
  { action: 'mission', biasKey: 'mission' },
  { action: 'arena', biasKey: 'arena' },
  { action: 'feud', biasKey: 'arena', event: 'feud' },
  { action: 'enhance', biasKey: 'enhance', event: 'enhance' },
  { action: 'repair', biasKey: 'enhance', event: 'repair' },
  { action: 'trade', biasKey: 'trade', event: 'trade' },
  { action: 'team', biasKey: 'team', event: 'team_join' },
  { action: 'bounty', biasKey: 'bounty', event: 'bounty' },
  { action: 'study', biasKey: 'study', event: 'study' },
  { action: 'acquire', biasKey: 'study', event: 'acquire' },
  { action: 'leisure', biasKey: 'leisure', event: 'leisure' },
  { action: 'socialize', biasKey: 'social', event: 'socialize' },
  { action: 'joy', biasKey: 'leisure', event: 'joy' },
  { action: 'black_market', biasKey: 'trade', event: 'black_market' },
  { action: 'mentor', biasKey: 'team', event: 'mentor' },
  { action: 'brand', biasKey: 'trade', event: 'brand' },
  { action: 'bloodline', biasKey: 'study', event: 'bloodline' },
  { action: 'barrier_break', biasKey: 'study', event: 'barrier_break' },
  { action: 'title_smelt', biasKey: 'enhance', event: 'title_smelt' },
  { action: 'casino', biasKey: 'casino', event: 'casino' },
  { action: 'heal', biasKey: 'heal', event: 'heal' },
];

const NATIVE_EVENTS: readonly DeedEvent[] = [
  'native_daily', 'native_survive', 'native_outsider', 'native_power',
  'native_rumor', 'native_trade', 'native_strife', 'native_train', 'native_event',
  'native_kin', 'native_festival', 'native_clan',
  'native_craft', 'native_worship', 'native_hunt', 'native_journey', 'native_legend',
];
// 土著成长事件：苦练/扬名/展力/狩猎中六维微涨
const NATIVE_GROW_EVENTS = new Set<DeedEvent>(['native_train', 'native_legend', 'native_power', 'native_hunt']);

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

interface RelationFx { otherName: string; label: string; }
/** 真实获得：写进 NPC 物品/技能/天赋栏（显示在面板） */
export interface TickGrant { equip?: NpcOwnedItem; skill?: Omit<Skill, 'addedAt'>; talent?: Omit<Talent, 'addedAt'>; }
export interface TickOutcome {
  deed?: Deed; patch?: Partial<NpcRecord>; relation?: RelationFx; grant?: TickGrant;
  consume?: { itemId: string };                                  // 消耗一件物品（数量-1）
  itemPatch?: { itemId: string; patch: Partial<NpcOwnedItem> };  // 改一件物品（损坏/修复）
  drop?: number;                                                 // 陨落时丢失的物品数
}
export interface TickOpts { allowDeath?: boolean; }

function mkDeed(turn: number, location: string, description: string): Deed {
  return { time: `第${turn}回合`, location, description, addedAt: Date.now() };
}
function tierNum(npc: NpcRecord): number {
  const m = /T(\d)/i.exec(npc.bioStrength ?? '');
  return m ? Number(m[1]) : 3;
}
function realmTier(npc: NpcRecord): number {
  const m = /([一二三四五六七八九])阶/.exec(npc.realm ?? '');
  return m ? (CN_NUM[m[1]] ?? 3) : tierNum(npc);
}
/** 战力档（0~9+）：取 realm 阶位与 bioStrength T 档的较高者 */
export function powerOf(npc: NpcRecord): number {
  return Math.max(realmTier(npc), tierNum(npc));
}
/** 竞技胜率：战力差经 logistic 映射。同档≈0.5，每差一档显著拉开。治"一阶赢五阶"。 */
export function arenaWinProb(self: number, opp: number): number {
  return 1 / (1 + Math.exp(-(self - opp) * 0.6));
}

function rollRating(rng: () => number, npc: NpcRecord): string {
  const margin = tierNum(npc) - Math.floor(rng() * 10) + (rng() * 4 - 2);
  if (margin >= 5) return 'SSS';
  if (margin >= 4) return 'SS';
  if (margin >= 2.5) return 'S';
  if (margin >= 1) return 'A';
  if (margin >= -0.5) return 'B';
  if (margin >= -2) return 'C';
  if (margin >= -3.5) return 'D';
  return 'E';
}
/** 职业归类关键词表：NPC 的 profession/unitType 文本 → 职业库键 */
const PROF_KEYS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // 细分优先（含 法/战士/骑士/兽/咒/剑/刀/元素 等通用字，须排在通用职业前避免误判）
  ['魔剑士', ['魔剑', '附魔剑', '法剑', '魔战士']],
  ['刀客', ['刀客', '刀法', '刀修', '刀手', '刀魔', '用刀', '拔刀']],
  ['毒师', ['毒师', '毒医', '用毒', '下毒', '毒修', '百毒']],
  ['幻术师', ['幻术', '幻师', '幻修', '迷幻', '梦境']],
  ['蛊师', ['蛊师', '蛊术', '养蛊', '巫蛊', '下蛊']],
  ['死亡骑士', ['死亡骑士', '死骑', '亡灵骑士', '冥骑', '符文骑士']],
  ['猎魔人', ['猎魔', '狩魔', '巫师猎人', '怪物猎人']],
  ['审判官', ['审判官', '审判者', '裁决官', '宗教裁判', '圣裁官']],
  ['元素使', ['元素']],
  ['时空法师', ['时空', '时间法师', '空间法师', '时之子']],
  ['术士', ['术士', '邪术', '巫术', '恶魔法师']],
  ['龙骑士', ['龙骑', '龙枪', '驭龙', '御龙', '屠龙']],
  ['武魂师', ['武魂', '魂师', '魂技', '魂环']],
  ['死神', ['死神', '镰刀', '收割者', '夺魂']],
  ['灵植师', ['灵植', '植灵', '草木', '木灵师']],
  ['占卜师', ['占卜', '卜算', '预言', '星象师', '命师']],
  ['盗贼', ['盗贼', '盗', '飞贼', '游荡者', '窃贼']],
  ['舞者', ['舞者', '舞姬', '战舞', '歌舞', '舞娘']],
  ['画师', ['画师', '丹青', '画修', '画灵']],
  ['死灵法师', ['死灵', '亡灵', '尸', '骸骨']],
  ['阵法师', ['阵法', '阵师', '布阵', '阵纹']],
  ['符咒师', ['符咒', '符箓', '符师', '咒术', '咒师', '画符']],
  ['炼丹师', ['炼丹', '丹师', '丹修', '丹道', '药师', '制药']],
  ['炼器师', ['炼器', '器师', '锻造', '铸器', '铭文', '锻师']],
  ['傀儡师', ['傀儡', '偃甲', '操偶', '机关师']],
  ['御兽师', ['御兽', '驭兽', '灵兽', '驯兽', '兽师', '宠物', '驭灵', '牧兽']],
  ['圣骑士', ['圣骑', '圣堂', '圣殿', '圣武']],
  ['狂战士', ['狂战', '狂暴', '蛮战', '野蛮', '狂乱']],
  ['吟游诗人', ['吟游', '诗人', '乐师', '琴师', '歌姬']],
  ['德鲁伊', ['德鲁伊', '德鲁', '自然', '变形者']],
  ['萨满', ['萨满', '图腾', '巫医', '祭灵']],
  // 通用职业
  ['剑士', ['剑', '刀', '武士', '侍']],
  ['枪手', ['枪', '铳', '狙', '炮手', '枪械']],
  ['法师', ['法', '术', '魔', '咒', '元素']],
  ['拳师', ['拳', '武者', '格斗', '体术', '武僧', '搏击']],
  ['弓手', ['弓', '箭', '游侠', '弩']],
  ['刺客', ['刺', '暗杀', '影', '杀手', '忍']],
  ['重装', ['重装', '坦', '盾', '守卫', '骑士', '战士']],
  ['异能者', ['异能', '超能', '念力', '精神', '超能力']],
  ['召唤师', ['召唤', '契灵', '通灵', '唤灵']],
  ['治疗', ['治疗', '医', '辅助', '牧', '祭司']],
  ['血族', ['血族', '吸血', '血裔']],
  ['机械师', ['机械', '工程', '机师', '炮兵', '改造']],
];
/** 把 NPC 的 职业/类型 文本归类到职业库键；无命中回退「通用」。export 供测试。 */
export function profKey(npc: NpcRecord): string {
  const p = (npc.profession ?? '') + (npc.unitType ?? '');
  for (const [k, kws] of PROF_KEYS) if (kws.some((w) => p.includes(w))) return k;
  return '通用';
}
/** 装备名：优先真实已装备物品，否则按职业组合生成（共享前缀 × 职业词根，治"随身装备"占位） */
/** 按职业组合一件装备（前缀×职业武器/防具/饰品词根），返回名称+类别+槽位 */
function composeEquip(npc: NpcRecord, rng: () => number): { name: string; category: string; slot: string } {
  const b = getCorpus().banks;
  const g = b.profGear?.[profKey(npc)] ?? b.profGear?.['通用'];
  const pre = b.gearPrefix?.length ? pickFrom(rng, b.gearPrefix) : '';
  const roll = rng();
  if (roll < 0.78 && g?.weapon?.length) return { name: pre + pickFrom(rng, g.weapon), category: '武器', slot: '武器' };
  if (roll < 0.92 && b.armorCore?.length) return { name: pre + pickFrom(rng, b.armorCore), category: '防具', slot: '防具' };
  if (b.accessoryCore?.length) return { name: pre + pickFrom(rng, b.accessoryCore), category: '饰品', slot: '饰品' };
  return { name: b.equipment?.length ? pre + pickFrom(rng, b.equipment) : '随身装备', category: '武器', slot: '武器' };
}
function genEquip(npc: NpcRecord, rng: () => number): string {
  return (npc.items ?? []).find((it) => it.equipped)?.name || composeEquip(npc, rng).name;
}
/** 技能/天赋名：按职业组合（前缀 × 职业招式词根，或直接取职业天赋全名） */
function genSkill(npc: NpcRecord, rng: () => number): string {
  const b = getCorpus().banks;
  const g = b.profGear?.[profKey(npc)] ?? b.profGear?.['通用'];
  if (g) {
    if (rng() < 0.4 && g.talent?.length) return pickFrom(rng, g.talent);
    if (g.skill?.length) {
      const pre = b.skillPrefix?.length ? pickFrom(rng, b.skillPrefix) : '';
      return pre + pickFrom(rng, g.skill);
    }
  }
  return b.skillTalent?.length ? pickFrom(rng, b.skillTalent) : '一门绝技';
}
/** 取职业天赋全名（用于「觉醒天赋」真获得） */
function genTalentName(npc: NpcRecord, rng: () => number): string {
  const b = getCorpus().banks;
  const g = b.profGear?.[profKey(npc)] ?? b.profGear?.['通用'];
  if (g?.talent?.length) return pickFrom(rng, g.talent);
  return b.skillTalent?.length ? pickFrom(rng, b.skillTalent) : '天赋异禀';
}

const EQUIP_GRADES = ['精良', '稀有', '史诗', '传说'];
const SKILL_RARITY = ['普通', '精良', '稀有', '史诗', '传说', '奥义', '极境'];   // 技能品级(与全局同尺·治旧「人/玄/地」被UI显示成"普通")
const TALENT_RARITY = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];                    // 天赋品级 D~SSS

/* ── 离场历练技能「战斗原型」：确定性合成像样的完整技能（效果/简介/字段），无 API。治"效果=依招式发挥、信息不全"占位垃圾 ── */
type Arch = 'assassin' | 'caster' | 'melee' | 'tank' | 'control' | 'support' | 'summon' | 'ranged';
const ARCH_KW: ReadonlyArray<readonly [Arch, readonly string[]]> = [
  ['assassin', ['刺客', '刀客', '潜杀', '暗杀', '影', '死神', '夜行', '毒', '刺']],
  ['caster', ['法师', '术士', '元素', '时空', '幻', '咒', '符', '魔导', '灵能', '祭司', '巫']],
  ['tank', ['守护', '重甲', '盾', '铁卫', '壁', '骑士']],
  ['control', ['蛊', '缚', '禁', '审判', '控', '傀儡', '结界']],
  ['support', ['医', '牧', '治疗', '灵植', '辅助', '祝福', '祭']],
  ['summon', ['召唤', '驭', '御兽', '龙骑', '武魂', '亡灵', '尸', '傀']],
  ['ranged', ['弓', '射', '枪手', '铳', '狙', '箭', '炮']],
];
function archOf(npc: NpcRecord): Arch {
  const p = (npc.profession ?? '') + (npc.unitType ?? '');
  for (const [a, kws] of ARCH_KW) if (kws.some((w) => p.includes(w))) return a;
  return 'melee';
}
const ARCH_FX: Record<Arch, { verb: string; target: string; dtype: string; riders: readonly string[] }> = {
  assassin: { verb: '自死角欺身、直取要害', target: '单体', dtype: '物理', riders: ['命中要害则暴击并致其流血', '对残血目标伤害显著提升', '得手后瞬身脱离、隐去身形'] },
  caster: { verb: '引动法则、于阵前凝术轰落', target: '范围', dtype: '法术', riders: ['并灼烧/冰封波及之敌', '施法后短暂强化下一道法术', '击中时削其法术抗性'] },
  melee: { verb: '沉腰发力、全力劈斩当面之敌', target: '前方', dtype: '物理', riders: ['末段附加破甲与短暂击退', '连击时最后一击伤害翻涨', '格挡后可立即反击'] },
  tank: { verb: '举盾前压、以身撞阵', target: '前方', dtype: '物理', riders: ['期间大幅减伤并嘲讽近敌', '格挡成功反震伤害', '为己方竖起一道护盾'] },
  control: { verb: '布下术法/毒瘴锁敌', target: '范围', dtype: '异常', riders: ['命中使其定身/沉默数息', '持续侵蚀其生命与神智', '削其行动力与命中'] },
  support: { verb: '运转生机、祝祷加护', target: '己方', dtype: '增益', riders: ['为友军回复生命并解一异常', '短时增幅友军攻防', '为重伤者罩上不灭薄盾'] },
  summon: { verb: '催动契约、唤出战宠助战', target: '召唤', dtype: '召唤', riders: ['召物存续期间代主受伤、协同攻击', '可牺牲召物换取一次爆发', '召物越多则本体越强'] },
  ranged: { verb: '拉满劲弩、凝形远袭', target: '单体', dtype: '物理', riders: ['距离越远伤害越高', '贯穿一线之敌', '命中叠加「标记」、易伤加深'] },
};
const POWER_MAG = ['轻微', '尚可', '可观', '沉重', '骇人', '毁灭性', '法则层面', '近乎无解'];   // idx=clamp(战力,0..7)
function magOf(npc: NpcRecord): string { return POWER_MAG[Math.min(POWER_MAG.length - 1, Math.max(0, powerOf(npc)))]; }
/** 按战力档定品级（弱 NPC→普通/低阶，强 NPC→高阶；±1 抖动） */
function rarityByPower(rng: () => number, npc: NpcRecord, scale: readonly string[]): string {
  const base = Math.min(scale.length - 1, Math.floor(powerOf(npc) / 2));
  const j = base + (rng() < 0.3 ? 1 : 0) - (rng() < 0.3 ? 1 : 0);
  return scale[Math.min(scale.length - 1, Math.max(0, j))];
}

/** 真获得：按职业造一件可写进 NPC 储物栏的装备 */
function makeEquipItem(npc: NpcRecord, rng: () => number, turn: number): NpcOwnedItem {
  const c = composeEquip(npc, rng);
  const slotTaken = (npc.items ?? []).some((it) => it.equipped && it.category === c.category);
  return {
    id: `I_${npc.id}_a${turn}`, name: c.name, category: c.category, gradeDesc: pickFrom(rng, EQUIP_GRADES),
    effect: '六维小幅加成', quantity: 1, equipped: !slotTaken, equipSlot: c.slot, acquisition: '离场历练所得',
    durability: '100/100', addedAt: Date.now(),   // 自动换装（同类无已装备则穿上）+ 满耐久
  };
}
/** 真获得：消耗品（可堆叠） */
function makeConsumable(npc: NpcRecord, rng: () => number, turn: number): NpcOwnedItem {
  const b = getCorpus().banks;
  return {
    id: `I_${npc.id}_c${turn}`, name: b.consumable?.length ? pickFrom(rng, b.consumable) : '恢复药剂',
    category: '消耗品', gradeDesc: pickFrom(rng, ['普通', '精良', '稀有']), effect: '使用后恢复/增益',
    quantity: 2 + Math.floor(rng() * 3), equipped: false, acquisition: '离场历练所得', addedAt: Date.now(),
  };
}
/** 土著本地物资 */
function makeNativeGood(npc: NpcRecord, rng: () => number, turn: number): NpcOwnedItem {
  const b = getCorpus().banks;
  return {
    id: `I_${npc.id}_n${turn}`, name: b.nativeGoods?.length ? pickFrom(rng, b.nativeGoods) : '山货',
    category: '物资', gradeDesc: '普通', effect: '本地物产',
    quantity: 1 + Math.floor(rng() * 3), equipped: false, acquisition: '故土所得', addedAt: Date.now(),
  };
}
/** 真获得：按职业造一门可写进 NPC 技能栏的技能 */
function makeSkill(npc: NpcRecord, rng: () => number, turn: number): Omit<Skill, 'addedAt'> {
  const a = ARCH_FX[archOf(npc)];
  const mag = magOf(npc);
  const name = genSkill(npc, rng);
  return {
    id: `S_${npc.id}_a${turn}`, name, level: '初窥·Lv.1', skillType: '主动',
    rarity: rarityByPower(rng, npc, SKILL_RARITY),
    target: a.target, cost: '少量气力/法力', cooldown: '短', damage: `${mag}·${a.dtype}`,
    effect: `${a.verb}，对${a.target}造成${mag}的${a.dtype}伤害；${pickFrom(rng, a.riders)}。`,
    desc: `${npc.profession || '历练者'}于离场历练中打磨成型的${a.dtype}招式。`,
    tags: [a.dtype, '离场历练'],
  } as Omit<Skill, 'addedAt'>;
}
/** 真获得：按职业造一项可写进 NPC 天赋栏的天赋 */
function makeTalent(npc: NpcRecord, rng: () => number): Omit<Talent, 'addedAt'> {
  const a = ARCH_FX[archOf(npc)];
  const passive = a.dtype === '增益' ? '常驻增幅己身机能' : `令其${a.dtype}路数化为本能`;
  return {
    name: genTalentName(npc, rng),
    rarity: rarityByPower(rng, npc, TALENT_RARITY), source: '离场历练·顿悟', category: '特殊异能类',
    effect: `被动：${passive}——${pickFrom(rng, a.riders)}（威力档：${magOf(npc)}）。`,
    desc: `历练中觉醒的天赋，与其${npc.profession || '战斗'}路数相合。`,
  } as Omit<Talent, 'addedAt'>;
}

export function homeParadise(id: string): string {
  const bank = getCorpus().banks.paradise;
  return bank?.length ? bank[hashStr(id) % bank.length] : '';
}

const isProtected = (n: NpcRecord) => !!(n.isFriend || n.isBond || n.keepForever || n.partyMember);

function npcTierName(npc: NpcRecord): string | undefined {
  return /([一二三四五六七八九]阶|绝强|至强|巅峰至强|无上之境)/.exec(npc.realm ?? '')?.[1];
}
function npcLevel(npc: NpcRecord): number | undefined {
  const m = /Lv\.?\s*(\d+)/i.exec(npc.realm ?? '');
  return m ? Number(m[1]) : undefined;
}

/** 档内有界成长：涨 Lv(不越当前阶)+微调六维(attrCapForTier 按档封顶)。无变化返回空对象。 */
export function boundedGrowth(npc: NpcRecord, rng: () => number, opts: { levelUp?: boolean; attrGain?: number }): Partial<NpcRecord> {
  const out: Partial<NpcRecord> = {};
  const tierName = npcTierName(npc);
  const lv = npcLevel(npc);
  if (opts.levelUp && lv != null) {
    const ti = (TIER_NAMES.indexOf(tierName ?? '') + 1) || Math.ceil(lv / 10);
    const newLv = Math.min(lv + 1, ti * 10);
    if (newLv !== lv) out.realm = (npc.realm ?? '').replace(/Lv\.?\s*\d+/i, `Lv.${newLv}`);
  }
  if (opts.attrGain && npc.attrs) {
    const cap = attrCapForTier(tierName, lv);
    const next = { ...npc.attrs };
    let changed = false;
    for (let i = 0; i < opts.attrGain; i++) {
      const k = ATTR_KEYS[Math.floor(rng() * ATTR_KEYS.length)];
      const v = Math.min((next[k] ?? 0) + 1, cap);
      if (v !== next[k]) { next[k] = v; changed = true; }
    }
    if (changed) {
      out.attrs = next;
      // HP/EP 上限随六维重算（多属性系数表，默认 体×20 / 智×15，尊重 NPC 自定义）；只抬上限，不补血
      const r = ratioOf(npc);
      const nb = npcBaseAttrs({ attrs: next, realAttrs: npc.realAttrs });   // 进化后的基础六维 + 真实属性点直加(realAttrs)
      out.maxHp = computeMaxHp(nb, 1, r);
      out.maxMp = computeMaxEp(nb, 1, r);
    }
  }
  return out;
}

function pickHubAction(rng: () => number, npc: NpcRecord): { action: string; event?: DeedEvent } | null {
  const bias = behaviorBiasFor(npc.personality);
  const weighted = HUB_TABLE.map((t) => ({ t, w: Math.max(0, bias[t.biasKey] ?? 1) }));
  const total = weighted.reduce((a, b) => a + b.w, 0) + IDLE_WEIGHT;
  let r = rng() * total;
  if ((r -= IDLE_WEIGHT) < 0) return null;
  for (const x of weighted) if ((r -= x.w) < 0) return { action: x.t.action, event: x.t.event };
  return null;
}

export function addRelation(rel: string | undefined, name: string, label: string): string {
  const kept = (rel ?? '')
    .split(/[;；]/).map((s) => s.trim()).filter(Boolean)
    .filter((e) => e.split(/[:：]/)[0]?.trim() !== name);
  kept.push(`${name}:${label}`);
  return kept.join(';');
}
export function findRival(npc: NpcRecord, peers: string[]): string | undefined {
  const rel = npc.relations ?? '';
  return peers.find((name) => rel.includes(`${name}:宿敌`) || rel.includes(`${name}：宿敌`));
}
function pickEnemy(rng: () => number, npc: NpcRecord, peers: string[]): string | null {
  if (!peers.length) return null;
  const rival = findRival(npc, peers);
  return rival && rng() < 0.6 ? rival : pickFrom(rng, peers);
}

const missionStatus = (world?: string) => `执行任务中（${world || '任务世界'}）`;
const isNative = (npc: NpcRecord) => npc.npcTag === '土著';

/** 试炼晋阶：阶位 +1（唯一不越档例外·仅 SS+ 通过试炼触发）。九阶封顶/无法解析返回 undefined。 */
function promoteRealm(npc: NpcRecord): string | undefined {
  const cur = npcTierName(npc);
  if (!cur) return undefined;
  const i = TIER_NAMES.indexOf(cur);
  if (i < 0 || i + 1 >= TIER_NAMES.length) return undefined;   // 九阶封顶
  const next = TIER_NAMES[i + 1];
  const newLv = (i + 1) * 10 + 1;                              // 新阶底部等级
  let r = npc.realm ?? '';
  r = r.includes(cur) ? r.replace(cur, next) : (r ? `${next}·${r}` : next);
  r = /Lv\.?\s*\d+/i.test(r) ? r.replace(/Lv\.?\s*\d+/i, `Lv.${newLv}`) : `${r}·Lv.${newLv}`;
  return r;
}

/** 任务归来结算：陨落 + 成长 + war/trial 差异化。普通 E 致死 0.3；war/trial 致死 D|E 共 0.4。 */
function missionSettle(npc: NpcRecord, world: string | undefined, rating: string, rng: () => number, txtSeed: number, opts: TickOpts, turn: number, base: DeedCtx): TickOutcome {
  const isWar = world === '世界争夺战', isTrial = world === '试炼世界';
  const lethal = isWar || isTrial ? (rating === 'E' || rating === 'D') : rating === 'E';
  const deathP = isWar || isTrial ? 0.4 : DEATH_CHANCE;
  if (lethal && opts.allowDeath && !isProtected(npc) && rng() < deathP) {
    const dead = pickDeed('mission_death', { ...base, world }, txtSeed);
    return { deed: mkDeed(turn, world ?? '', dead), patch: { isDead: true, deadTurn: turn, status: '已死亡', auto: { phase: 'hub', turns: 0 } }, drop: 1 + (rng() < 0.5 ? 1 : 0) };
  }
  const good = rating === 'S' || rating === 'SS' || rating === 'SSS';
  let event: DeedEvent = 'mission_return';
  let grow: Partial<NpcRecord>;
  let grant: TickGrant | undefined;
  let ctx: DeedCtx = { ...base, world, rating };
  if (isWar) {
    event = good ? 'war_return_win' : 'war_return_loss';
    grow = boundedGrowth(npc, rng, { levelUp: good, attrGain: good ? 2 : 0 });
    if (good) grant = { equip: makeEquipItem(npc, rng, turn) };   // 战利品：胜则必得一件装备
  } else if (isTrial) {
    const pass = good || rating === 'A';
    event = pass ? 'trial_pass' : 'trial_fail';
    grow = boundedGrowth(npc, rng, { levelUp: pass, attrGain: pass ? 1 : 0 });
    // 试炼晋阶：SS/SSS 通过·~35%·唯一不越档例外（官方晋阶考核）
    if ((rating === 'SS' || rating === 'SSS') && rng() < 0.35) {
      const promo = promoteRealm(npc);
      if (promo) { event = 'trial_promote'; grow = { ...grow, realm: promo }; ctx = { ...ctx, realm: promo }; }
    }
  } else {
    grow = boundedGrowth(npc, rng, { levelUp: good, attrGain: rating === 'SSS' ? 2 : rating === 'SS' ? 1 : 0 });
  }
  const desc = pickDeed(event, ctx, txtSeed);
  const rest = HUB_REST_MIN + Math.floor(rng() * (HUB_REST_SPAN + 1));
  return { deed: mkDeed(turn, world ?? '', desc), patch: { auto: { phase: 'hub', turns: rest }, status: '主神空间·休整', ...grow }, grant };
}

/** 入口：按 npcTag 分流 */
export function decideNpcTick(npc: NpcRecord, turn: number, peers: string[] = [], opts: TickOpts = {}): TickOutcome {
  return isNative(npc) ? decideNativeTick(npc, turn, peers, opts) : decideContractorTick(npc, turn, peers, opts);
}

/* ── 契约者：双相循环 ───────────────────────────────────────── */
function decideContractorTick(npc: NpcRecord, turn: number, peers: string[], opts: TickOpts): TickOutcome {
  const auto: NpcAuto = npc.auto ?? { phase: 'hub', turns: 0 };
  const seed = seedFrom(turn, npc.id);
  const rng = makeRng(seed);
  const txtSeed = (seed ^ 0x5bd1e995) >>> 0;
  const base: DeedCtx = { name: npc.name, realm: npc.realm, personality: npc.personality, paradise: homeParadise(npc.id) };

  if (auto.phase === 'mission') {
    const left = auto.turns - 1;
    if (left > 0) return { patch: { auto: { ...auto, turns: left }, status: missionStatus(auto.world) } };
    return missionSettle(npc, auto.world, rollRating(rng, npc), rng, txtSeed, opts, turn, base);
  }

  if (auto.turns > 0 && rng() < 0.7) return { patch: { auto: { ...auto, turns: auto.turns - 1 } } };

  // 随机际遇（小概率·不受性格驱动）：心魔 / 遭遇违规者 / 奇遇横财
  const enc = rng();
  if (enc < 0.09) {
    const ev: DeedEvent = enc < 0.035 ? 'inner_demon' : enc < 0.065 ? 'encounter_violator' : 'windfall';
    return { deed: mkDeed(turn, '主神空间', pickDeed(ev, base, txtSeed)), patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间' } };
  }
  // 真获得（小概率·写进 NPC 面板）：装备 3% / 消耗品 2% / 技能 2% / 天赋 1%
  if (enc < 0.17) {
    const hub: Partial<NpcRecord> = { auto: { phase: 'hub', turns: 0 }, status: '主神空间' };
    if (enc < 0.12) { const item = makeEquipItem(npc, rng, turn); return { deed: mkDeed(turn, '主神空间', pickDeed('gain_equip', { ...base, item: item.name }, txtSeed)), patch: hub, grant: { equip: item } }; }
    if (enc < 0.14) { const item = makeConsumable(npc, rng, turn); return { deed: mkDeed(turn, '主神空间', pickDeed('gain_consumable', { ...base, item: item.name }, txtSeed)), patch: hub, grant: { equip: item } }; }
    if (enc < 0.16) { const sk = makeSkill(npc, rng, turn); return { deed: mkDeed(turn, '主神空间', pickDeed('gain_skill', { ...base, skill: sk.name }, txtSeed)), patch: hub, grant: { skill: sk } }; }
    const tl = makeTalent(npc, rng); return { deed: mkDeed(turn, '主神空间', pickDeed('gain_talent', { ...base, skill: tl.name }, txtSeed)), patch: hub, grant: { talent: tl } };
  }
  // 装备损坏（小概率·仅当有已装备物品）：标记损坏并卸下，待 repair 修复
  if (enc < 0.195) {
    const eq = (npc.items ?? []).find((it) => it.equipped);
    if (eq) return { deed: mkDeed(turn, '主神空间', pickDeed('equip_break', { ...base, item: eq.name }, txtSeed)), patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间' }, itemPatch: { itemId: eq.id, patch: { durability: '0/100', equipped: false, effect: (eq.effect || '') + '【已损坏】' } } };
  }

  const tier = realmTier(npc);
  if (tier >= 4 && rng() < WAR_CHANCE) {
    const desc = pickDeed('war_world', { ...base, world: '世界争夺战' }, txtSeed);
    return { deed: mkDeed(turn, '世界争夺战', desc), patch: { auto: { phase: 'mission', turns: MISSION_MIN + 2 + Math.floor(rng() * 3), world: '世界争夺战' }, status: missionStatus('世界争夺战') } };
  }
  if (tier >= 3 && rng() < TRIAL_CHANCE) {
    const desc = pickDeed('trial', { ...base, world: '试炼世界' }, txtSeed);
    return { deed: mkDeed(turn, '试炼世界', desc), patch: { auto: { phase: 'mission', turns: MISSION_MIN + Math.floor(rng() * 2), world: '试炼世界' }, status: missionStatus('试炼世界') } };
  }

  const action = pickHubAction(rng, npc);
  if (!action) return { patch: { auto: { phase: 'hub', turns: Math.max(0, auto.turns - 1) } } };

  if (action.action === 'mission') {
    const world = pickFrom(rng, getCorpus().banks.worldTheme);
    const desc = pickDeed('mission_depart', { ...base, world }, txtSeed);
    return { deed: mkDeed(turn, world, desc), patch: { auto: { phase: 'mission', turns: MISSION_MIN + Math.floor(rng() * (MISSION_SPAN + 1)), world }, status: missionStatus(world) } };
  }

  let event = action.event as DeedEvent;
  const ctx: DeedCtx = { ...base };
  let relation: RelationFx | undefined;
  let consume: { itemId: string } | undefined;
  let itemPatch: { itemId: string; patch: Partial<NpcOwnedItem> } | undefined;
  if (action.action === 'arena') {
    const target = pickEnemy(rng, npc, peers);
    // 战力加权：对手取随机挑战者强度，自身越强越易胜（治"一阶赢五阶"）
    const win = rng() < arenaWinProb(powerOf(npc), Math.floor(rng() * 10));
    event = win ? 'arena_win' : 'arena_lose';
    ctx.enemy = target ?? '某位契约者';
    ctx.n = 1 + Math.floor(rng() * 60);
    if (target && rng() < 0.3) relation = { otherName: target, label: '宿敌' };
  } else if (action.action === 'feud') {
    const target = pickEnemy(rng, npc, peers);
    ctx.enemy = target ?? '某位契约者';
    if (target) relation = { otherName: target, label: '宿敌' };
  } else if (action.action === 'team') {
    const target = peers.length ? pickFrom(rng, peers) : null;
    ctx.enemy = target ?? '几名契约者';
    if (target) relation = { otherName: target, label: '盟友' };
  } else if (action.action === 'bounty') {
    ctx.enemy = pickEnemy(rng, npc, peers) ?? '一名违规者';
    ctx.coin = (1 + Math.floor(rng() * 9)) * 1000;
  } else if (action.action === 'enhance') {
    ctx.item = genEquip(npc, rng);
    ctx.coin = (1 + Math.floor(rng() * 9)) * 1000;
    ctx.n = 1 + Math.floor(rng() * 8);
  } else if (action.action === 'trade') {
    ctx.item = rng() < 0.5 ? genEquip(npc, rng) : '一批资源';
  } else if (action.action === 'acquire') {
    ctx.skill = genSkill(npc, rng);
  } else if (action.action === 'socialize' || action.action === 'mentor') {
    if (peers.length) ctx.enemy = pickFrom(rng, peers);
  } else if (action.action === 'heal') {
    const con = (npc.items ?? []).find((it) => it.category === '消耗品' && (it.quantity ?? 0) > 0);
    if (con) { event = 'use_consumable'; ctx.item = con.name; consume = { itemId: con.id }; }   // 有药就服一枚
  } else if (action.action === 'repair') {
    const dmg = (npc.items ?? []).find((it) => (it.durability ?? '').startsWith('0') || (it.effect ?? '').includes('已损坏'));
    ctx.item = dmg?.name ?? genEquip(npc, rng);
    if (dmg) itemPatch = { itemId: dmg.id, patch: { durability: '100/100', equipped: true, effect: (dmg.effect ?? '').replace('【已损坏】', '') || '六维小幅加成' } };
  }
  const desc = pickDeed(event, ctx, txtSeed);
  const grow = (action.action === 'barrier_break' || action.action === 'bloodline')
    ? boundedGrowth(npc, rng, { attrGain: 1 }) : {};
  return { deed: desc ? mkDeed(turn, '主神空间', desc) : undefined, patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间', ...grow }, relation, consume, itemPatch };
}

/* ── 土著：留在故土过本地生活（无相位机·无乐园术语） ──────── */
/** 土著成长：随六维微涨（+1 随机一维，封顶=自身现有最高维，绝不越过既定身份强度）。同步重算 HP/EP 上限。 */
function nativeGrow(npc: NpcRecord, rng: () => number): Partial<NpcRecord> {
  if (!npc.attrs) return {};
  const cap = Math.max(...ATTR_KEYS.map((k) => npc.attrs![k] ?? 0), 1);
  const next = { ...npc.attrs };
  const k = ATTR_KEYS[Math.floor(rng() * ATTR_KEYS.length)];
  const v = Math.min((next[k] ?? 0) + 1, cap);
  if (v === next[k]) return {};
  next[k] = v;
  const out: Partial<NpcRecord> = { attrs: next };
  const r = ratioOf(npc);
  const nb = npcBaseAttrs({ attrs: next, realAttrs: npc.realAttrs });   // 进化后的基础六维 + 真实属性点直加(realAttrs)
  out.maxHp = computeMaxHp(nb, 1, r);   // HP 上限=Σ六维×系数（默认体×20，尊重自定义；只抬上限）
  out.maxMp = computeMaxEp(nb, 1, r);   // EP 上限=Σ六维×系数（默认智×15）
  return out;
}

function decideNativeTick(npc: NpcRecord, turn: number, peers: string[], opts: TickOpts): TickOutcome {
  const seed = seedFrom(turn, npc.id);
  const rng = makeRng(seed);
  const txtSeed = (seed ^ 0x5bd1e995) >>> 0;
  if (rng() < NATIVE_IDLE) return {};
  // 土著偶尔添置本地家当（写进储物，~8%·专属掷骰不靠稀有事件）
  if (rng() < 0.08) {
    const item = makeNativeGood(npc, rng, turn);
    const d = pickDeed('native_gain', { name: npc.name, personality: npc.personality, item: item.name }, txtSeed);
    return d ? { deed: mkDeed(turn, '故土', d), grant: { equip: item } } : {};
  }
  const event = pickFrom(rng, NATIVE_EVENTS as DeedEvent[]);
  const ctx: DeedCtx = { name: npc.name, personality: npc.personality };
  let relation: RelationFx | undefined;
  if (event === 'native_strife') {
    const target = peers.length ? pickFrom(rng, peers) : null;
    ctx.enemy = target ?? '邻人';
    if (target) relation = { otherName: target, label: '宿敌' };
  }
  // 土著陨落：御敌/求生失利可能殒命（需开关 + 非受保护）
  if (event === 'native_survive' && opts.allowDeath && !isProtected(npc) && rng() < 0.12) {
    const dead = pickDeed('native_death', { name: npc.name, personality: npc.personality }, txtSeed);
    return { deed: mkDeed(turn, '故土', dead || `${npc.name} 殒命故土。`), patch: { isDead: true, deadTurn: turn, status: '已死亡' }, drop: 1 };
  }
  // 土著成长：苦练/扬名/狩猎中六维微涨（封顶自身峰值）
  const grow = NATIVE_GROW_EVENTS.has(event) ? nativeGrow(npc, rng) : {};
  const desc = pickDeed(event, ctx, txtSeed);
  return desc ? { deed: mkDeed(turn, '故土', desc), relation, patch: Object.keys(grow).length ? grow : undefined } : {};
}

function score(n: NpcRecord): number {
  return (n.isFriend ? 100 : 0) + (n.isBond ? 50 : 0) + (n.keepForever ? 30 : 0)
    + (n.auto?.phase === 'mission' ? 40 : 0) + (n.updatedAt ?? 0) / 1e13;
}
function isActiveThisTurn(n: NpcRecord, turn: number): boolean {
  return !!(n.isFriend || n.isBond || n.keepForever) || n.auto?.phase === 'mission' || (hashStr(n.id) % CADENCE) === (turn % CADENCE);
}

/** 每回合调用：对离场 NPC 跑一次自治（零 API）。返回本回合新增的经历条数。自带开关守卫。 */
export function runNpcAutonomy(turn: number): number {
  const ss = useSettings.getState();
  if (!ss.npcAutonomyOn) return 0;
  const every = Math.max(1, ss.npcAutonomyEvery ?? 1);
  if (turn % every !== 0) return 0;                   // 每 N 回合才运行一次
  const runIdx = Math.floor(turn / every);            // 轮换计数：按"运行次数"循环，与 every 解耦防只跑一个分组
  const maxTicks = Math.max(1, ss.npcAutonomyMax ?? MAX_TICKS_PER_TURN);
  const store = useNpc.getState();
  const eligible = Object.values(store.npcs).filter((n) => !n.onScene && !n.isDead && hasRealNpcName(n));
  if (!eligible.length) return 0;

  const contractorNames = eligible.filter((n) => !isNative(n)).map((n) => n.name).filter(Boolean);
  const nativeNames = eligible.filter((n) => isNative(n)).map((n) => n.name).filter(Boolean);

  const ranked = eligible.filter((n) => isActiveThisTurn(n, runIdx)).sort((a, b) => score(b) - score(a)).slice(0, maxTicks);

  const acc = new Map<string, { deed?: Deed; patch: Partial<NpcRecord> }>();
  const ensure = (id: string) => { let e = acc.get(id); if (!e) { e = { patch: {} }; acc.set(id, e); } return e; };
  const accSet = (id: string, deed: Deed | undefined, patch: Partial<NpcRecord>) => {
    const e = ensure(id); if (deed) e.deed = deed; Object.assign(e.patch, patch);
  };
  const relAdd = (id: string, name: string, label: string) => {
    const e = ensure(id);
    e.patch.relations = addRelation(e.patch.relations ?? store.npcs[id]?.relations ?? '', name, label);
  };

  // ── 配对联动（档C）：同类 hub NPC 两两配对，一次结算双方都受影响 ──
  const handled = new Set<string>();
  const prng = makeRng(seedFrom(turn, 'pair') >>> 0);
  const ds = () => Math.floor(prng() * 0xffffffff) >>> 0;
  const pairUp = (list: NpcRecord[], native: boolean) => {
    const pool = list.filter((n) => n.auto?.phase !== 'mission' && !handled.has(n.id));
    const shuffled = pool.map((n) => ({ n, k: prng() })).sort((x, y) => x.k - y.k).map((x) => x.n);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      if (prng() > PAIR_CHANCE) continue;
      const a = shuffled[i], b = shuffled[i + 1];
      handled.add(a.id); handled.add(b.id);
      if (native) {
        if (prng() < 0.5) {  // 部族械斗 → 宿敌
          accSet(a.id, mkDeed(turn, '故土', pickDeed('native_strife', { name: a.name, enemy: b.name, personality: a.personality }, ds())), {});
          accSet(b.id, mkDeed(turn, '故土', pickDeed('native_strife', { name: b.name, enemy: a.name, personality: b.personality }, ds())), {});
          relAdd(a.id, b.name, '宿敌'); relAdd(b.id, a.name, '宿敌');
        } else {              // 结盟/联姻 → 盟友
          accSet(a.id, mkDeed(turn, '故土', pickDeed('native_ally', { name: a.name, enemy: b.name }, ds())), {});
          accSet(b.id, mkDeed(turn, '故土', pickDeed('native_ally', { name: b.name, enemy: a.name }, ds())), {});
          relAdd(a.id, b.name, '盟友'); relAdd(b.id, a.name, '盟友');
        }
        continue;
      }
      if (prng() < 0.7) {     // 契约者对决（战力加权）→ 胜者升名次·败者下滑·或结仇
        const aWins = prng() < arenaWinProb(powerOf(a), powerOf(b));
        const W = aWins ? a : b, L = aWins ? b : a;
        accSet(W.id, mkDeed(turn, '竞技场', pickDeed('arena_win', { name: W.name, enemy: L.name, n: 1 + Math.floor(prng() * 30), personality: W.personality, realm: W.realm }, ds())), { status: '主神空间' });
        accSet(L.id, mkDeed(turn, '竞技场', pickDeed('arena_lose', { name: L.name, enemy: W.name, personality: L.personality, realm: L.realm }, ds())), { status: '主神空间' });
        if (prng() < 0.4) { relAdd(W.id, L.name, '宿敌'); relAdd(L.id, W.name, '宿敌'); }
      } else {                // 组队出征 → 双方进同一任务相 + 结盟
        const world = pickFrom(prng, getCorpus().banks.worldTheme);
        const dur = MISSION_MIN + Math.floor(prng() * (MISSION_SPAN + 1));
        accSet(a.id, mkDeed(turn, world, pickDeed('coop_depart', { name: a.name, enemy: b.name, world }, ds())), { auto: { phase: 'mission', turns: dur, world }, status: missionStatus(world) });
        accSet(b.id, mkDeed(turn, world, pickDeed('coop_depart', { name: b.name, enemy: a.name, world }, ds())), { auto: { phase: 'mission', turns: dur, world }, status: missionStatus(world) });
        relAdd(a.id, b.name, '盟友'); relAdd(b.id, a.name, '盟友');
      }
    }
  };
  pairUp(ranked.filter((n) => !isNative(n)), false);
  pairUp(ranked.filter((n) => isNative(n)), true);

  // ── 逐个模拟未配对的 NPC ──
  const allowDeath = useSettings.getState().npcAutonomyDeath;
  const itemFx: Array<{ id: string; out: TickOutcome }> = [];
  for (const npc of ranked) {
    if (handled.has(npc.id)) continue;
    const pool = (isNative(npc) ? nativeNames : contractorNames).filter((p) => p !== npc.name);
    const out = decideNpcTick(npc, turn, pool, { allowDeath });
    if (!out.deed && !out.patch && !out.relation && !out.grant && !out.consume && !out.itemPatch && !out.drop) continue;
    if (out.deed || out.patch) accSet(npc.id, out.deed, out.patch ?? {});
    if (out.relation) {
      relAdd(npc.id, out.relation.otherName, out.relation.label);
      const other = eligible.find((n) => n.name === out.relation!.otherName);
      if (other && other.id !== npc.id) relAdd(other.id, npc.name, out.relation.label);
    }
    if (out.grant || out.consume || out.itemPatch || out.drop) itemFx.push({ id: npc.id, out });
  }

  const updates = [...acc.entries()].map(([id, e]) => ({ id, deed: e.deed, patch: e.patch }));
  if (updates.length) store.applyAutonomy(updates);
  // 真实物品效果 → 写进 NPC 面板：获得（带上限）/ 消耗 / 损坏修复 / 陨落掉落
  if (itemFx.length) {
    const chars = useCharacters.getState();
    const GEAR_CATS = ['武器', '防具', '饰品'];
    for (const { id, out } of itemFx) {
      const rec = store.npcs[id];
      if (out.grant?.equip) {
        const gear = GEAR_CATS.includes(out.grant.equip.category);
        const gearCount = (rec?.items ?? []).filter((it) => it.acquisition === '离场历练所得' && GEAR_CATS.includes(it.category)).length;
        if (!gear || gearCount < MAX_AUTO_GEAR) store.addNpcItem(id, out.grant.equip);   // 装备总量上限
      }
      if (out.grant?.skill) chars.addSkill(id, out.grant.skill);
      if (out.grant?.talent) chars.addTrait(id, out.grant.talent);
      if (out.consume) store.consumeNpcItem(id, out.consume.itemId, 1);
      if (out.itemPatch) store.updateNpcItem(id, out.itemPatch.itemId, out.itemPatch.patch);
      if (out.drop && rec) {
        for (const it of (rec.items ?? []).filter((x) => !x.locked).slice(0, out.drop)) store.removeNpcItem(id, it.id);
      }
    }
  }
  return updates.filter((u) => u.deed).length;
}
