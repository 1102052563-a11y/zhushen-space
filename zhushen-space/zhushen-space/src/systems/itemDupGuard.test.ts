import { describe, it, expect, beforeEach } from 'vitest';
import { applyAllUpdates } from './stateApply';
import { applyItemCommands, deferredCreateSkipReason } from './stateParser';
import { pruneBlankDupItems } from './itemWatchdog';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useLedger } from './ledger/ledgerStore';

/* 「同一件物品两条：一条有详细信息、一条只有名字」的两道防线：
   ① 源头 —— deferredCreateSkipReason：延后建物对账补建前，先判物品阶段/设施是不是已经落地过（宽松同名，容忍润色改名/换品级）。
   ② 收口 —— pruneBlankDupItems：漏进来的、以及老存档里已经躺着的空壳重复，回合末并进完整那条。 */

const CMD = (json: string) => ({ type: 'createItem' as const, data: JSON.parse(json), raw: `createItem(${json})` });

beforeEach(() => {
  useItems.setState({ items: [], currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } } as any);
  useNpc.setState({ npcs: {} } as any);
  useLedger.getState().clear();
});

describe('deferredCreateSkipReason（延后建物对账·补建前的"是不是已经有了"）', () => {
  const pickup = '主角拾起一把裂空战刃。\n<upstore>\ncreateItem({"name":"裂空战刃","category":"武器","grade":"蓝色","effect":"锋利"})\n</upstore>';

  it('★物品阶段把名字润色过（"裂空战刃"→"暗金·裂空战刃"）→ 补建被拦，不再多出一条空壳', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    // 物品阶段落地的是**完整档**且名字被润色
    applyItemCommands([CMD('{"item":{"name":"暗金·裂空战刃","category":"武器","grade":"金色","effect":"斩击附带风刃","combatStat":"攻击力+180","score":"820","intro":"上古战刃"}}')]);
    expect(deferredCreateSkipReason(deferredCreates[0])).toContain('暗金·裂空战刃');
  });

  it('★品级被改写（"蓝色"→"绿色"）→ 严格判重会漏网，本判定仍拦下', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    applyItemCommands([CMD('{"item":{"name":"裂空战刃","category":"武器","grade":"绿色","effect":"锋利","score":"120","combatStat":"攻击力+30"}}')]);
    expect(deferredCreateSkipReason(deferredCreates[0])).toBeTruthy();
  });

  it('★真没建过 → 不拦（补建照跑，绝不把正文给的物品吞掉）', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    expect(deferredCreateSkipReason(deferredCreates[0])).toBeNull();
    applyItemCommands(deferredCreates);
    expect(useItems.getState().items.filter((i: any) => i.name === '裂空战刃').length).toBe(1);
  });

  it('名字只是相近而非同一件（"破损铁剑" vs 背包里的"破损铁盾"）→ 不拦，仍照常补建', () => {
    applyItemCommands([CMD('{"item":{"name":"破损铁盾","category":"防具","grade":"白色","combatStat":"防御力+5","score":"10"}}')]);
    expect(deferredCreateSkipReason(CMD('{"item":{"name":"破损铁剑","category":"武器"}}'))).toBeNull();
  });

  it('★设施已发放物（开箱/合成确定性入库·容忍名字漂）→ 拦下，不绕过 suppressCreateNames', () => {
    const why = deferredCreateSkipReason(CMD('{"item":{"name":"裂空战刃","category":"武器"}}'), { suppressNames: ['暗金·裂空战刃'] });
    expect(why).toContain('设施');
  });

  it('★货币伪物品：物品阶段本回合已入账 → 拦下，防重复发钱', () => {
    applyAllUpdates('<upstore>createItem({"name":"乐园币","quantity":"300"})</upstore>', { source: 'item-phase', turn: 7 });
    expect(useItems.getState().currency.乐园币).toBe(300);
    expect(deferredCreateSkipReason(CMD('{"item":{"1":"乐园币","5":"300"}}'), { turn: 7 })).toContain('物品阶段');
  });

  it('货币伪物品：物品阶段没入过账 → 不拦（宁可漏防、不吞钱）', () => {
    expect(deferredCreateSkipReason(CMD('{"item":{"1":"乐园币","5":"300"}}'), { turn: 7 })).toBeNull();
  });

  it('★可堆叠物不走"背包里已有"那道 → 又捡到同款药剂仍能累加数量，不被误吞', () => {
    applyItemCommands([CMD('{"item":{"name":"止血喷雾","category":"消耗品","grade":"白色","quantity":"2"}}')]);
    const again = CMD('{"item":{"name":"止血喷雾","category":"消耗品","grade":"白色","quantity":"3"}}');
    expect(deferredCreateSkipReason(again)).toBeNull();
    applyItemCommands([again]);
    expect(useItems.getState().items.find((i: any) => i.name === '止血喷雾')?.quantity).toBe(5);
  });

  it('唯一物已在 NPC 身上（物品阶段判成随从所得）→ 拦下，不在主角包里再复制一份', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓', items: [{ id: 'x', name: '裂空战刃', category: '武器', gradeDesc: '金色', score: '820', combatStat: '攻击力+180' }] } } } as any);
    expect(deferredCreateSkipReason(CMD('{"item":{"name":"裂空战刃","category":"武器"}}'))).toBeTruthy();
  });
});

