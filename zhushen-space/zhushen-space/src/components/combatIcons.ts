/* 战斗图标：game-icons.net（经 react-icons/gi 引入·CC BY 3.0·GitHub: react-icons/react-icons）
   动作/标签/状态名 → 单色 SVG 图标；继承 currentColor，自动随青光主题着色。
   找不到映射的概念由调用方回退到原 emoji。tree-shaking 只打包用到的图标。 */
import type { IconType } from 'react-icons';
import {
  GiBroadsword, GiScrollUnfurled, GiSwapBag, GiShield, GiShieldReflect, GiRun,
  GiSwordWound, GiHealing, GiMagicSwirl, GiBiceps, GiRunningShoe, GiCrackedShield,
  GiBrokenBone, GiPoisonBottle, GiFlame, GiStunGrenade, GiDeathSkull, GiBleedingWound,
  GiBackstab, GiVortex,
} from 'react-icons/gi';

const MAP: Record<string, IconType> = {
  // ── 动作 ──
  attack: GiBroadsword, 普攻: GiBroadsword,
  skill: GiScrollUnfurled, 技能: GiScrollUnfurled, 武功: GiScrollUnfurled,
  item: GiSwapBag, 道具: GiSwapBag, 物品: GiSwapBag,
  defend: GiShield, 防御: GiShield,
  protect: GiShieldReflect, 保护: GiShieldReflect,
  flee: GiRun, 逃跑: GiRun,
  // ── 标签 / 状态名 ──
  deal: GiSwordWound,
  block: GiShield, 护盾: GiShield, 格挡: GiShield, 守护: GiShield,
  heal: GiHealing, 治疗: GiHealing, 再生: GiHealing,
  restore: GiMagicSwirl, 回能: GiMagicSwirl, 聚能: GiMagicSwirl, 蓄力: GiMagicSwirl, charge: GiMagicSwirl,
  strength: GiBiceps, 力量: GiBiceps, 战意: GiBiceps,
  dexterity: GiRunningShoe, 敏捷: GiRunningShoe,
  vulnerable: GiCrackedShield, 易伤: GiCrackedShield, 碎甲: GiCrackedShield, 破甲: GiCrackedShield, sunder: GiCrackedShield,
  weak: GiBrokenBone, 虚弱: GiBrokenBone,
  poison: GiPoisonBottle, 中毒: GiPoisonBottle,
  burn: GiFlame, 燃烧: GiFlame, 灼烧: GiFlame,
  stun: GiStunGrenade, 眩晕: GiStunGrenade,
  execute: GiDeathSkull, 斩杀: GiDeathSkull, 不死: GiDeathSkull,
  lifesteal: GiBleedingWound, 吸血: GiBleedingWound, 流血: GiBleedingWound,
  pierce: GiBackstab, 穿透: GiBackstab,
  domain: GiVortex, 领域: GiVortex,
};

/** 取某概念(动作kind/标签tag/状态中文名)的战斗图标组件；无映射返回 undefined（调用方回退 emoji）。 */
export function combatIconFor(key?: string): IconType | undefined {
  return key ? MAP[key] : undefined;
}
