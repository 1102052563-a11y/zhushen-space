/* ════════════════════════════════════════════
   声明式成就引擎（借鉴 色色灵感状态栏V3.2 的成就目录架构）
   - 目录（achievementCatalog.ts）＝唯一事实源：每条成就声明 metric(ctx)→当前进度值 + target 阈值；
   - 引擎对 AchvCtx（各 store 的纯数值快照）机械求值，达标即经 playerStore.addAchievement 落档（按 id upsert·幂等·可重复调用）；
   - 纯前端零 API；与既有两条发放通道（AI 叙事解锁、casinoHonors/深渊 等设施发放）并存，id 前缀 cat_ 隔离；
   - 玩家删除 cat_ 成就后下次扫描会自动补回（条件仍达标＝确定性重授，与 casinoHonors 同语义）。
   调用点：App 回合推进兜底簇（sendMessage / reprocessVars）+ AchievementPanel 打开时。
════════════════════════════════════════════ */
import { usePlayer } from '../store/playerStore';
import { useItems, gradeToNum, isResourcePseudoItem } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useNpc } from '../store/npcStore';
import { useWorldRecord } from '../store/worldRecordStore';
import { useAbyss } from '../store/abyssStore';
import { useTeam } from '../store/adventureTeamStore';
import { useTerritory } from '../store/territoryStore';
import { useMisc } from '../store/miscStore';
import { useBioCycle } from '../store/bioCycleStore';
import { useTraining } from '../store/trainingStore';
import { worldDayIndex as worldDayIndexSafe } from './bioCycle';
import { effectiveTier, tierIndex } from './arena';
// 目录只 `import type` 本文件的 AchvDef（编译期擦除），此处运行时单向依赖 catalog，无环。
import { ACHV_CATALOG } from './achievementCatalog';

/** 各 store 的纯数值快照——catalog 的 metric 只准读它（纯函数·可单测） */
export interface AchvCtx {
  tierNum: number;         // 阶位序号：1=一阶 … 14=十四阶（effectiveTier 取 max(显式,等级推导)）
  level: number;
  worldSource: number;     // 当前任务世界累计世界之源
  attrTotal: number;       // 六维总和
  realAttrPlus: number;    // 真实属性·直加值总和
  reputeMax: number;       // 四维声誉最高档 0~5
  coins: number;           // 乐园币
  soulCoins: number;       // 灵魂钱币
  itemCount: number;       // 背包物品件数（排除货币伪物品）
  bestGradeNum: number;    // 持有物最高品级档 0..15（gradeToNum）
  bestEnhance: number;     // 装备最高强化等级 0..16
  weaponKills: number;     // 武器杀敌数合计（killCount 数字合计）
  skillCount: number;      // 主角(B1)技能数
  traitCount: number;      // 主角天赋数
  titleCount: number;      // 主角称号数
  subProfCount: number;    // 主角副职业数
  npcCount: number;        // 在档角色数（未死亡）
  npcDead: number;         // 在档已死亡角色数
  trustMax: number;        // 全 NPC 最高信任
  corruptionMax: number;   // 全 NPC 最高沉沦
  trainMax: number;        // 🔗 全 NPC 最高调教值（extra.调教值）
  devMax: number;          // 🔗 全 NPC 最高单项开发度（extra.开发·*）
  pregnantCount: number;   // 🌸 当前孕育中的 NPC 数（bioCycle·孕程内）
  orgasmMax: number;       // 🔗 单 NPC 最高高潮次数（extra.高潮次数）
  creampieMax: number;     // 🔗 单 NPC 最高内射次数（extra.内射次数）
  birthMax: number;        // 🔗 单 NPC 最高生产次数（extra.生产次数·已生育）
  trainRosterCount: number;// 🔗 纳入调教系统的人数（trainingStore.roster）
  worldsVisited: number;   // 踏入过的任务世界实例数
  worldsCleared: number;   // 通关数（summary.状态 含「通关」）
  bestRatingNum: number;   // 最佳通关评价档：E=2 D=3 C=4 B=5 A=6 S=7 SS=8 SSS=9（无=0）
  abyssDeepest: number;    // 地牢最深层
  abyssClears: number;     // 地牢通关次数
  teamFounded: number;     // 已建冒险团=1
  teamRankNum: number;     // 团评级：E=1 D=2 C=3 B=4 A=5 S=6 SS=7 SSS=8（未建=0）
  territoryLevel: number;  // 个人基地等级 1~5（未开=0）
  turnCount: number;       // 累计总回合数
  achievementCount: number;// 已解锁成就总数（含 AI/设施发放）
}

export interface AchvDef {
  id: string;              // 必须 cat_ 前缀（与 AI/设施发放的成就隔离）
  name: string;
  desc: string;            // 成就说明（解锁后展示）
  condition: string;       // 达成条件文案（图鉴锁定态也展示；隐藏成就锁定时不展示）
  category: string;        // 对齐 AchievementPanel 筛选片：战斗/探索/任务/生存/隐藏/其他
  type: string;            // 普通/累计/阶段/特殊
  rarity: string;          // D/C/B/A/S/SS/SSS（RARITY_CLS 有色）
  hidden?: boolean;        // 隐藏成就：图鉴锁定态打码，解锁才揭晓
  quip?: string;           // 趣评（解锁后的一句吐槽·借鉴V3.2）
  target: number;          // 达成阈值（>0）
  metric: (c: AchvCtx) => number;   // 当前进度值（只读 ctx）
}

