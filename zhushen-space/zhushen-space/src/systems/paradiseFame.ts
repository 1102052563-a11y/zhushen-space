/*
  乐园声望（卡里完全没有，但无限流必须有 —— 见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §5.5）
  ────────────────────────────────────────────────────────────────────────────────
  四维声誉绑任务世界，几十回合就随离世归零，价值有限。真正该**永久累积**的是
  「主角在轮回乐园这个圈子里的名声」——而前端早就攒了一堆数据，却从没有任何地方汇总过：

      竞技场排名 / 烙印等级 / 深渊最深层与通关数 / 冒险团阶位 / 公会等级 / 历次世界结算评级

  它们各自躺在各自的面板里，对叙事零贡献。这个模块把它们**纯派生**地聚成一个声望档，
  用途有三：
    ① 注入正文（契约者 NPC、私信砍价、频道互动都能读到"这人在乐园什么名号"）
    ② 契约者 NPC 建档时的初始 trust/respect 基线（而不是恒定 10）
    ③ 跨世界传闻：声望够高时，新世界的**其他契约者**可能"听说过你"
       —— 注意这**不破**土著的认知隔离：土著仍然一无所知（NATIVE_UNAWARE_RULE 照旧）

  ★ 纯派生 = **零 store 改动、零存档改动**：每次现算，没有需要维护的新状态。
  ★ 所有 store 读取都各自 try/catch：某个玩法没启用/store 没载入时静默跳过，绝不阻断注入。
*/
import { usePlayer } from '../store/playerStore';
import { useTeam } from '../store/adventureTeamStore';
import { useWorldRecord } from '../store/worldRecordStore';
import { useAbyss } from '../store/abyssStore';
import { useGuild } from '../store/guildStore';

/** 声望七档（低→高）。名号是"别人怎么称呼你"，不是数值。 */
export const FAME_TIERS = [
  '无名之辈', '略有耳闻', '小有名气', '崭露头角', '名号在外', '声名显赫', '传说级契约者',
] as const;
export type FameTier = typeof FAME_TIERS[number];

/** 各档的分数门槛（累计分 → 档位）。刻意让前两档很容易到，最高档很难。 */
const TIER_GATES = [0, 8, 20, 40, 70, 110, 170];

export interface FameSource {
  label: string;    // 展示用：「竞技场第37名」
  score: number;    // 贡献分
}

export interface FameReport {
  tier: FameTier;
  score: number;
  sources: FameSource[];
  /** 一行摘要，直接注入 */
  line: string;
}

