/* ════════════════════════════════════════════
   深渊地牢「堕落流」—— 确定性引擎（M1）
   设计见 指导/深渊地牢-堕落流-设计.md。
   铁则：本文件是纯函数 + 数值，AI 不碰；副本完全沙盒化（§13.3），
   只读主角快照、绝不回写 playerStore。M1 用线性多层地牢 + 自动战斗，
   分叉房间图 / 完整 CombatPanel 复用留 M2。
════════════════════════════════════════════ */
import type { PlayerAttrs } from '../store/playerStore';
import { computeDerived, computeMaxHp, computeMaxEp } from './derivedStats';
import {
  ABYSS_BIOMES, pickMonsters, rollLootTable, BOON_SEED_POOL, SIN_BLACK_MASK,
  BOON_PRIM_BASE, BOON_TIER_MUL, ABYSS_STARMAP,
  SIN_TYPES, SIN_ACTIVE_POOL, SIN_PASSIVE_POOL, SIN_CURSE_POOL, SIN_QUALITY_LADDER,
  type MonsterDef, type AbyssLoot, type BoonCard, type BoonApply, type BoonPrim, type BoonTier, type SinAttrKey,
  type StarEffect, type BoonSchool,
} from '../data/abyssData';

/** 堕落星图聚合效果（按已解锁节点）。 */
export interface StarmapBonus {
  startAtkMul: number; startDefMul: number; startHpMul: number;
  berserkMul: number;        // 失控概率乘数（<1 = 缓和）
  crystalMul: number;        // 结晶产出乘数（>1）
  extraBoon: boolean;
  affinity: BoonSchool[];    // 加成池偏向流派
  startBoons: BoonSchool[];  // 开局白送
}
export function starmapEffects(nodeIds: string[]): StarmapBonus {
  const set = new Set(nodeIds);
  const b: StarmapBonus = { startAtkMul: 0, startDefMul: 0, startHpMul: 0, berserkMul: 1, crystalMul: 1, extraBoon: false, affinity: [], startBoons: [] };
  for (const n of ABYSS_STARMAP) {
    if (!set.has(n.id)) continue;
    const e: StarEffect = n.eff;
    if (e.startAtkMul) b.startAtkMul += e.startAtkMul;
    if (e.startDefMul) b.startDefMul += e.startDefMul;
    if (e.startHpMul) b.startHpMul += e.startHpMul;
    if (e.berserkReduce) b.berserkMul *= (1 - e.berserkReduce);
    if (e.crystalMul) b.crystalMul *= (1 + e.crystalMul);
    if (e.extraBoon) b.extraBoon = true;
    if (e.boonWeight) b.affinity.push(e.boonWeight);
    if (e.startBoon) b.startBoons.push(e.startBoon);
  }
  return b;
}

/** 原罪物数值骨架（前端 roll，交 AI 配文 §4.5）。 */
export interface SinTemplate {
  quality: string;
  category: string;     // 大类（武器/防具/饰品）
  sub: string;          // 类型细分
  biome: number;
  stats: Partial<Record<SinAttrKey, number>>;
  active: { id: string; tag: string };
  passive: { id: string; tag: string }[];
  curse: { id: string; tag: string };
}
/** AI 回传的原罪物文案（全部可缺，前端兜底）。 */
export interface SinFlavor {
  name?: string; title?: string; lore?: string;
  activeName?: string; activeDesc?: string; passiveDesc?: string[]; curseDesc?: string; appearance?: string;
}
/** AI 回传的觉醒文案（§10.2，全部可缺，前端兜底）。 */
export interface AwakenFlavor {
  affixName?: string; affixDesc?: string; newPrim?: { id?: string; tier?: string } | null; awakenNarrative?: string;
}

/* ── 调参常量（全在这里，方便平衡） ── */
export const ABYSS_TUNING = {
  floorsPerZone: 3,              // 每险地区层数（M1 黑渊 3 层，第 3 层区主=通关）
  roomsPerFloor: [6, 8],        // 每层房间数随机区间（含 entry + boss）
  deathRetain: 0.5,             // 死亡：未带出战利品保留比例（§14.2）
  ticketCost: 100,              // 门票（乐园币）
  crystalsPerFloor: 5,          // 每到达 1 层结算的堕落结晶
  clearBonusCrystals: 30,       // 通关额外结晶
  floorScale: 0.28,             // 每全局层深怪物属性增幅
  boonChoices: 4,               // 战后四选一（1-2 张贴合主角 kit + 其余无关多样）
  corruptIcePerBattle: 6,       // 每场战斗后腐蚀涨幅（基础推进）
  corruptThresholds: [0, 20, 45, 75, 110, 150],  // 堕落等级 0-5 阈值
  awakenEveryClears: 3,         // 每通关 N 次 → 1 枚觉醒充能
  berserkChance: [0, 0, 0, 0.08, 0.16, 0.28],  // 失控概率（按堕落等级 0-5；越堕落越易反噬）
  formMinFall: 5,               // 堕落形态可发动的最低堕落等级
  formRounds: 3,                // 堕落形态持续回合
  formAtkMul: 1.6,              // 形态期攻击倍率
  formDmgTaken: 0.7,            // 形态期受伤系数（×0.7=减伤）
  formBacklashHp: 0.2,          // 形态结束反噬（损失 maxHp 比例，保底留 1）
  formBacklashCorrupt: 10,      // 形态结束反噬腐蚀
  mirrorMinFall: 4,             // 触发「堕落镜像」区主的最低堕落等级
  mirrorStatMul: 1.4,           // 堕落镜像区主属性倍率
} as const;

/* ════════ 类型 ════════ */
export type RoomType = 'entry' | 'battle' | 'elite' | 'boss' | 'event' | 'rest' | 'treasure' | 'beacon' | 'sin' | 'altar' | 'judge';

/** 堕落祭坛献祭选项（§8 堕落流：主动堆腐蚀换强度）。 */
export interface AltarOption { id: string; label: string; corruption: number; apply: BoonApply; desc: string; }

/** 深渊裁判剧情局（仿赌坊魂赌）：AI 出剧情+裁判文案，前端定后果（M4）。 */
export interface JudgeOption { id: string; label: string; flavor: string; apply: BoonApply; corruption: number; hpDelta: number; }  // hpDelta: 正=回血% / 负=自损%（占 maxHp）
export interface JudgeData { scene: string; options: JudgeOption[]; }
export interface JudgeFlavor { scene?: string; options?: { label?: string; flavor?: string }[] }

export interface AbyssUnit {
  id: string;
  name: string;
  isPlayer: boolean;
  attrs: PlayerAttrs;     // 沙盒拷贝（加成卡只改这份）
  level: number;
  tier?: string;
  maxHp: number; hp: number;
  maxEp: number; ep: number;
  atk: number; def: number;
  lifesteal?: number;     // 吸血比例（加成卡赋予，0-1）
  tags?: string[];        // 怪物机制标签
  skills?: { name: string; effect: string }[];  // 技能面板（敌人 AI 生成 / 主角读 characterStore / 同伴读其 characterStore）
  bioStrength?: string;   // 生物强度模板（T0-T9，展示）
  race?: string;          // 种族（展示）
  fx?: AbyssFx[];         // Layer2 状态效果（buff/debuff/DoT/HoT/控制/不死/锁血）
  shield?: number;        // 护盾（先于 HP 吸收）
  cd?: Record<string, number>;  // 技能冷却（按技能名）
  summon?: boolean;       // 是否召唤物（限时，roundsLeft 到期消失）
  summonLeft?: number;    // 召唤物剩余存在回合
  alive: boolean;
}

/** Layer2 战斗状态（仿战斗系统 CombatStatusMod，作用于沙盒单位）。 */
export interface AbyssFx {
  name: string; emoji: string; rounds: number; tone: 'buff' | 'debuff';
  atkMult?: number;   // 攻击倍率增量
  defMult?: number;   // 防御倍率增量（负=破甲）
  dot?: number;       // 每回合持续伤害（定值）
  hot?: number;       // 每回合持续治疗
  stun?: boolean;     // 控制：无法行动
  undying?: boolean;  // 不死：扣血保底 1
  hpLock?: boolean;   // 锁血：完全不掉血
}

/** AI 生成的敌人面板（仿战斗系统 COMBAT_BATTLE_DATA_RULE 的内联敌人块）。 */
export interface AbyssEnemyPanel {
  name: string; race?: string; tier?: string; bioStrength?: string;
  attrs?: Partial<PlayerAttrs>; skills?: { name: string; effect: string }[]; count?: number;
}

