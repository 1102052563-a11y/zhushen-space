/* ════════════════════════════════════════════
   战斗结算引擎（纯逻辑，无 React）—— 建在 systems/diceEngine 之上。
   每次出手 = 一次 diceEngine.resolve 对抗判定（已聚合双方全部技能/天赋/装备/强度差），
   伤害 = max(1, 攻ATK - 守DEF×防御系数) × 成功等级倍率 × 缩放；护盾先吸收再扣 HP。
   数值全部由代码算，AI 只负责叙事 + 判暴击。轮回乐园重皮：阶位/强度走 T0-T9，技能品级走入门~极道。
════════════════════════════════════════════ */
import {
  resolve, strengthScoreFromBio, luckMod, ATTR_KEYS, type AttrKey, type DiceAttrs, type ResolveSide, type EquipItemLite,
} from './diceEngine';
import {
  computeDerived, computeMaxHp, computeMaxEp, fullMaxHp, fullMaxEp, lvFromRealm, normalizeTier, realmFromLevel, effectiveResource, trueAttr,
} from './derivedStats';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { usePlayer, type StatusEffect, type CombatStatusMod } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useItems, gradeToNum } from '../store/itemStore';
import type { Skill } from '../store/characterStore';
import type { BattleState, CombatStatBlock, Combatant, Side, CombatActionKind, DomainState } from '../store/combatStore';
import { newLogId } from '../store/combatStore';

const DEFAULT_ATTRS: DiceAttrs = { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };

/* 调参常量（手感调节集中在此） */
const DMG_SCALE = 2;          // 全局伤害缩放（让一场仗约 3~6 回合）
const DEF_FACTOR = 0.6;       // 防御对攻击的削减系数
const DEFEND_MITIGATION = 0.5;// 防御姿态承伤倍率
const BACKLASH_FACTOR = 0.5;  // 大失败反噬己方比例
const SKILL_EP_BY_TIER: Record<string, number> = { 入门: 5, 精通: 10, 大师: 15, 宗师: 20, 极道: 30 };
const LUCK_W = 2;             // 幸运在对抗里的权重（双向：出手方加、防御方减；luckMod 本体 ±2 → 净边际 ±~6~8）
const TRUE_W = 4;             // 真实属性差在对抗里的权重（每 80 普通=1 真实，差距大即碾压命中）
const EP_REGEN_RATE = 0.06;  // 每回合自动回蓝比例（按上限），防长仗技能荒；防御额外回更多

/* 真实属性总分 = Σ floor(六维/80)。后期属性破 80 后才>0，故只在高阶产生碾压效果。 */
function trueScore(a: DiceAttrs): number {
  return ATTR_KEYS.reduce((s, k) => s + trueAttr(a[k]), 0);
}

/* 真实属性·直加分配总和（Σ realAttrs[k]）。真实属性点直加的真实属性也计入战斗碾压因子（与面板显示口径一致）。 */
function sumRealAttrs(ra?: Partial<Record<AttrKey, number>>): number {
  return ra ? ATTR_KEYS.reduce((s, k) => s + (ra[k] ?? 0), 0) : 0;
}

const equippedOf = (arr: any[] | undefined): EquipItemLite[] =>
  (arr ?? []).filter((it) => it?.equipped).map((it) => ({ category: it?.category as string, grade: (it?.numeric?.grade as number) ?? gradeToNum(it?.gradeDesc) }));

