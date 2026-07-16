import { describe, it, expect, beforeEach } from 'vitest';
import { applyAllUpdates } from './stateApply';
import { applyItemCommands } from './stateParser';
import { useTables } from '../store/tableStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';

/* 1c 写路径：applyAllUpdates 末尾把 13 张镜像表从 store 投影覆盖，
   AI 的 <tableEdit> 只对「纪要表」(编年史·表原生·store 无对应)有效；写镜像表会被投影抹掉。 */
beforeEach(() => {
  useTables.getState().resetAll();
  usePlayer.setState({ profile: {} } as any);
  useItems.setState({ currency: {}, items: [] } as any);
  useNpc.setState({ npcs: {} } as any);
});

describe('applyAllUpdates × <tableEdit>（1c：纪要表接受 AI 写·镜像表由 store 投影）', () => {
  it('★<tableEdit> 写「纪要表」(编年史) 端到端落库并存活（投影不碰它）', () => {
    const reply = '主角走进商店，买下一卷卷轴。\n<tableEdit>\ninsertRow("纪要表",{"时间":"第1天","地点":"商店","事件":"买下回城卷轴"})\n</tableEdit>';
    applyAllUpdates(reply);
    const rows = useTables.getState().rows('chronicle');
    expect(rows.length).toBe(1);
    expect(rows[0]['事件']).toBe('买下回城卷轴');
  });

  it('★<tableEdit> 往镜像表(背包)塞的东西被 store 投影覆盖（1c 漂移消除）', () => {
    // store 里没这件物品；AI 却想用 <tableEdit> 直接塞进背包镜像表 → 投影从空 itemStore 重灌 → 被抹掉
    applyAllUpdates('<tableEdit>insertRow("背包物品表",{"0":"幻觉神装","3":"99"})</tableEdit>');
    expect(useTables.getState().rows('inventory').length).toBe(0);
  });

  it('镜像表随 store 投影更新（itemStore 有物 → 背包表自动出现该物·无需 AI 填）', () => {
    useItems.setState({ items: [{ id: 'i1', name: '铁剑', quantity: 1 }] } as any);
    applyAllUpdates('纯剧情，无指令块。');
    const rows = useTables.getState().rows('inventory');
    expect(rows.length).toBe(1);
    expect(rows[0]['物品名称']).toBe('铁剑');
  });

  it('无 <tableEdit> 且 store 空 → 表保持空', () => {
    applyAllUpdates('纯剧情叙述，没有任何指令块。');
    expect(useTables.getState().rows('inventory').length).toBe(0);
    expect(useTables.getState().rows('chronicle').length).toBe(0);
  });
});

describe('applyAllUpdates × deferItemCreate（物品阶段独占建物品·根治正文+物品阶段各建一次重复）', () => {
  const pickup = '主角捡起一把寒铁剑。\n<upstore>\ncreateItem({"name":"寒铁剑","category":"武器","grade":"蓝色","effect":"锋利"})\n</upstore>';

  it('默认（不传 opts）→ 正文自带的 createItem 照旧即时入库', () => {
    applyAllUpdates(pickup);
    expect(useItems.getState().items.filter((i: any) => i.name === '寒铁剑').length).toBe(1);
  });

  it('deferItemCreate=true → 跳过正文的 createItem（交物品阶段独占建），本次不入库', () => {
    applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    expect(useItems.getState().items.filter((i: any) => i.name === '寒铁剑').length).toBe(0);
  });

  /* ⚠「延后 ≠ 丢弃」：物品阶段一旦没接住（未配API早退/抛异常被catch吞/演化调度频率与物品频率不同步该回合没跑/
     AI 就是没发这条 createItem），这件物品会**永久消失**——正文说给了、背包里没有（"装备装备没有、宝箱宝箱没有"）。
     现成的「物品守护看门狗」补不了：它比对"进过背包又消失"，这类物品从未进过背包。故必须回传原指令供事后对账。 */
  it('★延后的 createItem 原样回传（供 reconcileDeferredCreates 事后对账补建）', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    expect(deferredCreates.length).toBe(1);
    expect(deferredCreates[0].type).toBe('createItem');
  });

  it('不延后时 deferredCreates 为空（没东西要对账）', () => {
    expect(applyAllUpdates(pickup).deferredCreates.length).toBe(0);
  });

  it('★兜底补建：物品阶段没接住 → 按回传指令补建，物品回到背包', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    expect(useItems.getState().items.filter((i: any) => i.name === '寒铁剑').length).toBe(0);   // 物品阶段没建
    applyItemCommands(deferredCreates);                                                          // = reconcileDeferredCreates
    expect(useItems.getState().items.filter((i: any) => i.name === '寒铁剑').length).toBe(1);
  });

  it('★对账幂等：物品阶段已建过 → 补建被闸门判 dup 拦掉，绝不变两件', () => {
    const { deferredCreates } = applyAllUpdates(pickup, undefined, { deferItemCreate: true });
    applyItemCommands(deferredCreates);   // 模拟物品阶段建了一次
    applyItemCommands(deferredCreates);   // 对账兜底再来一次
    expect(useItems.getState().items.filter((i: any) => i.name === '寒铁剑').length).toBe(1);
  });
});
