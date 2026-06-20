import { lvFromRealm, realmFromLevel, normalizeTier, computeMaxHp, computeMaxEp } from './derivedStats';
import type { DiceAttrs } from './diceEngine';
import type { Skill } from '../store/characterStore';

/* ════════════════════════════════════════════
   组队讨伐 · BOSS 生成引擎（纯逻辑）
   难度档(手动) × 队伍规模/阶位(自动缩放) → BOSS 数值骨架 + 词缀 + 多阶段技能组。
   产出喂给 combatEngine.buildCombatant(transient) + characterStore['BOSS'].skills。
   参考崩铁/原神/鸣潮/DNF：难度=HP倍率+词缀叠加+阶段换招（韧性击破/点名/召唤为第二步加料）。
════════════════════════════════════════════ */

export type RaidDifficulty = 'normal' | 'hard' | 'nightmare' | 'abyss';

export interface RaidAffix { id: string; name: string; emoji: string; desc: string }
export interface RaidPhase { idx: number; name: string; threshold: number; line: string }  // threshold=进入该阶段的 HP 占比(0~1)
export interface RaidBoss {
  name: string;
  emoji: string;
  tier: string;
  difficulty: RaidDifficulty;
  difficultyLabel: string;
  attrs: DiceAttrs;
  maxHp: number;
  maxEp: number;
  skillsByPhase: Skill[][];   // 每阶段的技能组（阶段换招）
  phases: RaidPhase[];        // 阶段0=满血；按 threshold 降序
  affixes: string[];          // 本场词缀 id（难度越高越多）
  rewardTier: string;         // 掉落档（E~SSS 思路，沿用世界结算评级口径）
  intro: string;
}

export const RAID_DIFFS: { id: RaidDifficulty; label: string; hpMul: number; affixN: number; phases: number; tierBump: number; reward: string }[] = [
  { id: 'normal',    label: '普通', hpMul: 1,  affixN: 1, phases: 2, tierBump: 0, reward: 'C' },
  { id: 'hard',      label: '困难', hpMul: 3,  affixN: 2, phases: 2, tierBump: 1, reward: 'B' },
  { id: 'nightmare', label: '噩梦', hpMul: 6,  affixN: 3, phases: 3, tierBump: 2, reward: 'A' },
  { id: 'abyss',     label: '深渊', hpMul: 10, affixN: 4, phases: 3, tierBump: 3, reward: 'S' },
];

export const RAID_AFFIXES: RaidAffix[] = [
  { id: 'enrage', name: '狂暴', emoji: '💢', desc: '每进入新阶段攻击力大幅提升' },
  { id: 'shield', name: '护壁', emoji: '🛡', desc: '入场/换阶段获得高额护盾，需集火打破' },
  { id: 'regen',  name: '再生', emoji: '🔁', desc: '每回合回复部分生命' },
  { id: 'tough',  name: '坚韧', emoji: '🧱', desc: '受到的伤害减免' },
  { id: 'bleed',  name: '噬血', emoji: '🩸', desc: '技能附带出血（持续掉血）' },
  { id: 'burn',   name: '燃域', emoji: '🔥', desc: '高阶段释放群体灼烧' },
];
export const affixById = (id: string) => RAID_AFFIXES.find((a) => a.id === id);

const PHASE_LINES = [
  '——「不过尔尔。」',
  '——「有点意思，让你们见识真正的力量！」',
  '——「都给我陪葬吧！！」',
];

const ROSTER: { name: string; emoji: string }[] = [
  { name: '噬渊魔龙·瓦尔基', emoji: '🐉' },
  { name: '血色女武神', emoji: '⚔️' },
  { name: '虚空吞噬者', emoji: '🕳️' },
  { name: '熔狱炎魔', emoji: '🔥' },
  { name: '千面诡影', emoji: '👁️' },
];

let _sid = 0;
function sk(name: string, skillType: string, effect: string, level: string, cost: number, tags: string[]): Skill {
  return { id: `BSK_${Date.now()}_${_sid++}`, name, skillType, effect, level, cost, tags, addedAt: 0 } as any;
}

