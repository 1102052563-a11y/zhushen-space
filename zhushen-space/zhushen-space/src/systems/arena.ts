import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';

/* ════════════════════════════════════════════
   竞技场（纯逻辑，无 React / 无 AI）
   · 阶位 → 开放哪些竞技场（一~四阶普通本阶竞技场；五阶起开强者争霸战·六阶需前50资格；七阶+ 树之竞技场）
   · 名次 → 榜单要展示的 50 个 rank（确定性算，名字/标签交给 AI 填）
   · 名次 → 奖励档位（仅前100有物质奖励）
   术语遵循轮回乐园：阶位 / 生物强度 T0~T9 / 乐园币·魂币·灵魂结晶。
════════════════════════════════════════════ */

export type ArenaKind = 'normal' | 'championship' | 'tree';

export interface ArenaDef {
  id: string;            // 稳定标识：普通=n{idx}（n4=五阶/n5=六阶…）/ championship / tree
  kind: ArenaKind;
  name: string;          // "六阶竞技场" / "强者争霸战" / "树之竞技场"
  emoji: string;
  desc: string;
  locked: boolean;       // true=不可进入（资格不足）
  lockHint?: string;     // 锁定原因/资格提示文案
  noticeText?: string;   // 非锁定时的特别提示（如五阶"预定名额"文案）
}

export interface LadderEntry {
  rank: number;
  name: string;
  tier: string;          // 阶位
  job: string;           // 职业（多样新意）
  strength: string;      // 生物强度档 T0~T9
  persona?: string;      // 性格
  badge?: string;        // 树生世界 / 虚空通行 / 争霸席位 …
  isPlayer?: boolean;    // 主角自己那一行
}

/* 主角阶位下标（一阶=0 … 五阶=4 … 七阶=6）；取不到当 0。 */
export function tierIndex(tier?: string): number {
  const t = normalizeTier(tier);
  const i = TIERS.indexOf(t as typeof TIERS[number]);
  return i < 0 ? 0 : i;
}

/* 有效阶位 = max(显式 profile.tier, 等级推导)。
   侧栏显示的是 realmFromLevel(level)，而 profile.tier 早期常停在「一阶」；
   取两者较高者，既贴合玩家所见、又尊重 AI 设过的更高阶位（与 combat 的 p.tier||realmFromLevel 同源）。 */
export function effectiveTier(tier: string | undefined, level: number): string {
  const a = normalizeTier(tier);
  const b = realmFromLevel(Math.max(1, level || 1));
  const ia = TIERS.indexOf(a as typeof TIERS[number]);
  const ib = TIERS.indexOf(b as typeof TIERS[number]);
  return (ia >= ib ? (a || b) : b) || '一阶';
}

export const CHAMPIONSHIP_INDEX = 4;   // 五阶起才有强者争霸战资格（普通竞技场一阶即可用）

/* 竞技场对所有阶位开放：一~四阶为「本阶竞技场」（普通），五阶起增开强者争霸战，七阶+ 树之竞技场。
   保留此函数以兼容调用方（恒为 true）。 */
export function arenaUnlocked(_tier?: string): boolean {
  return true;
}

/* 是否身处乐园（枢纽）内 —— 竞技场只在乐园内可用。
   依据杂项演化的当前世界名（miscStore.worldName）：乐园/专属房间/主神空间 = 在枢纽；
   任务世界/衍生世界（有自己的地名）= 在外，不可用。空名按"在乐园"（开局兜底，不误锁）。
   比 isHomeWorld 略宽：覆盖天启/圣域/死亡等任意「…乐园」枢纽。 */
export function inParadise(worldName?: string): boolean {
  const s = (worldName ?? '').trim();
  if (!s) return true;
  return /乐园|专属房间|主神空间/.test(s);
}

/* 普通竞技场的稳定 id（按阶位下标），如六阶=ti5→'n5'。 */
export function normalArenaId(ti: number): string { return `n${ti}`; }