describe('pruneBlankDupItems（空壳重复清理·收口安全网）', () => {
  const rich = { id: 'A', name: '暗金·裂空战刃', category: '武器', gradeDesc: '金色', effect: '斩击附带风刃', combatStat: '攻击力+180', score: '820', intro: '上古战刃' };
  const blank = { id: 'B', name: '裂空战刃', category: '武器', gradeDesc: '蓝色', effect: '锋利', quantity: 1 };

  it('★同名 + 一条完整一条空壳 → 空壳并入完整那条，只剩一件', () => {
    useItems.setState({ items: [rich, blank] } as any);
    const r = pruneBlankDupItems();
    expect(r.removed).toBe(1);
    const items = useItems.getState().items;
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('A');
    expect((items[0] as any).combatStat).toBe('攻击力+180');   // 完整档的细节完好
  });

  it('两条都是完整档（同名两件真装备=独立实例）→ 一件都不动', () => {
    useItems.setState({ items: [rich, { ...rich, id: 'C' }] } as any);
    expect(pruneBlankDupItems().removed).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });

  it('空壳已装备 / 已锁定 → 绝不动（不悄悄吞掉玩家正穿/锁着的东西）', () => {
    useItems.setState({ items: [rich, { ...blank, equipped: true, equipSlot: 'weapon:right' }] } as any);
    expect(pruneBlankDupItems().removed).toBe(0);
    useItems.setState({ items: [rich, { ...blank, locked: true }] } as any);
    expect(pruneBlankDupItems().removed).toBe(0);
  });

  it('没有完整档的同名兄弟 → 空壳原样保留（物品阶段没启用时全是简写档，不能误删）', () => {
    useItems.setState({ items: [blank, { id: 'D', name: '止血喷雾', category: '消耗品' }] } as any);
    expect(pruneBlankDupItems().removed).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });

  it('可堆叠空壳并入时数量累加（不丢数量）', () => {
    const richPotion = { id: 'P', name: '高级疗伤药', category: '消耗品', gradeDesc: '绿色', quantity: 2, intro: '瞬回大量生命', score: '30' };
    useItems.setState({ items: [richPotion, { id: 'Q', name: '疗伤药', category: '消耗品', quantity: 3 }] } as any);
    expect(pruneBlankDupItems().removed).toBe(1);
    expect(useItems.getState().items[0].quantity).toBe(5);
  });

  it('★空壳独有字段回填给完整档（正文写的获得方式不丢）', () => {
    useItems.setState({ items: [{ ...rich, acquisition: '' }, { ...blank, acquisition: '击杀风蚀者掉落' }] } as any);
    pruneBlankDupItems();
    expect((useItems.getState().items[0] as any).acquisition).toBe('击杀风蚀者掉落');
  });

  it('NPC 持有物里的空壳重复同样清理', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓', items: [rich, blank] } } } as any);
    expect(pruneBlankDupItems().removed).toBe(1);
    expect(useNpc.getState().npcs.C1.items.length).toBe(1);
  });
});
