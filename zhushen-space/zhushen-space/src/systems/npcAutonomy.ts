/*
  轨道A · 离场角色自治引擎（零 API）
  ────────────────────────────────────────────────────────────────
  每回合(runPostNarrativePhases)调用 runNpcAutonomy(turn)：对「离场·有真名·未死」的
  NPC 跑一次确定性模拟，产出经历(deedLog)、相位(auto)与关系(relations)，全程不调 API。
  按 npcTag 分流：
    · 契约者/随从/默认 → 双相循环「任务世界 ↔ 主神空间」(decideContractorTick)
    · 土著(native)     → 留在自己的任务世界过本地生活(decideNativeTick)，绝不碰乐园术语
  档A(2026-06-20)：① 关系网双向落地(feud/team/native_strife/arena 改双方 relations) + 复仇定向
    ② 公平轮换(分片让全体离场 NPC 轮流活) ③ 世界争夺战/试炼按阶位触发。
  安全：仍不改六维/等级、不致死、不发奖（成长/陨落是档B，待用户拍板）。
*/
import { useNpc, hasRealNpcName, type NpcRecord, type NpcAuto } from '../store/npcStore';
import type { Deed } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import {
  pickDeed, seedFrom, behaviorBiasFor, makeRng, pickFrom, getCorpus, hashStr,
  type DeedCtx, type DeedEvent,
} from './autonomyCorpus';
import { attrCapForTier } from './derivedStats';

const MAX_TICKS_PER_TURN = 16;             // 每回合最多模拟的离场 NPC 数（控性能/刷屏）
const CADENCE = 3;                          // 背景离场 NPC 分 3 组轮流（好友/任务中者不受限）
const MISSION_MIN = 2, MISSION_SPAN = 3;   // 任务时长 2..4 回合
const HUB_REST_MIN = 1, HUB_REST_SPAN = 1; // 归来后休整 1..2 回合
const IDLE_WEIGHT = 1.3;                    // 契约者「啥也不干」权重 → 控制刷经历密度
const NATIVE_IDLE = 0.45;                   // 土著每回合「无事发生」概率
const WAR_CHANCE = 0.05, TRIAL_CHANCE = 0.05; // ≥四阶征召世界争夺战 / ≥三阶进试炼
const DEATH_CHANCE = 0.3;                    // E 级任务·致死开关开·非保护 NPC 的陨落概率
const ATTR_KEYS = ['str', 'agi', 'con', 'int', 'cha'] as const; // 成长微调的六维（不动 luck，前端独占）
const TIER_NAMES = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶'];

/** 主神空间候选行动 → behaviorBias 权重键 + 语料事件 */
const HUB_TABLE: ReadonlyArray<{ action: string; biasKey: string; event?: DeedEvent }> = [
  { action: 'mission', biasKey: 'mission' },
  { action: 'arena', biasKey: 'arena' },
  { action: 'feud', biasKey: 'arena', event: 'feud' },
  { action: 'enhance', biasKey: 'enhance', event: 'enhance' },
  { action: 'trade', biasKey: 'trade', event: 'trade' },
  { action: 'team', biasKey: 'team', event: 'team_join' },
  { action: 'bounty', biasKey: 'bounty', event: 'bounty' },
  { action: 'study', biasKey: 'study', event: 'study' },
  { action: 'leisure', biasKey: 'leisure', event: 'leisure' },
  { action: 'brand', biasKey: 'trade', event: 'brand' },
  { action: 'bloodline', biasKey: 'study', event: 'bloodline' },
  { action: 'barrier_break', biasKey: 'study', event: 'barrier_break' },
  { action: 'title_smelt', biasKey: 'enhance', event: 'title_smelt' },
  { action: 'casino', biasKey: 'casino', event: 'casino' },
  { action: 'heal', biasKey: 'heal', event: 'heal' },
];

/** 土著本地生活事件（绝不含乐园术语；称契约者为「外来者」） */
const NATIVE_EVENTS: readonly DeedEvent[] = [
  'native_daily', 'native_survive', 'native_outsider', 'native_power',
  'native_rumor', 'native_trade', 'native_strife', 'native_train', 'native_event',
  'native_kin', 'native_festival', 'native_clan',
];

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 关系副作用：与某 NPC（按名）结成的双向关系（宿敌/盟友） */
interface RelationFx { otherName: string; label: string; }

export interface TickOutcome {
  deed?: Deed;
  patch?: Partial<NpcRecord>;
  relation?: RelationFx;
}

