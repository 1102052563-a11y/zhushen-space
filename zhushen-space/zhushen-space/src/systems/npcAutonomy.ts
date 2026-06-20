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
import { useNpc, hasRealNpcName, type NpcRecord, type NpcAuto } from '../store/npcStore';
import type { Deed } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import {
  pickDeed, seedFrom, behaviorBiasFor, makeRng, pickFrom, getCorpus, hashStr,
  type DeedCtx, type DeedEvent,
} from './autonomyCorpus';
import { attrCapForTier } from './derivedStats';

const MAX_TICKS_PER_TURN = 16;
const CADENCE = 3;                          // 背景离场 NPC 分 3 组轮流
const MISSION_MIN = 2, MISSION_SPAN = 3;
const HUB_REST_MIN = 1, HUB_REST_SPAN = 1;
const IDLE_WEIGHT = 1.3;
const NATIVE_IDLE = 0.45;
const WAR_CHANCE = 0.05, TRIAL_CHANCE = 0.05;
const DEATH_CHANCE = 0.3;                    // 普通 E 级致死率（war/trial 更高，见 missionSettle）
const PAIR_CHANCE = 0.45;                    // 一对同类 hub NPC 触发联动的概率
const ATTR_KEYS = ['str', 'agi', 'con', 'int', 'cha'] as const;
const TIER_NAMES = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶'];

const HUB_TABLE: ReadonlyArray<{ action: string; biasKey: string; event?: DeedEvent }> = [
  { action: 'mission', biasKey: 'mission' },
  { action: 'arena', biasKey: 'arena' },
  { action: 'feud', biasKey: 'arena', event: 'feud' },
  { action: 'enhance', biasKey: 'enhance', event: 'enhance' },
  { action: 'trade', biasKey: 'trade', event: 'trade' },
  { action: 'team', biasKey: 'team', event: 'team_join' },
  { action: 'bounty', biasKey: 'bounty', event: 'bounty' },
  { action: 'study', biasKey: 'study', event: 'study' },
  { action: 'acquire', biasKey: 'study', event: 'acquire' },
  { action: 'leisure', biasKey: 'leisure', event: 'leisure' },
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
];

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