export interface AbyssRoom {
  id: string;
  type: RoomType;
  name: string;
  cleared: boolean;
  payload?: { monsterIds?: string[]; lootTable?: string; sin?: boolean };
}

export interface AbyssFloor {
  zone: number;
  floor: number;
  rooms: AbyssRoom[];     // 线性序列：rooms[0]=entry … rooms[last]=boss
}

export interface AbyssRun {
  seed: string;
  mode: 'normal' | 'endless';  // 主线封顶 / 无尽深渊（M4，通关界之底后解锁）
  biome: number;          // 险地区（M1 恒 1=黑渊）
  floor: number;          // 当前层（1..floorsPerZone）
  globalDepth: number;    // 全局层深（跨区累计，用于缩放/结算）
  map: AbyssFloor;
  posIdx: number;         // 当前房间下标
  corruption: number;
  fallLevel: number;      // 0-5
  party: AbyssUnit[];     // 主角(+M2 召唤/随从)；沙盒
  loot: AbyssLoot[];      // 本局未带出战利品
  boons: BoonCard[];      // 本局已选加成卡 = run 内 build
  pendingBoons: BoonCard[] | null;  // 战后待选（null = 待生成，由面板触发 API/兜底）
  pendingSin: { idx: number; template: SinTemplate } | null;  // 待 AI 配文的原罪物（已落 loot[idx] 兜底，可被增强）
  hardcore: boolean;                // 极限模式：强制主角单人
  fight: AbyssFight | null;         // 进行中的交互式战斗（M2，沙盒）
  pendingAltar: AltarOption[] | null;  // 堕落祭坛待选献祭
  affinity: BoonSchool[];           // 堕落星图偏向流派（加成池加权）
  extraBoon: boolean;               // 战后四选一（星图）
  berserkMul: number;               // 失控概率乘数（星图缓和）
  crystalMul: number;               // 结晶产出乘数（星图）
  pendingJudge: JudgeData | null;   // 深渊裁判剧情局待抉择（M4）
  lastBattle: { rounds: number; foes: string[]; win: boolean } | null;
  status: 'exploring' | 'fighting' | 'choosingBoon' | 'altar' | 'judge' | 'dead' | 'cleared';
  log: string[];
}

/** 交互式战斗进行态（M2，沙盒内逐回合）。玩家控 B1，队友/敌人自动行动。 */
export interface AbyssFight {
  enemies: AbyssUnit[];
  round: number;
  heroDefending: boolean;   // 本回合主角防御姿态（敌方行动时减伤）
  form: { roundsLeft: number } | null;  // 堕落形态（魔化爆发）进行态
  formUsed: boolean;        // 本场是否已用过堕落形态
  mirror: boolean;          // 堕落镜像区主（高腐蚀触发，强化+掉堕落专属原罪物）
  pendingPanel: { kind: 'elite' | 'boss'; biome: number; depth: number } | null;  // 待 AI 生成敌人面板（已落兜底敌人，可被替换）
  log: string[];
}

export interface PlayerSnapshot {
  name: string;
  attrs: PlayerAttrs;
  level: number;
  tier?: string;
  equipped: { category: string; grade: number }[];
  skills?: { name: string; effect: string }[];   // 战斗中可施放（主角读 characterStore；同伴读其 characterStore）
}

/* ════════ 确定性 RNG（mulberry32 + 字符串散列） ════════ */
export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
export function makeRng(seed: number | string) {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/* ════════ 腐蚀 → 堕落等级 ════════ */
export function corruptToFall(corruption: number): number {
  const th = ABYSS_TUNING.corruptThresholds;
  let lv = 0;
  for (let i = 0; i < th.length; i++) if (corruption >= th[i]) lv = i;
  return lv;
}

/* ════════ 主角 → 沙盒单位（快照，绝不回写） ════════ */
export function buildPlayerUnit(snap: PlayerSnapshot): AbyssUnit {
  const d = computeDerived(snap.attrs, snap.level, snap.equipped);
  const maxHp = Math.max(1, computeMaxHp(snap.attrs));
  const maxEp = Math.max(0, computeMaxEp(snap.attrs));
  return {
    id: 'B1', name: snap.name || '契约者', isPlayer: true,
    attrs: { ...snap.attrs }, level: snap.level, tier: snap.tier,
    maxHp, hp: maxHp, maxEp, ep: maxEp,
    atk: Math.max(1, d.patk), def: Math.max(0, d.pdef), skills: snap.skills ?? [], alive: true,
  };
}

/** 队友（召唤/随从/契约者 NPC）→ 沙盒单位（与主角同侧，§六 队伍）。 */
export function buildAllyUnit(snap: PlayerSnapshot, idx: number): AbyssUnit {
  const u = buildPlayerUnit(snap);
  return { ...u, id: `A${idx}`, isPlayer: false };
}

/* ════════ 怪物 → 沙盒单位（按全局层深缩放） ════════ */
function buildMonsterUnit(def: MonsterDef, globalDepth: number, idx: number, rng: () => number): AbyssUnit {
  const scale = 1 + ABYSS_TUNING.floorScale * (globalDepth - 1);
  const jitter = 0.9 + rng() * 0.2;   // ±10% 个体浮动
  const m = scale * jitter;
  const hp = Math.max(1, Math.round(def.hp * m));
  return {
    id: `E${idx}`, name: def.name, isPlayer: false,
    attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 },
    level: Math.round(globalDepth * 5), tier: def.tier,
    maxHp: hp, hp, maxEp: 0, ep: 0,
    atk: Math.max(1, Math.round(def.atk * m)), def: Math.max(0, Math.round(def.def * m)),
    tags: def.tags, alive: true,
  };
}