/* 按阶段+词缀生成 BOSS 技能组：阶段越深招式越猛；带 bleed/burn 词缀的高阶段追加对应技能 */
function buildBossSkills(phaseCount: number, affixes: string[]): Skill[][] {
  const out: Skill[][] = [];
  for (let p = 0; p < phaseCount; p++) {
    const set: Skill[] = [
      sk('裂空斩', '攻击', `单体重击，造成大量物理伤害${p > 0 ? '（强化）' : ''}`, p >= 2 ? '极道' : p === 1 ? '大师' : '精通', 0, ['单体']),
    ];
    if (p >= 1) set.push(sk('毁灭横扫', '攻击', '群体攻击，对我方全体造成伤害', '大师', 10, ['群攻', '群体']));
    if (p >= 2) set.push(sk('终焉灭世', '攻击', '蓄力后对全场释放毁灭一击', '极道', 30, ['群攻', '群体', '蓄力']));
    if (affixes.includes('bleed') && p >= 1) set.push(sk('血噬爪', '攻击', '撕裂目标，造成伤害并施加出血（持续掉血）', '大师', 8, ['单体', '出血']));
    if (affixes.includes('burn') && p >= 2) set.push(sk('燃狱', '攻击', '点燃战场，对我方全体施加灼烧（每回合掉血）', '极道', 15, ['群攻', '群体', '灼烧']));
    out.push(set);
  }
  return out;
}

/* 主题 BOSS 招池（巴卡尔副本四只各 12~14 个专属技能，按 minPhase 渐次解锁；2 阶段 BOSS 终阶≥10、3 阶段全开）。
   tags 中 群攻/群体→AoE、蓄力→charge、领域→domain 由战斗引擎识别；其余冰冻/中毒/麻痹/灼烧/出血/护盾/控制 为风味+提示。 */
