/*
  轨道A · 离场契约者自治引擎（零 API）
  ────────────────────────────────────────────────────────────────
  每回合(runPostNarrativePhases)调用 runNpcAutonomy(turn)：对「离场·有真名·未死」的
  NPC 跑一次确定性「任务世界 ↔ 主神空间」双相循环，产出经历(deedLog)与相位(auto)，
  全程不调 API。文本取自 autonomyCorpus 语料库；随机基于 seedFrom(turn,id) 可复现。
  与演化AI分工：演化AI管在场NPC、本引擎只碰离场NPC，互不重叠。
  安全(MVP)：不改六维/等级、不致死（忠于「不凭空涨数值」铁律）；只生活、写经历、转相位。
*/
import { useNpc, hasRealNpcName, type NpcRecord, type NpcAuto } from '../store/npcStore';
import type { Deed } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import {
  pickDeed, seedFrom, behaviorBiasFor, makeRng, pickFrom, getCorpus,
  type DeedCtx, type DeedEvent,
} from './autonomyCorpus';

const MAX_TICKS_PER_TURN = 14;             // 每回合最多模拟的离场 NPC 数（控性能/刷屏）
const MISSION_MIN = 2, MISSION_SPAN = 3;   // 任务时长 2..4 回合
const HUB_REST_MIN = 1, HUB_REST_SPAN = 1; // 归来后休整 1..2 回合
const IDLE_WEIGHT = 1.3;                    // 「啥也不干」权重 → 控制刷经历密度

/** 主神空间候选行动 → behaviorBias 权重键 + 语料事件（mission/arena 特殊处理） */
const HUB_TABLE: ReadonlyArray<{ action: string; biasKey: string; event?: DeedEvent }> = [
  { action: 'mission', biasKey: 'mission' },
  { action: 'arena', biasKey: 'arena' },
  { action: 'enhance', biasKey: 'enhance', event: 'enhance' },
  { action: 'trade', biasKey: 'trade', event: 'trade' },
  { action: 'team', biasKey: 'team', event: 'team_join' },
  { action: 'casino', biasKey: 'casino', event: 'casino' },
  { action: 'heal', biasKey: 'heal', event: 'heal' },
];

export interface TickOutcome {
  deed?: Deed;
  patch?: Partial<NpcRecord>;
}

function mkDeed(turn: number, location: string, description: string): Deed {
  return { time: `第${turn}回合`, location, description, addedAt: Date.now() };
}

function tierNum(npc: NpcRecord): number {
  const m = /T(\d)/i.exec(npc.bioStrength ?? '');
  return m ? Number(m[1]) : 3;
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

/** 纯函数：给定 NPC 与回合号，决定本回合自治产出（经历 + 相位/状态补丁）。可单测。 */
export function decideNpcTick(npc: NpcRecord, turn: number, peers: string[] = []): TickOutcome {
  const auto: NpcAuto = npc.auto ?? { phase: 'hub', turns: 0 };
  const seed = seedFrom(turn, npc.id);
  const rng = makeRng(seed);
  const txtSeed = (seed ^ 0x5bd1e995) >>> 0;
  const base: DeedCtx = { name: npc.name, realm: npc.realm, personality: npc.personality };

  // ── 任务世界相 ──
  if (auto.phase === 'mission') {
    const left = auto.turns - 1;
    if (left > 0) {
      return { patch: { auto: { ...auto, turns: left }, status: missionStatus(auto.world) } };
    }
    const rating = rollRating(rng, npc);
    const desc = pickDeed('mission_return', { ...base, world: auto.world, rating }, txtSeed);
    const rest = HUB_REST_MIN + Math.floor(rng() * (HUB_REST_SPAN + 1));
    return {
      deed: mkDeed(turn, auto.world ?? '', desc),
      patch: { auto: { phase: 'hub', turns: rest }, status: '主神空间·休整' },
    };
  }

  // ── 主神空间相 ──
  if (auto.turns > 0 && rng() < 0.7) {            // 休整中，大概率不动
    return { patch: { auto: { ...auto, turns: auto.turns - 1 } } };
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

  // 主神空间内的其余行动 → 出一条经历、留在 hub
  let event = action.event as DeedEvent;
  const ctx: DeedCtx = { ...base };
  if (action.action === 'arena') {
    event = rng() < 0.5 ? 'arena_win' : 'arena_lose';
    ctx.enemy = peers.length ? pickFrom(rng, peers) : '某位契约者';
    ctx.n = 1 + Math.floor(rng() * 60);
  } else if (action.action === 'enhance') {
    ctx.item = equippedItemName(npc);
    ctx.coin = (1 + Math.floor(rng() * 9)) * 1000;
    ctx.n = 1 + Math.floor(rng() * 8);
  } else if (action.action === 'trade') {
    ctx.item = '一批资源';
  } else if (action.action === 'team') {
    ctx.enemy = peers.length ? pickFrom(rng, peers) : '几名契约者';
  }
  const desc = pickDeed(event, ctx, txtSeed);
  return {
    deed: desc ? mkDeed(turn, '主神空间', desc) : undefined,
    patch: { auto: { phase: 'hub', turns: 0 }, status: '主神空间' },
  };
}

/** 离场 NPC 的模拟优先级：好友/羁绊/长留 + 任务中（免得卡进度） + 最近活跃 */
function score(n: NpcRecord): number {
  return (n.isFriend ? 100 : 0) + (n.isBond ? 50 : 0) + (n.keepForever ? 30 : 0)
    + (n.auto?.phase === 'mission' ? 40 : 0)
    + (n.updatedAt ?? 0) / 1e13;
}

/** 每回合调用：对离场 NPC 跑一次自治（零 API）。返回本回合新增的经历条数。自带开关守卫。 */
export function runNpcAutonomy(turn: number): number {
  if (!useSettings.getState().npcAutonomyOn) return 0;
  const store = useNpc.getState();
  const eligible = Object.values(store.npcs).filter((n) => !n.onScene && !n.isDead && hasRealNpcName(n));
  if (!eligible.length) return 0;

  const ranked = eligible.slice().sort((a, b) => score(b) - score(a)).slice(0, MAX_TICKS_PER_TURN);
  const peers = eligible.map((n) => n.name).filter(Boolean);

  const updates: Array<{ id: string; deed?: Deed; patch?: Partial<NpcRecord> }> = [];
  for (const npc of ranked) {
    const out = decideNpcTick(npc, turn, peers.filter((p) => p !== npc.name));
    if (out.deed || out.patch) updates.push({ id: npc.id, deed: out.deed, patch: out.patch });
  }
  if (updates.length) store.applyAutonomy(updates);
  return updates.filter((u) => u.deed).length;
}