/* ════════ AI 敌人面板（仿战斗系统：六维→derived，代码定数值；§5/M4） ════════ */
const ATTR6: PlayerAttrs = { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
/** 把一个 AI 敌人面板 → 沙盒单位（六维走 computeDerived/computeMaxHp，与战斗系统同模型）。 */
function buildEnemyFromPanel(p: AbyssEnemyPanel, globalDepth: number, idx: number, rng: () => number): AbyssUnit {
  const attrs: PlayerAttrs = { ...ATTR6, ...(p.attrs ?? {}) };
  const level = Math.max(1, Math.round(globalDepth * 5));
  const d = computeDerived(attrs, level, []);
  const jitter = 0.92 + rng() * 0.16;
  const maxHp = Math.max(1, Math.round(computeMaxHp(attrs) * jitter));
  return {
    id: `E${idx}`, name: p.name || '深渊存在', isPlayer: false,
    attrs, level, tier: p.tier, bioStrength: p.bioStrength, race: p.race,
    maxHp, hp: maxHp, maxEp: Math.max(0, computeMaxEp(attrs)), ep: Math.max(0, computeMaxEp(attrs)),
    atk: Math.max(1, Math.round(d.patk * jitter)), def: Math.max(0, Math.round(d.pdef * jitter)),
    skills: Array.isArray(p.skills) ? p.skills.slice(0, 4).map((s) => ({ name: String(s?.name || '').slice(0, 16), effect: String(s?.effect || '').slice(0, 60) })).filter((s) => s.name) : [],
    alive: true,
  };
}
/** AI 面板数组 → 敌人单位（展开 count；上限 6）；空/无效返回 null（调用方回退数据敌人）。 */
export function panelToEnemies(panels: any, globalDepth: number, seed: string): AbyssUnit[] | null {
  if (!Array.isArray(panels) || !panels.length) return null;
  const rng = makeRng(`${seed}|panel${globalDepth}`);
  const out: AbyssUnit[] = [];
  for (const p of panels) {
    if (!p || !p.name) continue;
    const count = Math.max(1, Math.min(4, Math.round(Number(p.count) || 1)));
    for (let i = 0; i < count && out.length < 6; i++) out.push(buildEnemyFromPanel(p, globalDepth, out.length, rng));
  }
  return out.length ? out : null;
}
/** 敌人面板生成上下文（交面板请求 API）。 */
export function enemyGenContext(run: AbyssRun): { biome: number; biomeName: string; kind: 'elite' | 'boss'; depth: number; floor: number; seed: string } | null {
  const f = run.fight; if (!f?.pendingPanel) return null;
  return { biome: f.pendingPanel.biome, biomeName: ABYSS_BIOMES[f.pendingPanel.biome - 1]?.name ?? '深渊', kind: f.pendingPanel.kind, depth: f.pendingPanel.depth, floor: run.floor, seed: `${run.seed}|e${run.posIdx}` };
}
/** AI 面板单位回来后替换战斗敌人（镜像同步强化）；null/空=回退保留数据敌人。 */
export function applyEnemyPanels(run: AbyssRun, units: AbyssUnit[] | null): AbyssRun {
  if (!run.fight?.pendingPanel) return run;
  if (!units || !units.length) return { ...run, fight: { ...run.fight, pendingPanel: null } };
  let enemies = units;
  if (run.fight.mirror) {
    const m = ABYSS_TUNING.mirrorStatMul;
    enemies = units.map((e) => ({ ...e, name: `堕落·${e.name}`, maxHp: Math.round(e.maxHp * m), hp: Math.round(e.maxHp * m), atk: Math.round(e.atk * m), def: Math.round(e.def * m) }));
  }
  return { ...run, fight: { ...run.fight, enemies, pendingPanel: null, log: [...run.fight.log, `🜂 敌人面板：${enemies.map((e) => e.name).join('、')}`] } };
}

/* ════════ 生成一层（线性房间序列） ════════ */
export function genFloor(seed: string, biome: number, floor: number): AbyssFloor {
  const rng = makeRng(`${seed}|z${biome}|f${floor}`);
  const [lo, hi] = ABYSS_TUNING.roomsPerFloor;
  const n = ri(rng, lo, hi);
  const biomeData = ABYSS_BIOMES[biome - 1] ?? ABYSS_BIOMES[0];
  const rooms: AbyssRoom[] = [];
  rooms.push({ id: `r0`, type: 'entry', name: '入口', cleared: true });
  for (let i = 1; i < n - 1; i++) {
    // 中段房间权重：战斗多，夹杂精英/事件/休整/宝藏/封印
    const roll = rng();
    let type: RoomType;
    if (roll < 0.42) type = 'battle';
    else if (roll < 0.56) type = 'elite';
    else if (roll < 0.68) type = 'event';
    else if (roll < 0.78) type = 'rest';
    else if (roll < 0.86) type = 'treasure';
    else if (roll < 0.93) type = 'altar';
    else if (roll < 0.97) type = 'judge';
    else type = 'sin';
    // 每层中段塞一个回溯阵（撤退锚点）
    if (i === Math.floor((n - 1) / 2)) type = 'beacon';
    const r: AbyssRoom = { id: `r${i}`, type, name: roomName(type, rng), cleared: false };
    if (type === 'battle' || type === 'elite') {
      r.payload = { monsterIds: [], lootTable: type === 'elite' ? biomeData.eliteLoot : biomeData.battleLoot };
    } else if (type === 'treasure') {
      r.payload = { lootTable: biomeData.treasureLoot };
    } else if (type === 'sin') {
      r.payload = { sin: true };
    }
    rooms.push(r);
  }
  const isZoneBoss = floor >= ABYSS_TUNING.floorsPerZone;
  rooms.push({
    id: `r${n - 1}`, type: 'boss',
    name: isZoneBoss ? biomeData.zoneBoss : `${biomeData.name}·层主`,
    cleared: false,
    payload: { lootTable: biomeData.bossLoot, sin: isZoneBoss },
  });
  return { zone: biome, floor, rooms };
}

function roomName(t: RoomType, rng: () => number): string {
  const tbl: Record<RoomType, string[]> = {
    entry: ['入口'], boss: ['守关'],
    battle: ['污浊之径', '黑雾岔口', '渊蛆巢穴', '腐土洼地'],
    elite: ['精英盘踞', '堕落契约者', '污泥巨怪'],
    event: ['古怪祭台', '低语裂隙', '残骸堆', '诡异水洼'],
    rest: ['短暂安全屋', '微光石室'],
    treasure: ['封存宝箱', '遗骸藏货'],
    beacon: ['回溯阵'],
    sin: ['原罪封印'],
    altar: ['堕落祭坛', '低语祭台', '渊血石坛'],
    judge: ['深渊裁判', '心魔之庭', '低语审判台'],
  };
  return pick(rng, tbl[t] ?? ['未知']);
}

/* ════════ 进入下一个房间（核心步进） ════════
   返回新的 run；战斗在此自动结算（M1，沙盒内）。 */
export function stepEnterRoom(run: AbyssRun): AbyssRun {
  if (run.status !== 'exploring') return run;
  const nextIdx = run.posIdx + 1;
  if (nextIdx >= run.map.rooms.length) return run;
  const rng = makeRng(`${run.seed}|z${run.biome}|f${run.floor}|enter${nextIdx}|c${run.corruption}`);
  let next: AbyssRun = { ...run, posIdx: nextIdx, map: { ...run.map, rooms: run.map.rooms.map((r) => ({ ...r })) }, log: [...run.log] };
  const room = next.map.rooms[nextIdx];

  if (room.type === 'battle' || room.type === 'elite' || room.type === 'boss') {
    // 进入交互式战斗（M2）：建立战斗态，由 combatAct 逐回合推进；胜负→applyCombatWin/dead
    const biomeData = ABYSS_BIOMES[run.biome - 1] ?? ABYSS_BIOMES[0];
    const kind = room.type === 'boss' ? 'boss' : room.type;
    const defs = pickMonsters(biomeData, kind, rng);
    const enemies = defs.map((d, i) => buildMonsterUnit(d, run.globalDepth, i, rng));
    // 堕落镜像：区主房 + 高腐蚀 → 强化区主（更险，胜则掉堕落专属原罪物，§6.3）
    const isZoneBoss = room.type === 'boss' && run.floor >= ABYSS_TUNING.floorsPerZone;
    const mirror = isZoneBoss && run.fallLevel >= ABYSS_TUNING.mirrorMinFall;
    if (mirror) {
      const m = ABYSS_TUNING.mirrorStatMul;
      for (const e of enemies) {
        e.name = `堕落·${e.name}`;
        e.maxHp = Math.round(e.maxHp * m); e.hp = e.maxHp;
        e.atk = Math.round(e.atk * m); e.def = Math.round(e.def * m);
      }
    }
    // 精英/区主 → 标记待 AI 生成敌人面板（六维/技能），面板由 store/面板异步请求替换；普通战斗用数据敌人即可
    const pendingPanel: AbyssFight['pendingPanel'] = (kind === 'elite' || kind === 'boss') ? { kind, biome: run.biome, depth: run.globalDepth } : null;
    next.fight = { enemies, round: 1, heroDefending: false, form: null, formUsed: false, mirror, pendingPanel, log: [mirror ? `😈 堕落镜像降临：${enemies.map((e) => e.name).join('、')}！` : `⚔ ${room.name}：遭遇 ${enemies.map((e) => e.name).join('、')}`] };
    next.status = 'fighting';
    return next;
  }

  // 非战斗房
  room.cleared = true;
  switch (room.type) {
    case 'rest': {
      const heal = Math.round(next.party[0]?.maxHp * 0.35) || 0;
      next.party = next.party.map((u) => ({ ...u, hp: Math.min(u.maxHp, u.hp + heal) }));
      // 休整可净化少量腐蚀
      next.corruption = Math.max(0, next.corruption - 10);
      next.fallLevel = corruptToFall(next.corruption);
      next.log.push(`🔥 ${room.name}：回复 ${heal} HP，净化 10 腐蚀`);
      break;
    }
    case 'treasure': {
      if (room.payload?.lootTable) {
        const loot = rollLootTable(room.payload.lootTable, run.globalDepth, rng);
        next.loot.push(...loot);
        next.log.push(`💎 ${room.name}：获得 ${loot.map((l) => l.name).join('、') || '空空如也'}`);
      }
      break;
    }
    case 'sin': {
      dropSin(next, rng, 1);
      next.corruption += 18; next.fallLevel = corruptToFall(next.corruption);
      next.log.push(`💎 原罪封印：夺得「${next.loot[next.loot.length - 1]?.name}」（腐蚀 +18）`);
      break;
    }
    case 'altar': {
      next.pendingAltar = genAltarOffers(rng);
      next.status = 'altar';
      next.log.push(`🩸 ${room.name}：低语诱你献祭，以腐蚀换取力量…`);
      break;
    }
    case 'judge': {
      next.pendingJudge = genJudge(rng);
      next.status = 'judge';
      next.log.push(`🎭 ${room.name}：心魔现身，向你抛出抉择…`);
      break;
    }
    case 'event': {
      // M1：简易奇遇——腐蚀换强或小回血（确定性二选一由 rng 定）
      if (rng() < 0.5) {
        next.corruption += 12; next.fallLevel = corruptToFall(next.corruption);
        const u = next.party[0];
        if (u) next.party = [{ ...u, atk: Math.round(u.atk * 1.08) }, ...next.party.slice(1)];
        next.log.push(`❓ ${room.name}：触碰污染之力，攻击+8%（腐蚀 +12）`);
      } else {
        const u = next.party[0];
        if (u) next.party = [{ ...u, hp: Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.15)) }, ...next.party.slice(1)];
        next.log.push(`❓ ${room.name}：寻得净水，回复 15% HP`);
      }
      break;
    }
    case 'beacon':
      next.log.push('🌀 回溯阵：可随时从此安全撤退（全额带出战利品）');
      break;
  }
  // 到达本层最后一个非 boss 房并不会自动结束；boss 在上面分支
  return next;
}

