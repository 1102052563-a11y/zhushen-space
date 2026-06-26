// 助战物化：把一张「助战卡」（其他玩家上传的主角面板）变成本玩家世界里的一名在场临时队友 NPC。
// 唯一独特逻辑（其余全复用现成 store/范式）。纯函数直接操作 store，App.tsx 无需改业务逻辑。
//   · 强制在场 = keepForever:true（reconcileScenePresence/pruneGhostNpcs 已天然豁免长期保留角色）。
//   · 临时队伍生命周期 = partyMember/partyWorld（离开世界随 disbandPartyForWorld 软解散，同借用队友）。
//   · 战力 = 直接采用卡里的「有效六维 + maxHp/maxEp」；装备入背包但不 equipped，避免与有效六维重复叠加。
import { useNpc, type NpcOwnedItem, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useMisc } from '../store/miscStore';
import { bumpAutoSave } from './saveManager';
import type { AssistCard, AssistSnapshot } from './assistProtocol';

function coerceGender(g?: string): '男' | '女' | '' {
  return g === '男' || g === '女' ? g : '';
}

// 卡里的装备/物品 → NPC 持有物。装备一律 equipped:false（展示用，不进有效六维二次叠加）。
function toOwnedItem(raw: any, cid: string, idx: number, isEquip: boolean): NpcOwnedItem {
  return {
    id: `I_${cid}_${idx}`,
    name: String(raw?.name || '未知物品'),
    category: String(raw?.category || raw?.slot || (isEquip ? '装备' : '杂物')),
    gradeDesc: String(raw?.gradeDesc || ''),
    effect: String(raw?.effect || ''),
    quantity: Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.qty ?? 1)) || 1),
    equipped: false,
    equipSlot: raw?.equipSlot || raw?.slot || undefined,
    combatStat: raw?.combatStat || undefined,
    appearance: raw?.appearance || undefined,
    notes: isEquip ? '（助战角色随身装备）' : undefined,
    addedAt: Date.now(),
  };
}

/** 把一张助战卡物化成本地在场队友 NPC，返回新建/已存在的 NPC id（失败返回空串）。
 *  会调用 assistClient.invite 让排行榜 +1（由调用方负责，避免本模块依赖 client→store 环）。 */
export function materializeAssist(card: AssistCard): string {
  const snap = card?.snapshot;
  if (!snap || !snap.name) return '';
  const npc = useNpc.getState();
  const world = (useMisc.getState() as any).worldName || '';

  // 去重：同一张卡已在本世界 → 只确保在场，不重复建档
  const exist = Object.values(npc.npcs).find((r) => r.assistCardId === card.id);
  if (exist) {
    if (!exist.onScene) npc.setScene(exist.id, true);
    npc.upsertNpc(exist.id, { keepForever: true, partyMember: true, partyWorld: world });
    void bumpAutoSave();   // 回合外改动→刷新自动档，防"刷新→继续读自动档"丢失
    return exist.id;
  }

  // 1) 建临时队友骨架（拿到 C-id，自带 partyMember/onScene/realm=阶位|助战·分类）
  const cid = npc.createPartyMember({
    name: snap.name,
    tier: snap.tier || '',
    job: snap.profession || '',
    persona: snap.personality || '',
    role: `助战·${card.category}`,
    world,
  });

  // 2) 灌入完整面板（有效六维 + HP/EP 上限 + 外观 + 立绘 + 助战标记 + 强制在场）
  const a: any = snap.attrs || {};
  const background = [
    snap.race ? `种族：${snap.race}` : '',
    snap.raceDetail || '',
    snap.personalityDetail || '',
  ].filter(Boolean).join('\n');
  const patch: Partial<NpcRecord> = {
    gender: coerceGender(snap.gender),
    appearanceDetail: snap.appearance || '',
    background,
    attrs: {
      str: Number(a.str) || 5, agi: Number(a.agi) || 5, con: Number(a.con) || 5,
      int: Number(a.int) || 5, cha: Number(a.cha) || 5, luck: Number(a.luck) || 5,
    },
    hp: snap.maxHp, maxHp: snap.maxHp,
    mp: snap.maxEp, maxMp: snap.maxEp,
    avatar: snap.avatar || undefined,
    npcTag: '契约者',
    keepForever: true,                 // 强制在场：reconcileScenePresence/pruneGhostNpcs 都会跳过长期保留角色
    assistOwnerId: card.ownerId,
    assistCardId: card.id,
    review: `由契约者${card.ownerDu ? '#' + card.ownerDu : ''} ${card.ownerName} 上传的助战角色`,
  };

  // 3) 物品：装备 + 储存空间（装备不 equipped）
  const items: NpcOwnedItem[] = [];
  (snap.equipment || []).forEach((e: any, i: number) => items.push(toOwnedItem(e, cid, i, true)));
  (snap.items || []).forEach((it: any, i: number) => items.push(toOwnedItem(it, cid, 100 + i, false)));
  if (items.length) patch.items = items;

  npc.upsertNpc(cid, patch);

  // 4) 技能/天赋写进 characterStore（同 App.tsx MP_ 注入法；新角色直接整体写入）
  try {
    useCharacters.setState((s) => ({
      characters: { ...s.characters, [cid]: { id: cid, skills: (snap.skills || []) as any, traits: (snap.traits || []) as any } },
    }));
  } catch { /* 技能写入失败不阻断物化 */ }

  void bumpAutoSave();   // 回合外改动→刷新自动档，防"刷新→继续读自动档"丢失（助战NPC刷新就不见的根因）
  return cid;
}