function mkDeed(turn: number, location: string, description: string): Deed {
  return { time: `第${turn}回合`, location, description, addedAt: Date.now() };
}

function tierNum(npc: NpcRecord): number {
  const m = /T(\d)/i.exec(npc.bioStrength ?? '');
  return m ? Number(m[1]) : 3;
}

/** 从 realm 解析阶位数（一~九阶 → 1~9）；无则回退 bioStrength T 档 */
function realmTier(npc: NpcRecord): number {
  const m = /([一二三四五六七八九])阶/.exec(npc.realm ?? '');
  return m ? (CN_NUM[m[1]] ?? 3) : tierNum(npc);
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

function equippedItemName(npc: NpcRecord): string {
  const eq = (npc.items ?? []).find((it) => it.equipped);
  return eq?.name || '随身装备';
}

/** 契约者归属的乐园（七乐园之一，按 id 稳定指派；纯背景 flavor，喂 {paradise} 槽） */
export function homeParadise(id: string): string {
  const bank = getCorpus().banks.paradise;
  return bank?.length ? bank[hashStr(id) % bank.length] : '';
}

/** 受保护、永不被自治致死的 NPC：好友 / 羁绊开局 / 手动长留 / 当前队友 */
const isProtected = (n: NpcRecord) => !!(n.isFriend || n.isBond || n.keepForever || n.partyMember);

function npcTierName(npc: NpcRecord): string | undefined {
  return /([一二三四五六七八九]阶|绝强|至强|巅峰至强|无上之境)/.exec(npc.realm ?? '')?.[1];
}
function npcLevel(npc: NpcRecord): number | undefined {
  const m = /Lv\.?\s*(\d+)/i.exec(npc.realm ?? '');
  return m ? Number(m[1]) : undefined;
}

/**
 * 档内有界成长（档B·②）：涨 Lv（不越当前阶）+ 微调六维（clampBaseAttrs 按 ATTR_CAP_BY_TIER 封顶）。
 * 返回要并入 patch 的字段；无实际变化则返回空对象。绝不越档、绝不碰主角（仅离场 NPC）。
 */
export function boundedGrowth(npc: NpcRecord, rng: () => number, opts: { levelUp?: boolean; attrGain?: number }): Partial<NpcRecord> {
  const out: Partial<NpcRecord> = {};
  const tierName = npcTierName(npc);
  const lv = npcLevel(npc);
  if (opts.levelUp && lv != null) {
    const ti = (TIER_NAMES.indexOf(tierName ?? '') + 1) || Math.ceil(lv / 10);
    const newLv = Math.min(lv + 1, ti * 10);    // 阶顶 = 阶序 ×10 级，封死不越阶
    if (newLv !== lv) out.realm = (npc.realm ?? '').replace(/Lv\.?\s*\d+/i, `Lv.${newLv}`);
  }
  if (opts.attrGain && npc.attrs) {
    const cap = attrCapForTier(tierName, lv);   // 该档「单个基础属性」硬上限
    const next = { ...npc.attrs };
    let changed = false;
    for (let i = 0; i < opts.attrGain; i++) {
      const k = ATTR_KEYS[Math.floor(rng() * ATTR_KEYS.length)];
      const v = Math.min((next[k] ?? 0) + 1, cap);   // 按档封顶，不越档
      if (v !== next[k]) { next[k] = v; changed = true; }
    }
    if (changed) out.attrs = next;
  }
  return out;
}

/** 往 relations 串追加一条关系，按名去重（同名覆盖）。格式 "名:关系;名:关系" */
export function addRelation(rel: string | undefined, name: string, label: string): string {
  const kept = (rel ?? '')
    .split(/[;；]/).map((s) => s.trim()).filter(Boolean)
    .filter((e) => e.split(/[:：]/)[0]?.trim() !== name);
  kept.push(`${name}:${label}`);
  return kept.join(';');
}

/** relations 里登记过的宿敌，且仍在场上（peers）→ 用于复仇定向 */
export function findRival(npc: NpcRecord, peers: string[]): string | undefined {
  const rel = npc.relations ?? '';
  return peers.find((name) => rel.includes(`${name}:宿敌`) || rel.includes(`${name}：宿敌`));
}

/** 挑对手：优先盯着已有宿敌（复仇），否则随机 */
function pickEnemy(rng: () => number, npc: NpcRecord, peers: string[]): string | null {
  if (!peers.length) return null;
  const rival = findRival(npc, peers);
  return rival && rng() < 0.6 ? rival : pickFrom(rng, peers);
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

const missionStatus = (world?: string) => `执行任务中（${world || '任务世界'}）`;

/** 是否任务世界原住民（土著）：不参与主神空间/任务循环，过本地生活 */
const isNative = (npc: NpcRecord) => npc.npcTag === '土著';

export interface TickOpts { allowDeath?: boolean; }

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

  // ── 任务世界相 ──
  if (auto.phase === 'mission') {
    const left = auto.turns - 1;
    if (left > 0) {
      return { patch: { auto: { ...auto, turns: left }, status: missionStatus(auto.world) } };
    }
    const rating = rollRating(rng, npc);
    // 陨落（档B）：仅 E 级·致死开关开·非保护·低概率
    if (rating === 'E' && opts.allowDeath && !isProtected(npc) && rng() < DEATH_CHANCE) {
      const dead = pickDeed('mission_death', { ...base, world: auto.world }, txtSeed);
      return {
        deed: mkDeed(turn, auto.world ?? '', dead),
        patch: { isDead: true, deadTurn: turn, status: '已死亡', auto: { phase: 'hub', turns: 0 } },
      };
    }
    const desc = pickDeed('mission_return', { ...base, world: auto.world, rating }, txtSeed);
    const rest = HUB_REST_MIN + Math.floor(rng() * (HUB_REST_SPAN + 1));
    // 档内有界成长（档B·②）：好评级真涨等级/六维，按档封顶不越档
    const grow = boundedGrowth(npc, rng, {
      levelUp: rating === 'S' || rating === 'SS' || rating === 'SSS',
      attrGain: rating === 'SSS' ? 2 : rating === 'SS' ? 1 : 0,
    });
    return {
      deed: mkDeed(turn, auto.world ?? '', desc),
      patch: { auto: { phase: 'hub', turns: rest }, status: '主神空间·休整', ...grow },
    };
  }

  // ── 主神空间相 ──
  if (auto.turns > 0 && rng() < 0.7) {            // 休整中，大概率不动
    return { patch: { auto: { ...auto, turns: auto.turns - 1 } } };
  }

  // 特殊征召（优先于普通行动）：世界争夺战（≥四阶）/ 试炼世界（≥三阶）
  const tier = realmTier(npc);
  if (tier >= 4 && rng() < WAR_CHANCE) {
    const desc = pickDeed('war_world', { ...base, world: '世界争夺战' }, txtSeed);
    const dur = MISSION_MIN + 2 + Math.floor(rng() * 3);
    return { deed: mkDeed(turn, '世界争夺战', desc), patch: { auto: { phase: 'mission', turns: dur, world: '世界争夺战' }, status: missionStatus('世界争夺战') } };
  }
  if (tier >= 3 && rng() < TRIAL_CHANCE) {
    const desc = pickDeed('trial', { ...base, world: '试炼世界' }, txtSeed);
    const dur = MISSION_MIN + Math.floor(rng() * 2);
    return { deed: mkDeed(turn, '试炼世界', desc), patch: { auto: { phase: 'mission', turns: dur, world: '试炼世界' }, status: missionStatus('试炼世界') } };
  }

  const action = pickHubAction(rng, npc);
  if (!action) {                                  // idle：不刷经历
    return { patch: { auto: { phase: 'hub', turns: Math.max(0, auto.turns - 1) } } };
  }

  if (action.action === 'mission') {              // 出任务 → 进任务世界相
    const world = pickFrom(rng, getCorpus().banks.worldTheme);
    const dur = MISSION_MIN + Math.floor(rng() * (MISSION_SPAN + 1));
    const desc = pickDeed('mission_depart', { ...base, world }, txtSeed);
    return {
      deed: mkDeed(turn, world, desc),
      patch: { auto: { phase: 'mission', turns: dur, world }, status: missionStatus(world) },
    };
  }

  // 主神空间内的其余行动 → 出一条经历、留在 hub（部分带关系副作用）
  let event = action.event as DeedEvent;
  const ctx: DeedCtx = { ...base };
  let relation: RelationFx | undefined;
  if (action.action === 'arena') {
    const target = pickEnemy(rng, npc, peers);
    event = rng() < 0.5 ? 'arena_win' : 'arena_lose';
    ctx.enemy = target ?? '某位契约者';
    ctx.n = 1 + Math.floor(rng() * 60);
    if (target && rng() < 0.3) relation = { otherName: target, label: '宿敌' };  // 竞技结仇
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
    ctx.item = equippedItemName(npc);
    ctx.coin = (1 + Math.floor(rng() * 9)) * 1000;
    ctx.n = 1 + Math.floor(rng() * 8);
  } else if (action.action === 'trade') {
    ctx.item = '一批资源';
  }
  // study / leisure / casino / heal / brand / title_smelt 仅用 tone/emote
  const desc = pickDeed(event, ctx, txtSeed);
  // 壁障突破考核 / 血脉炼化 → 档内有界微调六维
  const grow = (action.action === 'barrier_break' || action.action === 'bloodline')
    ? boundedGrowth(npc, rng, { attrGain: 1 })
    : {};
  return {
    deed: desc ? mkDeed(turn, '主神空间', desc) : undefined,
    patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间', ...grow },
    relation,
  };
}

/* ── 土著：留在任务世界过本地生活（无相位机，无乐园术语） ──── */
function decideNativeTick(npc: NpcRecord, turn: number, peers: string[]): TickOutcome {
  const seed = seedFrom(turn, npc.id);
  const rng = makeRng(seed);
  const txtSeed = (seed ^ 0x5bd1e995) >>> 0;
  if (rng() < NATIVE_IDLE) return {};            // 平淡的一天，不记
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

/** 离场 NPC 的模拟优先级：好友/羁绊/长留 + 任务中（免得卡进度） + 最近活跃 */
function score(n: NpcRecord): number {
  return (n.isFriend ? 100 : 0) + (n.isBond ? 50 : 0) + (n.keepForever ? 30 : 0)
    + (n.auto?.phase === 'mission' ? 40 : 0)
    + (n.updatedAt ?? 0) / 1e13;
}

/** 本回合是否轮到该 NPC 行动：好友/羁绊/长留/任务中者每回合都活；其余按分片轮换 */
function isActiveThisTurn(n: NpcRecord, turn: number): boolean {
  return !!(n.isFriend || n.isBond || n.keepForever)
    || n.auto?.phase === 'mission'
    || (hashStr(n.id) % CADENCE) === (turn % CADENCE);
}

/** 每回合调用：对离场 NPC 跑一次自治（零 API）。返回本回合新增的经历条数。自带开关守卫。 */
export function runNpcAutonomy(turn: number): number {
  if (!useSettings.getState().npcAutonomyOn) return 0;
  const store = useNpc.getState();
  const eligible = Object.values(store.npcs).filter((n) => !n.onScene && !n.isDead && hasRealNpcName(n));
  if (!eligible.length) return 0;

  // 关系只在同类之间结（契约者↔契约者在主神空间；土著↔土著在故土），避免跨界乱配
  const contractorNames = eligible.filter((n) => !isNative(n)).map((n) => n.name).filter(Boolean);
  const nativeNames = eligible.filter((n) => isNative(n)).map((n) => n.name).filter(Boolean);
  const byName = new Map<string, NpcRecord>();
  for (const n of eligible) if (n.name) byName.set(n.name, n);

  const ranked = eligible
    .filter((n) => isActiveThisTurn(n, turn))
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_TICKS_PER_TURN);

  // 累积本回合所有改动（同一 NPC 可被多方关系波及 → 关系串需逐步合并，故用 Map 累积）
  const acc = new Map<string, { deed?: Deed; patch: Partial<NpcRecord> }>();
  const ensure = (id: string) => {
    let e = acc.get(id);
    if (!e) { e = { patch: {} }; acc.set(id, e); }
    return e;
  };
  const relAdd = (id: string, name: string, label: string) => {
    const e = ensure(id);
    const baseRel = e.patch.relations ?? store.npcs[id]?.relations ?? '';
    e.patch.relations = addRelation(baseRel, name, label);
  };

  const allowDeath = useSettings.getState().npcAutonomyDeath;
  for (const npc of ranked) {
    const pool = (isNative(npc) ? nativeNames : contractorNames).filter((p) => p !== npc.name);
    const out = decideNpcTick(npc, turn, pool, { allowDeath });
    if (!out.deed && !out.patch && !out.relation) continue;
    const e = ensure(npc.id);
    if (out.deed) e.deed = out.deed;
    if (out.patch) Object.assign(e.patch, out.patch);
    if (out.relation) {
      relAdd(npc.id, out.relation.otherName, out.relation.label);
      const other = byName.get(out.relation.otherName);
      if (other && other.id !== npc.id) relAdd(other.id, npc.name, out.relation.label);
    }
  }

  const updates = [...acc.entries()].map(([id, e]) => ({ id, deed: e.deed, patch: e.patch }));
  if (updates.length) store.applyAutonomy(updates);
  return updates.filter((u) => u.deed).length;
}