/* ════════ 交互式战斗（M2，沙盒逐回合；玩家控 B1，队友/敌人自动） ════════ */
/** 胜利后：清房 + 战利品/原罪物 + 腐蚀推进 + 通关/三选一。 */
export function applyCombatWin(run: AbyssRun): AbyssRun {
  const mirror = !!run.fight?.mirror;
  const next: AbyssRun = {
    ...run,
    map: { ...run.map, rooms: run.map.rooms.map((r) => ({ ...r })) },
    loot: [...run.loot], log: [...run.log],
  };
  const room = next.map.rooms[next.posIdx];
  const rng = makeRng(`${next.seed}|win|f${next.floor}|${next.posIdx}|c${next.corruption}`);
  room.cleared = true;
  const isBoss = room.type === 'boss';
  const isElite = room.type === 'elite';
  const isZoneBoss = isBoss && next.floor >= ABYSS_TUNING.floorsPerZone;
  if (room.payload?.lootTable) next.loot.push(...rollLootTable(room.payload.lootTable, next.globalDepth, rng));
  if (room.payload?.sin) { next.loot.push({ ...SIN_BLACK_MASK }); next.log.push('💎 夺得原罪物：黑暗面具'); }
  if (mirror) { dropSin(next, rng, 3); next.log.push(`😈 堕落镜像伏诛，夺得堕落专属原罪物「${next.loot[next.loot.length - 1]?.name}」`); }
  next.corruption += ABYSS_TUNING.corruptIcePerBattle + (isBoss ? 8 : isElite ? 3 : 0);
  next.fallLevel = corruptToFall(next.corruption);
  next.lastBattle = { rounds: run.fight?.round ?? 1, foes: run.fight?.enemies.map((e) => e.name) ?? [], win: true };
  next.fight = null;
  // 仅普通模式击破「界之底（最后险地）」区主才算通关；无尽模式永不结束（循环下潜，越来越深）
  if (isZoneBoss && next.biome >= ABYSS_BIOMES.length && next.mode !== 'endless') {
    next.status = 'cleared';
    next.log.push('🏁 击破界之底区主——通关深渊！');
    return next;
  }
  next.pendingBoons = null;
  next.status = 'choosingBoon';
  return next;
}

/** 推进到下一险地（区主清掉、非最终险地时调用）。无尽模式越过界之底则循环回黑渊但层深继续累计（越来越难）。 */
export function advanceZone(run: AbyssRun): AbyssRun {
  const raw = run.biome + 1;
  const wrapped = raw > ABYSS_BIOMES.length;       // 无尽：越过界之底 → 回环
  const nz = wrapped ? 1 : raw;
  const name = ABYSS_BIOMES[nz - 1]?.name ?? `险地${nz}`;
  const map = genFloor(`${run.seed}|loop${run.globalDepth}`, nz, 1);
  return {
    ...run, biome: nz, floor: 1, globalDepth: run.globalDepth + 1, map, posIdx: 0,
    status: 'exploring',
    log: [...run.log, wrapped ? `♾ 越过界之底，深渊更深处再度敞开 → ${name}（更凶险）` : `⬇⬇ 深入下一险地：${name}（第 1 层）`],
  };
}

/* ════════ Layer2 战斗辅助（沙盒；概念对齐 combatEngine：状态/护盾/控制/DoT·HoT/不死·锁血） ════════ */
const SKILL_CD = 2;   // 技能冷却回合
const sumFxMul = (u: AbyssUnit, k: 'atkMult' | 'defMult') => (u.fx ?? []).reduce((s, f) => s + (f[k] ?? 0), 0);
function effAtk(u: AbyssUnit): number { return Math.max(1, Math.round(u.atk * (1 + sumFxMul(u, 'atkMult')))); }
function effDef(u: AbyssUnit): number { return Math.max(0, Math.round(u.def * (1 + sumFxMul(u, 'defMult')))); }
const isStunned = (u: AbyssUnit) => (u.fx ?? []).some((f) => f.stun);
const isHpLocked = (u: AbyssUnit) => (u.fx ?? []).some((f) => f.hpLock);
const isUndying = (u: AbyssUnit) => (u.fx ?? []).some((f) => f.undying);
function addFx(u: AbyssUnit, fx: AbyssFx) { u.fx = [...(u.fx ?? []).filter((f) => f.name !== fx.name), fx]; }
/** 扣血：护盾先吸 → 锁血(0)/不死(保底1) → HP。返回实扣值 + 文案。 */
function dealDamage(t: AbyssUnit, raw: number): { lost: number; note: string } {
  if (raw <= 0) return { lost: 0, note: '' };
  let d = raw, note = '';
  if (t.shield && t.shield > 0) { const ab = Math.min(t.shield, d); t.shield -= ab; d -= ab; if (ab > 0) note += `（盾-${ab}）`; }
  if (d <= 0) return { lost: 0, note };
  if (isHpLocked(t)) return { lost: 0, note: note + '（锁血）' };
  let nh = t.hp - d;
  if (isUndying(t) && nh < 1) { nh = 1; note += '（不死）'; }
  nh = Math.max(0, nh); const lost = t.hp - nh; t.hp = nh;
  if (t.hp <= 0) t.alive = false;
  return { lost, note };
}
/** 回合开始：DoT/HoT 结算 + 状态/护盾过期 + 召唤物计时。返回日志。 */
function tickUnit(u: AbyssUnit): string[] {
  if (!u.alive) return [];
  const out: string[] = [];
  for (const f of (u.fx ?? [])) {
    if (f.dot) { const r = dealDamage(u, f.dot); if (r.lost) out.push(`${u.isPlayer ? '你' : u.name} 受【${f.name}】${r.lost}${u.alive ? '' : '（倒下）'}`); }
    if (f.hot && u.alive) { const h = Math.min(u.maxHp - u.hp, f.hot); if (h > 0) { u.hp += h; out.push(`${u.isPlayer ? '你' : u.name}【${f.name}】回 ${h}`); } }
  }
  u.fx = (u.fx ?? []).map((f) => ({ ...f, rounds: f.rounds - 1 })).filter((f) => f.rounds > 0);
  if (u.summon && u.summonLeft != null) { u.summonLeft -= 1; if (u.summonLeft <= 0) { u.alive = false; out.push(`${u.name} 消散`); } }
  return out;
}
/** 关键词推断技能效果（紧凑版 inferSkillSpec）。 */
function inferAbyssSkill(text: string) {
  const t = text || '';
  return {
    aoe: /群|全体|范围|周围|横扫|溅射|波及|席卷|风暴|爆发/.test(t),
    dot: /中毒|剧毒|淬毒/.test(t) ? { n: '中毒', e: '☠️' } : /灼烧|燃烧|点燃|焚|烈焰|龙息/.test(t) ? { n: '灼烧', e: '🔥' } : /流血|撕裂|出血|斩|噬/.test(t) ? { n: '流血', e: '🩸' } : /腐蚀|侵蚀|污染/.test(t) ? { n: '腐蚀', e: '🧪' } : null,
    stun: /眩晕|定身|冰冻|麻痹|石化|沉默|禁锢|束缚|昏迷|震慑|控制|冻结/.test(t),
    debuffDef: /破甲|碎甲|裂甲|破防/.test(t),
    debuffAtk: /虚弱|弱化|削弱|降攻|缴械|衰弱|减速/.test(t),
    buffAtk: /强化|增幅|狂暴|战意|怒|附魔|嗜血|蓄/.test(t),
    shieldSelf: /护盾|护罩|护壁|格挡|结界|铁壁|金钟|护身|护甲|龙鳞|甲壳|壁/.test(t),
    heal: /治疗|治愈|回复|恢复|疗|加血|吸取生命|生命汲取/.test(t),
    undying: /不死|不灭|不屈|濒死|金身|打不死/.test(t),
    summon: /召唤|唤出|呼唤|分裂|增援|召出|亡魂|尸潮/.test(t),
  };
}
function makeSummon(caster: AbyssUnit, n: number): AbyssUnit {
  return {
    id: `${caster.id}_s${n}`, name: caster.isPlayer ? '渊仆' : `${caster.name.replace('堕落·', '')}·眷属`, isPlayer: caster.isPlayer,
    attrs: caster.attrs, level: caster.level, maxHp: Math.max(1, Math.round(caster.maxHp * 0.35)), hp: Math.max(1, Math.round(caster.maxHp * 0.35)),
    maxEp: 0, ep: 0, atk: Math.max(1, Math.round(caster.atk * 0.5)), def: Math.max(0, Math.round(caster.def * 0.5)),
    summon: true, summonLeft: 3, alive: true,
  };
}
/** 施放技能（玩家/同伴/敌人共用）。friends=施法者同侧、foes=对方；incoming=对目标受伤系数（主角防御/形态）。 */
function castAbyssSkill(caster: AbyssUnit, skill: { name: string; effect: string }, friends: AbyssUnit[], foes: AbyssUnit[], rng: () => number, log: string[], atkMul: number, incoming: (t: AbyssUnit) => number): void {
  const spec = inferAbyssSkill(`${skill.name}|${skill.effect}`);
  const who = caster.isPlayer ? '你' : caster.name;
  log.push(`${who} 施放【${skill.name}】`);
  const aliveFoes = foes.filter((f) => f.alive);
  const power = Math.round(effAtk(caster) * atkMul * 1.4);
  const targets = spec.aoe ? aliveFoes : aliveFoes.sort((a, b) => a.hp - b.hp).slice(0, 1);
  for (const tgt of targets) {
    const base = Math.max(1, Math.round((power - effDef(tgt) * 0.5) * (0.85 + rng() * 0.3) * incoming(tgt)));
    const r = dealDamage(tgt, base);
    if (caster.lifesteal && r.lost) caster.hp = Math.min(caster.maxHp, caster.hp + Math.round(r.lost * caster.lifesteal));
    if (spec.dot) addFx(tgt, { name: spec.dot.n, emoji: spec.dot.e, rounds: 3, tone: 'debuff', dot: Math.max(1, Math.round(power * 0.12)) });
    if (spec.stun) addFx(tgt, { name: '眩晕', emoji: '💫', rounds: 1, tone: 'debuff', stun: true });
    if (spec.debuffDef) addFx(tgt, { name: '破甲', emoji: '🛡️', rounds: 2, tone: 'debuff', defMult: -0.3 });
    if (spec.debuffAtk) addFx(tgt, { name: '虚弱', emoji: '📉', rounds: 2, tone: 'debuff', atkMult: -0.3 });
    log.push(`　→ ${tgt.name} ${r.lost}${r.note}${tgt.alive ? '' : '（倒下）'}`);
  }
  if (spec.shieldSelf) { caster.shield = (caster.shield ?? 0) + Math.round(effAtk(caster) * 0.6); log.push(`　${who} 获护盾`); }
  if (spec.buffAtk) { addFx(caster, { name: '战意', emoji: '⚔️', rounds: 2, tone: 'buff', atkMult: 0.3 }); }
  if (spec.undying) { addFx(caster, { name: '不死', emoji: '💀', rounds: 2, tone: 'buff', undying: true }); }
  if (spec.heal) { const t = friends.filter((f) => f.alive).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]; if (t) { const h = Math.min(t.maxHp - t.hp, Math.round(effAtk(caster) * 0.5)); if (h > 0) { t.hp += h; log.push(`　回复 ${t.isPlayer ? '你' : t.name} ${h}`); } } }
  if (spec.summon && friends.length < 6) { const s = makeSummon(caster, friends.length); friends.push(s); log.push(`　召唤 ${s.name}`); }
  caster.cd = { ...(caster.cd ?? {}), [skill.name]: SKILL_CD };
}