/** 遣散一名助战 NPC：硬删除（连带清掉 characterStore 里的技能/天赋孤儿数据）。 */
export function dismissAssist(npcId: string): void {
  try { useNpc.getState().hardRemoveNpc(npcId); } catch { /* */ }
  void bumpAutoSave();   // 遣散也刷新自动档，否则刷新读旧自动档会让已遣散的又回来
}

/** 当前世界里所有「被邀请的助战 NPC」（供面板「我的助战」列出 + 遣散）。 */
export function listActiveAssists(): NpcRecord[] {
  return Object.values(useNpc.getState().npcs).filter((r) => !!r.assistOwnerId);
}

/** 把本玩家的一名 NPC 序列化成助战卡快照（NPC 助战上传用；materializeAssist 的逆操作）。
 *  avatar 为原始串（dataURL/http），由 assistClient 上传前压缩。失败返回 null。 */
export function npcToSnapshotRaw(npcId: string): AssistSnapshot | null {
  const r = useNpc.getState().npcs[npcId];
  if (!r || !r.name) return null;
  const cd = useCharacters.getState().characters[npcId];
  const a: any = r.attrs || {};
  const hasAttrs = a && typeof a === 'object' && Object.keys(a).length > 0;
  const tier = (r.realm || '').split('|')[0] || '';
  const head = [tier, r.profession].filter(Boolean).join('·');
  const stat = hasAttrs ? `力${a.str ?? '?'} 敏${a.agi ?? '?'} 体${a.con ?? '?'} 智${a.int ?? '?'} 魅${a.cha ?? '?'} 幸${a.luck ?? '?'}` : '';
  const equipment = (r.items || []).filter((it) => it.equipped).map((it) => ({ name: it.name, slot: it.equipSlot || it.category, gradeDesc: it.gradeDesc, effect: it.effect, combatStat: it.combatStat }));
  const items = (r.items || []).filter((it) => !it.equipped).map((it) => ({ name: it.name, category: it.category, gradeDesc: it.gradeDesc, effect: it.effect, quantity: it.quantity }));
  return {
    name: r.name,
    tier,
    profession: r.profession || '',
    gender: r.gender || '',
    personality: r.personality || '',
    personalityDetail: r.innerThought || '',
    appearance: r.appearanceDetail || r.appearance5 || '',
    attrs: hasAttrs ? a : undefined,
    maxHp: r.maxHp,
    maxEp: r.maxMp,
    line: [head, stat].filter(Boolean).join(' '),
    skills: cd?.skills || [],
    traits: cd?.traits || [],
    equipment,
    items,
    avatar: r.avatar || '',
  };
}