type ASkill = { name: string; skillType: string; effect: string; level: string; cost: number; tags: string[]; minPhase: number };
const BOSS_ARCHETYPES: Record<string, ASkill[]> = {
  ice: [
    { name: '寒冰爪击', skillType: '攻击', effect: '凝冰利爪单体重击，附带刺骨寒意', level: '精通', cost: 0, tags: ['单体'], minPhase: 0 },
    { name: '霜息吐息', skillType: '攻击', effect: '向全场喷吐寒霜，群体冰冻伤害', level: '精通', cost: 6, tags: ['群攻', '群体'], minPhase: 0 },
    { name: '冰棱乱射', skillType: '攻击', effect: '激射多发冰棱，单体多段连击', level: '精通', cost: 5, tags: ['单体'], minPhase: 0 },
    { name: '凛冬护盾', skillType: '防御', effect: '为自身覆上厚重冰甲护盾', level: '精通', cost: 8, tags: ['护盾'], minPhase: 0 },
    { name: '急冻箭', skillType: '攻击', effect: '单体冰箭，有几率冻结目标', level: '精通', cost: 4, tags: ['单体', '冻结'], minPhase: 0 },
    { name: '霜牢之域', skillType: '领域', effect: '展开霜牢领域，全场减速且每回合受冰蚀', level: '精通', cost: 12, tags: ['领域', '群体'], minPhase: 0 },
    { name: '极地暴雪', skillType: '攻击', effect: '召来暴雪，全体冰伤并有几率冻结', level: '大师', cost: 14, tags: ['群攻', '群体', '冻结'], minPhase: 1 },
    { name: '冰封棺椁', skillType: '攻击', effect: '将目标封入冰棺，重伤并冻结', level: '大师', cost: 12, tags: ['单体', '冻结'], minPhase: 1 },
    { name: '霜甲反震', skillType: '增益', effect: '寒甲附体，受击反弹冰寒伤害', level: '大师', cost: 10, tags: ['护盾', '反伤'], minPhase: 1 },
    { name: '寒流回涌', skillType: '治疗', effect: '抽取场上寒气，回复自身生命', level: '大师', cost: 12, tags: ['治疗'], minPhase: 1 },
    { name: '风雪连斩', skillType: '攻击', effect: '借风雪之势，单体三连斩', level: '大师', cost: 9, tags: ['单体'], minPhase: 1 },
    { name: '绝对零度', skillType: '攻击', effect: '蓄力后将全场拖入绝对零度，巨额冰伤+冻结', level: '极道', cost: 30, tags: ['群攻', '群体', '蓄力', '冻结'], minPhase: 2 },
    { name: '永冬降临', skillType: '领域', effect: '永冬之地笼罩全场，每回合持续冰伤', level: '极道', cost: 25, tags: ['领域', '群体'], minPhase: 2 },
  ],
  poison: [
    { name: '毒牙撕咬', skillType: '攻击', effect: '毒牙咬击单体，造成伤害并流血', level: '精通', cost: 0, tags: ['单体', '出血'], minPhase: 0 },
    { name: '腐蚀吐息', skillType: '攻击', effect: '喷吐腐蚀毒雾，全体中毒', level: '精通', cost: 6, tags: ['群攻', '群体', '中毒'], minPhase: 0 },
    { name: '酸液喷溅', skillType: '攻击', effect: '酸液腐蚀单体，降低其防御', level: '精通', cost: 5, tags: ['单体'], minPhase: 0 },
    { name: '尾刺连击', skillType: '攻击', effect: '毒尾多段刺击单体', level: '精通', cost: 4, tags: ['单体'], minPhase: 0 },
    { name: '噬毒之吻', skillType: '攻击', effect: '单体重毒撕咬，叠加中毒层', level: '精通', cost: 6, tags: ['单体', '中毒'], minPhase: 0 },
    { name: '瘴雾之域', skillType: '领域', effect: '弥漫瘴气领域，全场持续中毒', level: '精通', cost: 12, tags: ['领域', '群体', '中毒'], minPhase: 0 },
    { name: '剧毒喷吐', skillType: '攻击', effect: '喷吐剧毒，全体叠加中毒层', level: '大师', cost: 14, tags: ['群攻', '群体', '中毒'], minPhase: 1 },
    { name: '腐骨之触', skillType: '攻击', effect: '腐骨毒触单体，重毒并降防', level: '大师', cost: 12, tags: ['单体', '中毒'], minPhase: 1 },
    { name: '蜕皮再生', skillType: '治疗', effect: '蜕去腐皮，回复自身生命', level: '大师', cost: 12, tags: ['治疗'], minPhase: 1 },
    { name: '禁疗瘴域', skillType: '领域', effect: '瘴毒领域笼罩全场，持续中毒且削弱治疗', level: '大师', cost: 16, tags: ['领域', '群体'], minPhase: 1 },
    { name: '毒刃突袭', skillType: '攻击', effect: '毒刃突袭单体，造成伤害并流血', level: '大师', cost: 9, tags: ['单体', '出血'], minPhase: 1 },
    { name: '万毒归元', skillType: '攻击', effect: '蓄力催动万毒，全场剧毒爆发', level: '极道', cost: 30, tags: ['群攻', '群体', '中毒', '蓄力'], minPhase: 2 },
    { name: '致命毒囊', skillType: '攻击', effect: '毒囊爆裂，浓毒灌注单体，重毒斩杀', level: '极道', cost: 22, tags: ['单体', '中毒'], minPhase: 2 },
  ],
  stun: [
    { name: '雷光爪', skillType: '攻击', effect: '缠绕雷光的利爪单体重击', level: '精通', cost: 0, tags: ['单体'], minPhase: 0 },
    { name: '麻痹电网', skillType: '攻击', effect: '张开电网，全体雷击并有几率麻痹', level: '精通', cost: 6, tags: ['群攻', '群体', '麻痹'], minPhase: 0 },
    { name: '落雷', skillType: '攻击', effect: '引落雷霆轰击单体，有几率眩晕', level: '精通', cost: 5, tags: ['单体', '麻痹'], minPhase: 0 },
    { name: '静电护体', skillType: '防御', effect: '静电屏障护体，生成护盾', level: '精通', cost: 8, tags: ['护盾'], minPhase: 0 },
    { name: '闪电突袭', skillType: '攻击', effect: '化作闪电高速突进单体', level: '精通', cost: 4, tags: ['单体'], minPhase: 0 },
    { name: '感电之触', skillType: '攻击', effect: '单体感电，麻痹其行动', level: '精通', cost: 6, tags: ['单体', '麻痹'], minPhase: 0 },
    { name: '雷暴轰击', skillType: '攻击', effect: '召唤雷暴轰击全体', level: '大师', cost: 14, tags: ['群攻', '群体'], minPhase: 1 },
    { name: '瘫痪冲击', skillType: '攻击', effect: '高压电流冲击单体，重伤并眩晕', level: '大师', cost: 12, tags: ['单体', '麻痹'], minPhase: 1 },
    { name: '蓄能过载', skillType: '增益', effect: '蓄积雷能过载，下次出手大幅增伤', level: '大师', cost: 10, tags: ['蓄力'], minPhase: 1 },
    { name: '天罗雷域', skillType: '领域', effect: '雷感天罗笼罩全场，每回合随机麻痹', level: '大师', cost: 16, tags: ['领域', '群体', '麻痹'], minPhase: 1 },
    { name: '连锁闪电', skillType: '攻击', effect: '雷电在我方间连锁弹跳，群体雷伤', level: '大师', cost: 11, tags: ['群攻', '群体'], minPhase: 1 },
    { name: '万雷天牢', skillType: '攻击', effect: '蓄力布下万雷天牢，全场雷击+眩晕', level: '极道', cost: 30, tags: ['群攻', '群体', '蓄力', '麻痹'], minPhase: 2 },
    { name: '雷龙真身', skillType: '增益', effect: '化雷龙真身，全属性狂暴并加速', level: '极道', cost: 25, tags: ['buff'], minPhase: 2 },
  ],
  bakal: [
    { name: '龙王之爪', skillType: '攻击', effect: '龙王利爪单体重击，势不可挡', level: '精通', cost: 0, tags: ['单体'], minPhase: 0 },
    { name: '黑龙焰', skillType: '攻击', effect: '喷吐黑龙之焰，全体火伤+灼烧', level: '精通', cost: 8, tags: ['群攻', '群体', '灼烧'], minPhase: 0 },
    { name: '龙尾横扫', skillType: '攻击', effect: '龙尾横扫全场，击退我方', level: '精通', cost: 6, tags: ['群攻', '群体'], minPhase: 0 },
    { name: '龙王威压', skillType: '减益', effect: '释放龙王威压，全场降低攻击', level: '精通', cost: 10, tags: ['群体', '控制'], minPhase: 0 },
    { name: '烈焰吐息', skillType: '攻击', effect: '高温烈焰吐息，单体重伤+灼烧', level: '精通', cost: 7, tags: ['单体', '灼烧'], minPhase: 0 },
    { name: '毁灭龙息', skillType: '攻击', effect: '毁灭龙息席卷全体，巨额火伤', level: '大师', cost: 16, tags: ['群攻', '群体', '灼烧'], minPhase: 1 },
    { name: '逆鳞狂怒', skillType: '增益', effect: '逆鳞领域展开，自身陷入狂怒大幅增伤', level: '大师', cost: 14, tags: ['领域'], minPhase: 1 },
    { name: '焚天爆炎', skillType: '攻击', effect: '焚天爆炎轰击全体，附加灼烧', level: '大师', cost: 13, tags: ['群攻', '群体', '灼烧'], minPhase: 1 },
    { name: '龙鳞壁垒', skillType: '防御', effect: '黑龙鳞甲护体，生成高额护盾', level: '大师', cost: 12, tags: ['护盾'], minPhase: 1 },
    { name: '炼狱火海', skillType: '领域', effect: '点燃全场为炼狱火海，每回合持续灼烧', level: '大师', cost: 18, tags: ['领域', '群体', '灼烧'], minPhase: 1 },
    { name: '终焉·龙王灭世', skillType: '攻击', effect: '蓄力凝聚龙王之力，对全场释放毁灭灭世一击', level: '极道', cost: 35, tags: ['群攻', '群体', '蓄力'], minPhase: 2 },
    { name: '龙王恐惧', skillType: '减益', effect: '龙王之威令全体陷入恐惧·眩晕', level: '极道', cost: 25, tags: ['群体', '控制'], minPhase: 2 },
    { name: '末日龙炎', skillType: '攻击', effect: '末日龙炎吞噬全场，巨伤+持续灼烧', level: '极道', cost: 28, tags: ['群攻', '群体', '灼烧'], minPhase: 2 },
    { name: '王权降临', skillType: '增益', effect: '龙王权能加身，全属性狂暴', level: '极道', cost: 30, tags: ['buff'], minPhase: 2 },
  ],
};

