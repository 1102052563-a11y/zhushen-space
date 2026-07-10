import { describe, it, expect, beforeEach } from 'vitest';
import { applyAllUpdates } from './stateApply';
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
});
