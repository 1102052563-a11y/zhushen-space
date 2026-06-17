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
  type MonsterDef, type AbyssLoot, type BoonCard,
} from '../data/abyssData';

/* ── 调参常量（全在这里，方便平衡） ── */
export const ABYSS_TUNING = {
  floorsPerZone: 3,              // 每险地区层数（M1 黑渊 3 层，第 3 层区主=通关）
  roomsPerFloor: [6, 8],        // 每层房间数随机区间（含 entry + boss）
  deathRetain: 0.5,             // 死亡：未带出战利品保留比例（§14.2）
  ticketCost: 100,              // 门票（乐园币）
  crystalsPerFloor: 5,          // 每到达 1 层结算的堕落结晶
  clearBonusCrystals: 30,       // 通关额外结晶
  floorScale: 0.28,             // 每全局层深怪物属性增幅
  boonChoices: 3,               // 战后三选一
  corruptIcePerBattle: 6,       // 每场战斗后腐蚀涨幅（基础推进）
  corruptThresholds: [0, 20, 45, 75, 110, 150],  // 堕落等级 0-5 阈值
  awakenEveryClears: 3,         // 每通关 N 次 → 1 枚觉醒充能
} as const;

/* ════════ 类型 ════════ */
export type RoomType = 'entry' | 'battle' | 'elite' | 'boss' | 'event' | 'rest' | 'treasure' | 'beacon' | 'sin';

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
  tags?: string[];        // 怪物机制标签（M2 接战斗 Layer2）
  alive: boolean;
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
  pendingBoons: BoonCard[] | null;  // 战后待选
  lastBattle: { rounds: number; foes: string[]; win: boolean } | null;
  status: 'exploring' | 'choosingBoon' | 'dead' | 'cleared';
  log: string[];
}

export interface PlayerSnapshot {
  name: string;
  attrs: PlayerAttrs;
  level: number;
  tier?: string;
  equipped: { category: string; grade: number }[];
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
    atk: Math.max(1, d.patk), def: Math.max(0, d.pdef), alive: true,
  };
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
    if (roll < 0.48) type = 'battle';
    else if (roll < 0.62) type = 'elite';
    else if (roll < 0.74) type = 'event';
    else if (roll < 0.84) type = 'rest';
    else if (roll < 0.93) type = 'treasure';
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
    const biomeData = ABYSS_BIOMES[run.biome - 1] ?? ABYSS_BIOMES[0];
    const kind = room.type === 'boss' ? 'boss' : room.type;
    const defs = pickMonsters(biomeData, kind, rng);
    const enemies = defs.map((d, i) => buildMonsterUnit(d, run.globalDepth, i, rng));
    const result = resolveFight(next.party, enemies, rng);
    next.party = result.party;
    next.lastBattle = { rounds: result.rounds, foes: enemies.map((e) => e.name), win: result.win };
    next.log.push(result.win
      ? `⚔ ${room.name}：击败 ${enemies.map((e) => e.name).join('、')}（${result.rounds}回合）`
      : `💀 ${room.name}：队伍全灭于 ${enemies.map((e) => e.name).join('、')}`);
    if (!result.win) { next.status = 'dead'; return next; }
    room.cleared = true;
    // 战利品
    if (room.payload?.lootTable) next.loot.push(...rollLootTable(room.payload.lootTable, run.globalDepth, rng));
    if (room.payload?.sin) { next.loot.push({ ...SIN_BLACK_MASK }); next.log.push('💎 夺得原罪物：黑暗面具'); }
    // 腐蚀推进
    next.corruption += ABYSS_TUNING.corruptIcePerBattle + (kind === 'boss' ? 8 : kind === 'elite' ? 3 : 0);
    next.fallLevel = corruptToFall(next.corruption);
    // 区主 = 通关
    if (room.type === 'boss' && run.floor >= ABYSS_TUNING.floorsPerZone) {
      next.status = 'cleared';
      next.log.push('🏁 击破区主，通关界之底前哨——黑渊！');
      return next;
    }
    // 否则战后给三选一加成卡
    next.pendingBoons = rollBoons(rng, ABYSS_TUNING.boonChoices);
    next.status = 'choosingBoon';
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
      next.loot.push({ ...SIN_BLACK_MASK });
      next.corruption += 18; next.fallLevel = corruptToFall(next.corruption);
      next.log.push('💎 原罪封印：夺得黑暗面具（腐蚀 +18）');
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

/* ════════ 选择加成卡 → 应用到沙盒 + 继续探索 ════════ */
export function applyBoon(run: AbyssRun, card: BoonCard): AbyssRun {
  const party = run.party.map((u, i) => {
    if (i !== 0) return u;   // M1：只作用主角 B1
    let { atk, def, maxHp, hp, attrs } = u;
    if (card.apply.atkMult) atk = Math.round(atk * (1 + card.apply.atkMult));
    if (card.apply.defMult) def = Math.round(def * (1 + card.apply.defMult));
    if (card.apply.hpMult) { const nm = Math.round(maxHp * (1 + card.apply.hpMult)); hp = Math.round(hp * (nm / Math.max(1, maxHp))); maxHp = nm; }
    if (card.apply.atkFlat) atk += card.apply.atkFlat;
    if (card.apply.heal) hp = Math.min(maxHp, hp + Math.round(maxHp * card.apply.heal));
    return { ...u, atk, def, maxHp, hp, attrs };
  });
  return { ...run, party, boons: [...run.boons, card], pendingBoons: null, status: 'exploring', log: [...run.log, `🃏 加成：${card.name}`] };
}

/* ════════ 战后三选一（M1：种子池随机，无 synergy；API 生成留 M2） ════════ */
export function rollBoons(rng: () => number, n: number): BoonCard[] {
  const pool = [...BOON_SEED_POOL];
  const out: BoonCard[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
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
      target.hp -= dmg(u.atk, target.def);
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
export function startRun(snap: PlayerSnapshot, seedInput?: string): AbyssRun {
  const seed = seedInput || `abyss-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const map = genFloor(seed, 1, 1);
  return {
    seed, biome: 1, floor: 1, globalDepth: 1, map, posIdx: 0,
    corruption: 0, fallLevel: 0,
    party: [buildPlayerUnit(snap)],
    loot: [], boons: [], pendingBoons: null, lastBattle: null,
    status: 'exploring',
    log: [`🕳 踏入深渊·黑渊（第 1 层）`],
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
export function settleRun(run: AbyssRun, outcome: 'retreat' | 'dead' | 'cleared'): SettleResult {
  const reachedDepth = run.globalDepth;
  let carry: AbyssLoot[];
  if (outcome === 'dead') {
    // 未带出战利品按比例保留（确定性：保留前 ceil(50%) 件）
    const keep = Math.ceil(run.loot.length * ABYSS_TUNING.deathRetain);
    carry = run.loot.slice(0, keep);
  } else {
    carry = [...run.loot];
  }
  let crystals = reachedDepth * ABYSS_TUNING.crystalsPerFloor;
  if (outcome === 'cleared') crystals += ABYSS_TUNING.clearBonusCrystals;
  const note = outcome === 'cleared' ? '通关！全额带出 + 通关结晶'
    : outcome === 'retreat' ? '安全撤退，全额带出'
    : `深渊放逐：带出 ${carry.length}/${run.loot.length} 件`;
  return { carry, crystals, cleared: outcome === 'cleared', reachedDepth, note };
}
