import { describe, it, expect } from 'vitest';
import { lenientJsonParse, pickTargetItem, parseAllItemCommands, applyItemCommands } from './stateParser';
import { useItems } from '../store/itemStore';

describe('lenientJsonParse（容忍裸键/单引号/尾逗号的 JSON）', () => {
  it('标准 JSON', () => {
    expect(lenientJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('裸键（无引号）', () => {
    expect(lenientJsonParse('{a:1,b:2}')).toEqual({ a: 1, b: 2 });
  });
  it('尾逗号（对象/数组）', () => {
    expect(lenientJsonParse('{a:1,}')).toEqual({ a: 1 });
    expect(lenientJsonParse('{a:[1,2,],}')).toEqual({ a: [1, 2] });
  });
  it('单引号', () => {
    expect(lenientJsonParse("{'a':'b'}")).toEqual({ a: 'b' });
  });
  it('解析不了 → undefined', () => {
    expect(lenientJsonParse('not json')).toBeUndefined();
    expect(lenientJsonParse('{broken')).toBeUndefined();
  });
});

describe('pickTargetItem（消耗/销毁的目标物品定位，容忍 AI 把名字塞进 itemId）', () => {
  const bag = [
    { id: 'I_B1_14', name: '古旧的炼金学徒手札' },
    { id: 'I_B1_03', name: '次级止血喷雾' },
    { id: 'I_B1_07', name: '寒铁长剑' },
  ];

  it('★回归：AI 把物品名误塞进 itemId、且漏填 name → 仍能按名字找到', () => {
    // 即本次 bug：name=undefined，itemId 实为物品名
    expect(pickTargetItem(bag, '古旧的炼金学徒手札', undefined)?.id).toBe('I_B1_14');
  });

  it('正常：itemId 命中真实 id、name 也相符 → 用它', () => {
    expect(pickTargetItem(bag, 'I_B1_14', '古旧的炼金学徒手札')?.id).toBe('I_B1_14');
  });

  it('正常：只给 name（无 itemId）→ 按名字精确找到', () => {
    expect(pickTargetItem(bag, undefined, '寒铁长剑')?.id).toBe('I_B1_07');
  });

  it('优先级：itemId 命中物品A，但 name 指向物品B → 信任 name，返回 B 而非 A', () => {
    // itemId 指向手札，但 name 给的是长剑 → 不能动手札，应返回长剑
    expect(pickTargetItem(bag, 'I_B1_14', '寒铁长剑')?.id).toBe('I_B1_07');
  });

  it('安全：给了 name 却谁也匹配不上（哪怕 itemId 命中某物）→ 返回 null（宁可不删也不误删）', () => {
    expect(pickTargetItem(bag, 'I_B1_14', '不存在的传说圣剑')).toBeNull();
  });

  it('安全：纯 id 格式的幻觉 itemId、无 name → 返回 null，不会误匹配到任何中文名物品', () => {
    expect(pickTargetItem(bag, 'I_FAKE_99', undefined)).toBeNull();
  });
});

describe('createItem 确定性护栏（④货币伪物品拒建 + ③combatStat 机读归一）', () => {
  const run = (s: string) => applyItemCommands(parseAllItemCommands(`<upstore>${s}</upstore>`));

  const zeroWallet = { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 };

  it('④ 货币 createItem(如开宝箱得乐园币) → 不建死条目、直接计入钱包（修"不进货币/不第一时间更新"）', () => {
    useItems.setState({ items: [], currency: { ...zeroWallet } });
    run('createItem({"name":"乐园币","category":"特殊物品","quantity":500})');
    run('createItem({"name":"灵魂钱币","category":"特殊物品","quantity":2})');
    expect(useItems.getState().items.length).toBe(0);           // 不建死条目
    expect(useItems.getState().currency.乐园币).toBe(500);       // 第一时间进钱包
    expect(useItems.getState().currency.灵魂钱币).toBe(2);
  });

  it('④ 成长点数 createItem → 拒绝且不计入（点数只在【世界结算】发放）', () => {
    useItems.setState({ items: [], currency: { ...zeroWallet } });
    run('createItem({"name":"技能点","category":"特殊物品","quantity":3})');
    run('createItem({"name":"潜能点","category":"重要物品","quantity":2})');
    expect(useItems.getState().items.length).toBe(0);
    expect(useItems.getState().currency.技能点).toBe(0);         // 不被物品阶段补发
  });

  it('④ NPC owner 的货币 createItem → 不计入主角钱包', () => {
    useItems.setState({ items: [], currency: { ...zeroWallet } });
    run('createItem({"owner":"C1","name":"乐园币","category":"特殊物品","quantity":300})');
    expect(useItems.getState().currency.乐园币).toBe(0);
  });

  it('④ 实物（灵魂结晶/宝箱）不受影响、照常建', () => {
    useItems.setState({ items: [] });
    run('createItem({"name":"灵魂结晶(中)","category":"材料","quantity":1})');
    run('createItem({"name":"史诗级·虚空宝箱","category":"重要物品","quantity":1})');
    expect(useItems.getState().items.length).toBe(2);
  });

  it('③ 全角数字 combatStat → 归一为半角（否则 derivedStats 读不出）', () => {
    useItems.setState({ items: [] });
    run('createItem({"name":"测试剑","category":"武器","combatStat":"攻击力 ８０"})');
    expect(useItems.getState().items[0].combatStat).toBe('攻击力 80');
  });

  it('③ 全角范围/分隔符 combatStat → 归一', () => {
    useItems.setState({ items: [] });
    run('createItem({"name":"测试甲","category":"防具","combatStat":"防御力 ２０～３５"})');
    expect(useItems.getState().items[0].combatStat).toBe('防御力 20~35');
  });
});

describe('transferItem 安全护栏（治"交易吞掉正文没提的另一件武器、最近删除无记录、只能回滚"）', () => {
  const run = (s: string) => applyItemCommands(parseAllItemCommands(`<upstore>${s}</upstore>`));
  const seedTwoWeapons = () => useItems.setState({
    items: [
      { id: 'I_B1_01', name: '寒铁长剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'I_B1_02', name: '玄铁巨斧', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any,
    recentlyDeleted: [],
  });

  it('★按 name 定位：AI 把 itemId 误填成另一件(B)的 id、但 name 是被交易那件(A) → 转走 A、绝不吞掉 B', () => {
    seedTwoWeapons();
    // 正文交易的是「寒铁长剑」(A)，AI 却把 itemId 误填成「玄铁巨斧」(B) 的 id —— 旧实现会裸按 id 删掉 B
    run('transferItem({"from":"B1","to":"C9","itemId":"I_B1_02","name":"寒铁长剑"})');
    const items = useItems.getState().items;
    expect(items.find((i) => i.name === '玄铁巨斧')).toBeTruthy();  // B 必须还在（正文没提）
    expect(items.find((i) => i.name === '寒铁长剑')).toBeFalsy();   // A 被正确转走
  });

  it('★转出整件 → 进「最近删除」可恢复（治"只能回滚"）', () => {
    seedTwoWeapons();
    run('transferItem({"from":"B1","itemId":"I_B1_01","name":"寒铁长剑","reason":"以物易物换走"})');
    const bin = useItems.getState().recentlyDeleted;
    expect(bin.find((d) => d.name === '寒铁长剑')).toBeTruthy();    // 可在「最近删除」里找回
  });

  it('★拒绝转出已锁定物品（防误删本命装备）', () => {
    useItems.setState({ items: [
      { id: 'I_B1_01', name: '本命剑', category: '武器', gradeDesc: '金色', quantity: 1, effect: '', equipped: false, locked: true, tags: [], addedAt: 0 },
    ] as any, recentlyDeleted: [] });
    run('transferItem({"from":"B1","itemId":"I_B1_01","name":"本命剑"})');
    expect(useItems.getState().items.length).toBe(1);              // 锁定→未被转走
  });

  it('★转入玩家·来源不明 → 不削减已有物品数量（修旧 Math.min 静默丢失）', () => {
    useItems.setState({ items: [
      { id: 'I_B1_07', name: '止血喷雾', category: '消耗品', gradeDesc: '白色', quantity: 10, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any, recentlyDeleted: [] });
    run('transferItem({"to":"B1","itemId":"I_B1_07","quantity":1})');
    expect(useItems.getState().items[0].quantity).toBe(10);        // 旧实现会被砍成 1
  });
});