/* 按主题招池 + 阶段构建 skillsByPhase：每阶段=minPhase≤当前阶段的全部技能（渐次解锁，越深招越多越猛）。 */
function buildArchetypeSkills(archId: string, phaseCount: number): Skill[][] {
  const pool = BOSS_ARCHETYPES[archId];
  if (!pool) return buildBossSkills(phaseCount, []);
  const out: Skill[][] = [];
  for (let p = 0; p < phaseCount; p++) {
    out.push(pool.filter((s) => s.minPhase <= p).map((s) => sk(s.name, s.skillType, s.effect, s.level, s.cost, s.tags)));
  }
  return out;
}

/* 生成 BOSS。opts.name/emoji 由内置图鉴选或 AI 现生（两者都支持：传入则用，不传则随机图鉴）。 */
export function generateRaidBoss(
  difficulty: RaidDifficulty,
  opts: { partySize?: number; partyTier?: string; name?: string; emoji?: string; affixes?: string[]; intro?: string; archetype?: string } = {},
): RaidBoss {
  const d = RAID_DIFFS.find((x) => x.id === difficulty) ?? RAID_DIFFS[0];
  const partySize = Math.max(1, Math.min(8, opts.partySize ?? 1));
  const partyLv = lvFromRealm(normalizeTier(opts.partyTier) || '一阶');
  const bossLv = Math.max(1, partyLv + d.tierBump * 10);   // 难度抬等级（越阶压制）
  const tier = realmFromLevel(bossLv);
  const a = 12 + Math.floor(bossLv * 1.1);                  // 粗略六维随等级（数值后续按实战调）
  const attrs: DiceAttrs = { str: a + 6, agi: a, con: a + 12, int: a + 4, cha: a, luck: a };
  const baseHp = computeMaxHp(attrs);                       // 体×20
  const maxHp = Math.max(200, Math.round(baseHp * d.hpMul * (1 + partySize * 0.5)));   // 难度倍率 × 队伍规模
  const maxEp = computeMaxEp(attrs) * 3;

  // 词缀：从池里随机抽 affixN 条（去重）
  const pool = RAID_AFFIXES.map((x) => x.id);
  const affixes: string[] = [];
  if (opts.affixes?.length) affixes.push(...opts.affixes.slice(0, d.affixN));
  while (affixes.length < d.affixN && pool.length) {
    const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (!affixes.includes(id)) affixes.push(id);
  }

  // 阶段：threshold = 进入该阶段的 HP 占比（2 段:1/0.5；3 段:1/0.66/0.33）
  const phases: RaidPhase[] = [];
  for (let p = 0; p < d.phases; p++) {
    const threshold = p === 0 ? 1 : +((d.phases - p) / d.phases).toFixed(2);
    phases.push({ idx: p, name: `第${p + 1}阶段`, threshold, line: PHASE_LINES[p] ?? '' });
  }

  const pick = opts.name ? { name: opts.name, emoji: opts.emoji || '👹' } : ROSTER[Math.floor(Math.random() * ROSTER.length)];
  const affixText = affixes.map((id) => affixById(id)?.name).filter(Boolean).join('、');
  const intro = opts.intro || `【${d.label}】${pick.name}（${tier}）现身！${affixText ? `携 ${affixText} 之威，` : ''}共 ${d.phases} 个阶段，血量极厚——组队讨伐！`;

  return {
    name: pick.name, emoji: pick.emoji, tier, difficulty, difficultyLabel: d.label,
    attrs, maxHp, maxEp,
    skillsByPhase: opts.archetype && BOSS_ARCHETYPES[opts.archetype] ? buildArchetypeSkills(opts.archetype, d.phases) : buildBossSkills(d.phases, affixes),
    phases, affixes, rewardTier: d.reward, intro,
  };
}

