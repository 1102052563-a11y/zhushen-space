/* ════════════════════════════════════════════════════════════════════════════
   树·潜能点「共享池」登记处（无任何 store/组件依赖 → 杜绝循环引用）
   职能：技能树 与 副职业树 共用同一份潜能点（等级×4+4 的确定性预算）。
   每个 tree store 在加载时把自己的 spent/aiBonusPP 贡献者注册进来；
   引擎 availablePP(ctx.charId 存在时) 读 allTreePool() 汇总，得到「两树合计已花/合计额外」，
   于是任一棵树点一个点，另一棵的可用潜能同步减少——真正共享一池。
   ──────────────────────────────────────────────────────────────────────────── */

export interface TreePoolContribution { spent: number; bonus: number }
type Contributor = (charId: string) => TreePoolContribution;

const contributors = new Set<Contributor>();

/** 各 tree store 启动时调用，登记「该 store 对某角色已花/额外潜能点」的读取器。重复登记同一函数无副作用。 */
export function registerTreePool(fn: Contributor): void { contributors.add(fn); }

/** 汇总所有已登记 store 对某角色的 已花潜能点 / 额外潜能点（兑换·任务奖励）总和。 */
export function allTreePool(charId: string): TreePoolContribution {
  let spent = 0, bonus = 0;
  for (const f of contributors) {
    try { const r = f(charId); spent += r.spent || 0; bonus += r.bonus || 0; } catch { /* 单个 store 读取失败不影响其它 */ }
  }
  return { spent, bonus };
}
