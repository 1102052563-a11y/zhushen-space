/* ════════════════════════════════════════════
   战斗结算引擎（纯逻辑，无 React）—— 标签 VM 版（战斗系统重置 Step 2）。
   每次出手 = 执行该技能的「标签效果列表」(systems/combatTags)，数值全部由代码确定性算定：
   · **必中**（无命中/闪避/暴击骰）；伤害 = mult×攻击力档 → 虚弱×0.75 → +力量 → 易伤×1.5 → −防御 → 扣盾 → 扣 HP。
   · 增益/减益走 StatusEffect+CombatStatusMod；护盾(格挡)每回合开始清零（STS 式）。
   · 蓄力大招 / 领域阵法 / 道具 保留原机制；技能本体走标签。
   敌人决策走 systems/enemyAI（本地启发式，0 API，Step 3）；AI 只在战斗结束据 BATTLE_RECORD 润色一次。
   阶位/强度走 T0-T9，技能品级走入门~极道。设计文档：指导/战斗系统-重置-设计.md
════════════════════════════════════════════ */
import {
  ATTR_KEYS, type AttrKey, type DiceAttrs, type EquipItemLite,
} from './diceEngine';
import {
  computeDerived, computeMaxHp, computeMaxEp, fullMaxHp, fullMaxEp, lvFromRealm, normalizeTier, realmFromLevel, effectiveResource, realAttrMult, attrCapForTier, ratioOf,
} from './derivedStats';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { effectiveCombatStat } from './enhanceEngine';
import { playerStatusAttrDelta, npcStatusAttrDelta } from './statusAttrs';
import { playSfx } from './audio';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { usePlayer, type StatusEffect, type CombatStatusMod } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useItems, gradeToNum } from '../store/itemStore';
import type { Skill } from '../store/characterStore';
import type { BattleState, CombatStatBlock, Combatant, Side, CombatActionKind, DomainState } from '../store/combatStore';
import { useCombat, newLogId } from '../store/combatStore';
import {
  parseCombatSpec, applyDamageModifiers, strengthBonus, dexterityBonus, TAG_REGISTRY, EXECUTE_THRESHOLD,
  aggregatePassives, aggregateTriggers, mergePassive, equipmentPassive, CRIT_BASE,
  type CombatEffect, type CombatSpec, type CombatTag, type TargetMode, type PassiveMod, type TriggerEvent, type TriggerCond, type SkillLike,
} from './combatTags';
import { bfElementMult, bfNum, skillElement, type BattlefieldAffix } from './battlefield';
import { useResource } from '../store/resourceStore';
import { setAttrEntries, setPassive } from './setBonus';   // 套装（宝石套装+锻造套装）单一口径：六维条目 / 战斗被动

const DEFAULT_ATTRS: DiceAttrs = { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };

/* 调参常量（手感调节集中在此） */
const DMG_SCALE = 2;          // 全局伤害缩放（让一场仗约 4~6 回合）
const DEF_FACTOR = 0.6;       // 防御对伤害的削减系数（必中模型里防御=减伤，不再是命中对抗）
const DEFEND_MITIGATION = 0.5;// 防御姿态承伤倍率
const CHIP_DMG_FRAC = 0.08;   // 破防保底：防御减免后至少保留减防前伤害的 8%（磨盘局有终点；跨阶碾压方向不变）
const SKILL_EP_BY_TIER: Record<string, number> = {
  普通: 5, 精良: 8, 稀有: 10, 史诗: 14, 传说: 18, 奥义: 24, 极境: 30,   // 技能品级 7 档（本项目实际命名）
  入门: 5, 精通: 10, 大师: 15, 宗师: 20, 极道: 30,                       // 旧命名兼容（重置前预设）
};
const EP_REGEN_RATE = 0.06;  // 每回合自动回蓝比例（按上限），防长仗技能荒；防御额外回更多
/* 品级 → EP 消耗占 maxEp 百分比下限。EP 上限随六维/阶位膨胀（四阶起还×5），平数值消耗在高阶形同免费
   → 最优解退化成无脑循环最强技；按百分比锚定让任何阶位都要为高品级技能付出代价（防御=回蓝成为节奏动作）。 */
const SKILL_EP_PCT_BY_GRADE: [RegExp, number][] = [
  [/极境|极道/, 0.30], [/奥义|宗师/, 0.22], [/传说/, 0.16], [/史诗|大师/, 0.12], [/稀有|精通/, 0.08], [/精良/, 0.05], [/普通|入门/, 0.03],
];
function skillEpPct(skill?: Skill): number {
  const lv = `${skill?.level ?? ''}`;
  for (const [re, p] of SKILL_EP_PCT_BY_GRADE) if (re.test(lv)) return p;
  return 0.06;   // 识别不出品级 → 中间值
}

/* 默认朝向「敌方」的标签（其余标签默认作用于己方/友方） */
const ENEMY_TAGS = new Set<CombatTag>([
  'deal', 'vulnerable', 'weak', 'poison', 'stun', 'burn', 'sunder', 'silence', 'execute', 'pierce', 'lifesteal', 'dispel', 'taunt', 'detonate',
]);
const RES_BOOST_MULT = 1.3;   // 资源强化档：主角耗自定义能量条点数的爆发倍率（P3）

/* 真实属性·直加分配总和（Σ realAttrs[k]）—— 计入参战者 trueBonus（展示/平衡用）。 */
function sumRealAttrs(ra?: Partial<Record<AttrKey, number>>): number {
  return ra ? ATTR_KEYS.reduce((s, k) => s + (ra[k] ?? 0), 0) : 0;
}

/* 战斗六维缩放（四阶起真实属性 ×5·5:1强制）：放大 str/agi/con/int/cha（→攻防/伤害/HP/EP 一并×5），
   luck 不缩放（特殊属性）。同阶 ×5 对 ×5 抵消=平衡；跨阶四阶打三阶 = 攻×5对防×1 碾压。 */
function scaleCombat(a: DiceAttrs, m: number): DiceAttrs {
  return m === 1 ? a : { str: a.str * m, agi: a.agi * m, con: a.con * m, int: a.int * m, cha: a.cha * m, luck: a.luck };
}

/* 幸运 → 暴击率（P2）：让第六维在战斗里有意义。luck 不随四阶×5 缩放 → 各阶位口径一致；
   每点 +0.2%、上限 +15%，叠加在装备/技能/套装被动暴击之上（previewAction 的 critChance 自动跟随）。 */
function withLuckCrit(p: PassiveMod | undefined, luck: number | undefined): PassiveMod {
  const lc = Math.min(0.15, Math.max(0, luck ?? 0) * 0.002);
  if (lc <= 0) return p ?? {};
  return { ...(p ?? {}), critChance: Math.min(1, (p?.critChance ?? 0) + lc) };
}