interface RelationFx { otherName: string; label: string; }
export interface TickOutcome { deed?: Deed; patch?: Partial<NpcRecord>; relation?: RelationFx; }
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
  // 细分优先（含 法/战士/骑士/兽/咒 等通用字，须排在通用职业前避免误判）
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
function genEquip(npc: NpcRecord, rng: () => number): string {
  const eq = (npc.items ?? []).find((it) => it.equipped)?.name;
  if (eq) return eq;
  const b = getCorpus().banks;
  const g = b.profGear?.[profKey(npc)] ?? b.profGear?.['通用'];
  const pre = b.gearPrefix?.length ? pickFrom(rng, b.gearPrefix) : '';
  const roll = rng();
  let core: string | undefined;
  if (roll < 0.78) core = g?.weapon?.length ? pickFrom(rng, g.weapon) : undefined;
  else if (roll < 0.92) core = b.armorCore?.length ? pickFrom(rng, b.armorCore) : undefined;
  else core = b.accessoryCore?.length ? pickFrom(rng, b.accessoryCore) : undefined;
  if (core) return pre + core;
  return b.equipment?.length ? pickFrom(rng, b.equipment) : '随身装备';
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
    if (changed) out.attrs = next;
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

/** 任务归来结算：陨落 + 成长 + war/trial 差异化。普通 E 致死 0.3；war/trial 致死 D|E 共 0.4。 */
function missionSettle(npc: NpcRecord, world: string | undefined, rating: string, rng: () => number, txtSeed: number, opts: TickOpts, turn: number, base: DeedCtx): TickOutcome {
  const isWar = world === '世界争夺战', isTrial = world === '试炼世界';
  const lethal = isWar || isTrial ? (rating === 'E' || rating === 'D') : rating === 'E';
  const deathP = isWar || isTrial ? 0.4 : DEATH_CHANCE;
  if (lethal && opts.allowDeath && !isProtected(npc) && rng() < deathP) {
    const dead = pickDeed('mission_death', { ...base, world }, txtSeed);
    return { deed: mkDeed(turn, world ?? '', dead), patch: { isDead: true, deadTurn: turn, status: '已死亡', auto: { phase: 'hub', turns: 0 } } };
  }
  const good = rating === 'S' || rating === 'SS' || rating === 'SSS';
  let event: DeedEvent = 'mission_return';
  let grow: Partial<NpcRecord>;
  if (isWar) {
    event = good ? 'war_return_win' : 'war_return_loss';
    grow = boundedGrowth(npc, rng, { levelUp: good, attrGain: good ? 2 : 0 });
  } else if (isTrial) {
    const pass = good || rating === 'A';
    event = pass ? 'trial_pass' : 'trial_fail';
    grow = boundedGrowth(npc, rng, { levelUp: pass, attrGain: pass ? 1 : 0 });
  } else {
    grow = boundedGrowth(npc, rng, { levelUp: good, attrGain: rating === 'SSS' ? 2 : rating === 'SS' ? 1 : 0 });
  }
  const desc = pickDeed(event, { ...base, world, rating }, txtSeed);
  const rest = HUB_REST_MIN + Math.floor(rng() * (HUB_REST_SPAN + 1));
  return { deed: mkDeed(turn, world ?? '', desc), patch: { auto: { phase: 'hub', turns: rest }, status: '主神空间·休整', ...grow } };
}

/** 入口：按 npcTag 分流 */
export function decideNpcTick(npc: NpcRecord, turn: number, peers: string[] = [], opts: TickOpts = {}): TickOutcome {
  return isNative(npc) ? decideNativeTick(npc, turn, peers) : decideContractorTick(npc, turn, peers, opts);
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
  }
  const desc = pickDeed(event, ctx, txtSeed);
  const grow = (action.action === 'barrier_break' || action.action === 'bloodline')
    ? boundedGrowth(npc, rng, { attrGain: 1 }) : {};
  return { deed: desc ? mkDeed(turn, '主神空间', desc) : undefined, patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间', ...grow }, relation };
}

/* ── 土著：留在故土过本地生活（无相位机·无乐园术语） ──────── */
function decideNativeTick(npc: NpcRecord, turn: number, peers: string[]): TickOutcome {
  const seed = seedFrom(turn, npc.id);
  const rng = makeRng(seed);
  const txtSeed = (seed ^ 0x5bd1e995) >>> 0;
  if (rng() < NATIVE_IDLE) return {};
  const event = pickFrom(rng, NATIVE_EVENTS as DeedEvent[]);
  const ctx: DeedCtx = { name: npc.name, personality: npc.personality };
  let relation: RelationFx | undefined;
  if (event === 'native_strife') {
    const target = peers.length ? pickFrom(rng, peers) : null;
    ctx.enemy = target ?? '邻人';
    if (target) relation = { otherName: target, label: '宿敌' };
  }
  const desc = pickDeed(event, ctx, txtSeed);
  return desc ? { deed: mkDeed(turn, '故土', desc), relation } : {};
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
  if (!useSettings.getState().npcAutonomyOn) return 0;
  const store = useNpc.getState();
  const eligible = Object.values(store.npcs).filter((n) => !n.onScene && !n.isDead && hasRealNpcName(n));
  if (!eligible.length) return 0;

  const contractorNames = eligible.filter((n) => !isNative(n)).map((n) => n.name).filter(Boolean);
  const nativeNames = eligible.filter((n) => isNative(n)).map((n) => n.name).filter(Boolean);

  const ranked = eligible.filter((n) => isActiveThisTurn(n, turn)).sort((a, b) => score(b) - score(a)).slice(0, MAX_TICKS_PER_TURN);

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
  for (const npc of ranked) {
    if (handled.has(npc.id)) continue;
    const pool = (isNative(npc) ? nativeNames : contractorNames).filter((p) => p !== npc.name);
    const out = decideNpcTick(npc, turn, pool, { allowDeath });
    if (!out.deed && !out.patch && !out.relation) continue;
    if (out.deed || out.patch) accSet(npc.id, out.deed, out.patch ?? {});
    if (out.relation) {
      relAdd(npc.id, out.relation.otherName, out.relation.label);
      const other = eligible.find((n) => n.name === out.relation!.otherName);
      if (other && other.id !== npc.id) relAdd(other.id, npc.name, out.relation.label);
    }
  }

  const updates = [...acc.entries()].map(([id, e]) => ({ id, deed: e.deed, patch: e.patch }));
  if (updates.length) store.applyAutonomy(updates);
  return updates.filter((u) => u.deed).length;
}