export function emptyCtx(): AchvCtx {
  return {
    tierNum: 0, level: 0, worldSource: 0, attrTotal: 0, realAttrPlus: 0, reputeMax: 0,
    coins: 0, soulCoins: 0, itemCount: 0, bestGradeNum: 0, bestEnhance: 0, weaponKills: 0,
    skillCount: 0, traitCount: 0, titleCount: 0, subProfCount: 0,
    npcCount: 0, npcDead: 0, trustMax: 0, corruptionMax: 0, trainMax: 0, devMax: 0, pregnantCount: 0,
    orgasmMax: 0, creampieMax: 0, birthMax: 0, trainRosterCount: 0,
    worldsVisited: 0, worldsCleared: 0, bestRatingNum: 0,
    abyssDeepest: 0, abyssClears: 0, teamFounded: 0, teamRankNum: 0, territoryLevel: 0,
    turnCount: 0, achievementCount: 0,
  };
}

/* 评价字串（E-~SSS）→ 档位数。前缀最长优先；识别不了=0。 */
export function ratingRank(s?: string): number {
  const t = String(s ?? '').trim().toUpperCase();
  if (!t) return 0;
  const order: [string, number][] = [['SSS', 9], ['SS', 8], ['S', 7], ['A', 6], ['B', 5], ['C', 4], ['D', 3], ['E', 2]];
  for (const [k, n] of order) if (t.startsWith(k)) return n;
  return 0;
}

const TEAM_RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
function teamRankNum(rank?: string): number {
  const t = String(rank ?? '').trim().toUpperCase();
  // 最长优先：SSS→SS→S…
  for (let i = TEAM_RANKS.length - 1; i >= 0; i--) if (t === TEAM_RANKS[i]) return i + 1;
  return 0;
}

/* 逐 store 防御性取数：任一 store 读挂只丢自己那几项，绝不让整次扫描失败。 */
function safe<T>(fn: () => T, fb: T): T { try { const v = fn(); return v ?? fb; } catch { return fb; } }