/* ════════════════════════════════════════════
   组队副本（多场战斗串联）：机械之乱 · 巴卡尔攻坚战
   结构：三子龙（自选顺序·各一场）→ 击破全部解锁龙王血锁 → 龙王本体战 → 结算。
   每场 encounter 复用 generateRaidBoss + 现有联机战斗；副本进度由房主权威、relay 广播。
   （原创设计，以 DNF 巴卡尔团本机制为蓝本重写，非搬运其素材/文案。）
════════════════════════════════════════════ */
export type EncounterKind = 'dragon' | 'boss';
export interface RaidEncounter {
  id: string;                 // 'ice' | 'poison' | 'stun' | 'bakal'
  kind: EncounterKind;
  name: string;
  emoji: string;
  boss: RaidBoss;
  status: 'pending' | 'cleared';
  note?: string;
}
export interface RaidDungeon {
  id: string;
  name: string;
  difficulty: RaidDifficulty;
  difficultyLabel: string;
  encounters: RaidEncounter[];   // 三子龙在前、龙王在末
  bossId: string;
  stage?: 'ongoing' | 'cleared' | 'failed';
  dread?: number;       // 恐惧之龙王槽（团灭计时·贯穿整个副本累积，满则团灭）
  dreadMax?: number;
}

const BAKAL_DRAGONS: { id: string; name: string; emoji: string; affixes: string[]; note: string; intro: string }[] = [
  { id: 'ice',    name: '冰龙·斯皮拉齐', emoji: '❄️', affixes: ['shield', 'regen'], note: '区域冰冻·弱火',  intro: '冰龙·斯皮拉齐踞于霜息领域，寒气封锁全场——破其冰甲！' },
  { id: 'poison', name: '毒龙·斯卡萨',   emoji: '🧪', affixes: ['bleed', 'regen'],  note: '中毒叠层·需净化', intro: '毒龙·斯卡萨吐息成雾，剧毒侵蚀血肉——速斩莫久缠！' },
  { id: 'stun',   name: '眩龙·希斯麦',   emoji: '⚡', affixes: ['enrage', 'tough'], note: '眩晕点名·抗控',  intro: '眩龙·希斯麦雷光缠身，麻痹之威笼罩战场——抗住点名！' },
];

