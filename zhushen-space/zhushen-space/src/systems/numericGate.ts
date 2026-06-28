/* 字段级数据校验 / typed gate（数据库引入③）——给战斗/交易一个"保证合法"的数值地基。
 *
 * 痛点：AI 可能把数值字段写成非数字（"str.B1 = 很强"）、负数、带小数、字符串 → derivedStats 的 ATK/DEF 变 NaN、
 * 交易数量变垃圾。drift-guard 只守"改了的已确立字段"，盖不住首次生成的垃圾值 / HP·EP / 数量。
 * 这里把六维 / 数量 / 强化等级**当场夹成合法非负整数**（非数字→从串里挖数字，再不行→兜底）。纯函数，便于测试。
 */

const SIX = ['str', 'agi', 'con', 'int', 'cha', 'luck'] as const;

/** 把任意值强转成「合法整数」：非有限数→从串里挖第一个数字，再不行→fallback；最后夹进 [min,max] 并取整。 */
export function toLegalInt(v: any, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  let n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);   // 从 "很强(99)" / "约80点" 里挖数字
    n = m ? Number(m[0]) : fallback;
  }
  if (!Number.isFinite(n)) n = fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 把六维里"非法"(非有限数 / 负 / 带小数 / 字符串)的夹成合法非负整数；只动存在且确实非法的维，返回改了哪几维。 */
export function sanitizeSixAttrs(attrs: any): { attrs: any; fixed: string[] } {
  if (!attrs || typeof attrs !== 'object') return { attrs, fixed: [] };
  const out: any = { ...attrs };
  const fixed: string[] = [];
  for (const k of SIX) {
    if (out[k] === undefined || out[k] === null) continue;
    const good = toLegalInt(out[k], 0, 0);
    if (good !== out[k]) { out[k] = good; fixed.push(k); }
  }
  return { attrs: out, fixed };
}

/** 校验一件物品的数值字段（数量、强化等级）；返回需要写回的补丁（空=合法、无需动）。 */
export function sanitizeItemNumbers(it: any): Record<string, any> | null {
  if (!it || typeof it !== 'object') return null;
  const patch: Record<string, any> = {};
  if (it.quantity !== undefined && it.quantity !== null) {
    const q = toLegalInt(it.quantity, 1, 0);
    if (q !== it.quantity) patch.quantity = q;
  }
  if (it.enhanceLevel !== undefined && it.enhanceLevel !== null) {
    const maxE = Number.isFinite(Number(it.maxEnhanceLevel)) ? Number(it.maxEnhanceLevel) : 16;
    const e = toLegalInt(it.enhanceLevel, 0, 0, Math.max(0, maxE));
    if (e !== it.enhanceLevel) patch.enhanceLevel = e;
  }
  return Object.keys(patch).length ? patch : null;
}
