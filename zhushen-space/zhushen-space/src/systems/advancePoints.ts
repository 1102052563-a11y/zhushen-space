/* ── 进阶点数·击杀结算（纯机械判定，取代 AI 自由给点）──────────────────────────
   病根：让正文/演化 AI 自由决定"击杀给多少进阶点"，跨回合无锚 → 1 点和 1000 点乱跳。
   方案：AI 只在正文末尾输出 <kill> 清单（谁杀了谁/对方阶位等级/数量），点数由本表机械算。

   核心锚点 L_p = 主角【当前阶位】升一级所需进阶点数（见 LEVEL_COST_BY_TIER）。
   奖励全部锚在 L_p 上 → 一阶玩家给几千、九阶玩家给几十亿，但"杀同阶约 20 只升一级"的
   手感在全阶位恒定，这就是自动规范化的来源。

   规则（用户拍板版）：
   - 同阶或更高：保底 = L_p × 1/20，再乘加权（阶位差/等级差/生物强度差）；**不数量递减**。
   - 低于自己阶位：固定 = L_p × 1/50 × 0.5^|阶差|（越碾压越趋零）；**数量递减**（防屠村刷点）。
   - 仅"确实死亡"且击杀者为主角（或受控方）才计入主角进阶点。
   ────────────────────────────────────────────────────────────────────────────── */
import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';

/* 升级消耗表：主角【每级】所需进阶点数，key = 阶位名。
   九阶以上世界书未给硬数值，按递进外推（可调）。 */
export const LEVEL_COST_BY_TIER: Record<string, number> = {
  一阶: 1e4, 二阶: 5e4, 三阶: 2e5, 四阶: 1e6, 五阶: 5e6,
  六阶: 5e7, 七阶: 5e8, 八阶: 5e9, 九阶: 1e11,
  绝强: 2e12, 至强: 4e13, 巅峰至强: 8e14, 无上之境: 1.6e16,
};

/* balance 旋钮集中在此，方便后续调参（改即生效）。 */
export const AP_TUNING = {
  floorFrac: 1 / 20,    // 同阶及以上：保底 = L_p × floorFrac
  lowTierFrac: 1 / 50,  // 低阶：基础 = L_p × lowTierFrac
  lowTierDecay: 0.5,    // 低阶每低一阶 ×0.5（越碾压越趋零）
  tierBase: 2,          // 阶位差：每越一阶 ×tierBase
  lvSlope: 0.05,        // 等级差：敌每高一级 +5%
  lvCap: 9,             // 等级差封顶 9 级（跨阶部分交给 tierMul，避免重复计数）
  bioSlope: 0.25,       // 生物强度：敌「等效阶位超出名义阶位」每档 +25%（扮猪吃虎溢价）
  bioCap: 4,            // 生物强度溢价封顶 4 档（×2）
  countDecayR: 0.9,     // 低阶数量递减比率：Σ r^k，封顶 1/(1-r)=10
};

export interface KillRecord {
  killer: string;      // 击杀者（用于判定是否计入主角）
  victim: string;      // 被击杀者名
  tier: string;        // 名义阶位（已规范化，可能为空）
  level?: number;      // 被击杀者等级（可选）
  effTier?: string;    // 等效阶位（可选；AI 标注越阶强者/扮猪吃虎时给）
  qty: number;         // 数量
  role?: string;       // 类型（杂兵/精英/首领，仅展示，不单独计权）
}

export interface KillRewardLine {
  victim: string;
  qty: number;
  gapLabel: string;    // 同阶 / 越阶+2 / 碾压-3（含类型后缀）
  points: number;      // 本行计入主角的点数（非主角击杀=0）
  credited: boolean;   // 击杀者是否为主角/受控方
}

export interface KillSettlement {
  lines: KillRewardLine[];
  total: number;       // 计入主角的总点数（整数）
}

export interface PlayerCtx {
  tier: string;        // 主角有效阶位
  level: number;       // 主角等级
  name?: string;       // 主角名（用于击杀者归属判断）
}

/* 阶位序号（一阶=0 … 九阶=8 … 无上之境=12）；取不到返回 -1。 */
function tierIdx(tier?: string): number {
  return TIERS.indexOf(normalizeTier(tier) as typeof TIERS[number]);
}

/* 主角有效阶位序号 = max(显式阶位, 等级推导)。profile.tier 早期常滞留"一阶"，
   需用等级兜底，否则锚点 L_p 会偏低、给点过少。 */
function playerTierIdx(tier: string | undefined, level: number): number {
  return Math.max(tierIdx(tier), tierIdx(realmFromLevel(Math.max(1, level || 1))), 0);
}