const DIFF_ORDER: RaidDifficulty[] = ['normal', 'hard', 'nightmare', 'abyss'];

/* 生成「巴卡尔攻坚战」副本：三子龙（选定难度）+ 龙王（难度+1档·更猛）。partyTier 传有效阶位，避免被碾压秒。 */
export function generateBakalDungeon(
  difficulty: RaidDifficulty,
  opts: { partySize?: number; partyTier?: string } = {},
): RaidDungeon {
  const di = Math.max(0, DIFF_ORDER.indexOf(difficulty));
  const bossDiff = DIFF_ORDER[Math.min(DIFF_ORDER.length - 1, di + 1)];
  const d = RAID_DIFFS.find((x) => x.id === difficulty) ?? RAID_DIFFS[0];
  const encounters: RaidEncounter[] = BAKAL_DRAGONS.map((dr) => ({
    id: dr.id, kind: 'dragon' as EncounterKind, name: dr.name, emoji: dr.emoji, note: dr.note,
    boss: generateRaidBoss(difficulty, { ...opts, name: dr.name, emoji: dr.emoji, affixes: dr.affixes, intro: dr.intro, archetype: dr.id }),
    status: 'pending' as const,
  }));
  encounters.push({
    id: 'bakal', kind: 'boss', name: '黑龙·巴卡尔', emoji: '🐉', note: '三阶段·血锁',
    boss: generateRaidBoss(bossDiff, { ...opts, name: '黑龙·巴卡尔', emoji: '🐉', affixes: ['enrage', 'burn', 'tough', 'shield'], intro: '黑龙·巴卡尔睁眼——龙王之怒将焚尽一切。三龙已陨、血锁尽开，决战！', archetype: 'bakal' }),
    status: 'pending',
  });
  return { id: 'bakal_raid_' + Date.now(), name: '机械之乱 · 巴卡尔攻坚战', difficulty, difficultyLabel: d.label, encounters, bossId: 'bakal', stage: 'ongoing', dread: 0, dreadMax: 100 };
}