/* 取某角色的技能/天赋/已装备（live 读 store；临时敌无建档则空） */
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
    const attrs = override.attrs ?? DEFAULT_ATTRS;
    const level = override.level ?? Math.max(1, lvFromRealm(override.tier));
    const tier = normalizeTier(override.tier) || realmFromLevel(level);
    const equipped: EquipItemLite[] = [];
    const d = computeDerived(attrs, level, equipped);
    return {
      side, name: override.name ?? id, attrs, level, tier,
      bioStrength: override.bioStrength ?? '', favor: undefined,
      patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
      maxHp: override.maxHp ?? computeMaxHp(attrs), maxEp: override.maxEp ?? computeMaxEp(attrs),
      isTransient: true,
    };
  }
  if (id === 'B1') {
    const p = usePlayer.getState().profile;
    const equippedFull = useItems.getState().items.filter((it) => it.equipped);
    const b1c = useCharacters.getState().characters['B1'];
    // 主角有效六维 = 基础 + 技能树 + 团队效果 + 装备(含宝石) + **技能/天赋的六维加成**（与属性面板/正文注入一致）。
    // 技能/天赋的「品级/评级相关性」另由骰子 mSkill/mTalent 计——那是相关性加成、与六维加成是两回事，不会双算。
    const baseTT = withAttrDelta(withAttrDelta(p.attrs ?? DEFAULT_ATTRS, playerTreeAttrBonus()), playerTeamAttrBonus());
    const attrs = effectiveAttrs(baseTT, b1c?.skills, b1c?.traits, equippedFull) as DiceAttrs;
    const equipped = equippedOf(useItems.getState().items);
    const d = computeDerived(attrs, p.level, equipped);
    const teamPerkAbil = playerTeamPerkAbilities();   // 团队效果里显式的「生命/法力上限」文本一并计入主角 HP/EP 上限
    // 上限传**基础六维**（fullMaxHp 内部会折六维加成；传 attrs 会双算技能/天赋的体质加成）
    const maxHp = fullMaxHp(baseTT, equippedFull as any, b1c?.skills, [...(b1c?.traits ?? []), ...teamPerkAbil]), maxEp = fullMaxEp(baseTT, equippedFull as any, b1c?.skills, [...(b1c?.traits ?? []), ...teamPerkAbil]);
    const g = useGame.getState().player;
    return {
      side, name: p.name || '主角', attrs, trueBonus: sumRealAttrs(p.realAttrs), level: p.level, tier: p.tier || realmFromLevel(p.level),
      bioStrength: p.bioStrength || '', favor: undefined,
      patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
      maxHp, maxEp, initHp: effectiveResource(g.hp, g.maxHp, maxHp), initEp: effectiveResource(g.mp, g.maxMp, maxEp),
    };
  }
  const npc = useNpc.getState().npcs[id];
  const equippedFull = (npc?.items ?? []).filter((it) => it.equipped);
  const npcC = useCharacters.getState().characters[id];
  const attrs = effectiveAttrs(npc?.attrs ?? DEFAULT_ATTRS, npcC?.skills, npcC?.traits, equippedFull as any) as DiceAttrs;  // 基础六维 + 装备(含宝石) + 技能/天赋的六维加成（与详情面板/正文注入一致）
  const level = lvFromRealm(npc?.realm);
  const equipped = equippedOf(npc?.items);
  const d = computeDerived(attrs, level, equipped);
  // 上限传**基础六维**（fullMaxHp 内部会折六维加成；传 attrs 会双算）
  const maxHp = fullMaxHp(npc?.attrs ?? DEFAULT_ATTRS, equippedFull as any, npcC?.skills, npcC?.traits), maxEp = fullMaxEp(npc?.attrs ?? DEFAULT_ATTRS, equippedFull as any, npcC?.skills, npcC?.traits);
  return {
    side, name: npc?.name || id, attrs, trueBonus: sumRealAttrs(npc?.realAttrs), level, tier: normalizeTier(npc?.realm) || realmFromLevel(level),
    bioStrength: npc?.bioStrength || '', favor: npc?.favor,
    patk: d.patk, pdef: d.pdef, matk: d.matk, mdef: d.mdef,
    maxHp, maxEp,
    initHp: effectiveResource(npc?.hp, npc?.maxHp, maxHp), initEp: effectiveResource(npc?.mp, npc?.maxMp, maxEp),
  };
}

/* 是否由玩家手动操控：主角 B1 永远是；玩家方队友仅在开启「手动控制队友」时 */
export function playerControlled(id: string, side: Side, manualAlly: boolean): boolean {
  return id === 'B1' || id.startsWith('MP_') || (side === 'player' && manualAlly);   // MP_*=联机来宾的战斗角色，由对应来宾远程出手（房主等待）
}

/* 先攻：敏捷 + 智力×0.3 + 随机(0~3)，降序排（对应凡人 speed+0.3神识） */
export function rollInitiative(b: CombatStatBlock): number {
  return b.attrs.agi + b.attrs.int * 0.3 + Math.random() * 3;
}

/* 由统计块装配整场战斗运行态 */
export function assembleBattle(
  blocks: Record<string, CombatStatBlock>,
  ctx: { reason: string; location: string; endConditions: string[] },
  manualAlly = false,
): BattleState {
  const ids = Object.keys(blocks);
  const participants: Record<string, Combatant> = {};
  for (const id of ids) {
    const b = blocks[id];
    participants[id] = {
      id, side: b.side, initiative: rollInitiative(b),
      curHp: b.initHp ?? b.maxHp, curEp: b.initEp ?? b.maxEp, curShield: 0, maxShield: 0,
      status: [], cooldowns: {},
    };
  }
  const order = [...ids].sort((a, c) => participants[c].initiative - participants[a].initiative);
  const playerTeam = ids.filter((id) => blocks[id].side === 'player');
  const enemyTeam = ids.filter((id) => blocks[id].side === 'enemy');
  const first = order[0];
  const firstSide = first ? participants[first].side : 'player';
  return {
    active: true, battleId: `battle_${Date.now()}`,
    stage: playerControlled(first, firstSide, manualAlly) ? 'awaiting_player' : 'awaiting_npc',
    round: 1, turn: 0, order, participants, initialState: blocks,
    context: { reason: ctx.reason, location: ctx.location, playerTeam, enemyTeam, endConditions: ctx.endConditions },
    log: [], transientEntities: {}, activeArrays: [], endReason: null, victor: null,
  };
}