/** 玩家一次行动 → 推进一整回合（回合开始结算 → 主角 → 队友 → 敌人 → 计时）。 */
export function combatAct(run: AbyssRun, action: 'attack' | 'defend' | 'flee' | 'skill', targetIdx = 0, skillIdx = 0): AbyssRun {
  if (!run.fight || run.status !== 'fighting') return run;
  const cp = (u: AbyssUnit): AbyssUnit => ({ ...u, fx: u.fx ? u.fx.map((f) => ({ ...f })) : u.fx, cd: u.cd ? { ...u.cd } : u.cd });
  const next: AbyssRun = {
    ...run,
    party: run.party.map(cp),
    fight: { ...run.fight, enemies: run.fight.enemies.map(cp), log: [...run.fight.log] },
  };
  const fight = next.fight!;
  const rng = makeRng(`${next.seed}|fight|${next.posIdx}|r${fight.round}`);
  const dmg = (atk: number, def: number) => Math.max(1, Math.round((atk - def * 0.5) * (0.85 + rng() * 0.3)));
  const hero = next.party[0];
  const formAtkMul = fight.form ? ABYSS_TUNING.formAtkMul : 1;
  const incoming = (t: AbyssUnit) => (t.isPlayer && fight.heroDefending ? 0.45 : 1) * (t.isPlayer && fight.form ? ABYSS_TUNING.formDmgTaken : 1);
  const basicAtk = (atkr: AbyssUnit, tgt: AbyssUnit, mul: number, label: string) => {
    const d = Math.max(1, Math.round((effAtk(atkr) * mul - effDef(tgt) * 0.5) * (0.85 + rng() * 0.3) * incoming(tgt)));
    const r = dealDamage(tgt, d);
    if (atkr.lifesteal && r.lost) atkr.hp = Math.min(atkr.maxHp, atkr.hp + Math.round(r.lost * atkr.lifesteal));
    fight.log.push(`${atkr.isPlayer ? '你' : atkr.name} ${label} 对 ${tgt.name} 造成 ${r.lost}${r.note}${tgt.alive ? '' : '（击杀）'}`);
  };
  void dmg;

  if (action === 'flee') {
    const rooms = next.map.rooms.map((r, i) => (i === next.posIdx ? { ...r, cleared: true } : r));
    next.map = { ...next.map, rooms };
    next.fight = null; next.status = 'exploring';
    next.corruption += 4; next.fallLevel = corruptToFall(next.corruption);
    next.log = [...next.log, `🏃 脱离与 ${fight.enemies.map((e) => e.name).join('、')} 的交战（无收获，腐蚀 +4）`];
    return next;
  }

  // 回合开始：DoT/HoT/状态过期/召唤计时
  for (const u of [...next.party, ...fight.enemies]) for (const l of tickUnit(u)) fight.log.push(l);
  if (!fight.enemies.some((e) => e.alive)) { next.log = [...next.log, '⚔ 敌人尽数倒于持续伤害']; return applyCombatWin(next); }
  if (!next.party.some((u) => u.alive)) { next.lastBattle = { rounds: fight.round, foes: fight.enemies.map((e) => e.name), win: false }; next.fight = null; next.status = 'dead'; next.log = [...next.log, '💀 队伍全灭']; return next; }

  // 失控（高堕落随机反噬）——形态期免疫；星图缓和
  const berserkChance = fight.form ? 0 : (ABYSS_TUNING.berserkChance[next.fallLevel] ?? 0) * (next.berserkMul ?? 1);
  let effAction: 'attack' | 'defend' | 'skill' | 'skip' = action;
  let useTarget = targetIdx;
  if (berserkChance > 0 && rng() < berserkChance) {
    const k = rng();
    if (k < 0.4) { useTarget = Math.floor(rng() * Math.max(1, fight.enemies.filter((e) => e.alive).length)); effAction = 'attack'; fight.log.push('⚠ 失控·暴走：你失去理智，攻向随机目标！'); }
    else if (k < 0.75) { const self = Math.round(hero.maxHp * 0.08); hero.hp = Math.max(1, hero.hp - self); effAction = 'skip'; fight.log.push(`⚠ 失控·反噬：黑暗反噬己身，自损 ${self}`); }
    else { effAction = 'skip'; fight.log.push('⚠ 失控·失神：你呆滞了一回合'); }
  }
  fight.heroDefending = effAction === 'defend';

  // 1) 主角
  if (isStunned(hero)) { fight.log.push('你被控制，无法行动'); }
  else if (hero.alive && effAction === 'attack') {
    const aliveE = fight.enemies.filter((e) => e.alive);
    const tgt = aliveE[Math.min(useTarget, aliveE.length - 1)] || aliveE[0];
    if (tgt) basicAtk(hero, tgt, formAtkMul, fight.form ? '【魔化】' : '攻击');
  } else if (hero.alive && effAction === 'skill') {
    const sk = hero.skills?.[skillIdx];
    if (sk && !hero.cd?.[sk.name]) castAbyssSkill(hero, sk, next.party, fight.enemies, rng, fight.log, formAtkMul, incoming);
    else { const tgt = fight.enemies.filter((e) => e.alive).sort((a, b) => a.hp - b.hp)[0]; if (tgt) { if (sk) fight.log.push(`【${sk.name}】冷却中，改为攻击`); basicAtk(hero, tgt, formAtkMul, '攻击'); } }
  } else if (effAction === 'defend') fight.log.push('你摆出防御姿态，下次受击减伤');

  // 2) 队友自动（施法/攻击）
  for (const a of [...next.party]) {
    if (a.isPlayer || !a.alive || isStunned(a)) continue;
    const sk = a.skills && a.skills.length && rng() < 0.4 ? a.skills[Math.floor(rng() * a.skills.length)] : null;
    if (sk && !a.cd?.[sk.name]) castAbyssSkill(a, sk, next.party, fight.enemies, rng, fight.log, 1, incoming);
    else { const tgt = fight.enemies.filter((e) => e.alive).sort((x, y) => x.hp - y.hp)[0]; if (tgt) basicAtk(a, tgt, 1, '攻击'); }
  }
  if (!fight.enemies.some((e) => e.alive)) { next.log = [...next.log, `⚔ 战胜 ${fight.enemies.filter((e) => !e.summon).map((e) => e.name).join('、') || '敌人'}（${fight.round} 回合）`]; return applyCombatWin(next); }

  // 3) 敌人（施法/攻击）
  for (const e of [...fight.enemies]) {
    if (!e.alive || isStunned(e)) continue;
    const tgt = next.party.filter((u) => u.alive).sort((x, y) => x.hp - y.hp)[0];
    if (!tgt) break;
    const sk = e.skills && e.skills.length && rng() < 0.4 ? e.skills[Math.floor(rng() * e.skills.length)] : null;
    if (sk && !e.cd?.[sk.name]) castAbyssSkill(e, sk, fight.enemies, next.party, rng, fight.log, 1, incoming);
    else basicAtk(e, tgt, 1, '攻击');
  }
  if (!next.party.some((u) => u.alive)) {
    next.lastBattle = { rounds: fight.round, foes: fight.enemies.map((e) => e.name), win: false };
    next.fight = null; next.status = 'dead';
    next.log = [...next.log, '💀 队伍全灭'];
    return next;
  }
  // 堕落形态计时 + 结束反噬
  if (fight.form) {
    const left = fight.form.roundsLeft - 1;
    if (left <= 0) {
      fight.form = null;
      const back = Math.round(hero.maxHp * ABYSS_TUNING.formBacklashHp);
      hero.hp = Math.max(1, hero.hp - back);
      next.corruption += ABYSS_TUNING.formBacklashCorrupt;
      next.fallLevel = corruptToFall(next.corruption);
      fight.log.push(`😈 堕落形态消退：反噬自损 ${back}，腐蚀 +${ABYSS_TUNING.formBacklashCorrupt}`);
    } else fight.form = { roundsLeft: left };
  }
  // 冷却递减 + 移除消散的召唤物
  for (const u of [...next.party, ...fight.enemies]) if (u.cd) for (const k of Object.keys(u.cd)) { u.cd[k] -= 1; if (u.cd[k] <= 0) delete u.cd[k]; }
  next.party = next.party.filter((u, i) => i === 0 || u.alive || !u.summon);
  fight.enemies = fight.enemies.filter((e) => e.alive || !e.summon);
  fight.round += 1; fight.heroDefending = false;
  fight.log = fight.log.slice(-40);
  return next;
}