/* 低阶数量递减：Σ r^k (k=0..n-1)，自然封顶 1/(1-r)。 */
function decayCount(n: number, r: number): number {
  const k = Math.max(1, Math.round(n || 1));
  return (1 - Math.pow(r, k)) / (1 - r);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/* 击杀者是否为主角/受控方。缺省（未写击杀者）保守视为主角。 */
function isPlayerKiller(killer: string, playerName?: string): boolean {
  const k = (killer || '').trim();
  if (!k) return true;
  if (/主角|玩家|^我$|\bB1\b/.test(k)) return true;
  return !!playerName && playerName.length > 0 && k.includes(playerName);
}

/* 单条击杀 → 点数 + 阶差标签（不含主角归属判断）。 */
export function computeKillReward(rec: KillRecord, ctx: PlayerCtx): { points: number; gapLabel: string } {
  const T = AP_TUNING;
  const pIdx = playerTierIdx(ctx.tier, ctx.level);
  const L_p = LEVEL_COST_BY_TIER[TIERS[pIdx]] ?? LEVEL_COST_BY_TIER['一阶'];

  // 被击杀者名义阶位序号：优先 tier，缺失用 level 推，再缺失视为同阶
  let vIdx = tierIdx(rec.tier);
  if (vIdx < 0 && rec.level) vIdx = tierIdx(realmFromLevel(rec.level));
  if (vIdx < 0) vIdx = pIdx;
  const dTier = vIdx - pIdx;

  if (dTier < 0) {
    // 低阶：固定 × 越碾压越趋零 × 数量递减
    const perKill = L_p * T.lowTierFrac * Math.pow(T.lowTierDecay, -dTier);
    const pts = perKill * decayCount(rec.qty, T.countDecayR);
    return { points: Math.round(pts), gapLabel: `碾压${dTier}` };
  }

  // 同阶或更高：保底 × 加权，数量线性（不递减）
  const tierMul = Math.pow(T.tierBase, dTier);
  const lvMul = rec.level != null
    ? 1 + T.lvSlope * clamp(rec.level - ctx.level, 0, T.lvCap)
    : 1;
  let bioMul = 1;
  if (rec.effTier) {
    const eff = tierIdx(rec.effTier);
    if (eff > vIdx) bioMul = 1 + T.bioSlope * clamp(eff - vIdx, 0, T.bioCap);
  }
  const weightMul = Math.max(1, tierMul * lvMul * bioMul);
  const qty = Math.max(1, Math.round(rec.qty || 1));
  const pts = L_p * T.floorFrac * weightMul * qty;
  return { points: Math.round(pts), gapLabel: dTier === 0 ? '同阶' : `越阶+${dTier}` };
}

const KILL_BLOCK_RE = /<kill>([\s\S]*?)<\/kill>/gi;

/* 解析正文末尾的 <kill> 清单。
   格式（每行一条，容错 = / : / ：）：
     击杀者 = 主角
     被击杀者 = 三阶妖兽 | 阶位=三阶 | 等级=24 | 数量=3 | 类型=杂兵
     被击杀者 = 血煞魔君 | 阶位=五阶 | 等效阶位=六阶 | 类型=首领
   「击杀者」行设定其后各行的默认击杀者；名称里带 ×N 也认。 */
export function parseKillManifest(text: string): KillRecord[] {
  const recs: KillRecord[] = [];
  let m: RegExpExecArray | null;
  KILL_BLOCK_RE.lastIndex = 0;
  while ((m = KILL_BLOCK_RE.exec(text)) !== null) {
    let curKiller = '主角';
    for (const rawLine of m[1].split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const km = /^击杀者\s*[=:：]\s*(.+)$/.exec(line);
      if (km) { curKiller = km[1].trim(); continue; }
      const vm = /^被击杀者\s*[=:：]\s*(.+)$/.exec(line);
      if (!vm) continue;
      const parts = vm[1].split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      const rec: KillRecord = { killer: curKiller, victim: parts[0], tier: '', qty: 1 };
      for (let i = 1; i < parts.length; i++) {
        const kv = /^([^=:：]+)\s*[=:：]\s*(.+)$/.exec(parts[i]);
        if (!kv) continue;
        const key = kv[1].trim();
        const val = kv[2].trim();
        if (/等效/.test(key)) rec.effTier = normalizeTier(val) || val;
        else if (/阶位|阶级|品阶/.test(key)) rec.tier = normalizeTier(val) || val;
        else if (/等级|level|lv/i.test(key)) rec.level = parseInt(val.replace(/\D/g, ''), 10) || undefined;
        else if (/数量|count|qty/i.test(key)) rec.qty = parseInt(val.replace(/\D/g, ''), 10) || 1;
        else if (/类型|role|种类/i.test(key)) rec.role = val;
      }
      // 名称尾部 "×3" / "x3" 也认作数量
      const qm = /[×xX*]\s*(\d+)\s*$/.exec(rec.victim);
      if (qm) { rec.qty = parseInt(qm[1], 10) || rec.qty; rec.victim = rec.victim.replace(/[×xX*]\s*\d+\s*$/, '').trim(); }
      if (rec.victim) recs.push(rec);
    }
  }
  return recs;
}

/* 多条击杀 → 结算（含主角归属过滤）。 */
export function buildKillSettlement(records: KillRecord[], ctx: PlayerCtx): KillSettlement {
  const lines: KillRewardLine[] = [];
  let total = 0;
  for (const rec of records) {
    const credited = isPlayerKiller(rec.killer, ctx.name);
    const { points, gapLabel } = computeKillReward(rec, ctx);
    const pts = credited ? points : 0;
    lines.push({ victim: rec.victim, qty: rec.qty, gapLabel: gapLabel + (rec.role ? `·${rec.role}` : ''), points: pts, credited });
    total += pts;
  }
  return { lines, total };
}

/* 大数显示：≥1亿用「亿」、≥1万用「万」，去掉无意义小数。 */
export function fmtAp(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2).replace(/\.?0+$/, '')}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2).replace(/\.?0+$/, '')}万`;
  return String(v);
}

/* 把结算冻结成显示用文本块（数字已算定，渲染层只格式化、不再重算）。
   首行 = 总计/当前；其余每行 = 名称 | 阶差标签 | +点数。 */
export function freezeSettlementBlock(s: KillSettlement, newTotalAp: number): string {
  const head = `总计 +${fmtAp(s.total)} | 当前 ${fmtAp(newTotalAp)}`;
  const rows = s.lines.map((l) =>
    `${l.victim}${l.qty > 1 ? ` ×${l.qty}` : ''} | ${l.gapLabel}${l.credited ? '' : '·非主角'} | +${fmtAp(l.points)}`
  );
  return `<击杀结算>\n${head}\n${rows.join('\n')}\n</击杀结算>`;
}
