import { describe, it, expect, beforeEach } from 'vitest';
import { opOf, refOf, digestOf, isBatchDup, newBatch, buildItemFeedback, purgeItemPhaseCurrency, detectUnregisteredCurrencyGains, type ItemEditResult } from './itemLedger';
import { useLedger } from './ledgerStore';
import { applyItemCommands, type ItemCommand } from '../stateParser';
import { useItems } from '../../store/itemStore';

const cmd = (type: string, data: any): ItemCommand => ({ type: type as ItemCommand['type'], data, raw: '' });
const resetBag = () =>
  useItems.setState({ items: [], currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 }, recentlyDeleted: [], itemTurn: 0 });

describe('itemLedger 纯函数', () => {
  it('opOf 把指令类型归一成操作', () => {
    expect(opOf('createItem')).toBe('create');
    expect(opOf('transferSpiritStones')).toBe('currency');
    expect(opOf('transferCurrency')).toBe('currency');
    expect(opOf('updateItemQuantity')).toBe('updateQty');
    expect(opOf('啥都不是')).toBe('other');
  });

  it('digestOf 对同一条逻辑指令稳定、对不同物品相异', () => {
    const a = digestOf(cmd('createItem', { name: '铁剑', category: '武器', grade: '蓝色', effect: '锋利' }));
    const b = digestOf(cmd('createItem', { name: '铁剑', category: '武器', grade: '蓝色', effect: '锋利' }));
    const c = digestOf(cmd('createItem', { name: '玄铁斧', category: '武器', grade: '蓝色' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('isBatchDup 逮住同批次第二次出现的同一指令', () => {
    const batch = newBatch();
    const c1 = cmd('createItem', { name: '铁剑', category: '武器', grade: '蓝色' });
    expect(isBatchDup(batch, c1)).toBe(false);
    expect(isBatchDup(batch, c1)).toBe(true);
  });

  it('refOf 优先取物品名', () => {
    expect(refOf(cmd('consumeItem', { name: '止血绷带', itemId: 'I_x' }))).toBe('止血绷带');
    expect(refOf(cmd('consumeItem', { itemId: 'I_x' }))).toBe('I_x');
  });

  it('buildItemFeedback 汇总失败项（含最接近线索），无失败返回空串', () => {
    const ok: ItemEditResult[] = [{ ok: true, op: 'create', ref: '铁剑' }];
    expect(buildItemFeedback(ok)).toBe('');
    const withFail: ItemEditResult[] = [
      { ok: false, op: 'consume', ref: '止血喷雾', reason: 'not_found', nearest: '次级止血喷雾' },
    ];
    const fb = buildItemFeedback(withFail);
    expect(fb).toContain('止血喷雾');
    expect(fb).toContain('次级止血喷雾');
  });
});

describe('applyItemCommands 单一闸门（物品·第0期）', () => {
  beforeEach(() => {
    resetBag();
    useLedger.getState().clear();
  });

  it('★同批次重复 createItem（装备）→ 只入库一件，第二条记为 dup', () => {
    const c1 = cmd('createItem', { name: '寒铁剑', category: '武器', grade: '蓝色', effect: '锋利' });
    const res = applyItemCommands([c1, { ...c1 }]);
    expect(useItems.getState().items.filter((it) => it.name === '寒铁剑').length).toBe(1);
    expect(res[1].skipped).toBe(true);
    expect(res[1].reason).toBe('dup');
  });

  it('★跨批次重复创建（正文+物品阶段各发一次同款装备）→ 状态判重拦截，仍只一件', () => {
    applyItemCommands([cmd('createItem', { name: '玄铁斧', category: '武器', grade: '紫色', effect: '沉重' })], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cmd('createItem', { name: '玄铁斧', category: '武器', grade: '紫色', effect: '沉重' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.filter((it) => it.name === '玄铁斧').length).toBe(1);
    expect(res[0].skipped).toBe(true);
    expect(res[0].reason).toBe('dup');
  });

  it('★同名同品级的装备(即使描述/效果不同) → 判重拦截只一件（治 AI 重提同一件武器变着描述→重复生成）', () => {
    applyItemCommands([cmd('createItem', { name: '长剑', category: '武器', grade: '蓝色', effect: '锋利' })], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cmd('createItem', { name: '长剑', category: '武器', grade: '蓝色', effect: '迟钝' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.filter((it) => it.name === '长剑').length).toBe(1);
    expect(res[0].skipped).toBe(true);
    expect(res[0].reason).toBe('dup');
  });

  it('★同名带装饰括号「【月影残心】」vs「月影残心」→ 归一去【】后判重，不重复生成', () => {
    applyItemCommands([cmd('createItem', { name: '月影残心', category: '武器', grade: '金色' })], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cmd('createItem', { name: '【月影残心】', category: '武器', grade: '金色' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.length).toBe(1);
    expect(res[0].skipped).toBe(true);
    expect(res[0].reason).toBe('dup');
  });

  it('★品级宽松：金色 vs 金色·顶级（AI 加后缀）→ 视为同级判重', () => {
    applyItemCommands([cmd('createItem', { name: '月影残心', category: '武器', grade: '金色' })], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cmd('createItem', { name: '月影残心', category: '武器', grade: '金色·顶级' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.length).toBe(1);
    expect(res[0].skipped).toBe(true);
  });

  it('不同品级（金色 vs 红色·升级）→ 品级不吻合，放行各一件', () => {
    applyItemCommands([cmd('createItem', { name: '月影残心', category: '武器', grade: '金色' })], { source: 'narrative', turn: 1 });
    applyItemCommands([cmd('createItem', { name: '月影残心', category: '武器', grade: '红色' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.length).toBe(2);
  });

  it('★重要物品/宝箱跨阶段各建一次（正文 upstore + 物品演化阶段）→ 判重只一件（治「变量出两个相同物品」·非装备唯一物也判重）', () => {
    applyItemCommands([cmd('createItem', { name: '精良级·蜂巢生化物源铁匣', category: '重要物品', quantity: 1, desc: '战利品' })], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cmd('createItem', { name: '精良级·蜂巢生化物源铁匣', category: '重要物品', quantity: 1, desc: '结算奖励' })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.filter((it) => it.name === '精良级·蜂巢生化物源铁匣').length).toBe(1);
    expect(res[0].skipped).toBe(true);
    expect(res[0].reason).toBe('dup');
  });

  it('消耗品(可堆叠)同名跨阶段 → 仍走 store 堆叠·不生成重复行', () => {
    applyItemCommands([cmd('createItem', { name: '生化补给箱', category: '消耗品', quantity: 1 })], { source: 'narrative', turn: 1 });
    applyItemCommands([cmd('createItem', { name: '生化补给箱', category: '消耗品', quantity: 1 })], { source: 'item-phase', turn: 1 });
    expect(useItems.getState().items.filter((it) => it.name === '生化补给箱').length).toBe(1);   // 一行·数量累加，不是两行
  });

  it('★consume 不存在的物品 → 结构化失败(not_found)，不崩、不误删别的', () => {
    applyItemCommands([cmd('createItem', { name: '某药', category: '消耗品', quantity: 2 })]);
    const res = applyItemCommands([cmd('consumeItem', { name: '不存在的药', quantity: 1 })]);
    expect(res[0].ok).toBe(false);
    expect(res[0].reason).toBe('not_found');
    expect(useItems.getState().items.find((it) => it.name === '某药')).toBeTruthy();   // 没误伤已有物品
  });

  it('consume 已有可堆叠物 → 正常扣减', () => {
    applyItemCommands([cmd('createItem', { name: '药水', category: '消耗品', quantity: 3 })]);
    const res = applyItemCommands([cmd('consumeItem', { name: '药水', quantity: 1 })]);
    expect(res[0].ok).toBe(true);
    expect(useItems.getState().items.find((it) => it.name === '药水')?.quantity).toBe(2);
  });

  it('每条裁决都进账本（applied / dup / fail 都有记录）', () => {
    applyItemCommands([cmd('createItem', { name: '盾', category: '防具', grade: '白色' })], { source: 'narrative', turn: 7 });
    applyItemCommands([cmd('createItem', { name: '盾', category: '防具', grade: '白色' }), cmd('consumeItem', { name: '查无此物' })], { source: 'item-phase', turn: 7 });
    const outcomes = useLedger.getState().eventsOfTurn(7).map((e) => e.outcome);
    expect(outcomes).toContain('applied');
    expect(outcomes).toContain('dup');
    expect(outcomes).toContain('fail');
  });
});

describe('货币跨阶段双计去重', () => {
  beforeEach(() => { resetBag(); useLedger.getState().clear(); });
  const cur = (amount: number, reason?: string, type = '乐园币') => cmd('transferCurrency', { type, amount, to: 'B1', reason });

  it('★同回合同笔奖励被正文+物品阶段各发一次 → 只入账一次', () => {
    applyItemCommands([cur(300, '任务奖励')], { source: 'narrative', turn: 1 });
    const res = applyItemCommands([cur(300, '任务奖励')], { source: 'item-phase', turn: 1 });
    expect(res[0].skipped).toBe(true);
    expect(res[0].reason).toBe('dup');
    expect(useItems.getState().currency.乐园币).toBe(300);
  });

  it('不同原因 → 视为两笔，各自入账', () => {
    applyItemCommands([cur(300, '任务奖励')], { source: 'narrative', turn: 2 });
    applyItemCommands([cur(300, '卖装备所得')], { source: 'item-phase', turn: 2 });
    expect(useItems.getState().currency.乐园币).toBe(600);
  });

  it('无原因 → 不去重（避免误并两笔同额奖励）', () => {
    applyItemCommands([cur(50)], { source: 'narrative', turn: 3 });
    applyItemCommands([cur(50)], { source: 'item-phase', turn: 3 });
    expect(useItems.getState().currency.乐园币).toBe(100);
  });

  it('币种别名归一（魂币=灵魂钱币）同样去重', () => {
    applyItemCommands([cmd('transferCurrency', { type: '灵魂钱币', amount: 10, to: 'B1', reason: '赏赐' })], { source: 'narrative', turn: 4 });
    const res = applyItemCommands([cmd('transferCurrency', { type: '魂币', amount: 10, to: 'B1', reason: '赏赐' })], { source: 'item-phase', turn: 4 });
    expect(res[0].skipped).toBe(true);
    expect(useItems.getState().currency.灵魂钱币).toBe(10);
  });

  it('★回滚 purge 本阶段货币事件后 → 重跑能重新发放', () => {
    applyItemCommands([cur(300, '任务奖励')], { source: 'item-phase', turn: 5 });
    expect(useItems.getState().currency.乐园币).toBe(300);
    // 模拟"储存空间手动更新"回滚：钱包还原 + 清本阶段货币账本
    useItems.setState({ currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } } as any);
    purgeItemPhaseCurrency(5);
    const res = applyItemCommands([cur(300, '任务奖励')], { source: 'item-phase', turn: 5 });
    expect(res[0].skipped).toBeUndefined();
    expect(useItems.getState().currency.乐园币).toBe(300);
  });

  it('narrative 来源的货币事件回滚后保留 → 仍正确抑制物品阶段重发', () => {
    applyItemCommands([cur(300, '任务奖励')], { source: 'narrative', turn: 6 });
    applyItemCommands([cur(300, '任务奖励')], { source: 'item-phase', turn: 6 });   // 被抑制
    expect(useItems.getState().currency.乐园币).toBe(300);
    purgeItemPhaseCurrency(6);   // 只清 item-phase 的（本例没有），narrative 的保留
    const res = applyItemCommands([cur(300, '任务奖励')], { source: 'item-phase', turn: 6 });
    expect(res[0].skipped).toBe(true);   // narrative 事件仍在 → 仍判 dup
    expect(useItems.getState().currency.乐园币).toBe(300);
  });
});

describe('货币所得漏登对账', () => {
  beforeEach(() => { useLedger.getState().clear(); });

  it('★正文获得乐园币、本回合无入账 → 回喂提示补登', () => {
    const fb = detectUnregisteredCurrencyGains('你击败了守卫，获得 300 乐园币。', 101);
    expect(fb).toContain('乐园币');
    expect(fb).toContain('cur.add');
  });

  it('正文获得乐园币、本回合已入账 → 不回喂', () => {
    useLedger.getState().append({ turn: 102, source: 'item-phase', entity: 'item', op: 'currency', ref: '乐园币', outcome: 'applied' });
    expect(detectUnregisteredCurrencyGains('获得 300 乐园币', 102)).toBe('');
  });

  it('正文没有货币所得 → 不回喂', () => {
    expect(detectUnregisteredCurrencyGains('你走进了幽暗的森林。', 103)).toBe('');
  });

  it('花费语义不算"获得" → 不回喂', () => {
    expect(detectUnregisteredCurrencyGains('你花了 300 乐园币买了一把剑。', 104)).toBe('');
  });

  it('灵魂钱币同样识别', () => {
    expect(detectUnregisteredCurrencyGains('结算所得：5 灵魂钱币', 105)).toContain('灵魂钱币');
  });
});

// 品级=物品固有稀有度，只由前端强化/觉醒/宝石(确定性)改；AI 演化绝不改已有物品的品级/评分。
// 治用户报的"同一件装备品级随受损/演化在 史诗↔绿色 乱跳、紫色稀里糊涂升史诗"。
describe('★品级/评分锁（updateItem + createItem 重生成）', () => {
  beforeEach(() => { resetBag(); useLedger.getState().clear(); });
  const bag = (name: string) => useItems.getState().items.find((x) => x.name === name)!;

  it('updateItem 不降品级：受损只更新耐久/杀敌，稀有度不变', () => {
    applyItemCommands([cmd('createItem', { name: '暗影黑牙', category: '武器', grade: '史诗级', durability: '38/50' })]);
    const g0 = bag('暗影黑牙').gradeDesc;
    applyItemCommands([cmd('updateItem', { name: '暗影黑牙', gradeDesc: '绿色', durability: '2/45', killCount: '+1' })]);
    const it = bag('暗影黑牙');
    expect(it.gradeDesc).toBe(g0);          // 品级锁·不变（无论规范化成何名）
    expect(it.gradeDesc).not.toBe('绿色');   // 确实没被降成绿色
    expect(it.durability).toBe('2/45');     // 耐久照常更新（受损体现在这里）
    expect(it.killCount).toBe('1');         // 杀敌照常累加
  });

  it('updateItem 也不升品级（紫→史诗随机升被挡）', () => {
    applyItemCommands([cmd('createItem', { name: '碎星', category: '武器', grade: '紫色' })]);
    const g0 = bag('碎星').gradeDesc;
    applyItemCommands([cmd('updateItem', { name: '碎星', gradeDesc: '史诗级' })]);
    expect(bag('碎星').gradeDesc).toBe(g0);
  });

  it('评分锁：已有评分不被 AI 改写', () => {
    applyItemCommands([cmd('createItem', { name: '古剑', category: '武器', grade: '紫色', score: '142' })]);
    const s0 = String(bag('古剑').score);
    applyItemCommands([cmd('updateItem', { name: '古剑', score: '22（受损严重）' })]);
    expect(String(bag('古剑').score)).toBe(s0);
  });

  it('原本缺品级的物品 → 允许 AI 补一次', () => {
    applyItemCommands([cmd('createItem', { name: '无名残片', category: '材料' })]);
    applyItemCommands([cmd('updateItem', { name: '无名残片', gradeDesc: '蓝色' })]);
    expect(bag('无名残片').gradeDesc).toBeTruthy();   // 缺则补上（异常兜底）
  });

  it('addItem 原地更新同 id 同名 → 保留原品级/评分（AI 重生成不改稀有度）', () => {
    useItems.getState().addItem({ id: 'I_TEST', name: '龙牙', category: '武器', gradeDesc: '史诗级', score: '999' } as any);
    const g0 = bag('龙牙').gradeDesc; const s0 = String(bag('龙牙').score);
    useItems.getState().addItem({ id: 'I_TEST', name: '龙牙', category: '武器', gradeDesc: '绿色', score: '20' } as any);
    expect(bag('龙牙').gradeDesc).toBe(g0);
    expect(String(bag('龙牙').score)).toBe(s0);
  });
});