export function buildAchvCtx(): AchvCtx {
  const c = emptyCtx();
  safe(() => {
    const p = usePlayer.getState();
    const prof = p.profile;
    c.level = Number(prof.level) || 0;
    c.tierNum = tierIndex(effectiveTier(prof.tier, c.level)) + 1;
    c.worldSource = Number(prof.worldSource) || 0;
    c.attrTotal = Object.values(prof.attrs ?? {}).reduce((s: number, v) => s + (Number(v) || 0), 0);
    c.realAttrPlus = Object.values(prof.realAttrs ?? {}).reduce((s: number, v) => s + (Number(v) || 0), 0);
    const rp = prof.repute;
    c.reputeMax = rp ? Math.max(rp.official || 0, rp.folk || 0, rp.shadow || 0, rp.trade || 0) : 0;
    c.achievementCount = (p.achievements ?? []).length;
    return 0;
  }, 0);
  safe(() => {
    const it = useItems.getState() as any;
    const cur = it.currency ?? {};
    c.coins = Number(cur['乐园币']) || 0;
    c.soulCoins = Number(cur['灵魂钱币']) || 0;
    const items = (it.items ?? []) as any[];
    let cnt = 0, grade = 0, enh = 0, kills = 0;
    for (const x of items) {
      if (!x || x.archived) continue;
      if (isResourcePseudoItem(x)) continue;
      cnt++;
      grade = Math.max(grade, gradeToNum(x.gradeDesc));
      enh = Math.max(enh, Number(x.maxEnhanceLevel ?? x.enhanceLevel) || 0);
      const k = parseInt(String(x.killCount ?? '').replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(k)) kills += k;
    }
    c.itemCount = cnt; c.bestGradeNum = grade; c.bestEnhance = enh; c.weaponKills = kills;
    return 0;
  }, 0);
  safe(() => {
    const b1 = (useCharacters.getState().characters ?? {})['B1'] as any;
    c.skillCount = (b1?.skills ?? []).length;
    c.traitCount = (b1?.traits ?? []).length;
    c.titleCount = (b1?.titles ?? []).length;
    c.subProfCount = (b1?.subProfessions ?? []).length;
    return 0;
  }, 0);
  safe(() => {
    const npcs = Object.values(useNpc.getState().npcs ?? {}) as any[];
    const DEV = ['开发·口部', '开发·乳部', '开发·下体', '开发·后庭', '开发·手足', '开发·全身感度'];
    const numOf = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
    let alive = 0, dead = 0, trust = 0, corr = 0, train = 0, dev = 0, orgasm = 0, creampie = 0, birth = 0;
    for (const n of npcs) {
      if (!n || !n.name || n.name === n.id) continue;   // 占位/空档不计
      if (n.isDead) { dead++; continue; }
      alive++;
      trust = Math.max(trust, Number(n.trust) || 0);
      corr = Math.max(corr, Number(n.corruption) || 0);
      const ex = (n.extra ?? {}) as Record<string, string>;
      train = Math.max(train, numOf(ex['调教值']));
      for (const k of DEV) dev = Math.max(dev, numOf(ex[k]));
      orgasm = Math.max(orgasm, numOf(ex['高潮次数']));
      creampie = Math.max(creampie, numOf(ex['内射次数']));
      birth = Math.max(birth, numOf(ex['生产次数']));
    }
    c.npcCount = alive; c.npcDead = dead; c.trustMax = trust; c.corruptionMax = corr; c.trainMax = train; c.devMax = dev;
    c.orgasmMax = orgasm; c.creampieMax = creampie; c.birthMax = birth;
    return 0;
  }, 0);
  safe(() => { c.trainRosterCount = (useTraining.getState().roster ?? []).length; return 0; }, 0);
  safe(() => {
    const B: any = useBioCycle.getState();
    if (!B.enabled) return 0;
    const day = worldDayIndexSafe(useMisc.getState().worldTime);
    if (day == null) return 0;
    let preg = 0;
    for (const prof of Object.values(B.chars ?? {}) as any[]) {
      if (prof?.on && prof.pregnant && day - prof.pregnant.sinceDay >= 0 && day - prof.pregnant.sinceDay <= 280) preg++;
    }
    c.pregnantCount = preg;
    return 0;
  }, 0);
  safe(() => {
    const recs = (useWorldRecord.getState().records ?? []) as any[];
    c.worldsVisited = recs.length;
    let cleared = 0, best = 0;
    for (const r of recs) {
      const st = String(r?.summary?.状态 ?? '');
      if (st.includes('通关')) cleared++;
      best = Math.max(best, ratingRank(r?.summary?.综合评价));
    }
    c.worldsCleared = cleared; c.bestRatingNum = best;
    return 0;
  }, 0);
  safe(() => {
    const m = (useAbyss.getState() as any).meta ?? {};
    c.abyssDeepest = Number(m.deepestFloor) || 0;
    c.abyssClears = Number(m.clearsCount) || 0;
    return 0;
  }, 0);
  safe(() => {
    const t = useTeam.getState() as any;
    c.teamFounded = t.established && !t.disbanded ? 1 : 0;
    c.teamRankNum = c.teamFounded ? teamRankNum(t.rank) : 0;
    return 0;
  }, 0);
  safe(() => {
    const tr = useTerritory.getState() as any;
    c.territoryLevel = Number(tr.level) || 0;
    return 0;
  }, 0);
  safe(() => { c.turnCount = Number(useMisc.getState().turnCount) || 0; return 0; }, 0);
  return c;
}

/** 纯求值：返回本次新达标的成就定义（不写 store）。metric 抛错/NaN 的条目跳过。 */
export function evalUnlocks(catalog: readonly AchvDef[], ctx: AchvCtx, ownedIds: ReadonlySet<string>): AchvDef[] {
  const out: AchvDef[] = [];
  for (const d of catalog) {
    if (ownedIds.has(d.id)) continue;
    let v = 0;
    try { v = d.metric(ctx); } catch { continue; }
    if (!Number.isFinite(v)) continue;
    if (v >= d.target) out.push(d);
  }
  return out;
}

/** 图鉴进度（锁定态进度条用）。 */
export function progressOf(d: AchvDef, ctx: AchvCtx): { cur: number; target: number; pct: number } {
  let v = 0;
  try { v = d.metric(ctx); } catch { v = 0; }
  if (!Number.isFinite(v)) v = 0;
  const cur = Math.max(0, Math.min(v, d.target));
  return { cur, target: d.target, pct: d.target > 0 ? cur / d.target : 0 };
}

/** 扫描并落档：达标未持有的目录成就 → addAchievement（按 id upsert·幂等）。返回本次新解锁的名字。 */
export function sweepAchievements(): string[] {
  try {
    const pl = usePlayer.getState();
    const owned = new Set((pl.achievements ?? []).map((a) => a.id));
    const ctx = buildAchvCtx();
    const hits = evalUnlocks(ACHV_CATALOG, ctx, owned);
    if (!hits.length) return [];
    const when = safe(() => useMisc.getState().worldTime || undefined, undefined as string | undefined);
    for (const d of hits) {
      pl.addAchievement({
        id: d.id, name: d.name, desc: d.desc, condition: d.condition,
        category: d.hidden ? '隐藏' : d.category, type: d.type, rarity: d.rarity,
        hidden: !!d.hidden, unlockTime: when,
      });
    }
    const names = hits.map((d) => d.name);
    console.log(`[成就] 🏅 图鉴自动解锁 ${names.length} 条：${names.join('、')}`);
    return names;
  } catch (e) {
    console.warn('[成就] 扫描失败（跳过本次）:', e);
    return [];
  }
}