/* 确定性 PRNG（暴击/触发概率用·同一 battleId+round+turn+actor 可复现） */
function seeded(str: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const equippedOf = (arr: any[] | undefined): EquipItemLite[] =>
  (arr ?? []).filter((it) => it?.equipped).map((it) => ({ category: it?.category as string, grade: (it?.numeric?.grade as number) ?? gradeToNum(it?.gradeDesc), combatStat: effectiveCombatStat(it) }));   // 攻防取「按强化等级放大后」的值，+N 才真进战力

/* 取某角色的技能/天赋/已装备（live 读 store；临时敌无建档则空） */
/* ════════ 伤害修正管线（单一来源·三处收拢）════════
   dealDamage / previewAction / applyTriggerEffect 共用同一条链：
   base → 虚弱→+力量→易伤(applyDamageModifiers) → ×蓄力×DMG_SCALE×词缀×(1+攻方增伤)×(1+守方受伤)
   → 防御档削减(×(1-穿透))与破防保底(CHIP_DMG_FRAC) → 防御姿态减半 → 暴击。
   rng 缺省不掷暴击（预览/意图预告场景），critDmg 恒为「全暴击值」供单列显示；
   rng 仅在 critChance>0 时消耗一次——保持 settleAction 内 rng 调用序列与旧实现一致（触发器 chance 判定不漂移）。
   ⚠ 新数值机制（新乘区/新保底）只改这里，三个调用方自动同步。 */
export interface DamagePipelineIn {
  base: number;               // (mult×攻击档+flat)，未经修正
  atkTier: number;            // 攻击档（力量层折算用）
  defTier: number;            // 目标防御档
  strengthStacks?: number;    // 攻方力量层数
  attackerWeak?: boolean;
  targetVulnerable?: boolean;
  chargeMult?: number;        // 蓄力倍率
  envMult?: number;           // 战场词缀元素倍率
  dmgDealtPct?: number;       // 攻方被动增伤
  dmgTakenPct?: number;       // 守方被动受伤（负=减伤）
  pierce?: number;            // 攻方穿透（削防御档 0~1）
  targetDefending?: boolean;
  critChance?: number;
  critMult?: number;
  resBoostMult?: number;      // 资源强化档（B1 自定义能量条耗点爆发 ×1.3；缺省 1）
  rng?: () => number;
}
export function damagePipeline(i: DamagePipelineIn): { dmg: number; crit: boolean; critDmg: number } {
  let dmg = applyDamageModifiers({ base: i.base, strengthBonus: strengthBonus(i.strengthStacks ?? 0, i.atkTier), attackerWeak: !!i.attackerWeak, targetVulnerable: !!i.targetVulnerable });
  dmg = Math.round(dmg * (i.chargeMult ?? 1) * DMG_SCALE * (i.envMult ?? 1) * (i.resBoostMult ?? 1) * (1 + (i.dmgDealtPct ?? 0)) * (1 + (i.dmgTakenPct ?? 0)));
  dmg = Math.max(Math.max(1, Math.ceil(dmg * CHIP_DMG_FRAC)), dmg - Math.round(i.defTier * DEF_FACTOR * (1 - (i.pierce ?? 0))));
  if (i.targetDefending) dmg = Math.max(1, Math.round(dmg * DEFEND_MITIGATION));
  const critDmg = Math.max(1, Math.round(dmg * (CRIT_BASE + (i.critMult ?? 0))));
  let crit = false;
  if ((i.critChance ?? 0) > 0 && i.rng && i.rng() < (i.critChance ?? 0)) { crit = true; dmg = critDmg; }
  return { dmg, crit, critDmg };
}

/* flat-only（未写 mult）的治疗/护盾/回能在高阶资源池前形同挠痒（与 P0 修燃烧/道具同病根）
   → 兜底锚定：heal 锚攻击档六成、block 锚防御档六成、restore 锚 EP 上限 8%（与旧 atkTier×0.3 取大）；
   写了 mult 即视为作者已按档位表达，完全尊重；authored 更大时取大（尊重原文）。 */
function healAmount(e: CombatEffect, atkTier: number): number {
  const authored = Math.round(((e.mult ?? 0) * atkTier + (e.flat ?? 0)) * DMG_SCALE);
  if ((e.mult ?? 0) > 0) return Math.max(1, authored);
  return Math.max(1, authored, Math.round(atkTier * 0.6 * DMG_SCALE));
}
function blockRaw(e: CombatEffect, defTier: number): number {   // 裸护盾量：敏捷层加值与战场词缀倍率由调用方叠
  const authored = Math.round(((e.mult ?? 0) * defTier + (e.flat ?? 0)) * DMG_SCALE);
  if ((e.mult ?? 0) > 0) return Math.max(0, authored);
  return Math.max(authored, Math.round(defTier * 0.6 * DMG_SCALE));
}
function restoreAmount(flat: number | undefined, maxEp: number, atkTier: number): number {
  return Math.max(1, Math.round(Math.max(flat ?? 0, maxEp * 0.08, atkTier * 0.3)));
}

/* ── 战斗统计（P4）：per-参战者 输出/承伤/治疗累计 + 全场最痛一击。挂在各伤害/治疗落点，供 ended 统计卡与战报「数据=/最痛=」段。 */
function addStat(c: Combatant | undefined, key: 'dealt' | 'taken' | 'healed', n: number) {
  if (!c || !(n > 0)) return;
  if (!c.stats) c.stats = { dealt: 0, taken: 0, healed: 0 };
  c.stats[key] += n;
}
function noteMaxHit(state: BattleState, actorId: string, targetId: string, dmg: number, label: string) {
  if (dmg > (state.maxHit?.dmg ?? 0)) state.maxHit = { actorId, targetId, dmg, label };
}

/* ── 引爆量（detonate·P3）：目标身上全部持续伤害的「未来总量」——燃烧 dotPerRound×剩余tick数(≤10) + 毒 层×单位，
   各吃战场词缀 DoT 倍率（引爆=提前结算，应与将来逐回合 tick 的总和等值）。preview 与结算共用。 */
function detonatableAmount(tc: Combatant, round: number, bfBurn: number, bfPoison: number): number {
  let total = 0;
  for (const s of tc.status) {
    const m = s.combat; if (!m || s.tone !== 'debuff') continue;
    if (m.dotPerRound) {
      const left = s.durationTurns != null ? Math.min(10, Math.max(1, s.durationTurns - (round - (s.startTurn ?? round)))) : 1;
      total += Math.round(m.dotPerRound * left * bfBurn);
    }
    if (m.poisonStacks) total += Math.round(m.poisonStacks * Math.max(1, m.poisonUnit ?? 1) * bfPoison);
  }
  return total;
}

/* ── 轻量元素反应（P3）：攻击元素 × 目标当前状态 → 反应。
   蒸汽=水冰打燃烧中目标（伤害×1.25 并淬灭燃烧）；感电=雷打中毒目标（+眩晕1回合·每场每目标限一次防控制链）。
   倍率走 damagePipeline 的 envMult 通道相乘；副作用（清燃烧/施眩晕）只在真结算执行，preview 只吃倍率。 */
function elementReaction(elem: string | null, tc: Combatant): { mult: number; kind?: 'steam' | 'shock' } {
  if (!elem) return { mult: 1 };
  if (elem === '水冰' && tc.status.some((s) => s.tone === 'debuff' && !!s.combat?.dotPerRound && /燃烧|灼烧|点燃/.test(s.name || ''))) return { mult: 1.25, kind: 'steam' };
  if (elem === '雷' && !tc.shockedOnce && tc.status.some((s) => !!s.combat?.poisonStacks)) return { mult: 1, kind: 'shock' };
  return { mult: 1 };
}

/* 佩戴中的称号 → 伪技能条目并进被动/触发器聚合（effect/bonusEffect/desc 文本走 inferPassive/inferTriggers 推断）。
   只进 kit（aggregatePassives/aggregateTriggers），不进主动技能表——不会被当技能施放、不进敌 AI 选技池。
   六维类称号文本与面板口径一致仍不折算（两侧同为不生效，避免单侧口径漂移）。 */
function equippedTitleAbilities(ch?: { titles?: { name?: string; effect?: string; bonusEffect?: string; desc?: string; equipped?: boolean }[] }): SkillLike[] {
  return (ch?.titles ?? []).filter((t) => t?.equipped).map((t) => ({ name: t.name, skillType: '称号', effect: [t.effect, t.bonusEffect].filter(Boolean).join('；'), desc: t.desc }));
}

function fetchAbilities(id: string): { skills: any[]; talents: any[]; equipped: EquipItemLite[] } {
  const chars = useCharacters.getState().characters;
  const ch = chars[id];
  if (id === 'B1') {
    return { skills: ch?.skills ?? [], talents: ch?.traits ?? [], equipped: equippedOf(useItems.getState().items) };
  }
  const npc = useNpc.getState().npcs[id];
  return { skills: ch?.skills ?? [], talents: ch?.traits ?? [], equipped: equippedOf(npc?.items) };
}

/* 建参战者静态统计块（建战时算一次并锚定）。B1=主角，Cx=NPC，其余视为临时敌（用传入 override）。 */
export function buildCombatant(id: string, side: Side, override?: Partial<CombatStatBlock> & { attrs?: DiceAttrs }): CombatStatBlock {
  if (override?.isTransient) {
    const level = override.level ?? Math.max(1, lvFromRealm(override.tier));
    const tier = normalizeTier(override.tier) || realmFromLevel(level);
    const attrs = scaleCombat(override.attrs ?? DEFAULT_ATTRS, realAttrMult(tier, level));   // 四阶起六维×5（攻防+HP/EP一并放大）
    const equipped: EquipItemLite[] = [];
    const d = computeDerived(attrs, level, equipped as any);
    const chT = useCharacters.getState().characters[id];
    const kit = [...(chT?.skills ?? []), ...(chT?.traits ?? []), ...equippedTitleAbilities(chT)];   // 瞬时敌(竞技对手/联机来宾)若注入了技能/天赋/佩戴称号→聚合被动/触发器
    return {
      side, name: override.name ?? id, attrs, level, tier,
      bioStrength: override.bioStrength ?? '', favor: undefined,
      patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
      maxHp: override.maxHp ?? computeMaxHp(attrs), maxEp: override.maxEp ?? computeMaxEp(attrs),
      passive: withLuckCrit(aggregatePassives(kit), attrs.luck), triggers: aggregateTriggers(kit),
      bossPhases: override.bossPhases,   // 显式 BOSS 阶段可传入（raid/竞技场调用方自配；自动判定只对非 transient）
      isTransient: true,
    };
  }
  if (id === 'B1') {
    const p = usePlayer.getState().profile;
    const equippedFull = useItems.getState().items.filter((it) => it.equipped);
    const b1c = useCharacters.getState().characters['B1'];
    // 主角有效六维 = 基础 + 技能树 + 团队效果 + 装备(含宝石) + 技能/天赋的六维加成（与属性面板/正文注入一致）。
    // 基础六维 + 技能树 + 团队 + **真实属性点直加(realAttrs)**——直加并入基础六维，自动进攻防/HP/EP，并随四阶×5、受本阶极值封顶。
    const baseTT = withAttrDelta(withAttrDelta(withAttrDelta(withAttrDelta(p.attrs ?? DEFAULT_ATTRS, playerTreeAttrBonus()), playerTeamAttrBonus()), p.realAttrs), playerStatusAttrDelta());
    const rm = realAttrMult(p.tier, p.level);   // 四阶起六维×5（攻防/伤害/HP/EP 一并放大）
    const equipForAttr = [...equippedFull, ...(setAttrEntries(equippedFull) as any[])];   // 宝石套装 + 锻造套装的六维加成 → 合成"装备条目"并入有效六维
    const attrs = scaleCombat(effectiveAttrs(baseTT, b1c?.skills, b1c?.traits, equipForAttr, attrCapForTier(p.tier, p.level)) as DiceAttrs, rm);   // 有效六维先夹本阶上限(遵守阶位)，再×真实倍率
    const equipped = equippedOf(useItems.getState().items);
    const d = computeDerived(attrs, p.level, equipped as any);
    const teamPerkAbil = playerTeamPerkAbilities();   // 团队效果里显式的「生命/法力上限」文本一并计入主角 HP/EP 上限
    // 上限传**基础六维**（fullMaxHp 内部会折六维加成；传 attrs 会双算技能/天赋的体质加成）；realMult=rm 让四阶起 HP/EP×5
    const maxHp = fullMaxHp(baseTT, equippedFull as any, b1c?.skills, [...(b1c?.traits ?? []), ...teamPerkAbil], rm, ratioOf(p)), maxEp = fullMaxEp(baseTT, equippedFull as any, b1c?.skills, [...(b1c?.traits ?? []), ...teamPerkAbil], rm, ratioOf(p));
    const g = useGame.getState().player;
    const b1kit = [...(b1c?.skills ?? []), ...(b1c?.traits ?? []), ...equippedTitleAbilities(b1c)];   // 技能+天赋+佩戴称号 → 聚合常驻被动修正/条件触发器（系统 C）
    return {
      side, name: p.name || '主角', attrs, trueBonus: sumRealAttrs(p.realAttrs), level: p.level, tier: p.tier || realmFromLevel(p.level),
      bioStrength: p.bioStrength || '', favor: undefined,
      patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
      maxHp, maxEp, initHp: effectiveResource(g.hp, g.maxHp, maxHp), initEp: effectiveResource(g.mp, g.maxMp, maxEp),
      // 被动 = 技能/天赋 + 装备&镶嵌宝石的高阶战斗属性(暴击/暴伤/破甲/减伤) + 宝石套装被动（后二者此前从不生效，是"宝石效果不生效"根因）+ 装备套装被动 + 幸运暴击
      passive: withLuckCrit(mergePassive(mergePassive(aggregatePassives(b1kit), equipmentPassive(equippedFull)), setPassive(equippedFull)), attrs.luck),
      triggers: aggregateTriggers(b1kit),
    };
  }
  const npc = useNpc.getState().npcs[id];
  const equippedFull = (npc?.items ?? []).filter((it) => it.equipped);
  const npcC = useCharacters.getState().characters[id];
  const level = lvFromRealm(npc?.realm);
  const rm = realAttrMult(npc?.realm, level);   // 四阶起六维×5（攻防/伤害/HP/EP 一并放大）
  const npcBase = withAttrDelta(withAttrDelta(npc?.attrs ?? DEFAULT_ATTRS, npc?.realAttrs), npcStatusAttrDelta(npc));   // 真实属性点直加(realAttrs)+叙事限时状态六维(statusEffects·与 B1 的 playerStatusAttrDelta 对称)并入基础六维→进攻防/HP/EP并随四阶×5
  // NPC 亦可镶嵌宝石成套 / 拿到锻造套装部件（赠予·交易·掉落）→ 套装六维同口径并入
  const npcEquipForAttr = [...(equippedFull as any[]), ...(setAttrEntries(equippedFull as any) as any[])];
  const attrs = scaleCombat(effectiveAttrs(npcBase, npcC?.skills, npcC?.traits, npcEquipForAttr, attrCapForTier(npc?.realm, level)) as DiceAttrs, rm);  // 有效六维先夹本阶上限(遵守阶位)，再×真实倍率
  const equipped = equippedOf(npc?.items);
  const d = computeDerived(attrs, level, equipped as any);
  // 上限传**基础六维**（fullMaxHp 内部会折六维加成；传 attrs 会双算）；realMult=rm 让四阶起 HP/EP×5
  const maxHp = fullMaxHp(npcBase, equippedFull as any, npcC?.skills, npcC?.traits, rm, ratioOf(npc)), maxEp = fullMaxEp(npcBase, equippedFull as any, npcC?.skills, npcC?.traits, rm, ratioOf(npc));
  const npcKit = [...(npcC?.skills ?? []), ...(npcC?.traits ?? []), ...equippedTitleAbilities(npcC)];   // 技能+天赋+佩戴称号 → 聚合常驻被动修正/条件触发器（系统 C）
  return {
    side, name: npc?.name || id, attrs, trueBonus: sumRealAttrs(npc?.realAttrs), level, tier: normalizeTier(npc?.realm) || realmFromLevel(level),
    bioStrength: npc?.bioStrength || '', favor: npc?.favor,
    patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
    maxHp, maxEp,
    initHp: effectiveResource(npc?.hp, npc?.maxHp, maxHp), initEp: effectiveResource(npc?.mp, npc?.maxMp, maxEp),
    passive: withLuckCrit(mergePassive(mergePassive(aggregatePassives(npcKit), equipmentPassive(equippedFull as any)), setPassive(equippedFull as any)), attrs.luck),
    triggers: aggregateTriggers(npcKit),
  };
}

/* 是否由玩家手动操控：主角 B1 永远是；玩家方队友仅在开启「手动控制队友」时 */
export function playerControlled(id: string, side: Side, manualAlly: boolean): boolean {
  return id === 'B1' || id.startsWith('MP_') || (side === 'player' && manualAlly);   // MP_*=联机来宾的战斗角色，由对应来宾远程出手（房主等待）
}

/* 联机：来宾(MP_*)战斗角色的可用道具——房主据此结算其用道具（来宾真实背包扣减在来宾本地做）。 */
const mpCombatItems: Record<string, any[]> = {};
export function setMpCombatItems(id: string, items: any[]) { mpCombatItems[id] = Array.isArray(items) ? items : []; }
export function clearMpCombatItems() { for (const k of Object.keys(mpCombatItems)) delete mpCombatItems[k]; }

/* 先攻：敏捷×词缀倍率 + 智力×0.3 + 随机(0~3)，降序排（对应凡人 speed+0.3神识）。
   agiMult=战场词缀（瘴泽拖慢、狂风助势）对敏捷贡献的倍率；rand 可传种子随机（assembleBattle 按 battleId+id 播种 → 同局可复现），缺省 Math.random。 */
export function rollInitiative(b: CombatStatBlock, agiMult = 1, rand: () => number = Math.random): number {
  return b.attrs.agi * agiMult + b.attrs.int * 0.3 + rand() * 3;
}

/* 由统计块装配整场战斗运行态 */
export function assembleBattle(
  blocks: Record<string, CombatStatBlock>,
  ctx: { reason: string; location: string; endConditions: string[]; battlefieldAffixes?: BattlefieldAffix[] },
  manualAlly = false,
): BattleState {
  const ids = Object.keys(blocks);
  const participants: Record<string, Combatant> = {};
  const agiInitMult = bfNum(ctx.battlefieldAffixes, 'agiInitMult');   // 战场词缀：先攻敏捷贡献倍率
  const battleId = `battle_${Date.now()}`;
  for (const id of ids) {
    const b = blocks[id];
    participants[id] = {
      id, side: b.side, initiative: rollInitiative(b, agiInitMult, seeded(`${battleId}|init|${id}`)),   // 先攻种子化：同局同 id 可复现
      curHp: b.initHp ?? b.maxHp, curEp: b.initEp ?? b.maxEp, curShield: 0, maxShield: 0,
      status: [], cooldowns: {},
    };
  }
  const order = [...ids].sort((a, c) => participants[c].initiative - participants[a].initiative);
  const playerTeam = ids.filter((id) => blocks[id].side === 'player');
  const enemyTeam = ids.filter((id) => blocks[id].side === 'enemy');
  // BOSS 多阶段·保守自动判定：敌方单体 && 非 transient（raid/竞技场/联机各有自己的机制）&& 未显式配置
  // && 血池 ≥ 我方全队总和×1.5（这种局面本来就是"BOSS 战"体验）→ 默认两阶段（70% 气势暴涨 / 35% 狂暴）
  if (enemyTeam.length === 1 && playerTeam.length >= 1) {
    const eb = blocks[enemyTeam[0]];
    const teamHp = playerTeam.reduce((s, id) => s + Math.max(0, blocks[id].maxHp), 0);
    if (eb && !eb.isTransient && !eb.bossPhases && teamHp > 0 && eb.maxHp >= teamHp * 1.5) {
      eb.bossPhases = [
        { hpPct: 0.7, announce: `${eb.name} 眼神骤变，气势暴涨——战斗才刚刚开始！`, strength: 3 },
        { hpPct: 0.35, announce: `${eb.name} 彻底狂暴了！`, cleanse: true, strength: 5, shieldPct: 0.08 },
      ];
    }
  }
  const first = order[0];
  const firstSide = first ? participants[first].side : 'player';
  return {
    active: true, battleId,
    stage: playerControlled(first, firstSide, manualAlly) ? 'awaiting_player' : 'awaiting_npc',
    round: 1, turn: 0, order, participants, initialState: blocks,
    context: { reason: ctx.reason, location: ctx.location, playerTeam, enemyTeam, endConditions: ctx.endConditions },
    log: [], transientEntities: {}, activeArrays: [],
    battlefieldAffixes: ctx.battlefieldAffixes?.length ? ctx.battlefieldAffixes : undefined,
    endReason: null, victor: null,
  };
}

/* ── 出手攻击通道推断（决定用物攻档还是法攻档） ── */
function isMagicSkill(skill?: Skill): boolean {
  if (!skill) return false;
  const t = `${skill.skillType ?? ''}${skill.damage ?? ''}${skill.effect ?? ''}${skill.name ?? ''}`;
  return /法术|术法|灵能|精神|意念|咒|魔|元素|能量|智力/.test(t);
}
function skillEpCost(skill?: Skill): number {
  if (!skill) return 0;
  const m = /(\d+)/.exec(skill.cost ?? '');
  if (m) return Math.max(0, Number(m[1]));
  for (const tier of Object.keys(SKILL_EP_BY_TIER)) if ((skill.level ?? '').includes(tier)) return SKILL_EP_BY_TIER[tier];
  return 8;
}

/* 技能最终 EP 消耗——引擎结算/敌人AI/面板显示的**单一来源**：
   authored(标签规格 cost > cost 文本数字 > 品级平数值兜底) 与「品级×maxEp 百分比」取大。 */
export function effectiveSkillCost(skill: Skill | undefined, maxEp: number): number {
  if (!skill) return 0;
  const sp = parseCombatSpec(skill as any);
  const authored = sp.cost && sp.cost > 0 ? sp.cost : skillEpCost(skill);
  return Math.max(authored, Math.round(Math.max(0, maxEp) * skillEpPct(skill)));
}

function parseCooldownRounds(skill?: Skill): number {
  const m = /(\d+)/.exec(skill?.cooldown ?? '');
  return m ? Math.max(0, Math.min(9, Number(m[1]))) : 0;
}

/* 蓄力大招识别：技能文本含蓄力类关键词 → 需连续蓄力再释放 */
function isChargeSkill(skill?: Skill): boolean {
  if (!skill) return false;
  const t = `${skill.name ?? ''}${skill.skillType ?? ''}${skill.effect ?? ''}${skill.desc ?? ''}${(skill.tags ?? []).join('')}`;
  return /蓄力|蓄势|充能|聚能|聚力|过载|引导|凝聚|积蓄|灌注|吟唱/.test(t);
}
/* 蓄力回合数：奥义/极道级 2 回合，其余 1 回合 */
function chargeTurns(skill?: Skill): number {
  const t = `${skill?.name ?? ''}${skill?.skillType ?? ''}${skill?.effect ?? ''}${skill?.level ?? ''}`;
  return /极道|奥义|大招|绝技|终极|毁灭|湮灭|本源|禁咒/.test(t) ? 2 : 1;
}

/* 领域/阵法识别：技能文本含领域类关键词（阵法归入领域，不单列） */
function isDomainSkill(skill?: Skill): boolean {
  if (!skill) return false;
  const t = `${skill.name ?? ''}${skill.skillType ?? ''}${skill.effect ?? ''}${skill.desc ?? ''}${(skill.tags ?? []).join('')}`;
  return /领域|结界|阵法|法阵|大阵|绝阵|场域|领地之|神域|封印之地|囚笼|阵图/.test(t);
}
/* 由技能推断领域档案（profile / 作用对象 / 每回合量 / 时限） */
function inferDomainSpec(skill: Skill, ownerMatk: number): Omit<DomainState, 'id' | 'ownerId' | 'ownerName' | 'side'> {
  const t = `${skill.name ?? ''}${skill.skillType ?? ''}${skill.effect ?? ''}${skill.desc ?? ''}${(skill.tags ?? []).join('')}`;
  const roundsLeft = /极道|奥义|无上|本源|大/.test(`${skill.name ?? ''}${skill.level ?? ''}`) ? 4 : 3;
  const name = skill.name || '领域';
  if (/治愈|生机|回春|治疗|疗愈|愈合|生命/.test(t)) return { name, emoji: '💚', profile: 'heal', affects: 'ally', amountPerRound: Math.max(1, Math.round(ownerMatk * 0.2)), roundsLeft, effectDesc: '我方每回合回血' };
  if (/守护|庇护|护持|护盾|金钟|铁壁|护罩/.test(t)) return { name, emoji: '🛡️', profile: 'shield', affects: 'ally', amountPerRound: Math.max(1, Math.round(ownerMatk * 0.5)), roundsLeft, effectDesc: '我方每回合获护盾' };
  if (/增幅|战意|狂暴|强化|加持|鼓舞|激励/.test(t)) return { name, emoji: '⚔️', profile: 'buff', affects: 'ally', amountPerRound: 0.25, roundsLeft, effectDesc: '我方攻击提升' };
  if (/禁锢|束缚|减速|凝滞|迟滞|囚|封印|镇压|压制|衰弱/.test(t)) return { name, emoji: '🕸️', profile: 'debuff', affects: 'enemy', amountPerRound: 0.25, roundsLeft, effectDesc: '敌方攻击下降' };
  return { name, emoji: '🌀', profile: 'damage', affects: 'enemy', amountPerRound: Math.max(1, Math.round(ownerMatk * 0.22)), roundsLeft, effectDesc: '敌方每回合受伤' };
}

/* 把参战者身上的状态修正汇总成有效攻防 + 是否被控制 */
function effCombatStats(c: Combatant, b: CombatStatBlock): { patk: number; matk: number; pdef: number; mdef: number; cannotAct: boolean } {
  let atkMult = 1, defMult = 1, cannotAct = false;
  for (const s of c.status) {
    const m = s.combat; if (!m) continue;
    atkMult += m.atkMult ?? 0;
    defMult += m.defMult ?? 0;
    if (m.cannotAct) cannotAct = true;
  }
  atkMult = Math.max(0.1, atkMult); defMult = Math.max(0.1, defMult);
  return {
    patk: Math.max(0, Math.round(b.patk * atkMult)), matk: Math.max(0, Math.round(b.matk * atkMult)),
    pdef: Math.max(0, Math.round(b.pdef * defMult)), mdef: Math.max(0, Math.round(b.mdef * defMult)),
    cannotAct,
  };
}

/* ── STS 原语读取（力量/敏捷/荆棘层数 + 易伤/虚弱/沉默标志） ── */
function effStr(c: Combatant): number { let n = 0; for (const s of c.status) { const v = s.combat?.strengthStacks; if (v) n += v; } return n; }
function effDex(c: Combatant): number { let n = 0; for (const s of c.status) { const v = s.combat?.dexterityStacks; if (v) n += v; } return n; }
function effThorns(c: Combatant): number { let n = 0; for (const s of c.status) { const v = s.combat?.thorns; if (v) n += v; } return n; }
function hasVuln(c: Combatant): boolean { return c.status.some((s) => !!s.combat?.vulnerable); }
function hasWeak(c: Combatant): boolean { return c.status.some((s) => !!s.combat?.weak); }
function isSilenced(c: Combatant): boolean { return c.status.some((s) => !!s.combat?.silenced); }

/* 不死/锁血保命标志（汇总当前生效的状态） */
function statusFlags(c: Combatant): { undying: boolean; hpLock: boolean } {
  let undying = false, hpLock = false;
  for (const s of c.status) { const m = s.combat; if (!m) continue; if (m.undying) undying = true; if (m.hpLock) hpLock = true; }
  return { undying, hpLock };
}
/* 对参战者扣 HP，遵守锁血(完全不掉)/不死(保底1)。返回实扣值 + 说明文案 */
function damageHp(c: Combatant, dmg: number): { lost: number; note: string } {
  if (dmg <= 0) return { lost: 0, note: '' };
  const f = statusFlags(c);
  if (f.hpLock) return { lost: 0, note: '（锁血·伤害被冻结）' };
  let newHp = c.curHp - dmg, note = '';
  if (f.undying && newHp < 1) { newHp = 1; note = '（不死·残血不灭）'; }
  newHp = Math.max(0, newHp);
  const lost = c.curHp - newHp;
  c.curHp = newHp;
  return { lost, note };
}

interface SkillStatusTpl { name: string; emoji: string; tone: 'buff' | 'debuff'; effect: string; rounds?: number; mod: CombatStatusMod; toEnemy: boolean }

/* 施加一条战斗状态（同名刷新）。source 用于嘲讽等需要回溯施法者的标签。 */
function applyCombatStatus(target: Combatant, tpl: SkillStatusTpl, round: number, source?: string) {
  const eff: StatusEffect = {
    id: `cs_${tpl.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: tpl.name, emoji: tpl.emoji, tone: tpl.tone, type: tpl.tone === 'buff' ? '增益' : '减益',
    effect: tpl.effect, startTurn: round, durationTurns: tpl.rounds, addedAt: Date.now(), combat: tpl.mod, source,
  };
  target.status = [...target.status.filter((s) => s.name !== tpl.name), eff];
}

/* 标签 → 状态模板（仅增益/减益/控制类标签；伤害/护盾/治疗等直接结算，不走这里） */
function buildStatusTpl(tag: CombatTag, e: CombatEffect, atkTier: number): SkillStatusTpl | null {
  const reg = TAG_REGISTRY[tag];
  const stacks = Math.max(1, e.stacks ?? 1);
  const rounds = e.turns;   // 可为 undefined
  switch (tag) {
    case 'strength': return { name: '力量', emoji: reg.emoji, tone: 'buff', effect: `造成伤害 +${stacks * 10}%`, rounds: rounds ?? 99, mod: { strengthStacks: stacks }, toEnemy: false };
    case 'dexterity': return { name: '敏捷', emoji: reg.emoji, tone: 'buff', effect: `格挡 +${stacks * 10}%`, rounds: rounds ?? 99, mod: { dexterityStacks: stacks }, toEnemy: false };
    case 'thorns': { const th = stacks * Math.max(1, Math.round(atkTier * 0.04)); return { name: '荆棘', emoji: reg.emoji, tone: 'buff', effect: `反弹 ${th} 点伤害`, rounds: rounds ?? 99, mod: { thorns: th }, toEnemy: false }; }   // 层数×攻击力档4%折成定值（平数值在高阶 HP 池前形同装饰）
    case 'regen': return { name: '再生', emoji: reg.emoji, tone: 'buff', effect: '每回合回复生命', rounds: rounds ?? 3, mod: { hotPerRound: Math.max(1, Math.round(stacks * atkTier * 0.05)) }, toEnemy: false };
    case 'vulnerable': return { name: '易伤', emoji: reg.emoji, tone: 'debuff', effect: '受到伤害 ×1.5', rounds: rounds ?? stacks, mod: { vulnerable: true }, toEnemy: true };
    case 'weak': return { name: '虚弱', emoji: reg.emoji, tone: 'debuff', effect: '造成伤害 ×0.75', rounds: rounds ?? stacks, mod: { weak: true }, toEnemy: true };
    case 'sunder': return { name: '碎甲', emoji: reg.emoji, tone: 'debuff', effect: `防御 −${stacks * 10}%`, rounds: rounds ?? 2, mod: { defMult: -0.1 * stacks }, toEnemy: true };
    case 'poison': { const pu = Math.max(1, Math.round(atkTier * 0.03)); return { name: '中毒', emoji: reg.emoji, tone: 'debuff', effect: `每回合掉血=层数×${pu}（${stacks} 层·每回合层数−1）`, rounds: undefined, mod: { poisonStacks: stacks, poisonUnit: pu }, toEnemy: true }; }   // 毒性单位锚定施毒者攻击档
    case 'burn': { const bd = Math.max(e.flat ?? 0, Math.round(atkTier * 0.12), 1); return { name: '燃烧', emoji: reg.emoji, tone: 'debuff', effect: `每回合损失 ${bd} 点生命`, rounds: rounds ?? 3, mod: { dotPerRound: bd }, toEnemy: true }; }   // flat 缺省/过小时按攻击档12%兜底
    case 'stun': return { name: '眩晕', emoji: reg.emoji, tone: 'debuff', effect: '无法行动', rounds: rounds ?? 1, mod: { cannotAct: true }, toEnemy: true };
    case 'silence': return { name: '沉默', emoji: reg.emoji, tone: 'debuff', effect: '无法使用技能', rounds: rounds ?? 1, mod: { silenced: true }, toEnemy: true };
    case 'taunt': return { name: '嘲讽', emoji: reg.emoji, tone: 'debuff', effect: '被迫优先攻击施法者', rounds: rounds ?? 2, mod: { taunt: true }, toEnemy: true };
    default: return null;
  }
}

/* ── BOSS 多阶段（通用·叙事强敌）：HP 首次跌破阈值 → 转阶段（文案+清减益/力量层/护盾/回血，全部复用现有机制）。
   调用点：dealDamage 命中后 + tickRoundStart DoT 后（触发追加压线的延迟到下次检查，phasesFired 保证不重不漏）。
   返回日志行（首行带【阶段】标记 → battleRecord KEY_RE 抓进战报「关键」段，润色 AI 据此写高潮）。 */
function fireBossPhases(state: BattleState, id: string): string[] {
  const c = state.participants[id]; const b = state.initialState[id];
  if (!c || !b?.bossPhases?.length || c.curHp <= 0 || c.left) return [];
  const lines: string[] = [];
  const fired = new Set(c.phasesFired ?? []);
  const ratio = c.curHp / Math.max(1, b.maxHp);
  for (const ph of b.bossPhases) {
    if (fired.has(ph.hpPct) || ratio > ph.hpPct) continue;
    fired.add(ph.hpPct);
    lines.push(`⚔️【阶段】${ph.announce}`);
    if (ph.cleanse) {
      const n = c.status.filter((s) => s.tone === 'debuff').length;
      c.status = c.status.filter((s) => s.tone !== 'debuff');
      if (n > 0) lines.push(`${b.name} 挣脱了全部减益（${n} 个）。`);
    }
    if (ph.strength) applyCombatStatus(c, { name: '力量', emoji: '💪', tone: 'buff', effect: `造成伤害 +${ph.strength * 10}%`, rounds: 99, mod: { strengthStacks: ph.strength }, toEnemy: false }, state.round);
    if (ph.shieldPct) { const amt = Math.max(1, Math.round(b.maxHp * ph.shieldPct)); c.curShield += amt; c.maxShield = Math.max(c.maxShield, c.curShield); lines.push(`${b.name} 凝起 ${amt} 点护体屏障。`); }
    if (ph.healPct) { const before = c.curHp; c.curHp = Math.min(b.maxHp, c.curHp + Math.max(1, Math.round(b.maxHp * ph.healPct))); if (c.curHp > before) lines.push(`${b.name} 回复 ${c.curHp - before} 点生命。`); }
  }
  c.phasesFired = [...fired];
  return lines;
}

/* 回合开始结算：持续伤害(燃烧/中毒)/持续治疗 + 状态过期 + 小回蓝（advanceTurn 进入新一轮时调用） */
export function tickRoundStart(state: BattleState): void {
  // 战场词缀（P1）：燃烧/中毒 DoT 与回蓝倍率（灼日助燃/雨幕压火/瘴泽助毒/灵潮回蓝…）
  const bfBurn = bfNum(state.battlefieldAffixes, 'burnDotMult');
  const bfPoison = bfNum(state.battlefieldAffixes, 'poisonDotMult');
  const bfEp = bfNum(state.battlefieldAffixes, 'epRegenMult');
  for (const id of state.order) {
    const c = state.participants[id]; const b = state.initialState[id];
    if (!c || !b || c.left) continue;
    let dot = 0, hot = 0;
    for (const s of c.status) { const mm = s.combat; if (!mm) continue; if (mm.dotPerRound) dot += Math.max(1, Math.round(mm.dotPerRound * (/燃烧|灼烧|点燃/.test(s.name || '') ? bfBurn : 1))); if (mm.hotPerRound) hot += mm.hotPerRound; if (mm.poisonStacks) dot += Math.max(1, Math.round(mm.poisonStacks * Math.max(1, mm.poisonUnit ?? 1) * bfPoison)); }   // 毒伤=层数×毒性单位（旧档无 unit 视为 1）×词缀
    if (c.curHp > 0 && dot > 0) {
      const { lost, note } = damageHp(c, dot);
      addStat(c, 'taken', lost);   // DoT 承伤计入统计（无明确归属方，不计 dealt）
      if (lost > 0 || note) state.log.push({ id: newLogId(), round: state.round, type: 'system', actorId: id, text: `${b.name} 受到持续效果 ${lost} 点伤害${note}。`, timestamp: Date.now() });
      for (const ln of fireBossPhases(state, id)) state.log.push({ id: newLogId(), round: state.round, type: 'system', actorId: id, text: ln, timestamp: Date.now() });   // DoT 压过阶段线也转阶段
    }
    if (c.curHp > 0 && hot > 0) {
      const before = c.curHp; c.curHp = Math.min(b.maxHp, c.curHp + hot);
      if (c.curHp > before) state.log.push({ id: newLogId(), round: state.round, type: 'system', actorId: id, text: `${b.name} 持续回复 ${c.curHp - before} 点生命。`, timestamp: Date.now() });
    }
    if (c.curHp > 0) c.curEp = Math.min(b.maxEp, c.curEp + Math.max(3, Math.round(b.maxEp * EP_REGEN_RATE * bfEp)));   // 每回合小回蓝 ×词缀（灵潮/荒芜）
    // 中毒层数每回合 −1
    for (const s of c.status) { if (s.combat?.poisonStacks) s.combat.poisonStacks -= 1; }
    // 过期：毒层耗尽即移除；其余按 durationTurns
    c.status = c.status.filter((s) => {
      if (s.combat?.poisonStacks != null && s.combat.poisonStacks <= 0) return false;
      return s.durationTurns == null || (state.round - (s.startTurn ?? state.round)) < s.durationTurns;
    });
  }

  // 领域/阵法每回合结算（主人倒下则消散）
  const domains = state.activeArrays ?? [];
  if (domains.length > 0) {
    const surviving: DomainState[] = [];
    for (const d of domains) {
      const owner = state.participants[d.ownerId];
      if (!owner || owner.left || owner.curHp <= 0) {
        state.log.push({ id: newLogId(), round: state.round, type: 'system', text: `领域「${d.name}」随 ${d.ownerName} 倒下而消散。`, timestamp: Date.now() });
        continue;
      }
      const targetSide: Side = d.affects === 'enemy' ? (d.side === 'player' ? 'enemy' : 'player') : d.side;
      const ids = state.order.filter((tid) => state.participants[tid]?.side === targetSide && !state.participants[tid]?.left && state.participants[tid]?.curHp > 0);
      for (const tid of ids) {
        const c = state.participants[tid]; const bl = state.initialState[tid];
        if (!c || !bl) continue;
        if (d.profile === 'damage') damageHp(c, d.amountPerRound);
        else if (d.profile === 'heal') c.curHp = Math.min(bl.maxHp, c.curHp + d.amountPerRound);
        else if (d.profile === 'shield') { c.curShield = Math.max(c.curShield, d.amountPerRound); c.maxShield = Math.max(c.maxShield, d.amountPerRound); }
        else if (d.profile === 'buff') applyCombatStatus(c, { name: '领域加持', emoji: '⚔️', tone: 'buff', effect: '攻击提升', rounds: 1, mod: { atkMult: d.amountPerRound }, toEnemy: false }, state.round);
        else if (d.profile === 'debuff') applyCombatStatus(c, { name: '领域压制', emoji: '🕸️', tone: 'debuff', effect: '攻击下降', rounds: 1, mod: { atkMult: -d.amountPerRound }, toEnemy: true }, state.round);
      }
      const verb = d.profile === 'damage' ? '灼烧' : d.profile === 'heal' ? '滋养' : d.profile === 'shield' ? '护持' : d.profile === 'buff' ? '加持' : '压制';
      if (ids.length > 0) state.log.push({ id: newLogId(), round: state.round, type: 'system', text: `领域「${d.name}」${verb}${d.affects === 'enemy' ? '敌方' : '我方'} ${ids.length} 人${(d.profile === 'damage' || d.profile === 'heal') ? `（${d.amountPerRound} 点）` : ''}。`, timestamp: Date.now() });
      d.roundsLeft -= 1;
      if (d.roundsLeft > 0) surviving.push(d);
      else state.log.push({ id: newLogId(), round: state.round, type: 'system', text: `领域「${d.name}」力竭消散。`, timestamp: Date.now() });
    }
    state.activeArrays = surviving;
  }
}

/* 道具战斗效果：关键词推断（炸弹→伤害、毒瓶→DoT、丹药→回血、药剂→回蓝/增益、护身符→护盾、解毒丹→解控） */
export interface ItemEffect { kind: 'damage' | 'dot' | 'heal' | 'restoreEp' | 'shield' | 'buff' | 'cleanse' | 'none'; amount: number; aoe: boolean; toEnemy: boolean; name: string; grade: number }
export function inferItemEffect(item: any): ItemEffect {   // 导出：敌人 AI「濒死吃药」复用同一判定（单一来源）
  const t = `${item?.name ?? ''}${item?.subType ?? ''}${item?.effect ?? ''}${(item?.tags ?? []).join('')}`;
  const grade = Math.max(1, (item?.numeric?.grade as number) ?? gradeToNum(item?.gradeDesc));
  const base = grade * 50;
  const m = /(\d{2,6})/.exec(`${item?.effect ?? ''}`);     // 取效果里第一个≥2位数字作威能
  const num = m ? Number(m[1]) : 0;
  const amount = num > 0 ? num : base;
  const name = item?.name ?? '道具';
  const aoe = /范围|全体|群|溅射|波及|周围|所有/.test(t);
  const R = (r: Omit<ItemEffect, 'grade'>): ItemEffect => ({ ...r, grade });
  if (/炸弹|手雷|爆|燃烧弹|火焰弹|雷弹|轰|霰弹|爆裂/.test(t) && !/护|防/.test(t)) return R({ kind: 'damage', amount: Math.max(1, num || base * 2), aoe, toEnemy: true, name });
  if (/毒瓶|毒弹|剧毒|腐蚀|酸液/.test(t)) return R({ kind: 'dot', amount: Math.max(1, Math.round((num || base) * 0.4)), aoe, toEnemy: true, name });
  if (/解控|解除|净化|驱散|解毒|清醒|镇定|醒神|脱困/.test(t)) return R({ kind: 'cleanse', amount: 0, aoe, toEnemy: false, name });
  if (/(法力|蓝|EP|精力|能量|内力|真元)/.test(t) && /回复|恢复|补充|回/.test(t)) return R({ kind: 'restoreEp', amount, aoe, toEnemy: false, name });
  if (/护盾|护身|护体|护罩|金钟/.test(t)) return R({ kind: 'shield', amount, aoe, toEnemy: false, name });
  if (/增益|强化|狂暴|战意|力量药|提升|爆发药|附魔/.test(t) && !/伤害|攻击/.test(t)) return R({ kind: 'buff', amount: 0, aoe, toEnemy: false, name });
  if (/生命|血|HP|气血|治疗|疗|愈|回血/.test(t)) return R({ kind: 'heal', amount, aoe, toEnemy: false, name });
  if (/丹|药|灵药|消耗品|针剂|喷雾|果/.test(`${item?.category ?? ''}${t}`)) return R({ kind: 'heal', amount: base, aoe: false, toEnemy: false, name });
  return R({ kind: 'none', amount: 0, aoe: false, toEnemy: false, name });
}

export interface SettleOutcome {
  state: BattleState;
  logLines: string[];        // 结算明细（攒进战斗日志，结束时压成 BATTLE_RECORD）
  actorName: string;
  defeated: string[];        // 本次出手被打到 HP≤0 的参战者 id
  consumedItem?: { id: string; qty: number };   // 本次用掉的道具（由调用方从背包扣除）
}

/* 结算一次出手（玩家或 NPC）。kind: attack/skill/item/defend/flee/charge/cancel。全确定性、必中。 */
export function settleAction(opts: {
  state: BattleState;
  actorId: string;
  kind: CombatActionKind;
  targetIds: string[];
  skillId?: string;
  itemId?: string;
  actionText?: string;
}): SettleOutcome {
  const state: BattleState = structuredClone(opts.state);
  const actor = state.participants[opts.actorId];
  const actorBlock = state.initialState[opts.actorId];
  const actorName = actorBlock?.name ?? opts.actorId;
  const logLines: string[] = [];
  const defeated: string[] = [];
  if (!actor || !actorBlock) return { state, logLines, actorName, defeated };

  const rng = seeded(`${state.battleId}|${state.round}|${state.turn}|${opts.actorId}`);   // 暴击/触发判定（条件触发系统 C）
  const myPassive: PassiveMod = actorBlock.passive ?? {};                                   // 出手方常驻被动修正
  fireTriggers('turnStart', opts.actorId);                                                   // 回合开始触发（再生/聚气等，控制下也触发）

  const controlled = effCombatStats(actor, actorBlock).cannotAct;
  // 蓄力中被控制 → 大招溃散
  if (actor.charging && controlled) {
    logLines.push(`${actorName} 蓄力被打断（被控制），「${actor.charging.name}」溃散。`);
    delete actor.charging;
    return { state, logLines, actorName, defeated };
  }
  if (controlled) {
    logLines.push(`${actorName} 被控制，本回合无法行动。`);
    return { state, logLines, actorName, defeated };
  }

  const sfxOn = useCombat.getState().config?.sfxOn !== false;   // 战斗音效开关（默认开）
  const abilities = fetchAbilities(opts.actorId);
  let skill: Skill | undefined;
  let targetIds = opts.targetIds;
  let chargeMult = 1;
  let resBoostMult = 1;   // 资源爆发档（B1 技能付出 numeric.resCost 绑定的能量条消耗 → ×1.3；见下方资源判定）

  if (actor.charging) {
    // ── 蓄力中：继续灌注 / 释放 / 中断 ──
    const ch = actor.charging;
    if (opts.kind === 'cancel') {
      logLines.push(`${actorName} 中断了「${ch.name}」的蓄力。`);
      delete actor.charging;
      return { state, logLines, actorName, defeated };
    }
    if (actor.curEp < ch.epPerTurn) {
      logLines.push(`${actorName} 法力不足，「${ch.name}」蓄力中断。`);
      delete actor.charging;
      return { state, logLines, actorName, defeated };
    }
    actor.curEp = Math.max(0, actor.curEp - ch.epPerTurn);
    ch.turnsLeft -= 1;
    if (ch.turnsLeft > 0) {
      logLines.push(`${actorName} 持续蓄力「${ch.name}」，威能积蓄中（还需 ${ch.turnsLeft} 回合）。`);
      return { state, logLines, actorName, defeated };
    }
    // 释放！
    skill = abilities.skills.find((s: Skill) => s.id === ch.skillId || s.name === ch.name);
    targetIds = ch.targetIds;
    chargeMult = 1 + 0.8 * ch.turnsTotal;
    if (skill) { const cd = Math.max(0, parseCooldownRounds(skill) - (myPassive.cdr ?? 0)); if (cd > 0) actor.cooldowns[skill.id] = cd; }
    delete actor.charging;
    logLines.push(`${actorName} 蓄力完成，「${ch.name}」轰然释放！`);
  } else {
    // ── 非蓄力分支 ──
    if (opts.kind === 'defend') { actor.defending = true; const ep = Math.max(5, Math.round(actorBlock.maxEp * EP_REGEN_RATE * 2 * bfNum(state.battlefieldAffixes, 'epRegenMult'))); actor.curEp = Math.min(actorBlock.maxEp, actor.curEp + ep); logLines.push(`${actorName} 摆出防御姿态，本回合承受伤害减半，回复 ${ep} 点 EP。`); fireTriggers('onDefend', opts.actorId); return { state, logLines, actorName, defeated }; }
    if (opts.kind === 'protect') {
      const tgt = opts.targetIds.find((id) => state.participants[id] && !state.participants[id].left && state.participants[id].curHp > 0 && state.initialState[id]?.side === actorBlock.side && id !== opts.actorId);
      if (!tgt) { logLines.push(`${actorName} 没有可保护的队友。`); return { state, logLines, actorName, defeated }; }
      state.participants[tgt].guardedBy = opts.actorId;
      actor.defending = true;   // 保护者自身也进入防御姿态，替挡时少受伤
      logLines.push(`${actorName} 挺身护住 ${state.initialState[tgt]?.name ?? tgt}，本回合替其挡下来袭。`);
      return { state, logLines, actorName, defeated };
    }
    if (opts.kind === 'flee') { actor.left = true; state.order = state.order.filter((id) => id !== opts.actorId); logLines.push(`${actorName} 脱离了战斗。`); return { state, logLines, actorName, defeated }; }
    if (opts.kind === 'charge' || opts.kind === 'cancel') { logLines.push(`${actorName} 当前没有可蓄力的大招。`); return { state, logLines, actorName, defeated }; }

    // ── 用道具（炸弹/药剂/丹药/炼金等；威能为道具自身、不随六维）──
    if (opts.kind === 'item') {
      const inv = opts.actorId === 'B1' ? useItems.getState().items
        : opts.actorId.startsWith('MP_') ? (mpCombatItems[opts.actorId] ?? [])   // 联机来宾道具：房主从注册表读
        : (useNpc.getState().npcs[opts.actorId]?.items ?? []);
      const item = inv.find((i: any) => i.id === opts.itemId || i.name === opts.itemId);
      if (!item || (item.quantity ?? 1) <= 0) { logLines.push(`${actorName} 没有可用的道具。`); return { state, logLines, actorName, defeated }; }
      const ie = inferItemEffect(item);
      // P0 锚定：道具平数值（品级×50/文本数字）在高阶 HP/EP 池前形同挠痒 → 伤害类以使用者攻击档、恢复类以目标上限设下限（与原文数值取大，尊重更大的 authored 值）
      const uEff = effCombatStats(actor, actorBlock);
      const atkAnchor = Math.max(uEff.patk, uEff.matk);
      const dmgFloor = Math.round(atkAnchor * (0.5 + ie.grade * 0.1) * DMG_SCALE);
      const recovPct = Math.min(0.5, 0.06 + ie.grade * 0.02);
      const eSide: Side = actorBlock.side === 'player' ? 'enemy' : 'player';
      const pick = (ids: string[], side: Side) => ids.filter((id) => state.participants[id] && !state.participants[id].left && state.participants[id].curHp > 0 && state.initialState[id]?.side === side);
      if (ie.kind === 'damage' || ie.kind === 'dot') {
        let tg = ie.aoe ? aliveIds(state, eSide) : pick(opts.targetIds, eSide);
        if (tg.length === 0) tg = aliveIds(state, eSide).slice(0, 1);
        for (const tid of tg) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          if (ie.kind === 'damage') { const { lost, note } = damageHp(tc, Math.max(ie.amount, dmgFloor)); logLines.push(`${actorName} 投出「${ie.name}」，${tb.name} 受到 ${lost} 点伤害${note}。`); addStat(actor, 'dealt', lost); addStat(tc, 'taken', lost); noteMaxHit(state, opts.actorId, tid, lost, `「${ie.name}」`); if (tc.curHp <= 0 && !defeated.includes(tid)) defeated.push(tid); }
          else { const pStacks = Math.min(15, Math.max(3, Math.round(ie.amount / 3))); const pUnit = Math.max(1, Math.round(atkAnchor * 0.03)); applyCombatStatus(tc, { name: '中毒', emoji: '🧪', tone: 'debuff', effect: `中毒（${pStacks} 层×${pUnit}/回合）`, mod: { poisonStacks: pStacks, poisonUnit: pUnit }, toEnemy: true }, state.round); logLines.push(`${actorName} 用「${ie.name}」使 ${tb.name} 中毒。`); }
        }
      } else {
        let tg = ie.aoe ? aliveIds(state, actorBlock.side) : pick(opts.targetIds, actorBlock.side);
        if (tg.length === 0) tg = [opts.actorId];
        for (const tid of tg) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          if (ie.kind === 'heal') { const amt = Math.max(ie.amount, Math.round(tb.maxHp * recovPct)); const before = tc.curHp; tc.curHp = Math.min(tb.maxHp, tc.curHp + amt); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 回复 ${tc.curHp - before} 点生命。`); addStat(actor, 'healed', tc.curHp - before); }
          else if (ie.kind === 'restoreEp') { const amt = Math.max(ie.amount, Math.round(tb.maxEp * recovPct)); const before = tc.curEp; tc.curEp = Math.min(tb.maxEp, tc.curEp + amt); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 回复 ${tc.curEp - before} 点 EP。`); }
          else if (ie.kind === 'shield') { const amt = Math.max(ie.amount, Math.round(tb.maxHp * Math.min(0.4, 0.05 + ie.grade * 0.015))); tc.curShield = Math.max(tc.curShield, amt); tc.maxShield = Math.max(tc.maxShield, amt); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 罩上 ${amt} 点护盾。`); }
          else if (ie.kind === 'buff') { applyCombatStatus(tc, { name: '力量', emoji: '💪', tone: 'buff', effect: '攻击提升', rounds: 3, mod: { strengthStacks: 3 }, toEnemy: false }, state.round); logLines.push(`${actorName} 用「${ie.name}」强化了 ${tb.name} 的攻击。`); }
          else if (ie.kind === 'cleanse') { const n = tc.status.filter((s) => s.tone === 'debuff' || s.combat?.cannotAct).length; tc.status = tc.status.filter((s) => !(s.tone === 'debuff' || s.combat?.cannotAct)); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 解除了 ${n} 个负面状态。`); }
          else logLines.push(`${actorName} 使用了「${ie.name}」。`);
        }
      }
      return { state, logLines, actorName, defeated, consumedItem: { id: item.id, qty: 1 } };
    }

    skill = opts.skillId ? abilities.skills.find((s: Skill) => s.id === opts.skillId || s.name === opts.skillId) : undefined;
    // 沉默 → 退化普攻
    if (opts.kind === 'skill' && skill && isSilenced(actor)) {
      logLines.push(`${actorName} 被沉默，无法施展「${skill.name}」，改为普通攻击。`);
      skill = undefined;
    }
    // 冷却 → 退化普攻
    if (opts.kind === 'skill' && skill && (actor.cooldowns[skill.id] ?? 0) > 0) {
      logLines.push(`${actorName} 的「${skill.name}」尚在冷却（剩 ${actor.cooldowns[skill.id]} 回合），改为普通攻击。`);
      skill = undefined;
    }
    // 自定义能量条（主角⚡面板绑定的 numeric.resCost/resGate·P3 把扣点从面板挪进引擎=autoBattle 代打路径也正确）：
    // 门槛未达/点数不足 → 退化普攻（面板已拦，此处兜底）；付出消耗 → 本次伤害进爆发档 ×1.3。
    // 引用已删能量条 → 视为无消耗不拦不扣（既有语义）；扣点与道具消耗同口径：撤销出手不返还。
    if (opts.kind === 'skill' && skill && opts.actorId === 'B1') {
      try {
        const rs = useResource.getState();
        const gRaw = (skill as any)?.numeric?.resGate as { id?: string; amount?: number } | undefined;
        const gBar = gRaw?.id && (gRaw.amount ?? 0) > 0 ? rs.resources.find((r) => r.id === gRaw.id) : undefined;
        if (gBar && gBar.cur < (gRaw?.amount ?? 0)) {
          logLines.push(`${actorName} 的${gBar.name}未达「${skill.name}」的门槛（需 ≥${gRaw?.amount}），改为普通攻击。`);
          skill = undefined;
        }
        const rcRaw = skill ? ((skill as any)?.numeric?.resCost as { id?: string; amount?: number } | undefined) : undefined;
        const rcBar = rcRaw?.id && (rcRaw.amount ?? 0) > 0 ? rs.resources.find((r) => r.id === rcRaw.id) : undefined;
        if (skill && rcBar) {
          if (rcBar.cur < (rcRaw?.amount ?? 0)) {
            logLines.push(`${actorName} 的${rcBar.name}不足（需 ${rcRaw?.amount}），「${skill.name}」未能施展，改为普通攻击。`);
            skill = undefined;
          } else {
            rs.setCur(rcBar.id, rcBar.cur - (rcRaw?.amount ?? 0));
            resBoostMult = RES_BOOST_MULT;
            logLines.push(`${actorName} 倾注 ${rcRaw?.amount} 点${rcBar.name}，「${skill.name}」进入爆发态！`);
          }
        }
      } catch {}
    }
    // 蓄力技能 → 进入蓄力
    if (opts.kind === 'skill' && skill && isChargeSkill(skill)) {
      const tt = chargeTurns(skill);
      const epPerTurn = Math.max(1, Math.round(effectiveSkillCost(skill, actorBlock.maxEp) * 0.5));
      if (actor.curEp < epPerTurn) {
        logLines.push(`${actorName} 法力不足，无法发动蓄力技「${skill.name}」，改为普通攻击。`);
        skill = undefined;
      } else {
        actor.curEp = Math.max(0, actor.curEp - epPerTurn);
        const eside: Side = actorBlock.side === 'player' ? 'enemy' : 'player';
        const lock = opts.targetIds.length ? opts.targetIds : aliveIds(state, eside).slice(0, 1);
        actor.charging = { skillId: skill.id, name: skill.name, targetIds: lock, turnsTotal: tt, turnsLeft: tt, epPerTurn };
        logLines.push(`${actorName} 开始蓄力「${skill.name}」，威能积蓄（共 ${tt} 回合）……`);
        return { state, logLines, actorName, defeated };
      }
    }
    // 领域技能 → 展开领域（持续每回合生效，本回合不出伤）
    if (opts.kind === 'skill' && skill && isDomainSkill(skill)) {
      const cost = effectiveSkillCost(skill, actorBlock.maxEp);
      if (cost > 0 && actor.curEp < cost) {
        logLines.push(`${actorName} 法力不足，无法展开领域「${skill.name}」，改为普通攻击。`);
        skill = undefined;
      } else {
        if (cost > 0) actor.curEp = Math.max(0, actor.curEp - cost);
        const cd = Math.max(0, parseCooldownRounds(skill) - (myPassive.cdr ?? 0)); if (cd > 0) actor.cooldowns[skill.id] = cd;
        const dspec = inferDomainSpec(skill, actorBlock.matk);
        const dom: DomainState = { id: `dom_${opts.actorId}_${Date.now()}`, ownerId: opts.actorId, ownerName: actorName, side: actorBlock.side, ...dspec };
        state.activeArrays = [...(state.activeArrays ?? []).filter((d) => d.ownerId !== opts.actorId), dom];
        logLines.push(`${actorName} 展开领域【${dom.emoji}${dom.name}】（${dom.effectDesc}，持续 ${dom.roundsLeft} 回合）。`);
        return { state, logLines, actorName, defeated };
      }
    }
    // 普通技能 EP + 冷却（消耗=effectiveSkillCost：authored 与品级×maxEp 百分比取大）
    if (opts.kind === 'skill' && skill) {
      const cost = effectiveSkillCost(skill, actorBlock.maxEp);
      if (cost > 0 && actor.curEp < cost) { logLines.push(`${actorName} 法力不足（需 ${cost} EP），「${skill.name}」未能施展，改为普通攻击。`); skill = undefined; }
      else if (cost > 0) actor.curEp = Math.max(0, actor.curEp - cost);
      if (skill) { const cd = Math.max(0, parseCooldownRounds(skill) - (myPassive.cdr ?? 0)); if (cd > 0) actor.cooldowns[skill.id] = cd; }
    }
  }

  // ===== 标签 VM 施放（普通技能 / 普攻 / 蓄力释放共用）=====
  const spec: CombatSpec = skill ? parseCombatSpec(skill as any) : { target: 'enemy', effects: [{ tag: 'deal', mult: 1.0, times: 1 }] };
  const magic = isMagicSkill(skill);
  // 战场词缀（P1 环境入数值）：元素通道倍率（雨压火/沼助毒…）+ 护盾获取倍率——previewAction 有同款镜像，改这里必须同步
  const skillText = skill ? `${skill.name ?? ''}${skill.skillType ?? ''}${skill.damage ?? ''}${skill.effect ?? ''}` : '';
  const env = bfElementMult(state.battlefieldAffixes, skillText);
  const elem = skillElement(skillText);   // 技能元素通道（元素反应 P3 用；与词缀同一嗅探）
  const envTag = env.mult !== 1 ? `（${env.by}${env.mult > 1 ? '+' : ''}${Math.round((env.mult - 1) * 100)}%）` : '';
  const bfBlock = bfNum(state.battlefieldAffixes, 'blockMult');
  const label = (skill ? `「${skill.name}」` : '普通攻击') + (chargeMult > 1 ? '·蓄力' : '');
  if (skill) actor.lastSkillIds = [skill.id, ...(actor.lastSkillIds ?? [])].slice(0, 2);   // 记最近两次施放（敌AI「不连放同技」读取）
  const myEff = effCombatStats(actor, actorBlock);
  const atkTier = magic ? myEff.matk : myEff.patk;
  const allySide: Side = actorBlock.side;
  const enemySide: Side = allySide === 'player' ? 'enemy' : 'player';
  const selected = targetIds.filter((id) => state.participants[id] && !state.participants[id].left);

  for (const e of spec.effects) runEffect(e, spec.target);
  return { state, logLines, actorName, defeated };

  // ───────── 标签执行闭包（捕获本场上下文） ─────────
  function pushDefeated(id: string) { if (!defeated.includes(id)) defeated.push(id); }

  function sideFor(tag: CombatTag, mode?: TargetMode): 'ally' | 'enemy' {
    if (mode === 'self' || mode === 'ally' || mode === 'allAlly') return 'ally';
    if (mode === 'enemy' || mode === 'allEnemy') return 'enemy';
    return ENEMY_TAGS.has(tag) ? 'enemy' : 'ally';
  }

  function targetsFor(e: CombatEffect, specTarget?: TargetMode): string[] {
    const mode = e.target ?? specTarget;
    const side = sideFor(e.tag, mode);
    const wantSide = side === 'ally' ? allySide : enemySide;
    if (mode === 'self') return [opts.actorId];
    const all = mode === 'all' || mode === 'allAlly' || mode === 'allEnemy';
    if (all) return aliveIds(state, wantSide);
    const picked = selected.filter((id) => state.initialState[id]?.side === wantSide && state.participants[id].curHp > 0);
    if (picked.length) return picked;
    return side === 'ally' ? [opts.actorId] : aliveIds(state, enemySide).slice(0, 1);
  }

  function runEffect(e: CombatEffect, specTarget?: TargetMode) {
    const ids = targetsFor(e, specTarget);
    switch (e.tag) {
      case 'deal': case 'pierce': case 'lifesteal': case 'execute': {
        const times = Math.max(1, (e.times ?? 1) + (e.tag === 'deal' ? (myPassive.extraHits ?? 0) : 0));   // 被动多段：deal 额外段数
        for (const tid of ids) for (let n = 0; n < times; n++) {
          const tc = state.participants[tid];
          if (!tc || tc.left || tc.curHp <= 0) break;
          dealDamage(tid, e);
        }
        break;
      }
      case 'detonate': {
        // 引爆（P3·DoT 收口）：把目标未来的持续伤害提前一次性结算 ×1.5 并清除——DoT 本身是真伤（不过防御链），提前结算亦然
        const bfBurn = bfNum(state.battlefieldAffixes, 'burnDotMult');
        const bfPoison = bfNum(state.battlefieldAffixes, 'poisonDotMult');
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid];
          if (!tc || !tb || tc.left || tc.curHp <= 0) continue;
          const total = detonatableAmount(tc, state.round, bfBurn, bfPoison);
          if (total <= 0) { logLines.push(`${actorName} 的${label}没有找到可引爆的持续伤害。`); continue; }
          tc.status = tc.status.filter((s) => !(s.tone === 'debuff' && (s.combat?.dotPerRound || s.combat?.poisonStacks)));
          const { lost, note } = damageHp(tc, Math.max(1, Math.round(total * 1.5)));
          logLines.push(`${actorName} 以${label}引爆 ${tb.name} 身上的毒火沉疴，轰出 ${lost} 点真实伤害${note}！`);
          addStat(actor, 'dealt', lost); addStat(tc, 'taken', lost); noteMaxHit(state, opts.actorId, tid, lost, `${label}·引爆`);
          if (sfxOn) playSfx('crit');
          if (tc.curHp <= 0) pushDefeated(tid);
          logLines.push(...fireBossPhases(state, tid));
          fireTriggers('onHit', opts.actorId, tid);
          fireTriggers('onHurt', tid, opts.actorId);
          if (tc.curHp <= 0) fireTriggers('onKill', opts.actorId, tid);
        }
        break;
      }
      case 'block': {
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          const defTier = effCombatStats(tc, tb).pdef;
          const amt = Math.max(1, Math.round((blockRaw(e, defTier) + dexterityBonus(effDex(tc), defTier)) * bfBlock));   // ×战场词缀护盾倍率（断壁/迷雾）
          tc.curShield += amt; tc.maxShield = Math.max(tc.maxShield, tc.curShield);
          logLines.push(`${actorName} 以${label}为 ${tb.name} 凝起 ${amt} 点护盾。`);
        }
        break;
      }
      case 'heal': {
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          const amt = healAmount(e, atkTier);
          const before = tc.curHp; tc.curHp = Math.min(tb.maxHp, tc.curHp + amt);
          logLines.push(`${actorName} 以${label}为 ${tb.name} 回复 ${tc.curHp - before} 点生命。`);
          addStat(actor, 'healed', tc.curHp - before);
        }
        break;
      }
      case 'restore': {
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          const amt = restoreAmount(e.flat, tb.maxEp, atkTier);
          const before = tc.curEp; tc.curEp = Math.min(tb.maxEp, tc.curEp + amt);
          logLines.push(`${actorName} 以${label}为 ${tb.name} 回复 ${tc.curEp - before} 点 EP。`);
        }
        break;
      }
      case 'cleanse': {
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          const n = tc.status.filter((s) => s.tone === 'debuff').length;
          tc.status = tc.status.filter((s) => s.tone !== 'debuff');
          logLines.push(`${actorName} 以${label}为 ${tb.name} 净化了 ${n} 个减益。`);
        }
        break;
      }
      case 'dispel': {
        for (const tid of ids) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          const n = tc.status.filter((s) => s.tone === 'buff').length;
          tc.status = tc.status.filter((s) => s.tone !== 'buff');
          logLines.push(`${actorName} 以${label}驱散了 ${tb.name} 的 ${n} 个增益。`);
        }
        break;
      }
      default: {
        // 增益/减益/控制类标签 → 施加状态（含 taunt 记 source=施法者，供敌人 AI 读取）
        const tpl = buildStatusTpl(e.tag, e, atkTier);
        if (tpl) {
          for (const tid of ids) {
            const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb || tc.left) continue;
            applyCombatStatus(tc, tpl, state.round, opts.actorId);
            logLines.push(`${actorName} 以${label}使 ${tb.name} ${tpl.tone === 'buff' ? '获得' : '陷入'}【${tpl.emoji}${tpl.name}】（${tpl.effect}）。`);
          }
        } else {
          logLines.push(`${actorName} 施放了${label}。`);
        }
        break;
      }
    }
  }

  function dealDamage(tidIn: string, e: CombatEffect) {
    let tid = tidIn;
    // 保护：被守护者受攻击 → 改由保护者(仍在场·同阵营·非攻击者)承受
    const g0 = state.participants[tidIn];
    if (g0?.guardedBy) {
      const prot = state.participants[g0.guardedBy]; const protB = state.initialState[g0.guardedBy];
      if (prot && protB && !prot.left && prot.curHp > 0 && g0.guardedBy !== tidIn && g0.guardedBy !== opts.actorId && protB.side === state.initialState[tidIn]?.side) {
        logLines.push(`${protB.name} 挺身替 ${state.initialState[tidIn]?.name ?? tidIn} 挡下攻击！`);
        tid = g0.guardedBy;
      }
    }
    const tc = state.participants[tid]; const tb = state.initialState[tid];
    if (!tc || !tb) return;
    const defTier = magic ? effCombatStats(tc, tb).mdef : effCombatStats(tc, tb).pdef;
    // 斩杀：目标 HP 占比 ≤ 阈值 → 直接打到 0（仍遵守锁血/不死）
    if (e.tag === 'execute' && tc.curHp / Math.max(1, tb.maxHp) <= EXECUTE_THRESHOLD) {
      const { lost, note } = damageHp(tc, tc.curHp + 1);
      logLines.push(`${actorName} 以${label}对濒死的 ${tb.name} 发动斩杀，造成 ${lost} 点伤害${note}。`);
      addStat(actor, 'dealt', lost); addStat(tc, 'taken', lost); noteMaxHit(state, opts.actorId, tid, lost, label);
      if (sfxOn) playSfx('crit');
      if (tc.curHp <= 0) pushDefeated(tid);
      return;
    }
    const tPass: PassiveMod = tb.passive ?? {};   // 守方常驻被动（减伤等）
    const react = elementReaction(elem, tc);      // 元素反应（P3）：蒸汽×1.25 / 感电触发眩晕
    const pipe = damagePipeline({
      base: (e.mult ?? 0) * atkTier + (e.flat ?? 0), atkTier, defTier,
      strengthStacks: effStr(actor), attackerWeak: hasWeak(actor), targetVulnerable: hasVuln(tc),
      chargeMult, envMult: env.mult * react.mult, resBoostMult,
      dmgDealtPct: myPassive.dmgDealtPct, dmgTakenPct: tPass.dmgTakenPct, pierce: myPassive.pierce,
      targetDefending: tc.defending,
      critChance: myPassive.critChance, critMult: myPassive.critMult, rng,
    });
    let dmg = pipe.dmg;
    const crit = pipe.crit;   // 被动：暴击
    let absorbed = 0;
    if (e.tag !== 'pierce' && tc.curShield > 0) { absorbed = Math.min(tc.curShield, dmg); tc.curShield -= absorbed; dmg -= absorbed; }
    const { lost, note } = damageHp(tc, dmg);
    const shieldTag = absorbed > 0 ? `（护盾抵消 ${absorbed}）` : '';
    const pierceTag = e.tag === 'pierce' ? '（穿透）' : '';
    logLines.push(`${actorName} ${label}${crit ? '·暴击' : ''} 命中 ${tb.name}，造成 ${lost} 点伤害${note}${shieldTag}${pierceTag}${envTag}。`);
    addStat(actor, 'dealt', lost + absorbed); addStat(tc, 'taken', lost + absorbed); noteMaxHit(state, opts.actorId, tid, lost + absorbed, label + (crit ? '·暴击' : ''));   // 打掉的护盾也算输出
    if (sfxOn) playSfx(crit ? 'crit' : 'hit');
    // 元素反应副作用（真结算才执行；preview 只吃倍率）
    if (react.kind === 'steam') {
      tc.status = tc.status.filter((s) => !(s.tone === 'debuff' && !!s.combat?.dotPerRound && /燃烧|灼烧|点燃/.test(s.name || '')));
      logLines.push(`  ↳ 蒸汽反应：水汽轰散烈焰，${tb.name} 的燃烧被淬灭（本击伤害 +25%）。`);
    } else if (react.kind === 'shock') {
      tc.shockedOnce = true;
      applyCombatStatus(tc, { name: '眩晕', emoji: '💫', tone: 'debuff', effect: '无法行动', rounds: 1, mod: { cannotAct: true }, toEnemy: true }, state.round, opts.actorId);
      logLines.push(`  ↳ 感电反应：毒素导电，${tb.name} 陷入【💫眩晕】（每场一次）。`);
    }
    if (e.tag === 'lifesteal' && lost > 0) {
      const heal = Math.max(1, Math.round(lost * 0.5));
      const before = actor.curHp; actor.curHp = Math.min(actorBlock.maxHp, actor.curHp + heal);
      if (actor.curHp > before) { logLines.push(`${actorName} 汲取 ${actor.curHp - before} 点生命。`); addStat(actor, 'healed', actor.curHp - before); }
    }
    const th = effThorns(tc);
    if (th > 0 && e.tag !== 'pierce' && actor.curHp > 0) {
      const { lost: sl } = damageHp(actor, th);
      if (sl > 0) { logLines.push(`${tb.name} 的荆棘反弹 ${sl} 点伤害给 ${actorName}。`); addStat(tc, 'dealt', sl); addStat(actor, 'taken', sl); if (actor.curHp <= 0) pushDefeated(opts.actorId); }
    }
    if (tc.curHp <= 0) pushDefeated(tid);
    logLines.push(...fireBossPhases(state, tid));   // BOSS 压过阶段线 → 转阶段（文案进战报「关键」段）
    // 条件触发：攻方命中 / 守方受击 / 击杀（触发产出的效果不再嵌套触发，避免递归）
    fireTriggers('onHit', opts.actorId, tid);
    fireTriggers('onHurt', tid, opts.actorId);
    if (tc.curHp <= 0) fireTriggers('onKill', opts.actorId, tid);
  }

  // ── 条件触发系统（C）：fireTriggers 找匹配触发器 → condMet 判条件 → applyTriggerEffect 落地效果 ──
  function condMet(cond: TriggerCond | undefined, ownerId: string, otherId?: string): boolean {
    if (!cond || cond === 'always') return true;
    const o = state.participants[ownerId]; const ob = state.initialState[ownerId];
    const t = otherId ? state.participants[otherId] : undefined; const tbb = otherId ? state.initialState[otherId] : undefined;
    switch (cond) {
      case 'targetBurning': return !!t?.status?.some((s) => !!s.combat?.dotPerRound);
      case 'targetPoisoned': return !!t?.status?.some((s) => !!s.combat?.poisonStacks);
      case 'targetStunned': return !!t?.status?.some((s) => !!s.combat?.cannotAct);
      case 'targetLowHp': return !!t && !!tbb && t.curHp / Math.max(1, tbb.maxHp) <= 0.3;
      case 'selfLowHp': return !!o && !!ob && o.curHp / Math.max(1, ob.maxHp) <= 0.3;
      case 'selfHasShield': return (o?.curShield ?? 0) > 0;
      default: return true;
    }
  }

  function fireTriggers(event: TriggerEvent, ownerId: string, otherId?: string) {
    const ob = state.initialState[ownerId]; const owner = state.participants[ownerId];
    if (!ob?.triggers?.length || !owner || owner.left || owner.curHp <= 0) return;
    for (let ti = 0; ti < ob.triggers.length; ti++) {
      const t = ob.triggers[ti];
      if (t.on !== event || !condMet(t.cond, ownerId, otherId)) continue;
      if (t.once && owner.firedOnce?.includes(ti)) continue;   // once：整场至多一次（chance 未通过不算用掉）
      if ((t.chance ?? 1) < 1 && rng() >= (t.chance ?? 1)) continue;
      if (t.once) owner.firedOnce = [...(owner.firedOnce ?? []), ti];
      applyTriggerEffect(t.effect, ownerId, otherId);
    }
  }

  function applyTriggerEffect(e: CombatEffect, ownerId: string, otherId?: string) {
    const ownerC = state.participants[ownerId]; const ownerB = state.initialState[ownerId];
    if (!ownerC || !ownerB) return;
    const toEnemy = ENEMY_TAGS.has(e.tag);
    let tgtId = toEnemy ? otherId : ownerId;                 // 朝敌效果→事件另一方；其余→自身
    if (toEnemy && !tgtId) tgtId = aliveIds(state, ownerB.side === 'player' ? 'enemy' : 'player')[0];
    if (!tgtId) return;
    const tc = state.participants[tgtId]; const tbb = state.initialState[tgtId];
    if (!tc || !tbb || tc.left || (toEnemy && tc.curHp <= 0)) return;
    const oAtk = effCombatStats(ownerC, ownerB).patk;
    if (e.tag === 'deal' || e.tag === 'pierce' || e.tag === 'lifesteal' || e.tag === 'execute') {
      const defT = effCombatStats(tc, tbb).pdef;
      let dmg = damagePipeline({ base: (e.mult ?? 0) * oAtk + (e.flat ?? 0), atkTier: oAtk, defTier: defT, targetDefending: tc.defending }).dmg;   // 素链：触发追加不吃攻方 buff/词缀/暴击（防触发滚雪球），但同吃破防保底/防御减半
      if (e.tag !== 'pierce' && tc.curShield > 0) { const ab = Math.min(tc.curShield, dmg); tc.curShield -= ab; dmg -= ab; }
      const { lost } = damageHp(tc, dmg);
      if (lost > 0) logLines.push(`  ↳ ${ownerB.name} 触发·对 ${tbb.name} 追加 ${lost} 点伤害。`);
      addStat(ownerC, 'dealt', lost); addStat(tc, 'taken', lost);
      if (e.tag === 'lifesteal' && lost > 0) { const b0 = ownerC.curHp; ownerC.curHp = Math.min(ownerB.maxHp, ownerC.curHp + Math.round(lost * 0.5)); addStat(ownerC, 'healed', ownerC.curHp - b0); }
      if (tc.curHp <= 0) pushDefeated(tgtId);
      return;
    }
    if (e.tag === 'heal') { const amt = healAmount(e, oAtk); const b0 = tc.curHp; tc.curHp = Math.min(tbb.maxHp, tc.curHp + amt); if (tc.curHp > b0) { logLines.push(`  ↳ ${ownerB.name} 触发·回复 ${tc.curHp - b0} 点生命。`); addStat(ownerC, 'healed', tc.curHp - b0); } return; }
    if (e.tag === 'restore') { const amt = restoreAmount(e.flat, tbb.maxEp, oAtk); tc.curEp = Math.min(tbb.maxEp, tc.curEp + amt); return; }
    if (e.tag === 'block') { const dT = effCombatStats(tc, tbb).pdef; const amt = Math.max(1, blockRaw(e, dT)); tc.curShield += amt; tc.maxShield = Math.max(tc.maxShield, tc.curShield); return; }
    const tpl = buildStatusTpl(e.tag, e, oAtk);
    if (tpl) { applyCombatStatus(tc, tpl, state.round, ownerId); logLines.push(`  ↳ ${ownerB.name} 触发·使 ${tbb.name} ${tpl.tone === 'buff' ? '获得' : '陷入'}【${tpl.emoji}${tpl.name}】。`); }
  }
}

/* ── 出手预览（P0·数字可见）：与 settleAction/dealDamage 共用 damagePipeline 的**无副作用镜像**。
   供面板出手按钮与敌方意图预告显示"预计伤害/回复/护盾"（STS 式：把算式亮给玩家）。
   不模拟：护盾吸收(面板已显示目标护盾)、保护改道、触发器追加；暴击不掷骰（不传 rng）、单列 critTotal。
   伤害/治疗/护盾公式已单一来源（damagePipeline/healAmount/blockRaw），改公式无需再手动同步此处；
   仅剩 env 的技能文本拼接与 targets 选取逻辑仍与 settleAction 平行，改那两处才需要对齐。 */
export interface ActionPreview {
  kind: 'damage' | 'heal' | 'block';
  total: number;          // 主数值（damage=全部伤害效果合计；heal/block=对应效果量）
  hits: number;           // 总段数（damage 连击+被动多段）
  critChance: number;     // 出手方暴击率（0=无）
  critTotal?: number;     // 全暴击时的总伤（有暴击率才给）
  executeReady?: boolean; // 含斩杀效果且目标已入斩杀线（该效果按补足击杀量计）
  chargeRounds?: number;  // 蓄力技：需先蓄 N 回合（total 为释放时伤害）
  targetId: string;       // 实际用于预估的目标
}
export function previewAction(state: BattleState, actorId: string, targetIdIn?: string, skillIn?: Skill): ActionPreview | null {
  const actor = state.participants[actorId]; const actorBlock = state.initialState[actorId];
  if (!actor || !actorBlock || actor.left) return null;
  let skill = skillIn;
  if (skill && (isSilenced(actor) || (actor.cooldowns[skill.id] ?? 0) > 0)) skill = undefined;   // 引擎会退化普攻 → 预览同口径
  let resBoostMult = 1;
  if (skill && actorId === 'B1') {   // 自定义能量条门槛/消耗镜像（只读不扣）：不足→退化普攻、付得起→爆发档 ×1.3——与 settleAction 同口径
    try {
      const rs = useResource.getState();
      const g = (skill as any)?.numeric?.resGate as { id?: string; amount?: number } | undefined;
      const rc = (skill as any)?.numeric?.resCost as { id?: string; amount?: number } | undefined;
      const gBar = g?.id && (g.amount ?? 0) > 0 ? rs.resources.find((r) => r.id === g.id) : undefined;
      const rcBar = rc?.id && (rc.amount ?? 0) > 0 ? rs.resources.find((r) => r.id === rc.id) : undefined;
      if ((gBar && gBar.cur < (g?.amount ?? 0)) || (rcBar && rcBar.cur < (rc?.amount ?? 0))) skill = undefined;
      else if (rcBar) resBoostMult = RES_BOOST_MULT;
    } catch {}
  }
  if (skill && isDomainSkill(skill)) return null;   // 领域：持续场效果，不做单点数值预览
  const spec: CombatSpec = skill ? parseCombatSpec(skill as any) : { target: 'enemy', effects: [{ tag: 'deal', mult: 1.0, times: 1 }] };
  const magic = isMagicSkill(skill);
  const pvSkillText = skill ? `${skill.name ?? ''}${skill.skillType ?? ''}${skill.damage ?? ''}${skill.effect ?? ''}` : '';
  const env = bfElementMult(state.battlefieldAffixes, pvSkillText);   // 战场词缀元素倍率（镜像 settleAction）
  const elem = skillElement(pvSkillText);                              // 元素反应通道（镜像）
  const myEff = effCombatStats(actor, actorBlock);
  const atkTier = magic ? myEff.matk : myEff.patk;
  const myPassive: PassiveMod = actorBlock.passive ?? {};
  const chargeRounds = skill && isChargeSkill(skill) ? chargeTurns(skill) : 0;
  const chargeMult = chargeRounds > 0 ? 1 + 0.8 * chargeRounds : 1;   // 与 settleAction 蓄力释放倍率一致
  const enemySide: Side = actorBlock.side === 'player' ? 'enemy' : 'player';

  const dmgTags = new Set<CombatTag>(['deal', 'pierce', 'lifesteal', 'execute', 'detonate']);
  const dmgEffects = spec.effects.filter((e) => dmgTags.has(e.tag));
  if (dmgEffects.length > 0) {
    const targetId = (targetIdIn && state.participants[targetIdIn] && !state.participants[targetIdIn].left && state.initialState[targetIdIn]?.side === enemySide)
      ? targetIdIn : aliveIds(state, enemySide)[0];
    if (!targetId) return null;
    const tc = state.participants[targetId]; const tb = state.initialState[targetId];
    if (!tc || !tb) return null;
    const tEff = effCombatStats(tc, tb);
    const defTier = magic ? tEff.mdef : tEff.pdef;
    const tPass: PassiveMod = tb.passive ?? {};
    const react = elementReaction(elem, tc);   // 元素反应倍率镜像（副作用只在真结算）
    let total = 0, hits = 0, critTotal = 0, executeReady = false;
    for (const e of dmgEffects) {
      if (e.tag === 'execute' && tc.curHp / Math.max(1, tb.maxHp) <= EXECUTE_THRESHOLD) { executeReady = true; total += tc.curHp; critTotal += tc.curHp; hits += 1; continue; }
      if (e.tag === 'detonate') {   // 引爆预览：目标当前 DoT 未来总量 ×1.5（无 DoT=0，不占段数）
        const amt = Math.round(detonatableAmount(tc, state.round, bfNum(state.battlefieldAffixes, 'burnDotMult'), bfNum(state.battlefieldAffixes, 'poisonDotMult')) * 1.5);
        if (amt > 0) { total += amt; critTotal += amt; hits += 1; }
        continue;
      }
      const { dmg, critDmg } = damagePipeline({
        base: (e.mult ?? 0) * atkTier + (e.flat ?? 0), atkTier, defTier,
        strengthStacks: effStr(actor), attackerWeak: hasWeak(actor), targetVulnerable: hasVuln(tc),
        chargeMult, envMult: env.mult * react.mult, resBoostMult,
        dmgDealtPct: myPassive.dmgDealtPct, dmgTakenPct: tPass.dmgTakenPct, pierce: myPassive.pierce,
        targetDefending: tc.defending,
        critMult: myPassive.critMult,   // 不传 rng：预览不掷暴击，critDmg 单列
      });
      const times = Math.max(1, (e.times ?? 1) + (e.tag === 'deal' ? (myPassive.extraHits ?? 0) : 0));
      total += dmg * times; hits += times;
      critTotal += critDmg * times;
    }
    const cc = myPassive.critChance ?? 0;
    return { kind: 'damage', total, hits, critChance: cc, critTotal: cc > 0 ? critTotal : undefined, executeReady: executeReady || undefined, chargeRounds: chargeRounds || undefined, targetId };
  }
  const healE = spec.effects.find((e) => e.tag === 'heal');
  if (healE) {
    const tid = (targetIdIn && state.participants[targetIdIn] && state.initialState[targetIdIn]?.side === actorBlock.side) ? targetIdIn : actorId;
    const amt = healAmount(healE, atkTier);
    return { kind: 'heal', total: amt, hits: 1, critChance: 0, targetId: tid };
  }
  const blockE = spec.effects.find((e) => e.tag === 'block');
  if (blockE) {
    const tid = (targetIdIn && state.participants[targetIdIn] && state.initialState[targetIdIn]?.side === actorBlock.side) ? targetIdIn : actorId;
    const tc = state.participants[tid]; const tb = state.initialState[tid];
    if (!tc || !tb) return null;
    const defT = effCombatStats(tc, tb).pdef;
    const amt = Math.max(1, Math.round((blockRaw(blockE, defT) + dexterityBonus(effDex(tc), defT)) * bfNum(state.battlefieldAffixes, 'blockMult')));
    return { kind: 'block', total: amt, hits: 1, critChance: 0, targetId: tid };
  }
  return null;
}

/* 推进回合：标记被击败者，跳过死亡/离场者，必要时进入下一轮（回合数+1、清防御姿态/护盾、冷却-1） */
export function advanceTurn(prev: BattleState, manualAlly = false): BattleState {
  const state: BattleState = structuredClone(prev);
  const isOut = (id: string) => {
    const p = state.participants[id];
    return !p || p.left || p.curHp <= 0;
  };
  let guard = 0;
  do {
    state.turn += 1;
    if (state.turn >= state.order.length) {
      state.turn = 0;
      state.round += 1;
      // 新一轮：清防御姿态、清护盾（STS 式格挡每回合重置）、冷却递减
      for (const id of Object.keys(state.participants)) {
        const p = state.participants[id];
        p.defending = false;
        p.guardedBy = undefined;
        p.curShield = 0; p.maxShield = 0;
        for (const k of Object.keys(p.cooldowns)) {
          p.cooldowns[k] = Math.max(0, p.cooldowns[k] - 1);
          if (p.cooldowns[k] === 0) delete p.cooldowns[k];
        }
      }
      tickRoundStart(state);   // 持续伤害/治疗 + 状态过期 + 小回蓝 + 领域结算
    }
    guard += 1;
  } while (isOut(state.order[state.turn]) && guard < state.order.length * 4 + 8);

  const cur = state.order[state.turn];
  const curSide = cur ? (state.participants[cur]?.side ?? 'player') : 'player';
  state.stage = playerControlled(cur, curSide, manualAlly) ? 'awaiting_player' : 'awaiting_npc';
  return state;
}

/* 胜负判定：某一方全部 HP≤0 或离场 → 对方获胜 */
export function checkEnd(state: BattleState): Side | null {
  const alive = (side: Side) => Object.values(state.participants)
    .some((p) => p.side === side && !p.left && p.curHp > 0);
  const playerAlive = alive('player');
  const enemyAlive = alive('enemy');
  if (!enemyAlive) return 'player';
  if (!playerAlive) return 'enemy';
  return null;
}

/* 当前行动者 id */
export function currentActorId(state: BattleState): string | undefined {
  return state.order[state.turn];
}

/* 存活参战者（某方），用于 AI 选目标/兜底 */
export function aliveIds(state: BattleState, side: Side): string[] {
  return state.order.filter((id) => state.participants[id]?.side === side && !state.participants[id]?.left && state.participants[id]?.curHp > 0);
}

/* 把一条结算明细写成 log entry payload */
export function makeActionLog(round: number, actorId: string, text: string, narration?: string, dialogue?: string) {
  return { id: newLogId(), round, type: 'action' as const, actorId, text, narration, dialogue, timestamp: Date.now() };
}