/* 主角阶位 → 开放哪些竞技场卡片。
   championshipQualified = 六阶普通竞技场历史最佳是否 ≤50。 */
export function arenasForTier(tier: string | undefined, championshipQualified: boolean): ArenaDef[] {
  const ti = tierIndex(tier);
  const tierName = TIERS[ti] ?? '一阶';

  // 七阶及以上：进入树之竞技场（取代普通乐园竞技场，强者争霸并入树之体系）
  if (ti >= 6) {
    return [{
      id: 'tree', kind: 'tree', name: '树之竞技场', emoji: '🌳',
      desc: '匹配来自所有乐园、虚空种族与超脱·原生世界的七阶强者。前50名可进入「树生世界」，前10名获「虚空通行」资格。',
      locked: false,
    }];
  }

  // 一阶起即有「本阶竞技场」（普通竞技场，仅本阶内排名与匹配）
  const out: ArenaDef[] = [{
    id: normalArenaId(ti), kind: 'normal', name: `${tierName}竞技场`, emoji: '🏟',
    desc: `轮回乐园${tierName}内部竞技场，进行本阶排名与匹配。`,
    locked: false,
  }];

  if (ti === 4) {
    // 五阶：可锁定名额，但真正参赛在六阶 —— 仅提示文案，本阶不可参赛
    out.push({
      id: 'championship', kind: 'championship', name: '强者争霸战', emoji: '⚔️',
      desc: '跨乐园·跨世界的顶级赛事，由虚空之树公证。', locked: true,
      lockHint: '五阶尚无参赛资格。在五阶竞技场打进前列可「预定名额」——晋升六阶后将代表轮回乐园正式出战。',
    });
  } else if (ti === 5) {
    // 六阶：正式参赛，但仅六阶竞技场前50名有资格
    out.push({
      id: 'championship', kind: 'championship', name: '强者争霸战', emoji: '⚔️',
      desc: '参赛方含轮回·天启·圣域·死亡·圣光等乐园，及羽族·恶魔族·奥术永恒星等虚空势力，虚空之树公证。',
      locked: !championshipQualified,
      lockHint: championshipQualified ? undefined : '资格不足：需在六阶竞技场打进前50名，方可代表轮回乐园出战。',
    });
  }
  return out;
}

/* 五阶在普通竞技场打进前列时的「预定名额」提示文案（playerRank 足够靠前才显示）。 */
export function reserveSeatNotice(arenaId: string, ti: number, playerRank: number): string | undefined {
  if (ti === 4 && arenaId === normalArenaId(4) && playerRank <= 3) {
    return '轮回乐园提示：你已锁定一个强者争霸战名额。如晋升六阶，将代表轮回乐园正式出战，对手包括其他乐园、虚空种族与超脱·原生世界的六阶强者。';
  }
  return undefined;
}

/* 首次进入某竞技场时给主角播种一个合理的初始名次（之后存进 store 即「记忆」，不再变动除非挑战）。
   championship 只有约50席，主角刚拿到资格→第50席。 */
export function seedPlayerRank(def: ArenaDef): number {
  if (def.kind === 'championship') return 50;
  if (def.kind === 'tree') return randInt(1500, 6000);
  return randInt(600, 2500);
}
function randInt(a: number, b: number): number { return a + Math.floor(Math.random() * (b - a + 1)); }

/* ── 名次 → 50 个要展示的 rank ────────────────────────────────
   主榜（home）：~20 个比主角高约 500 名的人 + ~30 个主角附近的人（含主角本人）。
   主角已在前50→直接给资格榜 1..50。 */
export function buildHomeRanks(playerRank: number, kind: ArenaKind): number[] {
  const cap = kind === 'championship' ? 50 : Infinity;
  if (playerRank <= 50 || cap === 50) {
    return range(1, Math.min(50, cap === 50 ? 50 : 50));
  }
  const set = new Set<number>();
  // 高约500名的一档（20 个）
  const highCenter = Math.max(1, playerRank - 500);
  for (let r = highCenter - 9; r <= highCenter + 10; r++) if (r >= 1) set.add(r);
  // 主角附近（30 个，含主角）
  for (let r = playerRank - 16; r <= playerRank + 14; r++) if (r >= 1) set.add(r);
  set.add(playerRank);
  return clampTo50(set, playerRank);
}

