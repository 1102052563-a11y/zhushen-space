import type { PlayerAttrs } from '../store/playerStore';
import { TIERS, ATTR_CAP_BY_TIER, normalizeTier, realmFromLevel } from './derivedStats';
import { effectiveAttrs } from './attrBonus';

/* ── 生物强度·纯机械判定（取代 AI 主观判档）────────────────────────────────────
   把角色六维按「轮回乐园·生物强度生成框架(T0~T9 属性预算)」反向换算成生物强度档：
   - 资质档(innate)：用「基础六维 + 名义阶位」算 —— 稳定，不含装备/技能/天赋加成、不越阶，反映先天底子。
   - 战力档(power) ：用「有效六维(含装备/技能/天赋加成) + 等效阶位反查」算 —— 随装备/技能穿脱浮动，
     反映当前真实战力，可越阶（一阶穿神装 → 判到更高档）。

   口径：5 项基础属性(力/敏/体/智/魅；**幸运不计入**)在本阶 [下限,上限] 区间内的「预算占用率」ratio
   → 套生物强度框架模板的 Flex% 边界得档位 → 再用本阶窗口钳制。
   基准用前端 ATTR_CAP_BY_TIER(= 基础六维硬上限，同源)，而非框架原始 Budget——
   后者那套 Range/Budget 数值与前端上限系统性错位、直接套会爆表判顶档，故弃用。
   ──────────────────────────────────────────────────────────────────────────── */

// 档位中文名（数组下标 = 档位数字 T0..T9）
export const BIO_TIER_NAMES = ['杂鱼', '兵卒', '精英', '勇士', '英雄', '领主', '王者', '半神', '真神', '源初'] as const;

export interface BioTier {
  code: string;    // 'T0'..'T9'
  num: number;     // 0..9
  name: string;    // 中文档名
  label: string;   // 'T3·勇士'
  ratio: number;   // 本阶预算占用率（调试/展示用，可能 <0 或 >1）
  tierNum: number; // 判定所用阶位序号（资质=名义阶位，战力=等效阶位），1..13
}

// 阶位序号(1=一阶 … 9=九阶 … 13=无上之境) → 该阶「单个基础属性」的 [下限,上限]
// 上限取 ATTR_CAP_BY_TIER；下限 = 上一阶上限 + 1（一阶特例下限 5）
function tierBounds(tierNum: number): [number, number] {
  const i = Math.max(1, Math.min(TIERS.length, Math.round(tierNum))) - 1;
  const cap = ATTR_CAP_BY_TIER[TIERS[i]] ?? Infinity;
  const min = i === 0 ? 5 : (ATTR_CAP_BY_TIER[TIERS[i - 1]] ?? 5) + 1;
  return [min, cap];
}

// 预算占用率 → 生物强度框架模板档(0..6)。边界取自框架 T0~T6 的 Flex% 区间。
function templateFromRatio(r: number): number {
  if (r <= 0.20) return 0; // T0 杂鱼
  if (r <= 0.35) return 1; // T1 兵卒
  if (r <= 0.55) return 2; // T2 精英
  if (r <= 0.75) return 3; // T3 勇士
  if (r <= 0.92) return 4; // T4 英雄
  if (r <= 1.00) return 5; // T5 领主
  return 6;                // T6 王者（> 满配，靠外源加成）
}

// 5 项基础属性之和 + 阶位序号 → 档位数字(0..9，已按本阶窗口钳制) + 占用率
function codeFromSum5(sum5: number, tierNum: number): { num: number; ratio: number } {
  const [min, cap] = tierBounds(tierNum);
  const denom = (cap - min) * 5;
  const ratio = denom > 0 && isFinite(denom) ? (sum5 - min * 5) / denom : 0;
  let num = templateFromRatio(ratio);
  // 本阶窗口：可出现的档位区间 [tierNum-1, min(9, tierNum+2)]（框架阶位窗口规律；高阶封顶 T9）
  const lo = Math.min(9, Math.max(0, tierNum - 1));
  const hi = Math.min(9, tierNum + 2);
  num = Math.max(lo, Math.min(hi, num));
  return { num, ratio };
}

// 5 项基础属性之和（幸运不计入）
function sum5Of(a: PlayerAttrs): number {
  return (a.str || 0) + (a.agi || 0) + (a.con || 0) + (a.int || 0) + (a.cha || 0);
}

function mk(num: number, ratio: number, tierNum: number): BioTier {
  const n = Math.max(0, Math.min(9, num));
  return { code: `T${n}`, num: n, name: BIO_TIER_NAMES[n], label: `T${n}·${BIO_TIER_NAMES[n]}`, ratio, tierNum };
}

// 名义阶位字符串/等级 → 阶位序号(1..13)，取「显式阶位」与「按等级推导」较高者（与 attrCapForTier 同源）
function nominalTierNum(tier?: string, level?: number): number {
  const it = TIERS.indexOf(normalizeTier(tier) as typeof TIERS[number]);
  const il = TIERS.indexOf(realmFromLevel(Math.max(1, level || 1)) as typeof TIERS[number]);
  const idx = Math.max(it, il);
  return idx < 0 ? 1 : idx + 1;
}

// 有效属性均值 → 等效阶位序号(1..13)：均值够得上哪个阶位的下限门槛，就算等效到那一阶（实现越阶战力）
function effectiveTierNum(effAvg: number): number {
  for (let t = TIERS.length; t >= 1; t--) {
    const [min] = tierBounds(t);
    if (effAvg >= min) return t;
  }
  return 1;
}

/* 资质档：基础六维 + 名义阶位（稳定、不含加成、不越阶） */
export function bioInnate(base?: PlayerAttrs, tier?: string, level?: number): BioTier | null {
  if (!base) return null;
  const tn = nominalTierNum(tier, level);
  const { num, ratio } = codeFromSum5(sum5Of(base), tn);
  return mk(num, ratio, tn);
}

/* 战力档：有效六维(含装备/技能/天赋加成) + 等效阶位反查（浮动、可越阶） */
export function bioPower(eff?: PlayerAttrs): BioTier | null {
  if (!eff) return null;
  const s = sum5Of(eff);
  const tn = effectiveTierNum(s / 5);
  const { num, ratio } = codeFromSum5(s, tn);
  return mk(num, ratio, tn);
}

type AbilityLite = { attrBonus?: string; effect?: string };
type EquipLite = { effect?: string; affix?: string; attrBonus?: string };

/* 便捷组合：从角色原始数据一次算出 资质档 + 战力档（内部自动聚合有效六维）。
   equipped 传「已佩戴」的装备列表（与 effectiveAttrs 约定一致，调用方自行过滤 equipped）。 */
export function bioStrengthOf(args: {
  base?: PlayerAttrs; tier?: string; level?: number;
  skills?: AbilityLite[]; talents?: AbilityLite[]; equipped?: EquipLite[];
}): { innate: BioTier | null; power: BioTier | null } {
  const { base, tier, level, skills = [], talents = [], equipped = [] } = args;
  const eff = base ? effectiveAttrs(base, skills, talents, equipped) : undefined;
  return { innate: bioInnate(base, tier, level), power: bioPower(eff) };
}

/* 资质档 + 战力档 合成一行展示文本：两档相同时只显一个，不同时显「资质X / 战力Y」 */
export function bioStrengthLabel(innate: BioTier | null, power: BioTier | null): string {
  if (!innate && !power) return '';
  if (!power) return innate!.label;
  if (!innate) return power!.label;
  if (innate.label === power.label) return innate.label;
  return `资质${innate.label} / 战力${power.label}`;
}
