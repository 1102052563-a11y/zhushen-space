import { describe, it, expect, beforeEach } from 'vitest';
import { runWatchdogs, watchdogViolations, healWatchdog } from './watchdog';
import { useItems } from '../../store/itemStore';
import { useNpc } from '../../store/npcStore';
import { walletReset, walletSeed } from './walletCore';
import { itemCoreReset, itemSeed, itemSig, reconcileItems } from './itemCore';

beforeEach(() => {
  walletReset();
  itemCoreReset();
  useItems.setState({ currency: {}, items: [] } as any);
  useNpc.setState({ npcs: {} } as any);
});

const domViolations = (domain: string) => runWatchdogs().find((r) => r.domain === domain)!.violations;

describe('状态对账看门狗（Step 10·扩 items/NPC）', () => {
  it('干净态 → 无违规', () => {
    useItems.setState({ currency: { 乐园币: 0 }, items: [{ id: 'i1', name: '剑', quantity: 1 }] } as any);
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三' } } } as any);
    expect(watchdogViolations()).toEqual([]);
  });

  it('★物品重复 id 被 facade 闸门结构性根除（塌成一条·无从"被抓"，比事后抓更强）', () => {
    useItems.setState({ items: [{ id: 'i1', name: '剑' }, { id: 'i1', name: '剑' }] } as any);
    expect(useItems.getState().items.length).toBe(1);                                   // facade subscribe 已塌掉重复 id
    expect(domViolations('物品').some((x) => /重复 id/.test(x))).toBe(false);            // 结构上没有重复 id 可抓
  });

  it('物品无名 / 数量≤0 被抓', () => {
    useItems.setState({ items: [{ id: 'a', name: '' }, { id: 'b', name: '药', quantity: 0 }] } as any);
    const v = domViolations('物品');
    expect(v.some((x) => /无名/.test(x))).toBe(true);
    expect(v.some((x) => /数量≤0/.test(x))).toBe(true);
  });

  it('装备槽冲突被抓', () => {
    useItems.setState({ items: [{ id: 'a', name: '剑A', equipped: true, equipSlot: 'weapon' }, { id: 'b', name: '剑B', equipped: true, equipSlot: 'weapon' }] } as any);
    expect(domViolations('物品').some((x) => /装备槽冲突/.test(x))).toBe(true);
  });

  it('幽灵 NPC（编号无真名）被抓', () => {
    useNpc.setState({ npcs: { C11: { id: 'C11', name: 'C11' }, C1: { id: 'C1', name: '张三' } } } as any);
    expect(domViolations('NPC').some((x) => /幽灵/.test(x))).toBe(true);
  });

  it('★NPC 重复建档被 facade 闸门即时合并（无从"被抓"，结构性优于事后抓）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三' }, C2: { id: 'C2', name: '张三' } } } as any);
    const zhangs = Object.values(useNpc.getState().npcs).filter((n: any) => n.name === '张三');
    expect(zhangs.length).toBe(1);                                              // facade subscribe 已合并
    expect(domViolations('NPC').some((x) => /重复建档/.test(x))).toBe(false);   // 结构上没有重复建档可抓
  });

  it('三域都在报告里（货币/物品/NPC）', () => {
    const domains = runWatchdogs().map((r) => r.domain);
    expect(domains).toEqual(expect.arrayContaining(['货币', '物品', 'NPC']));
  });
});

describe('看门狗·自愈 healWatchdog（调现成 dedup，不新造逻辑）', () => {
  it('干净态 → healed=false，全 0', () => {
    useItems.setState({ items: [{ id: 'i1', name: '剑', quantity: 1 }] } as any);
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三' } } } as any);
    const r = healWatchdog();
    expect(r).toMatchObject({ itemDeduped: 0, npcDeduped: 0, npcAliasMerged: 0, healed: false });
  });

  it('可堆叠同名重复物品（双计）→ 自愈合并、healed=true', () => {
    useItems.setState({ items: [
      { id: 'P1', name: '止血喷雾', category: '消耗品', gradeDesc: '白色', quantity: 3, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'P2', name: '止血喷雾', category: '消耗品', gradeDesc: '白色', quantity: 2, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    const r = healWatchdog();
    expect(r.itemDeduped).toBe(1);
    expect(r.healed).toBe(true);
    expect(useItems.getState().items.length).toBe(1);
    expect(useItems.getState().items[0].quantity).toBe(5);   // 3+2 累加
    // 自愈后同一不变量再查应已消解（无重复 id 之类）
    expect(runWatchdogs().find((x) => x.domain === '物品')!.violations).toEqual([]);
  });

  it('★数量漂移 → 自愈按背包真相重播种影子账本、漂移清零（旧版 heal 不碰漂移=用户报"按了没用"）', () => {
    // 背包只有 1 把剑；影子核心被搞成 3（模拟绕过闸门/静默消失导致的漂移）
    useItems.setState({ items: [{ id: 'i1', name: '剑', gradeDesc: '白色', quantity: 1 }] } as any);
    itemSeed({ [itemSig('剑', '白色')]: 3 });
    expect(reconcileItems(useItems.getState().items).length).toBeGreaterThan(0);   // 有漂移
    const r = healWatchdog();
    expect(r.driftRealigned).toBeGreaterThan(0);
    expect(r.healed).toBe(true);
    expect(reconcileItems(useItems.getState().items)).toEqual([]);   // 自愈后核心==背包·漂移清零
  });

  it('★货币漂移 → 自愈按钱包真相重播种、清零', () => {
    useItems.setState({ currency: { 乐园币: 100 } } as any);
    walletSeed({ 乐园币: 999 });   // 影子核心与钱包不一致
    expect(runWatchdogs().find((x) => x.domain === '货币')!.violations.some((v) => /漂移/.test(v))).toBe(true);
    const r = healWatchdog();
    expect(r.driftRealigned).toBeGreaterThan(0);
    expect(runWatchdogs().find((x) => x.domain === '货币')!.violations.some((v) => /漂移/.test(v))).toBe(false);
  });

  it('同名重复真实 NPC 已被 facade 闸门即时合并（heal 的 NPC 去重此后是 belt·无重复可去）', () => {
    useNpc.setState({ npcs: {
      C1: { id: 'C1', name: '弗利萨', tier: 'A' },
      C2: { id: 'C2', name: '弗利萨', tier: 'A' },
    } } as any);
    const friezas = Object.values(useNpc.getState().npcs).filter((n: any) => n.name === '弗利萨');
    expect(friezas.length).toBe(1);              // facade subscribe 在 setState 时已合并
    expect(healWatchdog().npcDeduped).toBe(0);   // facade 已处理·healWatchdog 无重复可去（healed=true 由物品可堆叠去重那条覆盖）
  });
});
