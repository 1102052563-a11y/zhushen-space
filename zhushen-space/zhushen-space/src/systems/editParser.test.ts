import { describe, it, expect, beforeEach } from 'vitest';
import { parseEditItems, parseEditChars, parseEditNpcs, parseEditFactions, editToTerritoryText, editToTeamText } from './editParser';
import { parseAllItemCommands, applyItemCommands } from './stateParser';
import { useItems } from '../store/itemStore';
import { useLedger } from './ledger/ledgerStore';

const ed = (...lines: string[]) => `<edit>\n${lines.join('\n')}\n</edit>`;

describe('editParser 翻译 <edit> → 既有命令对象', () => {
  it('item.add → createItem（cat→category 归一）', () => {
    const c = parseEditItems(ed('item.add {name:"铁剑", cat:"武器", grade:"蓝色", combatStat:"攻击力+45"}'));
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe('createItem');
    expect(c[0].data.name).toBe('铁剑');
    expect(c[0].data.category).toBe('武器');
    expect(c[0].data.cat).toBeUndefined();
  });

  it('item.set #uid {patch} → updateItem 带 itemId', () => {
    const c = parseEditItems(ed('item.set #I_B1_03 {affix:"[锋利]", combatStat:"攻击力+52"}'));
    expect(c[0].type).toBe('updateItem');
    expect(c[0].data.itemId).toBe('I_B1_03');
    expect(c[0].data.patch.affix).toBe('[锋利]');
  });

  it('item.set 名 {qty:N} → updateItemQuantity', () => {
    const c = parseEditItems(ed('item.set 治疗药水 {qty:"5"}'));
    expect(c[0].type).toBe('updateItemQuantity');
    expect(c[0].data.name).toBe('治疗药水');
    expect(c[0].data.newQuantity).toBe(5);
  });

  it('item.use 名 xN (原因) → consumeItem', () => {
    const c = parseEditItems(ed('item.use "止血绷带" x2 (包扎用掉)'));
    expect(c[0].type).toBe('consumeItem');
    expect(c[0].data.name).toBe('止血绷带');
    expect(c[0].data.quantity).toBe(2);
    expect(c[0].data.reason).toBe('包扎用掉');
  });

  it('item.del 名 (原因) → destroyItem', () => {
    const c = parseEditItems(ed('item.del 铁剑 (卖给铁匠)'));
    expect(c[0].type).toBe('destroyItem');
    expect(c[0].data.name).toBe('铁剑');
    expect(c[0].data.reason).toBe('卖给铁匠');
  });

  it('item.move 名 ->C1 → transferItem(from B1 to C1)', () => {
    const c = parseEditItems(ed('item.move 铁剑 ->C1 (赠予队友)'));
    expect(c[0].type).toBe('transferItem');
    expect(c[0].data.from).toBe('B1');
    expect(c[0].data.to).toBe('C1');
    expect(c[0].data.name).toBe('铁剑');
  });

  it('item.equip / item.unequip', () => {
    expect(parseEditItems(ed('item.equip 铁剑'))[0].type).toBe('equipItem');
    expect(parseEditItems(ed('item.unequip 铁剑'))[0].type).toBe('unequipItem');
  });

  it('cur.add / cur.sub → transferCurrency', () => {
    const a = parseEditItems(ed('cur.add 乐园币 300 (任务奖励)'))[0];
    expect(a.type).toBe('transferCurrency');
    expect(a.data.type).toBe('乐园币');
    expect(a.data.amount).toBe(300);
    expect(a.data.to).toBe('B1');
    const s = parseEditItems(ed('cur.sub 灵魂钱币 50'))[0];
    expect(s.data.from).toBe('B1');
    expect(s.data.amount).toBe(50);
  });

  it('skill/trait/title → CharCommand', () => {
    expect(parseEditChars(ed('skill.add B1 {name:"火球术", level:"Lv.1"}'))[0]).toMatchObject({ type: 'addSkill', charId: 'B1' });
    expect(parseEditChars(ed('skill.del B1 火球术'))[0]).toMatchObject({ type: 'deSkill', charId: 'B1', payload: '火球术' });
    expect(parseEditChars(ed('title.equip B1 屠龙者'))[0]).toMatchObject({ type: 'equipTitle', charId: 'B1', payload: '屠龙者' });
  });

  it('npc.set / npc.leave → NpcCommand', () => {
    expect(parseEditNpcs(ed('npc.set C1 {"12":"对主角好感上升"}'))[0]).toMatchObject({ type: 'add', id: 'C1' });
    expect(parseEditNpcs(ed('npc.leave C3'))[0]).toMatchObject({ type: 'de', id: 'C3' });
  });

  it('fac.set / fac.leave → FactionCommand', () => {
    expect(parseEditFactions(ed('fac.set F1 {"3":"扩张中"}'))[0]).toMatchObject({ type: 'add', id: 'F1' });
    expect(parseEditFactions(ed('fac.leave F2'))[0]).toMatchObject({ type: 'de', id: 'F2' });
  });

  it('注释行 / 空行忽略；无 <edit> 块返回空', () => {
    expect(parseEditItems('没有 edit 块的普通正文')).toHaveLength(0);
    const c = parseEditItems(ed('# 这是注释', '', 'item.del 杂草'));
    expect(c).toHaveLength(1);
  });
});

