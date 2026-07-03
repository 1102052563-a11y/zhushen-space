import { describe, it, expect, beforeEach } from 'vitest';
import {
  itemSig, itemCreate, itemConsume, itemSeed, itemCoreQ, itemCoreWatchdog, itemCoreReset,
  itemCoreSnapshot, itemCoreRestore, reconcileItems, seedItemsIfEmpty, itemsToSigMap, itemDiagnostics,
  commitItems, itemCollapseLog,
} from './itemCore';

beforeEach(() => { itemCoreReset(); });

describe('物品事件核心 itemCore（Step 10·内容签名 名称｜品级）', () => {
  it('签名归一：名称/品级 去空白+小写', () => {
    expect(itemSig(' 铁剑 ', '蓝色')).toBe(itemSig('铁剑', '蓝色'));
    expect(itemSig('铁剑', '蓝色')).not.toBe(itemSig('铁剑', '白色'));
  });

  it('create 按签名累加数量', () => {
    itemCreate('止血喷雾', '白色', 3);
    itemCreate('止血喷雾', '白色', 2);   // 同签名 → 累加
    itemCreate('铁剑', '蓝色', 1);
    const q = itemCoreQ();
    expect(q[itemSig('止血喷雾', '白色')]).toBe(5);
    expect(q[itemSig('铁剑', '蓝色')]).toBe(1);
  });

  it('consume 扣减；扣到 ≤0 删除签名', () => {
    itemCreate('药水', '绿色', 3);
    itemConsume('药水', '绿色', 1);
    expect(itemCoreQ()[itemSig('药水', '绿色')]).toBe(2);
    itemConsume('药水', '绿色', 5);   // 扣超
    expect(itemCoreQ()[itemSig('药水', '绿色')]).toBeUndefined();
  });

  it('★显式 id → 幂等（治双计：正文+物品阶段同一奖励各发一次只入一次）', () => {
    itemCreate('世界宝箱', '金色', 1, { id: 'reward-turn7' });
    itemCreate('世界宝箱', '金色', 1, { id: 'reward-turn7' });   // 同 id → 被幂等拦下
    expect(itemCoreQ()[itemSig('世界宝箱', '金色')]).toBe(1);
  });

  it('无 id 的同款多次入库不误去重（两次掉落各 1 → 共 2）', () => {
    itemCreate('铁剑', '蓝色', 1);
    itemCreate('铁剑', '蓝色', 1);
    expect(itemCoreQ()[itemSig('铁剑', '蓝色')]).toBe(2);
  });

  it('itemsToSigMap：itemStore.items 折成 签名→总数量', () => {
    const q = itemsToSigMap([
      { name: '铁剑', gradeDesc: '蓝色', quantity: 1 },
      { name: '铁剑', gradeDesc: '蓝色', quantity: 1 },   // 两件同款装备 → 签名合计 2
      { name: '药水', gradeDesc: '绿色', quantity: 3 },
    ]);
    expect(q[itemSig('铁剑', '蓝色')]).toBe(2);
    expect(q[itemSig('药水', '绿色')]).toBe(3);
  });

  it('★reconcile 抓漂移：itemStore 有而核心没有（双计/绕过闸门）', () => {
    itemCreate('铁剑', '蓝色', 1);   // 核心记 1
    const live = [{ name: '铁剑', gradeDesc: '蓝色', quantity: 1 }, { name: '铁剑', gradeDesc: '蓝色', quantity: 1 }];   // 背包却有 2（双计）
    const drift = reconcileItems(live);
    expect(drift).toEqual([{ sig: itemSig('铁剑', '蓝色'), core: 1, live: 2 }]);
  });

  it('reconcile 一致 → 无漂移', () => {
    itemCreate('铁剑', '蓝色', 2);
    const drift = reconcileItems([{ name: '铁剑', gradeDesc: '蓝色', quantity: 2 }]);
    expect(drift).toEqual([]);
  });

  it('seedItemsIfEmpty：核心空时从背包播种对齐', () => {
    const seeded = seedItemsIfEmpty([{ name: '布衣', gradeDesc: '白色', quantity: 1 }]);
    expect(seeded).toBe(true);
    expect(itemCoreQ()[itemSig('布衣', '白色')]).toBe(1);
    expect(seedItemsIfEmpty([{ name: '别的', gradeDesc: '白色', quantity: 9 }])).toBe(false);   // 已非空 → 不再播种
  });

  it('itemDiagnostics：漂移 + 不变量一次性', () => {
    itemCreate('铁剑', '蓝色', 1);
    const d = itemDiagnostics([{ name: '铁剑', gradeDesc: '蓝色', quantity: 3 }]);
    expect(d.ok).toBe(false);
    expect(d.drift[0]).toMatchObject({ core: 1, live: 3 });
  });

  it('不变量：正常态无违规', () => {
    itemCreate('铁剑', '蓝色', 2);
    expect(itemCoreWatchdog()).toEqual([]);
  });

  it('★快照往返（读档）：状态与幂等窗口都恢复', () => {
    itemCreate('圣剑', '金色', 1, { id: 'unique-holy' });
    const snap = JSON.parse(JSON.stringify(itemCoreSnapshot()));
    itemCoreReset();
    expect(itemCoreQ()[itemSig('圣剑', '金色')]).toBeUndefined();
    itemCoreRestore(snap);
    expect(itemCoreQ()[itemSig('圣剑', '金色')]).toBe(1);
    itemCreate('圣剑', '金色', 1, { id: 'unique-holy' });   // 恢复后同 id 仍被幂等拦（seen 也恢复了）
    expect(itemCoreQ()[itemSig('圣剑', '金色')]).toBe(1);
  });

  it('seed 整体重置基线', () => {
    itemCreate('旧物', '白色', 5);
    itemSeed({ [itemSig('新物', '蓝色')]: 3 });
    expect(itemCoreQ()[itemSig('旧物', '白色')]).toBeUndefined();
    expect(itemCoreQ()[itemSig('新物', '蓝色')]).toBe(3);
  });
});

describe('物品 facade 闸门 commitItems（id 键去重·结构根除重复 id）', () => {
  it('★两条同 id → 塌成一条（留首条）+ 计数', () => {
    const r = commitItems([
      { id: 'W1', name: '寒铁剑', quantity: 1 },
      { id: 'W1', name: '寒铁剑复制', quantity: 1 },   // 同 id 双计
      { id: 'W2', name: '匕首', quantity: 1 },
    ], 'test');
    expect(r.collapsed).toBe(1);
    expect(r.items.map((it) => it.id)).toEqual(['W1', 'W2']);
    expect(r.items.find((it) => it.id === 'W1').name).toBe('寒铁剑');   // 留首条
  });

  it('无重复 id → 原样返回、不塌缩', () => {
    const r = commitItems([{ id: 'A', name: '甲' }, { id: 'B', name: '乙' }], 'test');
    expect(r.collapsed).toBe(0);
    expect(r.items.length).toBe(2);
  });

  it('无 id 的条目原样保留（不发明数据）', () => {
    const r = commitItems([{ name: '无id物' }, { id: 'A', name: '甲' }], 'test');
    expect(r.collapsed).toBe(0);
    expect(r.items.length).toBe(2);
  });

  it('★塌缩记进审计日志（供追溯是哪个源造的重复）', () => {
    commitItems([{ id: 'X', name: '原件' }, { id: 'X', name: '重复件' }], '登场判断');
    const log = itemCollapseLog();
    const rec = log.find((l) => l.id === 'X');
    expect(rec).toMatchObject({ id: 'X', kept: '原件', dropped: '重复件', source: '登场判断' });
  });
});