/* ── 出手攻击/伤害通道推断 ── */
function isMagicSkill(skill?: Skill): boolean {
  if (!skill) return false;
  const t = `${skill.skillType ?? ''}${skill.damage ?? ''}${skill.effect ?? ''}${skill.name ?? ''}`;
  return /法术|术法|灵能|精神|意念|咒|魔|元素|能量|智力/.test(t);
}
function isHealSkill(skill?: Skill): boolean {
  if (!skill) return false;
  const t = `${skill.skillType ?? ''}${skill.target ?? ''}${skill.effect ?? ''}${skill.name ?? ''}${skill.desc ?? ''}`;
  return /治疗|治愈|回复|恢复|疗伤|救治|加血/.test(t);
}
function skillEpCost(skill?: Skill): number {
  if (!skill) return 0;
  const m = /(\d+)/.exec(skill.cost ?? '');
  if (m) return Math.max(0, Number(m[1]));
  for (const tier of Object.keys(SKILL_EP_BY_TIER)) if ((skill.level ?? '').includes(tier)) return SKILL_EP_BY_TIER[tier];
  return 8;
}

function resolveSideOf(id: string, attrKey: AttrKey, block: CombatStatBlock): ResolveSide {
  const ab = fetchAbilities(id);
  return { attrs: block.attrs, attrKey, skills: ab.skills, talents: ab.talents, equipped: ab.equipped };
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

interface SkillStatusTpl { name: string; emoji: string; tone: 'buff' | 'debuff'; effect: string; rounds: number; mod: CombatStatusMod; toEnemy: boolean }
interface SkillSpec { aoe: boolean; shieldAmount: number; statuses: SkillStatusTpl[] }

/* 施加一条战斗状态（同名刷新） */
function applyCombatStatus(target: Combatant, tpl: SkillStatusTpl, round: number) {
  const eff: StatusEffect = {
    id: `cs_${tpl.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: tpl.name, emoji: tpl.emoji, tone: tpl.tone, type: tpl.tone === 'buff' ? '增益' : '减益',
    effect: tpl.effect, startTurn: round, durationTurns: tpl.rounds, addedAt: Date.now(), combat: tpl.mod,
  };
  target.status = [...target.status.filter((s) => s.name !== tpl.name), eff];
}

/* 关键词推断技能的附加效果（护盾/buff/debuff/DoT/HoT/控制/群体）——纯关键词、确定性 */
function inferSkillSpec(skill: Skill | undefined, casterMatk: number): SkillSpec {
  const spec: SkillSpec = { aoe: false, shieldAmount: 0, statuses: [] };
  if (!skill) return spec;
  const t = `${skill.name ?? ''}|${skill.skillType ?? ''}|${skill.effect ?? ''}|${skill.desc ?? ''}|${skill.target ?? ''}|${(skill.tags ?? []).join('')}`;
  spec.aoe = /群体|全体|范围|周围|所有|群攻|横扫|波及|溅射|aoe/i.test(t);
  if (/护盾|护罩|护壁|护甲罩|格挡|结界|铁壁|金钟|护身|抵挡/.test(t)) spec.shieldAmount = Math.max(1, Math.round(casterMatk * 0.8));
  const dot = /中毒|剧毒|淬毒/.test(t) ? { n: '中毒', e: '☠️' } : /灼烧|燃烧|点燃|焚|烈焰/.test(t) ? { n: '灼烧', e: '🔥' } : /流血|撕裂|出血/.test(t) ? { n: '流血', e: '🩸' } : /腐蚀|侵蚀/.test(t) ? { n: '腐蚀', e: '🧪' } : null;
  if (dot) { const d = Math.max(1, Math.round(casterMatk * 0.15)); spec.statuses.push({ name: dot.n, emoji: dot.e, tone: 'debuff', effect: `每回合损失 ${d} 点生命`, rounds: 3, mod: { dotPerRound: d }, toEnemy: true }); }
  if (/眩晕|定身|冰冻|麻痹|石化|沉默|禁锢|束缚|昏迷|震慑/.test(t)) spec.statuses.push({ name: '眩晕', emoji: '💫', tone: 'debuff', effect: '无法行动', rounds: 1, mod: { cannotAct: true }, toEnemy: true });
  if (/破甲|碎甲|裂甲|破防/.test(t)) spec.statuses.push({ name: '破甲', emoji: '🛡️', tone: 'debuff', effect: '防御下降、受伤增加', rounds: 2, mod: { defMult: -0.3 }, toEnemy: true });
  else if (/虚弱|弱化|削弱|降攻|缴械/.test(t)) spec.statuses.push({ name: '虚弱', emoji: '📉', tone: 'debuff', effect: '攻击下降', rounds: 2, mod: { atkMult: -0.3 }, toEnemy: true });
  if (/强化|增幅|狂暴|战意|怒意|附魔/.test(t)) spec.statuses.push({ name: '战意', emoji: '⚔️', tone: 'buff', effect: '攻击提升', rounds: 2, mod: { atkMult: 0.3 }, toEnemy: false });
  if (!spec.shieldAmount && /护体|硬化|防御提升|金身|守护|庇护/.test(t)) spec.statuses.push({ name: '守护', emoji: '🛡️', tone: 'buff', effect: '防御提升', rounds: 2, mod: { defMult: 0.3 }, toEnemy: false });
  if (/再生|回春|持续治疗|生命恢复|疗愈/.test(t)) { const h = Math.max(1, Math.round(casterMatk * 0.12)); spec.statuses.push({ name: '再生', emoji: '💚', tone: 'buff', effect: `每回合回复 ${h} 点生命`, rounds: 3, mod: { hotPerRound: h }, toEnemy: false }); }
  if (/锁血|血量锁定|生命锁定|绝对防御|无敌/.test(t)) spec.statuses.push({ name: '锁血', emoji: '🔒', tone: 'buff', effect: '生命锁定，期间不掉血', rounds: 1, mod: { hpLock: true }, toEnemy: false });
  else if (/不死|不屈|不灭金身|金身不灭|大难不死|濒死|打不死|九条命|血战不退|坚韧不拔/.test(t)) spec.statuses.push({ name: '不死', emoji: '💀', tone: 'buff', effect: '扣血保底 1，不会被打死', rounds: 2, mod: { undying: true }, toEnemy: false });
  return spec;
}

/* 回合开始结算：持续伤害/治疗 + 状态过期（advanceTurn 进入新一轮时调用） */
export function tickRoundStart(state: BattleState): void {
  for (const id of state.order) {
    const c = state.participants[id]; const b = state.initialState[id];
    if (!c || !b || c.left) continue;
    let dot = 0, hot = 0;
    for (const s of c.status) { const mm = s.combat; if (!mm) continue; if (mm.dotPerRound) dot += mm.dotPerRound; if (mm.hotPerRound) hot += mm.hotPerRound; }
    if (c.curHp > 0 && dot > 0) {
      const { lost, note } = damageHp(c, dot);
      if (lost > 0 || note) state.log.push({ id: newLogId(), round: state.round, type: 'system', actorId: id, text: `${b.name} 受到持续效果 ${lost} 点伤害${note}。`, timestamp: Date.now() });
    }
    if (c.curHp > 0 && hot > 0) {
      const before = c.curHp; c.curHp = Math.min(b.maxHp, c.curHp + hot);
      if (c.curHp > before) state.log.push({ id: newLogId(), round: state.round, type: 'system', actorId: id, text: `${b.name} 持续回复 ${c.curHp - before} 点生命。`, timestamp: Date.now() });
    }
    if (c.curHp > 0) c.curEp = Math.min(b.maxEp, c.curEp + Math.max(3, Math.round(b.maxEp * EP_REGEN_RATE)));   // 每回合小回蓝
    c.status = c.status.filter((s) => s.durationTurns == null || (state.round - (s.startTurn ?? state.round)) < s.durationTurns);
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
interface ItemEffect { kind: 'damage' | 'dot' | 'heal' | 'restoreEp' | 'shield' | 'buff' | 'cleanse' | 'none'; amount: number; aoe: boolean; toEnemy: boolean; name: string }
function inferItemEffect(item: any): ItemEffect {
  const t = `${item?.name ?? ''}${item?.subType ?? ''}${item?.effect ?? ''}${(item?.tags ?? []).join('')}`;
  const grade = Math.max(1, (item?.numeric?.grade as number) ?? gradeToNum(item?.gradeDesc));
  const base = grade * 50;
  const m = /(\d{2,6})/.exec(`${item?.effect ?? ''}`);     // 取效果里第一个≥2位数字作威能
  const num = m ? Number(m[1]) : 0;
  const amount = num > 0 ? num : base;
  const name = item?.name ?? '道具';
  const aoe = /范围|全体|群|溅射|波及|周围|所有/.test(t);
  if (/炸弹|手雷|爆|燃烧弹|火焰弹|雷弹|轰|霰弹|爆裂/.test(t) && !/护|防/.test(t)) return { kind: 'damage', amount: Math.max(1, num || base * 2), aoe, toEnemy: true, name };
  if (/毒瓶|毒弹|剧毒|腐蚀|酸液/.test(t)) return { kind: 'dot', amount: Math.max(1, Math.round((num || base) * 0.4)), aoe, toEnemy: true, name };
  if (/解控|解除|净化|驱散|解毒|清醒|镇定|醒神|脱困/.test(t)) return { kind: 'cleanse', amount: 0, aoe, toEnemy: false, name };
  if (/(法力|蓝|EP|精力|能量|内力|真元)/.test(t) && /回复|恢复|补充|回/.test(t)) return { kind: 'restoreEp', amount, aoe, toEnemy: false, name };
  if (/护盾|护身|护体|护罩|金钟/.test(t)) return { kind: 'shield', amount, aoe, toEnemy: false, name };
  if (/增益|强化|狂暴|战意|力量药|提升|爆发药|附魔/.test(t) && !/伤害|攻击/.test(t)) return { kind: 'buff', amount: 0, aoe, toEnemy: false, name };
  if (/生命|血|HP|气血|治疗|疗|愈|回血/.test(t)) return { kind: 'heal', amount, aoe, toEnemy: false, name };
  if (/丹|药|灵药|消耗品|针剂|喷雾|果/.test(`${item?.category ?? ''}${t}`)) return { kind: 'heal', amount: base, aoe: false, toEnemy: false, name };
  return { kind: 'none', amount: 0, aoe: false, toEnemy: false, name };
}

export interface SettleOutcome {
  state: BattleState;
  logLines: string[];        // 结算明细（注入 result 阶段，让 AI 据此叙事）
  actorName: string;
  defeated: string[];        // 本次出手被打到 HP≤0 的参战者 id
  consumedItem?: { id: string; qty: number };   // 本次用掉的道具（由调用方从背包扣除）
}

/* 结算一次出手（玩家或 NPC）。kind: attack/skill/item/defend/flee/charge/cancel */
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

  const abilities = fetchAbilities(opts.actorId);
  let skill: Skill | undefined;
  let targetIds = opts.targetIds;
  let chargeMult = 1;

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
    if (skill) { const cd = parseCooldownRounds(skill); if (cd > 0) actor.cooldowns[skill.id] = cd; }
    delete actor.charging;
    logLines.push(`${actorName} 蓄力完成，「${ch.name}」轰然释放！`);
  } else {
    // ── 非蓄力分支 ──
    if (opts.kind === 'defend') { actor.defending = true; const ep = Math.max(5, Math.round(actorBlock.maxEp * EP_REGEN_RATE * 2)); actor.curEp = Math.min(actorBlock.maxEp, actor.curEp + ep); logLines.push(`${actorName} 摆出防御姿态，本回合承受伤害减半，回复 ${ep} 点 EP。`); return { state, logLines, actorName, defeated }; }
    if (opts.kind === 'flee') { actor.left = true; state.order = state.order.filter((id) => id !== opts.actorId); logLines.push(`${actorName} 试图脱离战斗。`); return { state, logLines, actorName, defeated }; }
    if (opts.kind === 'charge' || opts.kind === 'cancel') { logLines.push(`${actorName} 当前没有可蓄力的大招。`); return { state, logLines, actorName, defeated }; }

    // ── 用道具（炸弹/药剂/丹药/炼金等；威能为道具自身、不随六维）──
    if (opts.kind === 'item') {
      const inv = opts.actorId === 'B1' ? useItems.getState().items : (useNpc.getState().npcs[opts.actorId]?.items ?? []);
      const item = inv.find((i: any) => i.id === opts.itemId || i.name === opts.itemId);
      if (!item || (item.quantity ?? 1) <= 0) { logLines.push(`${actorName} 没有可用的道具。`); return { state, logLines, actorName, defeated }; }
      const ie = inferItemEffect(item);
      const eSide: Side = actorBlock.side === 'player' ? 'enemy' : 'player';
      const pick = (ids: string[], side: Side) => ids.filter((id) => state.participants[id] && !state.participants[id].left && state.participants[id].curHp > 0 && state.initialState[id]?.side === side);
      if (ie.kind === 'damage' || ie.kind === 'dot') {
        let tg = ie.aoe ? aliveIds(state, eSide) : pick(opts.targetIds, eSide);
        if (tg.length === 0) tg = aliveIds(state, eSide).slice(0, 1);
        for (const tid of tg) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          if (ie.kind === 'damage') { const { lost, note } = damageHp(tc, ie.amount); logLines.push(`${actorName} 投出「${ie.name}」，${tb.name} 受到 ${lost} 点伤害${note}。`); if (tc.curHp <= 0 && !defeated.includes(tid)) defeated.push(tid); }
          else { applyCombatStatus(tc, { name: '中毒', emoji: '☠️', tone: 'debuff', effect: `每回合损失 ${ie.amount} 点生命`, rounds: 3, mod: { dotPerRound: ie.amount }, toEnemy: true }, state.round); logLines.push(`${actorName} 用「${ie.name}」使 ${tb.name} 中毒。`); }
        }
      } else {
        let tg = ie.aoe ? aliveIds(state, actorBlock.side) : pick(opts.targetIds, actorBlock.side);
        if (tg.length === 0) tg = [opts.actorId];
        for (const tid of tg) {
          const tc = state.participants[tid]; const tb = state.initialState[tid]; if (!tc || !tb) continue;
          if (ie.kind === 'heal') { const before = tc.curHp; tc.curHp = Math.min(tb.maxHp, tc.curHp + ie.amount); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 回复 ${tc.curHp - before} 点生命。`); }
          else if (ie.kind === 'restoreEp') { const before = tc.curEp; tc.curEp = Math.min(tb.maxEp, tc.curEp + ie.amount); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 回复 ${tc.curEp - before} 点 EP。`); }
          else if (ie.kind === 'shield') { tc.curShield = Math.max(tc.curShield, ie.amount); tc.maxShield = Math.max(tc.maxShield, ie.amount); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 罩上 ${ie.amount} 点护盾。`); }
          else if (ie.kind === 'buff') { applyCombatStatus(tc, { name: '药力', emoji: '⚗️', tone: 'buff', effect: '攻击提升', rounds: 3, mod: { atkMult: 0.3 }, toEnemy: false }, state.round); logLines.push(`${actorName} 用「${ie.name}」强化了 ${tb.name} 的攻击。`); }
          else if (ie.kind === 'cleanse') { const n = tc.status.filter((s) => s.tone === 'debuff' || s.combat?.cannotAct).length; tc.status = tc.status.filter((s) => !(s.tone === 'debuff' || s.combat?.cannotAct)); logLines.push(`${actorName} 用「${ie.name}」为 ${tb.name} 解除了 ${n} 个负面状态。`); }
          else logLines.push(`${actorName} 使用了「${ie.name}」。`);
        }
      }
      return { state, logLines, actorName, defeated, consumedItem: { id: item.id, qty: 1 } };
    }

    skill = opts.skillId ? abilities.skills.find((s: Skill) => s.id === opts.skillId || s.name === opts.skillId) : undefined;
    // 冷却 → 退化普攻
    if (opts.kind === 'skill' && skill && (actor.cooldowns[skill.id] ?? 0) > 0) {
      logLines.push(`${actorName} 的「${skill.name}」尚在冷却（剩 ${actor.cooldowns[skill.id]} 回合），改为普通攻击。`);
      skill = undefined;
    }
    // 蓄力技能 → 进入蓄力
    if (opts.kind === 'skill' && skill && isChargeSkill(skill)) {
      const tt = chargeTurns(skill);
      const epPerTurn = Math.max(1, Math.round(skillEpCost(skill) * 0.5));
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
      const cost = skillEpCost(skill);
      if (cost > 0 && actor.curEp < cost) {
        logLines.push(`${actorName} 法力不足，无法展开领域「${skill.name}」，改为普通攻击。`);
        skill = undefined;
      } else {
        if (cost > 0) actor.curEp = Math.max(0, actor.curEp - cost);
        const cd = parseCooldownRounds(skill); if (cd > 0) actor.cooldowns[skill.id] = cd;
        const dspec = inferDomainSpec(skill, actorBlock.matk);
        const dom: DomainState = { id: `dom_${opts.actorId}_${Date.now()}`, ownerId: opts.actorId, ownerName: actorName, side: actorBlock.side, ...dspec };
        state.activeArrays = [...(state.activeArrays ?? []).filter((d) => d.ownerId !== opts.actorId), dom];
        logLines.push(`${actorName} 展开领域【${dom.emoji}${dom.name}】（${dom.effectDesc}，持续 ${dom.roundsLeft} 回合）。`);
        return { state, logLines, actorName, defeated };
      }
    }
    // 普通技能 EP + 冷却
    if (opts.kind === 'skill' && skill) {
      const cost = skillEpCost(skill);
      if (cost > 0 && actor.curEp < cost) { logLines.push(`${actorName} 法力不足（需 ${cost} EP），「${skill.name}」未能施展，改为普通攻击。`); skill = undefined; }
      else if (cost > 0) actor.curEp = Math.max(0, actor.curEp - cost);
    }
    if (opts.kind === 'skill' && skill) { const cd = parseCooldownRounds(skill); if (cd > 0) actor.cooldowns[skill.id] = cd; }
  }

  // ===== 共用施放（普通技能 / 蓄力释放）=====
  const usingSkill = !!skill;
  const magic = isMagicSkill(skill);
  const heal = isHealSkill(skill);
  const spec = inferSkillSpec(skill, actorBlock.matk);
  const label = (usingSkill ? `「${skill!.name}」` : '普通攻击') + (chargeMult > 1 ? '·蓄力' : '');

  const buffStatuses = spec.statuses.filter((s) => !s.toEnemy);   // 增益（给己方）
  const skTxt = `${skill?.name ?? ''}${skill?.skillType ?? ''}${skill?.effect ?? ''}${skill?.damage ?? ''}${(skill?.tags ?? []).join('')}`;
  const hasAttack = spec.statuses.some((s) => s.toEnemy) || /攻击|斩|劈|击|射|刺|炮|轰|冲|噬|咬|拳|爪/.test(skTxt);
  // 增益/支援类技能（治疗/buff/护盾，且无攻击意图）：作用于友方，可给队友或主角
  const isSupportSkill = usingSkill && !hasAttack && (heal || buffStatuses.length > 0 || spec.shieldAmount > 0);

  const enemySide: Side = actorBlock.side === 'player' ? 'enemy' : 'player';
  let targets = targetIds.filter((id) => state.participants[id] && !state.participants[id].left && state.participants[id].curHp > 0);

  // ── 增益/支援：对选中的友方（含主角）施加治疗/buff/护盾；没选/自身→施法者；群体→全体友方。不打敌人 ──
  if (isSupportSkill) {
    const allyPicked = targets.filter((id) => state.initialState[id]?.side === actorBlock.side);
    const supTargets = spec.aoe ? aliveIds(state, actorBlock.side) : (allyPicked.length ? allyPicked : [opts.actorId]);
    for (const aid of supTargets) {
      const ac = state.participants[aid]; const ab = state.initialState[aid];
      if (!ac || !ab || ac.left) continue;
      for (const st of buffStatuses) { applyCombatStatus(ac, st, state.round); logLines.push(`${actorName} 为 ${ab.name} 施加【${st.emoji}${st.name}】（${st.effect}）。`); }
      if (spec.shieldAmount > 0) { const amt = Math.round(spec.shieldAmount * chargeMult); ac.curShield = Math.max(ac.curShield, amt); ac.maxShield = Math.max(ac.maxShield, amt); logLines.push(`${actorName} 为 ${ab.name} 凝起护盾（${amt} 点）。`); }
      if (heal) {
        const fe = resolve({ mode: 'd20', attrs: actorBlock.attrs, attrKey: 'int', difficulty: '普通', skills: abilities.skills, talents: abilities.talents, includeLuck: true, opposed: false });
        const healAmt = Math.max(1, Math.round(actorBlock.matk * 0.8 * fe.multiplier * chargeMult));
        const before = ac.curHp; ac.curHp = Math.min(ab.maxHp, ac.curHp + healAmt);
        logLines.push(`${actorName} 以${label}治疗 ${ab.name}，回复 ${ac.curHp - before} 点生命（${fe.level}）。`);
      }
    }
    return { state, logLines, actorName, defeated };
  }

  // ── 攻击向：自身增益（如战意斩等组合技给施法者）+ 护盾 ──
  for (const st of buffStatuses) {
    applyCombatStatus(actor, st, state.round);
    logLines.push(`${actorName} 获得【${st.emoji}${st.name}】（${st.effect}）。`);
  }
  if (spec.shieldAmount > 0) {
    const amt = Math.round(spec.shieldAmount * chargeMult);
    actor.curShield = Math.max(actor.curShield, amt);
    actor.maxShield = Math.max(actor.maxShield, amt);
    logLines.push(`${actorName} 凝起护盾（${amt} 点）。`);
  }
  // 目标=敌方（群体→全体敌方；蓄力释放原目标已亡→改打其它敌人；其余只保留敌方目标）
  if (spec.aoe) targets = aliveIds(state, enemySide);
  else if (targets.length === 0 && chargeMult > 1) targets = aliveIds(state, enemySide).slice(0, 1);
  else targets = targets.filter((id) => state.initialState[id]?.side === enemySide);

  const eff = effCombatStats(actor, actorBlock);
  const atkKey: AttrKey = magic ? 'int' : (actorBlock.attrs.str >= actorBlock.attrs.agi ? 'str' : 'agi');
  const atkStat = magic ? eff.matk : eff.patk;

  for (const tid of targets) {
    const target = state.participants[tid];
    const tBlock = state.initialState[tid];
    if (!target || !tBlock || target.left) continue;
    const tName = tBlock.name;

    if (tBlock.side === actorBlock.side) continue;   // 攻击向只打敌方（保险）

    const defKey: AttrKey = magic ? 'int' : 'con';
    const tEff = effCombatStats(target, tBlock);
    const defStat = magic ? tEff.mdef : tEff.pdef;
    // 幸运双向（出手方加成、防御方进 DC）+ 真实属性差（碾压）：都走 extraMod
    const atkTrue = trueScore(actorBlock.attrs) + (actorBlock.trueBonus ?? 0), defTrue = trueScore(tBlock.attrs) + (tBlock.trueBonus ?? 0);
    const fe = resolve({
      mode: 'd20', attrs: actorBlock.attrs, attrKey: atkKey, difficulty: '普通',
      skills: abilities.skills, talents: abilities.talents, equipped: abilities.equipped,
      includeLuck: false, opposed: true,
      extraMod: LUCK_W * luckMod(actorBlock.attrs, 'd20') + TRUE_W * atkTrue,
      myStrengthScore: strengthScoreFromBio(actorBlock.bioStrength, actorBlock.level),
      enemyStrengthScore: strengthScoreFromBio(tBlock.bioStrength, tBlock.level),
      enemy: { ...resolveSideOf(tid, defKey, tBlock), extraMod: LUCK_W * luckMod(tBlock.attrs, 'd20') + TRUE_W * defTrue },
    });
    // 真实属性差 → 伤害碾压倍率（强者多打、弱者几乎打不动；同档=1）
    const realGap = atkTrue - defTrue;
    const crushMult = realGap > 0 ? 1 + Math.min(realGap, 12) * 0.25 : realGap < 0 ? 1 / (1 + Math.min(-realGap, 12) * 0.25) : 1;

    if (fe.backlash) {
      const self = Math.max(1, Math.round(Math.max(1, atkStat - defStat * DEF_FACTOR) * BACKLASH_FACTOR * DMG_SCALE));
      const { lost: sLost, note: sNote } = damageHp(actor, self);
      logLines.push(`${actorName} 对 ${tName} 的${label}弄巧成拙（大失败），反噬自身 ${sLost} 点${sNote}（d20:${fe.chosen}）。`);
      if (actor.curHp <= 0 && !defeated.includes(opts.actorId)) defeated.push(opts.actorId);
      continue;
    }
    if (!fe.success) {
      logLines.push(`${actorName} 的${label}被 ${tName} 闪避/格挡，未造成伤害（d20:${fe.chosen} < DC${fe.dc}）。`);
      continue;
    }

    let dmg = Math.max(1, Math.round(Math.max(1, atkStat - defStat * DEF_FACTOR) * fe.multiplier * DMG_SCALE * chargeMult * crushMult));
    if (target.defending) dmg = Math.max(1, Math.round(dmg * DEFEND_MITIGATION));
    let absorbed = 0;
    if (target.curShield > 0) { absorbed = Math.min(target.curShield, dmg); target.curShield -= absorbed; dmg -= absorbed; }
    const { lost, note } = damageHp(target, dmg);
    const critTag = fe.isCrit ? '【暴击】' : fe.multiplier > 1 ? `【${fe.level}】` : '';
    const shieldTag = absorbed > 0 ? `（护盾抵消 ${absorbed}）` : '';
    logLines.push(`${actorName} ${label} 命中 ${tName}${critTag}，造成 ${lost} 点伤害${note}${shieldTag}（d20:${fe.chosen}，倍率×${fe.multiplier}）。`);
    // 命中附加敌方 debuff / DoT / 控制
    if (target.curHp > 0) {
      for (const st of spec.statuses.filter((s) => s.toEnemy)) {
        applyCombatStatus(target, st, state.round);
        logLines.push(`${tName} 陷入【${st.emoji}${st.name}】（${st.effect}）。`);
      }
    }
    if (target.curHp <= 0 && !defeated.includes(tid)) defeated.push(tid);
  }

  return { state, logLines, actorName, defeated };
}

/* 推进回合：标记被击败者，跳过死亡/离场者，必要时进入下一轮（回合数+1、清防御姿态、冷却-1） */
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
      // 新一轮：清防御姿态、冷却递减
      for (const id of Object.keys(state.participants)) {
        const p = state.participants[id];
        p.defending = false;
        for (const k of Object.keys(p.cooldowns)) {
          p.cooldowns[k] = Math.max(0, p.cooldowns[k] - 1);
          if (p.cooldowns[k] === 0) delete p.cooldowns[k];
        }
      }
      tickRoundStart(state);   // 持续伤害/治疗 + 状态过期
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