describe('editParser 容错（动词/域别名 + 全角 + 弯引号）', () => {
  it('动词近义词别名：create/update/remove/give', () => {
    expect(parseEditItems(ed('item.create {name:"剑", cat:"武器"}'))[0].type).toBe('createItem');
    expect(parseEditItems(ed('item.update 剑 {affix:"[利]"}'))[0].type).toBe('updateItem');
    expect(parseEditItems(ed('item.remove 剑'))[0].type).toBe('destroyItem');
    expect(parseEditItems(ed('item.give 剑 ->C1'))[0].type).toBe('transferItem');
  });

  it('货币动词别名 gain/spend + 域别名 currency', () => {
    expect(parseEditItems(ed('cur.gain 乐园币 100'))[0]).toMatchObject({ type: 'transferCurrency', data: { to: 'B1', amount: 100 } });
    expect(parseEditItems(ed('cur.spend 乐园币 50'))[0].data.from).toBe('B1');
    expect(parseEditItems(ed('currency.add 乐园币 200'))[0].data.amount).toBe(200);
  });

  it('全角数字/乘号/箭头容错', () => {
    expect(parseEditItems(ed('cur.add 乐园币 ２００'))[0].data.amount).toBe(200);
    expect(parseEditItems(ed('item.use 药 ×3'))[0].data.quantity).toBe(3);
    expect(parseEditItems(ed('item.move 剑 →C1'))[0].data.to).toBe('C1');
  });

  it('弯引号 JSON 容错', () => {
    const c = parseEditItems(ed('item.add {name:“铁剑”, cat:“武器”}'));
    expect(c[0].data.name).toBe('铁剑');
    expect(c[0].data.category).toBe('武器');
  });

  it('npc/skill/fac 动词别名', () => {
    expect(parseEditNpcs(ed('npc.remove C3'))[0]).toMatchObject({ type: 'de', id: 'C3' });
    expect(parseEditChars(ed('skill.learn B1 {name:"剑气"}'))[0].type).toBe('addSkill');
    expect(parseEditFactions(ed('fac.update F1 {"3":"扩张"}'))[0]).toMatchObject({ type: 'add', id: 'F1' });
  });
});

describe('editParser 领地/团透传 → 合成 <upstore>', () => {
  it('territory.addBuilding {…} → addBuilding({…})（camelCase 保留）', () => {
    const t = editToTerritoryText(ed('territory.addBuilding {name:"铁匠铺", level:"1"}'));
    expect(t).toContain('<upstore>');
    expect(t).toContain('addBuilding(');
    expect(t).toContain('铁匠铺');
    expect(t).not.toContain('addbuilding');   // 不被小写化
  });

  it('territory.deBuilding 名 → deBuilding("名")；带 ref+json 双参', () => {
    expect(editToTerritoryText(ed('territory.deBuilding 铁匠铺'))).toContain('deBuilding("铁匠铺")');
    const m = editToTerritoryText(ed('territory.addMember "C1" {role:"队长"}'));
    expect(m).toContain('addMember("C1"');
    expect(m).toContain('role');
  });

  it('team.upsertMember 透传', () => {
    expect(editToTeamText(ed('team.upsertMember "C1" {role:"前锋"}'))).toContain('upsertMember("C1"');
  });

  it('无对应域的 <edit> → 空串', () => {
    expect(editToTerritoryText(ed('item.del 剑'))).toBe('');
    expect(editToTeamText('普通正文')).toBe('');
  });
});

describe('<edit> 与 <upstore> 合流 + 经闸门落地', () => {
  beforeEach(() => {
    useItems.setState({ items: [], currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 }, recentlyDeleted: [], itemTurn: 0 });
    useLedger.getState().clear();
  });

  it('parseAllItemCommands 同时认 <upstore> 与 <edit>', () => {
    const text = `<upstore>createItem({"name":"旧剑","category":"武器","grade":"白色"})</upstore>\n` + ed('item.add {name:"新剑", cat:"武器", grade:"蓝色"}');
    const cmds = parseAllItemCommands(text);
    expect(cmds.filter((c) => c.type === 'createItem')).toHaveLength(2);
  });

  it('<edit> 经 applyItemCommands 真正建物 + 记账本', () => {
    const cmds = parseAllItemCommands(ed('item.add {name:"寒霜匕首", cat:"武器", grade:"蓝色"}', 'cur.add 乐园币 200'));
    const res = applyItemCommands(cmds, { source: 'narrative', turn: 1 });
    expect(res.every((r) => r.ok)).toBe(true);
    expect(useItems.getState().items.find((it) => it.name === '寒霜匕首')).toBeTruthy();
    expect(useItems.getState().currency.乐园币).toBe(200);
    expect(useLedger.getState().eventsOfTurn(1).some((e) => e.entity === 'item' && e.outcome === 'applied')).toBe(true);
  });
});
