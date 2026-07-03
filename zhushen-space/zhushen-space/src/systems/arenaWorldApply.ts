// 世界竞技场·切磋：把一张对手参赛卡物化成本地一名【敌方】临时 NPC（供真实战斗系统对战），战后清理。
// 与助战 materializeAssist 的区别：这是**敌人**不是队友——npcTag='竞技对手'（复用局部竞技场的清扫兜底）、
// 非 partyMember、非 keepForever、不进自动存档（切磋是一次性的，不该被持久化/续玩带回）。
import { useNpc, type NpcOwnedItem, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useMisc } from '../store/miscStore';
import { normalizeTier, TIERS } from './derivedStats';
import type { AssistSnapshot } from './arenaWorldProtocol';

function coerceGender(g?: string): '男' | '女' | '' {
  return g === '男' || g === '女' ? g : '';
}
// 卡里没带 Lv 时按阶位推一个代表等级（阶位第 n 阶 → Lv (n-1)*10+5），供 lvFromRealm/衍生属性用。
function guessLevel(snap: AssistSnapshot): number {
  const m = /Lv\.?\s*(\d+)/i.exec(snap.realm || '');
  if (m) return Number(m[1]);
  const ti = TIERS.indexOf(normalizeTier(snap.tier) as typeof TIERS[number]);
  return ti >= 0 ? ti * 10 + 5 : 1;
}
// 卡里的装备/物品 → NPC 持有物（装备一律 equipped:false，展示用，不与有效六维二次叠加）。
function toOwnedItem(raw: any, cid: string, idx: number, isEquip: boolean): NpcOwnedItem {
  return {
    id: `AF_${cid}_${idx}`,
    name: String(raw?.name || '未知物品'),
    category: String(raw?.category || raw?.slot || (isEquip ? '装备' : '杂物')),
    gradeDesc: String(raw?.gradeDesc || ''),
    effect: String(raw?.effect || ''),
    quantity: Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.qty ?? 1)) || 1),
    equipped: false,
    equipSlot: raw?.equipSlot || raw?.slot || undefined,
    combatStat: raw?.combatStat || undefined,
    appearance: raw?.appearance || undefined,
    addedAt: Date.now(),
  };
}

/** 物化对手卡成临时敌方 NPC，返回 cid（失败返回空串）。战力=卡里有效六维 + maxHp/maxEp。 */
export function materializeArenaFoe(snap: AssistSnapshot): string {
  if (!snap || !snap.name) return '';
  const npc = useNpc.getState();
  const world = (useMisc.getState() as any).worldName || '';
  // 复用 createPartyMember 拿 C-id 骨架，随后 upsert 覆盖成「敌方·非队友」
  const cid = npc.createPartyMember({ name: snap.name, tier: snap.tier || '', job: snap.profession || '', persona: snap.personality || '', role: '竞技对手', world });

  const a: any = snap.attrs || {};
  const background = [snap.race ? `种族：${snap.race}` : '', snap.raceDetail || '', snap.personalityDetail || ''].filter(Boolean).join('\n');
  const patch: Partial<NpcRecord> = {
    gender: coerceGender(snap.gender),
    appearanceDetail: snap.appearance || '',
    background,
    // 保住等级：createPartyMember 建的 realm 无 Lv → lvFromRealm=1 会拉低衍生属性；用卡里 realm(NPC 卡带 Lv)或按阶位推代表等级
    realm: (snap.realm && /Lv/i.test(snap.realm)) ? snap.realm : `${normalizeTier(snap.tier) || snap.tier || '一阶'}·Lv.${guessLevel(snap)}|竞技对手`,
    attrs: {
      str: Number(a.str) || 5, agi: Number(a.agi) || 5, con: Number(a.con) || 5,
      int: Number(a.int) || 5, cha: Number(a.cha) || 5, luck: Number(a.luck) || 5,
    },
    hp: snap.maxHp, maxHp: snap.maxHp,
    mp: snap.maxEp, maxMp: snap.maxEp,
    avatar: snap.avatar || undefined,
    npcTag: '竞技对手',      // 敌方标记（局部竞技场的 sweep 也会兜底清理）
    partyMember: false,      // 覆盖 createPartyMember：切磋对手不是队友
    keepForever: false,
    partyWorld: '', partyRole: '',
    review: '世界竞技场·切磋对手（不计分）',
  };
  const items: NpcOwnedItem[] = [];
  (snap.equipment || []).forEach((e: any, i: number) => items.push(toOwnedItem(e, cid, i, true)));
  (snap.items || []).forEach((it: any, i: number) => items.push(toOwnedItem(it, cid, 100 + i, false)));
  if (items.length) patch.items = items;
  npc.upsertNpc(cid, patch);

  // 技能/天赋写进 characterStore（同 materializeAssist / MP_ 注入法）——供战斗真实施放
  try {
    useCharacters.setState((s) => ({
      characters: { ...s.characters, [cid]: { id: cid, skills: (snap.skills || []) as any, traits: (snap.traits || []) as any } },
    }));
  } catch { /* 技能写入失败不阻断物化 */ }

  return cid;   // 注意：不 bumpAutoSave（切磋对手是临时的，不进存档）
}

/** 切磋结束/中断清理：硬删除临时对手（连带 characterStore 孤儿）。 */
export function discardArenaFoe(cid: string): void {
  if (!cid) return;
  try { useCharacters.getState().removeCharacter(cid); useNpc.getState().hardRemoveNpc(cid); } catch { /* */ }
}

/** 主角卡的瞬时战斗 override——直接用卡里的**有效六维 + maxHp/EP**（主角快照存的就是有效六维），
 *  经 buildCombatant 瞬时路径只做四阶×5、不再二次套 effectiveAttrs+夹阶（治"战斗不读属性/衍生属性"）。
 *  技能/天赋仍由 characterStore[cid] 供敌方 AI 施放+被动聚合，故对战既忠于卡面数值又能放技能。 */
export function arenaFoeCombatOverride(snap: AssistSnapshot): { name: string; tier: string; level: number; maxHp?: number; maxEp?: number; bioStrength: string; attrs: Record<string, number> } {
  const a: any = snap.attrs || {};
  return {
    name: snap.name,
    tier: snap.tier || '',
    level: guessLevel(snap),
    maxHp: typeof snap.maxHp === 'number' ? snap.maxHp : undefined,
    maxEp: typeof snap.maxEp === 'number' ? snap.maxEp : undefined,
    bioStrength: snap.bioStrength || '',
    attrs: {
      str: Number(a.str) || 5, agi: Number(a.agi) || 5, con: Number(a.con) || 5,
      int: Number(a.int) || 5, cha: Number(a.cha) || 5, luck: Number(a.luck) || 5,
    },
  };
}
