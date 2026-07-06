import type { PlayerAttrs } from '../store/playerStore';
import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus } from '../store/adventureTeamStore';
import { effectiveAttrs, withAttrDelta, unmetRequirements } from './attrBonus';
import { nominalTierNum } from './bioStrength';

/* 主角「有效六维」实时读取（与主角侧栏/战斗/骰子同口径）：
   基础六维 + 技能树 + 团队效果 + 已装备物品 + 技能/天赋 的六维加成。
   供「装备需求门槛校验」等处随时取最新值（读 getState，非响应式）。 */
export function getPlayerEffectiveAttrs(): PlayerAttrs {
  const profile = usePlayer.getState().profile;
  const b1 = useCharacters.getState().characters['B1'];
  const equipped = useItems.getState().items.filter((it) => it.equipped);
  // 基础六维 + 技能树 + 团队 + **真实属性点直加(realAttrs)**（与 combatEngine.buildCombatant / PlayerSidebar 同口径；
  // 漏掉 realAttrs 会导致"识别不到真实属性"——四阶起真实属性点直加不计入需求校验）
  const base = withAttrDelta(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), profile.realAttrs);
  return effectiveAttrs(base, b1?.skills ?? [], b1?.traits ?? [], equipped);
}

/* 主角是否已进入「真实属性阶段」（四阶起）。真实属性玩家自动满足普通尺度装备需求。 */
export function isPlayerRealTier(): boolean {
  const p = usePlayer.getState().profile;
  return nominalTierNum(p.tier, p.level) >= 4;
}

/* 主角对某装备需求文本的未达标项（空数组＝可穿戴）。封装「有效六维 + 真实属性阶段」两个上下文，供装备面板/指令解析统一调用。 */
export function playerUnmetRequirements(reqText: string | undefined) {
  return unmetRequirements(reqText, getPlayerEffectiveAttrs(), isPlayerRealTier());
}
