/* ════════════════════════════════════════════
   战斗遥测（P5·平衡工程）—— 本地环形记录最近 50 场真实对局的骨架数据
   （回合数/胜负/双方阶位/缘由），喂未来的 DMG_SCALE/DEF_FACTOR 调参：
   平衡回归测试守「标准对局」，这里守「玩家实际打出来的分布」。
   存 localStorage `drpg-combat-telemetry`（元数据：不进 saveManager 快照，
   彻底重置清 drpg-* 时一并清掉即可）。展示：CombatManager「近期战斗」小节。
════════════════════════════════════════════ */

const KEY = 'drpg-combat-telemetry';
const CAP = 50;

export interface CombatTelemetryEntry {
  at: number;          // 结束时间戳
  rounds: number;      // 总回合数
  victor: string;      // player / enemy / none(中止)
  playerTier: string;  // 主角阶位
  enemyTier: string;   // 敌方阶位（多敌用 / 连接）
  reason?: string;     // 开战缘由（context.reason）
}

export function recordCombatTelemetry(e: CombatTelemetryEntry): void {
  try {
    const arr = readCombatTelemetry();
    arr.push(e);
    while (arr.length > CAP) arr.shift();
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch { /* 私隐模式等存储失败静默 */ }
}

export function readCombatTelemetry(): CombatTelemetryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.rounds === 'number') : [];
  } catch { return []; }
}

/** 汇总视图：场数/胜率/平均回合（CombatManager 顶部一行）。 */
export function telemetrySummary(list: CombatTelemetryEntry[]): { n: number; winRate: number; avgRounds: number } {
  const n = list.length;
  if (n === 0) return { n: 0, winRate: 0, avgRounds: 0 };
  const wins = list.filter((x) => x.victor === 'player').length;
  const avg = list.reduce((s, x) => s + x.rounds, 0) / n;
  return { n, winRate: Math.round((wins / n) * 100), avgRounds: Math.round(avg * 10) / 10 };
}
