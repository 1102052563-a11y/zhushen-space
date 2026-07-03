import type { PlayerAttrs } from '../store/playerStore';
import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus } from '../store/adventureTeamStore';
import { effectiveAttrs, withAttrDelta } from './attrBonus';

/* 主角「有效六维」实时读取（与主角侧栏/战斗/骰子同口径）：
   基础六维 + 技能树 + 团队效果 + 已装备物品 + 技能/天赋 的六维加成。
   供「装备需求门槛校验」等处随时取最新值（读 getState，非响应式）。 */
export function getPlayerEffectiveAttrs(): PlayerAttrs {
  const profile = usePlayer.getState().profile;
  const b1 = useCharacters.getState().characters['B1'];
  const equipped = useItems.getState().items.filter((it) => it.equipped);
  const base = withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus());
  return effectiveAttrs(base, b1?.skills ?? [], b1?.traits ?? [], equipped);
}
