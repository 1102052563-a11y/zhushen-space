import type { Player } from '../types';

// 伤害公式：基础伤害 = max(1, 攻击 - 防御)，附带 ±15% 随机浮动。
export function rollDamage(atk: number, def: number): number {
  const base = Math.max(1, atk - def);
  const variance = 0.85 + Math.random() * 0.3;
  return Math.max(1, Math.round(base * variance));
}

// 战力评估，仅用于在副本列表展示「推荐战力」对比。
export function power(p: Pick<Player, 'atk' | 'def' | 'maxHp' | 'maxSan'>): number {
  return Math.round(p.atk * 3 + p.def * 4 + p.maxHp * 0.5 + p.maxSan * 0.2);
}