/* ════════ 选择加成卡 → 应用到沙盒 + 继续探索 ════════ */
/** 把一份效果应用到主角 B1（加成卡 / 祭坛共用）。 */
function applyEffectToHero(party: AbyssUnit[], apply: BoonApply): AbyssUnit[] {
  return party.map((u, i) => {
    if (i !== 0) return u;
    let { atk, def, maxHp, hp } = u;
    if (apply.atkMult) atk = Math.round(atk * (1 + apply.atkMult));
    if (apply.defMult) def = Math.round(def * (1 + apply.defMult));
    if (apply.hpMult) { const nm = Math.round(maxHp * (1 + apply.hpMult)); hp = Math.round(hp * (nm / Math.max(1, maxHp))); maxHp = nm; }
    if (apply.atkFlat) atk += apply.atkFlat;
    if (apply.heal) hp = Math.min(maxHp, hp + Math.round(maxHp * apply.heal));
    const lifesteal = apply.lifesteal ? (u.lifesteal ?? 0) + apply.lifesteal : u.lifesteal;
    return { ...u, atk: Math.max(1, atk), def: Math.max(0, def), maxHp, hp, lifesteal };
  });
}

export function applyBoon(run: AbyssRun, card: BoonCard): AbyssRun {
  return { ...run, party: applyEffectToHero(run.party, card.apply), boons: [...run.boons, card], pendingBoons: null, status: 'exploring', log: [...run.log, `🃏 加成：${card.name}`] };
}

