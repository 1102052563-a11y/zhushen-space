/**
 * 从「物品 / NPC」对象构造全息卡检视弹层(HoloInspector)的 props。
 * 供全局 HoloViewer（holoViewerStore.showItem/showNpc）与各面板缩略图点击复用。
 */
import { parseAttrBonus, ATTR_KEYS, ATTR_LABEL } from './attrBonus';
import { splitAffixEntries, asText } from '../store/itemStore';
import { normalizeTier } from './derivedStats';

export interface HoloViewProps {
  img?: string;
  name?: string;
  badge?: string;
  grade?: string;
  tier?: string;
  rows?: { label: string; value: string }[];
  power?: { label?: string; value: string };
}

/** 物品 → 全息卡 props：品级出箔纸色，六维加成(parseAttrBonus)入底部面板，无加成则空(面板自动隐藏)。 */
export function holoItemProps(item: any): HoloViewProps {
  const affixText = splitAffixEntries(item?.affix).join(' ');
  const d = parseAttrBonus([asText(item?.effect), affixText].filter(Boolean).join(' '));
  const rows = ATTR_KEYS.filter((k) => d[k]).map((k) => ({ label: ATTR_LABEL[k], value: (d[k]! > 0 ? '+' : '') + d[k] }));
  const scoreNum = (String(item?.score ?? '').match(/\d+/) || [])[0];
  const power = scoreNum ? { label: '评分', value: scoreNum } : undefined;
  return { img: item?.image, name: item?.name, grade: item?.gradeDesc, badge: item?.gradeDesc || undefined, rows, power };
}

/** NPC → 全息卡 props：阶位出箔纸色，六维入面板，生物强度入顶部徽标。 */
export function holoNpcProps(npc: any): HoloViewProps {
  const rows = npc?.attrs ? ATTR_KEYS.map((k) => ({ label: ATTR_LABEL[k], value: String(npc.attrs[k] ?? '—') })) : [];
  const power = npc?.bioStrength ? { label: '强度', value: String(npc.bioStrength) } : undefined;
  const tierName = normalizeTier(npc?.realm) || undefined;
  return { img: npc?.avatar, name: npc?.name, tier: npc?.realm, badge: tierName, rows, power };
}
