import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';
import { useCharacters } from './characterStore';
import { attrCapForTier, lvFromRealm } from '../systems/derivedStats';
import { computeAttrBreakdown } from '../systems/attrBonus';

/* 合成工坊·御兽产物 → 宠物建档（createPet）
   旧 bug「不管啥宠物属性点全都是 50」：confirmCraft 按品阶 roll 了一套六维(体质可到 143)，却没把
   阶位/等级传给 createPet → realm='' → lvFromRealm('')=1 → realmFromLevel(1)='一阶'
   → attrCapForTier=50 → computeAttrBreakdown 把 base 与 total 双双夹到 50，每只宠物都变 50/50/50。
   （而 HP 走 npcBaseAttrs 读**未夹**的原始六维 → 面板显示体质 50 却 HP 2860=143×20，自相矛盾。）
   铁则：realm 必须带 ·Lv.N —— 等级藏在 realm 里，缺了就被全链路当一阶。*/

const petAttrs = { str: 148, agi: 132, con: 143, int: 7, cha: 3, luck: 4 };

beforeEach(() => {
  useNpc.setState({ npcs: {} });
  useCharacters.setState({ characters: {} });
});

// 面板/战斗看到的六维：computeAttrBreakdown(六维, 技能, 天赋, 装备, 本阶单属性上限)
const shownAttrs = (id: string) => {
  const npc = useNpc.getState().npcs[id];
  const bk = computeAttrBreakdown(npc.attrs, [], [], [], attrCapForTier(npc.realm, lvFromRealm(npc.realm)));
  return { str: bk.str.total, con: bk.con.total, int: bk.int.total };
};

describe('createPet（御兽产物建档）', () => {
  it('★带阶位+等级建档 → realm 写成「阶位·Lv.N|宠物」，等级取得回来', () => {
    const id = useNpc.getState().createPet({ name: '渊虎', species: '鬼化灵兽', tier: '四阶', level: 35, attrs: petAttrs });
    const npc = useNpc.getState().npcs[id];
    expect(npc.realm).toBe('四阶·Lv.35|宠物');
    expect(lvFromRealm(npc.realm)).toBe(35);
    expect(npc.npcTag).toBe('宠物');
    expect(npc.onScene).toBe(true);     // 收服即在场入队
    expect(npc.partyMember).toBe(true);
  });

  it('★六维不再被一阶上限夹平成 50（本 bug 的回归锁）', () => {
    const id = useNpc.getState().createPet({ name: '渊虎', species: '鬼化灵兽', tier: '四阶', level: 35, attrs: petAttrs });
    expect(attrCapForTier(useNpc.getState().npcs[id].realm, 35)).toBe(150);   // 四阶单属性极值，不再是一阶的 50
    const a = shownAttrs(id);
    expect(a.str).toBe(148);   // 原样显示，不被夹
    expect(a.con).toBe(143);   // HP(143×20=2860) 与面板体质此后一致，不再自相矛盾
    expect(a.int).toBe(7);     // 本就低于上限的维不受影响
  });

  it('★阶位不同 → 上限不同（品级/阶位真的会影响到六维，而非每只都 50）', () => {
    const lo = useNpc.getState().createPet({ name: '幼崽', tier: '一阶', level: 5, attrs: petAttrs });
    const hi = useNpc.getState().createPet({ name: '渊虎', tier: '六阶', level: 55, attrs: petAttrs });
    expect(shownAttrs(lo).con).toBe(50);            // 一阶宠物本就该夹到 50
    expect(shownAttrs(hi).con).toBe(143);           // 六阶宠物原样保留
    expect(shownAttrs(lo).con).not.toBe(shownAttrs(hi).con);
  });

  it('不传阶位（旧路径）→ realm 为空、六维被当一阶夹成 50：正是本次修掉的症状', () => {
    const id = useNpc.getState().createPet({ name: '无阶宠', attrs: petAttrs });
    expect(useNpc.getState().npcs[id].realm).toBe('');
    expect(attrCapForTier('', lvFromRealm(''))).toBe(50);   // 空 realm → Lv.1 → 一阶 → 50
    expect(shownAttrs(id)).toMatchObject({ str: 50, con: 50 });
  });
});