/* 竞技场名次 → 分：前100 有分，越靠前越高（第1名 30 分，第100名 6 分）。 */
function arenaScore(rank?: string): FameSource | null {
  const m = /(\d+)/.exec(rank ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  const s = Math.round(6 + 24 * (1 - (n - 1) / 99));
  return { label: `竞技场第${n}名`, score: s };
}

/* 烙印等级：契约者的资历标尺，起始 1。每级 3 分，封顶 30。 */
function brandScore(brand?: string): FameSource | null {
  const m = /(\d+)/.exec(brand ?? '');
  if (!m) return null;
  const lv = Number(m[1]);
  if (!Number.isFinite(lv) || lv <= 1) return null;   // 起始 1 不算成就
  return { label: `烙印${lv}级`, score: Math.min(30, lv * 3) };
}

/* 深渊：最深层每 10 层 4 分（封顶 24）＋ 每次通关 6 分（封顶 18）。 */
function abyssScore(): FameSource[] {
  const out: FameSource[] = [];
  try {
    const m = (useAbyss.getState() as { meta?: { deepestFloor?: number; clearsCount?: number } }).meta;
    if (!m) return out;
    const floor = m.deepestFloor ?? 0;
    if (floor > 0) out.push({ label: `深渊第${floor}层`, score: Math.min(24, Math.floor(floor / 10) * 4) });
    const clears = m.clearsCount ?? 0;
    if (clears > 0) out.push({ label: `深渊通关${clears}次`, score: Math.min(18, clears * 6) });
  } catch { /* 深渊未启用 */ }
  return out.filter((s) => s.score > 0);
}

const TEAM_RANK_SCORE: Record<string, number> = { E: 0, D: 3, C: 7, B: 12, A: 18, S: 26, SS: 34, SSS: 44 };

function teamScore(): FameSource | null {
  try {
    const t = useTeam.getState() as { established?: boolean; disbanded?: boolean; rank?: string; name?: string };
    if (!t.established || t.disbanded) return null;
    const s = TEAM_RANK_SCORE[String(t.rank ?? 'E')] ?? 0;
    if (s <= 0) return null;
    return { label: `${t.name || '冒险团'}·${t.rank}阶`, score: s };
  } catch { return null; }
}

function guildScore(): FameSource | null {
  try {
    const g = (useGuild.getState() as { my?: { name?: string; level?: number; role?: string } }).my;
    if (!g) return null;
    const lv = g.level ?? 1;
    const roleBonus = g.role === 'leader' ? 8 : g.role === 'viceLeader' ? 5 : g.role === 'elder' ? 3 : 0;
    const s = Math.min(24, lv * 2) + roleBonus;
    if (s <= 0) return null;
    return { label: `${g.name || '公会'}Lv.${lv}${roleBonus ? '·要职' : ''}`, score: s };
  } catch { return null; }
}

/* 历次世界结算评级：S 级以上才真正传得开。取最好的 3 次。 */
const GRADE_SCORE: Record<string, number> = { SSS: 30, SS: 22, S: 16, A: 9, B: 4, C: 1 };

function clearScores(): FameSource[] {
  try {
    const recs = (useWorldRecord.getState() as { records?: { name?: string; summary?: { 综合评价?: string } }[] }).records ?? [];
    const graded = recs
      .map((r) => {
        const g = (r.summary?.综合评价 ?? '').trim().toUpperCase();
        const key = Object.keys(GRADE_SCORE).find((k) => g.startsWith(k));
        return key ? { label: `${r.name || '某世界'}通关${key}`, score: GRADE_SCORE[key] } : null;
      })
      .filter((x): x is FameSource => !!x)
      .sort((a, b) => b.score - a.score);
    return graded.slice(0, 3);
  } catch { return []; }
}

export function fameTierOf(score: number): FameTier {
  let idx = 0;
  for (let i = 0; i < TIER_GATES.length; i++) if (score >= TIER_GATES[i]) idx = i;
  return FAME_TIERS[idx];
}

/** 现算一份乐园声望报告。零副作用、零存档。 */
export function paradiseFame(): FameReport {
  const sources: FameSource[] = [];
  try {
    const p = usePlayer.getState().profile;
    const a = arenaScore(p?.arenaRank); if (a) sources.push(a);
    const b = brandScore(p?.brandLevel); if (b) sources.push(b);
  } catch { /* */ }
  sources.push(...abyssScore());
  const t = teamScore(); if (t) sources.push(t);
  const g = guildScore(); if (g) sources.push(g);
  sources.push(...clearScores());

  sources.sort((x, y) => y.score - x.score);
  const score = sources.reduce((n, s) => n + s.score, 0);
  const tier = fameTierOf(score);
  const line = sources.length
    ? `${tier}（${sources.slice(0, 4).map((s) => s.label).join('、')}）`
    : tier;
  return { tier, score, sources, line };
}

/** 声望是否高到"新世界的其他契约者可能听说过你"（第 5 档起） */
export function isRenowned(rep?: FameReport): boolean {
  const r = rep ?? paradiseFame();
  return FAME_TIERS.indexOf(r.tier) >= 4;
}

/**
 * 契约者 NPC 建档时的初始态度基线（而不是恒定 10）。
 * ⚠ 只作用于**契约者**——土著对乐园声望一无所知，不该因此高看主角一眼。
 * 尊重随声望走（名号响就服气），信任只轻微加成（认识 ≠ 信任）。
 */
export function contractorBaseline(rep?: FameReport): { trust: number; respect: number } {
  const idx = FAME_TIERS.indexOf((rep ?? paradiseFame()).tier);
  return { trust: 10 + Math.min(10, idx * 2), respect: 10 + Math.min(30, idx * 6) };
}

/** 注入正文的一行；无任何成就时不出块 */
export function buildFameInjection(): { role: 'system'; content: string }[] {
  const rep = paradiseFame();
  if (!rep.sources.length) return [];
  const renown = isRenowned(rep)
    ? `\n· 名号已传开：**其他契约者**（不含本世界土著）见到主角时，可能认出、听说过、或慕名／忌惮。土著对此一无所知。`
    : '';
  return [{
    role: 'system' as const,
    content: `<乐园声望>（主角在轮回乐园契约者圈子里的**跨世界**名声·背景事实：对话与他人态度可自然体现，勿据此结算数值）\n`
      + `· ${rep.line}${renown}\n</乐园声望>`,
  }];
}