/* 自选名次：目标名次附近 50 人（target-24 … target+25）。 */
export function buildWindowRanks(target: number, kind: ArenaKind): number[] {
  const t = Math.max(1, Math.round(target));
  if (kind === 'championship') return range(1, 50);
  const set = new Set<number>();
  for (let r = t - 24; r <= t + 25; r++) if (r >= 1) set.add(r);
  return clampTo50(set, t);
}

function clampTo50(set: Set<number>, must: number): number[] {
  let arr = Array.from(set).sort((a, b) => a - b);
  if (arr.length > 50) {
    // 优先保留离 must 最近的 50 个，再按 rank 升序
    arr = arr.sort((a, b) => Math.abs(a - must) - Math.abs(b - must)).slice(0, 50).sort((a, b) => a - b);
  }
  return arr;
}
function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/* 树之 / 争霸 榜单 badge（按 rank）。 */
export function ladderBadge(kind: ArenaKind, rank: number): string | undefined {
  if (kind === 'tree') {
    if (rank <= 10) return '虚空通行';
    if (rank <= 50) return '树生世界';
  }
  if (kind === 'championship') {
    if (rank <= 10) return '争霸十强';
    return '争霸席位';
  }
  return undefined;
}

/* ── 名次 → 奖励档位（仅前100有物质奖励）──────────────────── */
export type RewardTier = 'champion' | 'top10' | 'top50' | 'top100' | 'none';
export function rewardTierFor(rank: number): RewardTier {
  if (rank === 1) return 'champion';
  if (rank <= 10) return 'top10';
  if (rank <= 50) return 'top50';
  if (rank <= 100) return 'top100';
  return 'none';
}

/* 各档位的品级带宽（前端据此约束 AI 生成的奖励，避免越级爆金）+ 件数 + 货币范围。 */
export interface RewardBand {
  label: string;
  grades: string;           // 允许的品级（喂给 AI 的约束）
  itemCount: [number, number];
  paradiseCoin: [number, number];   // 乐园币
  soulCoin: [number, number];       // 灵魂钱币（魂币）
  giveTitle: boolean;       // 是否给唯一称号
  note: string;
}
export const REWARD_BANDS: Record<Exclude<RewardTier, 'none'>, RewardBand> = {
  champion: { label: '竞技首位', grades: '暗金 / 起源 / 永恒', itemCount: [2, 3], paradiseCoin: [80000, 200000], soulCoin: [3, 8], giveTitle: true, note: '冠绝当前阶位，奖励最为丰厚，附唯一称号（如「竞技天王」）与硬通货灵魂结晶。' },
  top10:    { label: '前十名',   grades: '淡金 / 紫色',       itemCount: [1, 2], paradiseCoin: [30000, 80000],  soulCoin: [1, 3], giveTitle: false, note: '优质宝箱 / 高阶装备 / 稀有材料。' },
  top50:    { label: '前五十',   grades: '紫色 / 蓝色',       itemCount: [1, 2], paradiseCoin: [12000, 30000],  soulCoin: [0, 1], giveTitle: false, note: '资格类奖励 + 稀有材料。' },
  top100:   { label: '前百名',   grades: '蓝色 / 绿色',       itemCount: [1, 1], paradiseCoin: [4000, 12000],   soulCoin: [0, 0], giveTitle: false, note: '宝箱 / 材料 / 乐园币。' },
};

/* 连胜加成系数（≥3连胜起额外资源）。 */
export function streakBonusMul(streak: number): number {
  if (streak >= 7) return 1.6;
  if (streak >= 5) return 1.4;
  if (streak >= 3) return 1.2;
  return 1;
}

export function pickInt([a, b]: [number, number]): number { return a + Math.floor(Math.random() * (b - a + 1)); }