/* ════════ 堕落祭坛（§8 堕落流：主动献祭堆腐蚀换强度） ════════ */
const ALTAR_POOL: AltarOption[] = [
  { id: 'flesh', label: '献祭血肉', corruption: 20, apply: { atkMult: 0.25 }, desc: '攻击 +25%' },
  { id: 'mind', label: '献祭神智', corruption: 25, apply: { hpMult: 0.30 }, desc: '生命上限 +30%' },
  { id: 'blood', label: '饮渊之血', corruption: 15, apply: { lifesteal: 0.10 }, desc: '吸血 +10%' },
  { id: 'bone', label: '渊骨加身', corruption: 18, apply: { defMult: 0.30 }, desc: '防御 +30%' },
  { id: 'fury', label: '渊怒灌注', corruption: 30, apply: { atkMult: 0.40, defMult: -0.10 }, desc: '攻击 +40%，防御 -10%' },
];
export function genAltarOffers(rng: () => number): AltarOption[] {
  const pool = [...ALTAR_POOL];
  const out: AltarOption[] = [];
  for (let i = 0; i < 3 && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
/** 选择献祭（idx<0 = 拒绝离开）。 */
export function applyAltar(run: AbyssRun, idx: number): AbyssRun {
  if (run.status !== 'altar' || !run.pendingAltar) return run;
  if (idx < 0) return { ...run, pendingAltar: null, status: 'exploring', log: [...run.log, '🩸 你拒绝了祭坛的低语，转身离去'] };
  const opt = run.pendingAltar[idx];
  if (!opt) return { ...run, pendingAltar: null, status: 'exploring' };
  const corruption = run.corruption + opt.corruption;
  return {
    ...run,
    party: applyEffectToHero(run.party, opt.apply),
    corruption, fallLevel: corruptToFall(corruption),
    boons: [...run.boons, { id: `altar_${opt.id}`, name: opt.label, desc: opt.desc, school: 'corruption', quality: 'fine', apply: opt.apply }],
    pendingAltar: null, status: 'exploring',
    log: [...run.log, `🩸 献祭「${opt.label}」：${opt.desc}（腐蚀 +${opt.corruption}）`],
  };
}

/* ════════ 深渊裁判剧情局（M4，仿赌坊魂赌；AI 出剧情+裁判文案，前端定后果） ════════ */
const JUDGE_POOL: Omit<JudgeOption, 'flavor'>[] = [
  { id: 'greed', label: '攫取黑暗', apply: { atkMult: 0.25 }, corruption: 18, hpDelta: 0 },
  { id: 'pious', label: '净化己身', apply: {}, corruption: -12, hpDelta: 0.25 },
  { id: 'martyr', label: '献上血肉', apply: { hpMult: 0.20, atkMult: 0.12 }, corruption: 10, hpDelta: -0.15 },
  { id: 'gambit', label: '豪赌一掷', apply: { atkMult: 0.40 }, corruption: 25, hpDelta: -0.20 },
  { id: 'ward', label: '谨慎退避', apply: { defMult: 0.15 }, corruption: 0, hpDelta: 0 },
];
export function genJudge(rng: () => number): JudgeData {
  const pool = [...JUDGE_POOL];
  const options: JudgeOption[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const o = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    options.push({ ...o, flavor: o.label });
  }
  return { scene: '深渊的低语在你脑海回响，要你做出抉择……', options };
}
export function applyJudge(run: AbyssRun, idx: number): AbyssRun {
  if (run.status !== 'judge' || !run.pendingJudge) return run;
  const opt = run.pendingJudge.options[idx];
  if (!opt) return { ...run, pendingJudge: null, status: 'exploring' };
  let party = applyEffectToHero(run.party, opt.apply);
  if (opt.hpDelta) party = party.map((u, i) => i === 0 ? { ...u, hp: Math.max(1, Math.min(u.maxHp, u.hp + Math.round(u.maxHp * opt.hpDelta))) } : u);
  const corruption = Math.max(0, run.corruption + opt.corruption);
  return {
    ...run, party, corruption, fallLevel: corruptToFall(corruption), pendingJudge: null, status: 'exploring',
    log: [...run.log, `🎭 抉择「${opt.label}」（腐蚀 ${opt.corruption >= 0 ? '+' : ''}${opt.corruption}${opt.hpDelta ? `，HP ${opt.hpDelta > 0 ? '+' : ''}${Math.round(opt.hpDelta * 100)}%` : ''}）`],
  };
}
/** AI 配文回来后增强剧情局（场景+各选项文案；数值已前端定）。 */
export function applyJudgeFlavor(run: AbyssRun, flavor: JudgeFlavor | null): AbyssRun {
  if (!run.pendingJudge || !flavor) return run;
  const scene = flavor.scene?.trim() || run.pendingJudge.scene;
  const options = run.pendingJudge.options.map((o, i) => ({
    ...o,
    label: flavor.options?.[i]?.label?.trim() || o.label,
    flavor: flavor.options?.[i]?.flavor?.trim() || o.flavor,
  }));
  return { ...run, pendingJudge: { scene, options } };
}

/** 发动堕落形态（满堕落、本场未用过）。 */
export function activateForm(run: AbyssRun): AbyssRun {
  if (!run.fight || run.status !== 'fighting') return run;
  if (run.fallLevel < ABYSS_TUNING.formMinFall || run.fight.form || run.fight.formUsed) return run;
  return {
    ...run,
    fight: { ...run.fight, form: { roundsLeft: ABYSS_TUNING.formRounds }, formUsed: true, log: [...run.fight.log, '😈 堕落形态：魔化爆发！攻击大增、受伤减免（限时）'] },
  };
}

/* ════════ 战后三选一（M1：种子池随机，无 synergy；API 生成留 M2） ════════ */
export function rollBoons(rng: () => number, n: number, affinity: BoonSchool[] = []): BoonCard[] {
  const pool = [...BOON_SEED_POOL];
  const aff = new Set(affinity);
  const out: BoonCard[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    // 星图偏向：有偏向流派时，半数概率优先从该流派抽
    let candidates = pool;
    if (aff.size && rng() < 0.5) {
      const biased = pool.filter((c) => aff.has(c.school));
      if (biased.length) candidates = biased;
    }
    const pickCard = candidates[Math.floor(rng() * candidates.length)];
    out.push(pickCard);
    pool.splice(pool.indexOf(pickCard), 1);
  }
  return out;
}

const ATTR_CN: Record<SinAttrKey, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };

/* ════════ M2：加成卡 API 物化（AI 给原语+档位 → 前端定真实数值） ════════ */
export interface BoonGenContext { biome: number; floor: number; fallLevel: number; deck: { school: string; name: string }[]; want: number; depth: number; affinity: BoonSchool[]; }
export function boonGenContext(run: AbyssRun): BoonGenContext {
  return {
    biome: run.biome, floor: run.floor, fallLevel: run.fallLevel,
    deck: run.boons.map((b) => ({ school: b.school, name: b.name })),
    want: ABYSS_TUNING.boonChoices + (run.extraBoon ? 1 : 0), depth: run.globalDepth,
    affinity: run.affinity ?? [],
  };
}
export function materializeBoonFromAI(ai: any, depth: number): BoonCard | null {
  if (!ai || typeof ai !== 'object') return null;
  const prims = (Array.isArray(ai.prims) ? ai.prims : [])
    .map((p: any) => ({ id: String(p?.id) as BoonPrim, tier: (['low', 'mid', 'high'].includes(p?.tier) ? p.tier : 'mid') as BoonTier }))
    .filter((p: any) => !!BOON_PRIM_BASE[p.id as BoonPrim])
    .slice(0, 2);
  if (!prims.length) return null;
  const apply: BoonApply = {};
  const depthMul = 1 + depth * 0.04;
  for (const p of prims) {
    const def = BOON_PRIM_BASE[p.id];
    const v = def.base * BOON_TIER_MUL[p.tier] * depthMul;
    if (p.id === 'domain') { apply.atkMult = (apply.atkMult ?? 0) + v * 0.7; apply.defMult = (apply.defMult ?? 0) + v * 0.7; }
    else (apply as any)[def.field] = ((apply as any)[def.field] ?? 0) + v;
  }
  const school = (['corruption', 'martial', 'guard', 'undead', 'domain', 'gambler'].includes(ai.school) ? ai.school : 'martial');
  const quality = (['common', 'fine', 'epic'].includes(ai.quality) ? ai.quality : 'common');
  const name = String(ai.name || '深渊馈赠').slice(0, 8);
  return {
    id: `api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name, desc: String(ai.desc || '').slice(0, 60), school, quality, apply, prims,
    needCorruption: Number(ai.needCorruption) || 0, capstone: !!ai.capstone, related: !!ai.related,
  };
}
/** 把 AI 回的 3 张卡（数组）物化；不足/失败由调用方回退种子池。 */
export function materializeBoons(aiList: any, depth: number): BoonCard[] {
  if (!Array.isArray(aiList)) return [];
  return aiList.map((c) => materializeBoonFromAI(c, depth)).filter((c): c is BoonCard => !!c).slice(0, ABYSS_TUNING.boonChoices);
}

/* ════════ M2：随机原罪物（前端 roll 骨架 → AI 配文 → 组装） ════════ */
export function rollSinTemplate(depth: number, corruption: number, rng: () => number, biome = 1): SinTemplate {
  const score = depth + corruption / 30 + rng() * 2;
  const qi = Math.max(0, Math.min(SIN_QUALITY_LADDER.length - 1, Math.floor(score / 1.6)));
  const quality = SIN_QUALITY_LADDER[qi];
  const t = SIN_TYPES[Math.floor(rng() * SIN_TYPES.length)];
  const sub = t.subs[Math.floor(rng() * t.subs.length)];
  const budget = Math.round((40 + depth * 22) * (0.85 + rng() * 0.4));
  const stats: Partial<Record<SinAttrKey, number>> = {};
  const primary = t.primary[Math.floor(rng() * t.primary.length)];
  stats[primary] = Math.round(budget * 0.65);
  const secPool = (['str', 'agi', 'con', 'int', 'luck'] as SinAttrKey[]).filter((k) => k !== primary);
  const sec = secPool[Math.floor(rng() * secPool.length)];
  stats[sec] = Math.round(budget * 0.35);
  const active = SIN_ACTIVE_POOL[Math.floor(rng() * SIN_ACTIVE_POOL.length)];
  const passPool = [...SIN_PASSIVE_POOL];
  const passive: { id: string; tag: string }[] = [];
  const np = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < np && passPool.length; i++) passive.push(passPool.splice(Math.floor(rng() * passPool.length), 1)[0]);
  const curse = SIN_CURSE_POOL[Math.floor(rng() * SIN_CURSE_POOL.length)];
  return { quality, category: t.category, sub, biome, stats, active, passive, curse };
}
export function assembleSin(tpl: SinTemplate, flavor: SinFlavor | null): AbyssLoot {
  const name = (flavor?.name?.trim()) || tpl.sub;
  const statTxt = Object.entries(tpl.stats).map(([k, v]) => `${ATTR_CN[k as SinAttrKey]}+${v}`).join(' ');
  const lines: string[] = [];
  if (flavor?.title) lines.push(flavor.title);
  lines.push(`六维：${statTxt}`);
  lines.push(`主动·${flavor?.activeName || '原罪术'}：${flavor?.activeDesc || tpl.active.tag}`);
  const pd = (flavor?.passiveDesc && flavor.passiveDesc.length) ? flavor.passiveDesc : tpl.passive.map((p) => p.tag);
  pd.forEach((d, i) => lines.push(`被动${i + 1}：${d}`));
  lines.push(`诅咒：${flavor?.curseDesc || tpl.curse.tag}`);
  if (flavor?.lore) lines.push(flavor.lore);
  return {
    kind: 'sin', name, sin: true, category: tpl.category, quality: tpl.quality,
    effect: `【原罪·${name}】` + lines.join('；'),
    desc: flavor?.lore || '深渊原罪级造物，力量与诅咒并存。',
  };
}
/** 掉落一件随机原罪物（先落兜底版进 loot，并标记 pendingSin 供面板 API 增强）。 */
function dropSin(next: AbyssRun, rng: () => number, qualityBoost = 0): void {
  const tpl = rollSinTemplate(next.globalDepth + qualityBoost, next.corruption, rng, next.biome);
  next.loot.push(assembleSin(tpl, null));
  next.pendingSin = { idx: next.loot.length - 1, template: tpl };
}
/** AI 配文回来后增强已落库的原罪物（idx 来自 pendingSin）。 */
export function applySinFlavor(run: AbyssRun, idx: number, tpl: SinTemplate, flavor: SinFlavor | null): AbyssRun {
  if (idx < 0 || idx >= run.loot.length) return { ...run, pendingSin: null };
  const loot = run.loot.map((l, i) => (i === idx ? assembleSin(tpl, flavor) : l));
  return { ...run, loot, pendingSin: null };
}

/* ════════ 确定性自动战斗（M1，沙盒内） ════════ */
export function resolveFight(party: AbyssUnit[], enemies: AbyssUnit[], rng: () => number): { win: boolean; party: AbyssUnit[]; rounds: number } {
  let p = party.map((u) => ({ ...u, alive: u.hp > 0 }));
  let e = enemies.map((u) => ({ ...u }));
  const dmg = (atk: number, def: number) => Math.max(1, Math.round((atk - def * 0.5) * (0.85 + rng() * 0.3)));
  let rounds = 0;
  while (rounds < 100 && p.some((u) => u.alive) && e.some((u) => u.alive)) {
    rounds++;
    // 我方行动：集火血量最低的敌人
    for (const u of p) {
      if (!u.alive) continue;
      const target = e.filter((x) => x.alive).sort((a, b) => a.hp - b.hp)[0];
      if (!target) break;
      const d = dmg(u.atk, target.def);
      target.hp -= d;
      if (u.lifesteal) u.hp = Math.min(u.maxHp, u.hp + Math.round(d * u.lifesteal));
      if (target.hp <= 0) target.alive = false;
    }
    // 敌方行动：打血量最低的存活我方
    for (const x of e) {
      if (!x.alive) continue;
      const target = p.filter((u) => u.alive).sort((a, b) => a.hp - b.hp)[0];
      if (!target) break;
      target.hp -= dmg(x.atk, target.def);
      if (target.hp <= 0) target.alive = false;
    }
  }
  const win = !e.some((u) => u.alive) && p.some((u) => u.alive);
  return { win, party: p.map((u) => ({ ...u, hp: Math.max(0, u.hp), alive: u.hp > 0 })), rounds };
}

/* ════════ 开局 ════════ */
/** 加成卡去重签名（卡牌库/起手卡组用，§8.6）。 */
export function boonSig(card: { school: string; name: string }): string { return `${card.school}|${card.name}`; }

export interface StartOpts { hardcore?: boolean; allies?: AbyssUnit[]; seed?: string; starmap?: string[]; startZone?: number; startDeckCards?: BoonCard[]; endless?: boolean; }
function applyStartBonus(u: AbyssUnit, b: StarmapBonus): AbyssUnit {
  return {
    ...u,
    atk: Math.max(1, Math.round(u.atk * (1 + b.startAtkMul))),
    def: Math.max(0, Math.round(u.def * (1 + b.startDefMul))),
    maxHp: Math.round(u.maxHp * (1 + b.startHpMul)),
    hp: Math.round(u.maxHp * (1 + b.startHpMul)),
  };
}
export function startRun(snap: PlayerSnapshot, opts: StartOpts = {}): AbyssRun {
  const seed = opts.seed || `abyss-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const biome = Math.max(1, Math.min(ABYSS_BIOMES.length, opts.startZone || 1));   // 险地直达
  const globalDepth = (biome - 1) * ABYSS_TUNING.floorsPerZone + 1;
  const biomeName = ABYSS_BIOMES[biome - 1]?.name ?? '黑渊';
  const map = genFloor(seed, biome, 1);
  const hardcore = !!opts.hardcore;
  const endless = !!opts.endless;
  const bonus = starmapEffects(opts.starmap ?? []);
  const hero = applyStartBonus(buildPlayerUnit(snap), bonus);
  let party = hardcore ? [hero] : [hero, ...(opts.allies ?? [])];
  const log: string[] = [`🕳 踏入${endless ? '♾无尽深渊·' : '深渊·'}${biomeName}${hardcore ? '（极限·单人）' : ''}（第 1 层）`];
  const boons: BoonCard[] = [];
  for (const school of bonus.startBoons) {
    const card = BOON_SEED_POOL.find((c) => c.school === school);
    if (card) { party = applyEffectToHero(party, card.apply); boons.push(card); log.push(`🌑 星图起手：${card.name}`); }
  }
  // 卡牌库起手卡组（§8.6）
  for (const card of (opts.startDeckCards ?? [])) {
    party = applyEffectToHero(party, card.apply); boons.push(card); log.push(`🎴 起手卡组：${card.name}`);
  }
  return {
    seed, mode: endless ? 'endless' : 'normal', biome, floor: 1, globalDepth, map, posIdx: 0,
    corruption: 0, fallLevel: 0,
    party,
    loot: [], boons, pendingBoons: null, pendingSin: null, hardcore, fight: null, pendingAltar: null,
    affinity: bonus.affinity, extraBoon: bonus.extraBoon, berserkMul: bonus.berserkMul, crystalMul: bonus.crystalMul,
    pendingJudge: null,
    lastBattle: null,
    status: 'exploring',
    log,
  };
}

/* ════════ 下潜到下一层（boss 清空且非区主时调用） ════════ */
export function descend(run: AbyssRun): AbyssRun {
  const nf = run.floor + 1;
  const map = genFloor(run.seed, run.biome, nf);
  return {
    ...run, floor: nf, globalDepth: run.globalDepth + 1, map, posIdx: 0,
    status: 'exploring',
    log: [...run.log, `⬇ 下潜至第 ${nf} 层`],
  };
}

/* ════════ 结算（撤退/死亡/通关）——返回带出物 + meta 增量，由 store 落地 ════════ */
export interface SettleResult {
  carry: AbyssLoot[];          // 带出主线的战利品（白名单 §13.3）
  crystals: number;            // 堕落结晶（meta）
  cleared: boolean;
  reachedDepth: number;
  note: string;
}
export function settleRun(run: AbyssRun, outcome: 'retreat' | 'dead' | 'cleared', deathRetain: number = ABYSS_TUNING.deathRetain): SettleResult {
  const reachedDepth = run.globalDepth;
  let carry: AbyssLoot[];
  if (outcome === 'dead') {
    // 未带出战利品按比例保留（确定性：保留前 ceil(retain) 件，retain 由设置可调）
    const keep = Math.ceil(run.loot.length * deathRetain);
    carry = run.loot.slice(0, keep);
  } else {
    carry = [...run.loot];
  }
  let crystals = reachedDepth * ABYSS_TUNING.crystalsPerFloor;
  if (outcome === 'cleared') crystals += ABYSS_TUNING.clearBonusCrystals;
  crystals = Math.round(crystals * (run.crystalMul ?? 1));   // 星图「探渊者」加成
  const note = outcome === 'cleared' ? '通关！全额带出 + 通关结晶'
    : outcome === 'retreat' ? '安全撤退，全额带出'
    : `深渊放逐：带出 ${carry.length}/${run.loot.length} 件`;
  return { carry, crystals, cleared: outcome === 'cleared', reachedDepth, note };
}
