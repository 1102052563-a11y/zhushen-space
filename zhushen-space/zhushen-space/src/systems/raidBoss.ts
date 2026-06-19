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

/* 生成 BOSS。opts.name/emoji 由内置图鉴选或 AI 现生（两者都支持：传入则用，不传则随机图鉴）。 */
export function generateRaidBoss(
  difficulty: RaidDifficulty,
  opts: { partySize?: number; partyTier?: string; name?: string; emoji?: string; affixes?: string[]; intro?: string } = {},
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
    skillsByPhase: buildBossSkills(d.phases, affixes),
    phases, affixes, rewardTier: d.reward, intro,
  };
}
