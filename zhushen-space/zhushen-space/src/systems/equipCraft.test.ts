import { describe, it, expect } from 'vitest';
import {
  potentialMax, potentialLeft, isCraftable, canCraft, craftCost, planCraftPayment,
  resolveCraft, craftPatch, scaleCombat, spliceAffix, rollOutcome, affixName, canInfuse,
  sanitizeProcess, expectedValue, riskPricing, isPreviewMode, gradeNumOfEssence,
  BUILTIN_PROCESSES, POT_COST_MAX,
  type CraftProcessDef,
} from './equipCraft';
import type { InventoryItem } from '../store/itemStore';

/* 造一件测试装备（只填工艺相关字段） */
function mkItem(patch: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'I1', name: '测试长剑', category: '武器', effect: '', quantity: 1, equipped: false,
    gradeDesc: '紫色', score: '110', combatStat: '攻击力 100-140',
    affix: '【裂空】：斩击附带 15% 破甲\n【饮血】：击杀回复 5% 生命',
    addedAt: 0, ...patch,
  } as InventoryItem;
}
const forge = BUILTIN_PROCESSES.find((p) => p.id === 'forge')!;
const corrupt = BUILTIN_PROCESSES.find((p) => p.id === 'corrupt')!;

describe('锻造潜力', () => {
  it('潜力上限随品级递增（白色最低、创世最高）', () => {
    expect(potentialMax({ gradeDesc: '白色' })).toBe(8);
    expect(potentialMax({ gradeDesc: '创世' })).toBe(36);
    expect(potentialMax({ gradeDesc: '紫色' })).toBeGreaterThan(potentialMax({ gradeDesc: '蓝色' }));
  });

  it('剩余潜力 = 上限 - 已用，且不为负', () => {
    expect(potentialLeft(mkItem({ craft: { potUsed: 4 } }))).toBe(potentialMax({ gradeDesc: '紫色' }) - 4);
    expect(potentialLeft(mkItem({ craft: { potUsed: 999 } }))).toBe(0);
  });

  it('潜力耗尽 → 封盘，此后该装备再不能锻打', () => {
    const drained = mkItem({ craft: { potUsed: potentialMax({ gradeDesc: '紫色' }) } });
    const r = canCraft(drained, forge);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('潜力不足');
  });

  it('品级进阶抬高潜力上限 → 进阶后重获锻造空间（已用量保留）', () => {
    const before = mkItem({ gradeDesc: '紫色', craft: { potUsed: 14 } });
    const after = mkItem({ gradeDesc: '暗紫色', craft: { potUsed: 14 } });
    expect(potentialLeft(after)).toBeGreaterThan(potentialLeft(before));
  });
});

describe('可行性门禁', () => {
  it('非装备类不可施艺', () => {
    expect(isCraftable(mkItem({ category: '消耗品' }))).toBe(false);
    expect(canCraft(mkItem({ category: '消耗品' }), forge).ok).toBe(false);
  });

  it('腐化后封死一切工艺', () => {
    const c = mkItem({ craft: { corrupted: true } });
    expect(isCraftable(c)).toBe(false);
    expect(canCraft(c, forge).reason).toContain('无法再施加');
  });

  it('品级门槛拦住低品级装备（虚空腐蚀要求蓝色+）', () => {
    expect(canCraft(mkItem({ gradeDesc: '白色' }), corrupt).ok).toBe(false);
    expect(canCraft(mkItem({ gradeDesc: '紫色' }), corrupt).ok).toBe(true);
  });

  it('无词缀装备 + 只会改词缀的工艺 → 不可施艺', () => {
    const onlyRemove: CraftProcessDef = { ...forge, id: 'x', outcomes: [{ kind: 'removeAffix', weight: 1 }] };
    expect(canCraft(mkItem({ affix: '' }), onlyRemove).ok).toBe(false);
    expect(canCraft(mkItem({ affix: '' }), forge).ok).toBe(true);   // 加词缀的工艺不受影响
  });
});

describe('结果结算', () => {
  it('确定性工艺只会出唯一结果，且标记为需要 AI 写词缀', () => {
    const r = resolveCraft(mkItem(), forge);
    expect(r.outcome).toBe('addAffix');
    expect(r.needsAi).toBe(true);
    expect(r.potCost).toBe(forge.potCost);
  });

  it('改词缀类结果会锁定一条现有词缀作为作用对象', () => {
    const r = resolveCraft(mkItem(), corrupt, { rand: () => 0, forcedOutcome: 'upgradeAffix' });
    expect(r.affixIndex).toBe(0);
    expect(r.affixTarget).toContain('裂空');
  });

  it('装备无词缀时，改词缀类结果自动退化（removeAffix→无事、upgradeAffix→加词缀）', () => {
    const bare = mkItem({ affix: '' });
    expect(resolveCraft(bare, corrupt, { forcedOutcome: 'removeAffix' }).outcome).toBe('nothing');
    expect(resolveCraft(bare, corrupt, { forcedOutcome: 'upgradeAffix' }).outcome).toBe('addAffix');
  });

  it('品级已顶格时 gradeUp 退化为无事，已垫底时 gradeDown 退化为无事', () => {
    expect(resolveCraft(mkItem({ gradeDesc: '创世' }), corrupt, { forcedOutcome: 'gradeUp' }).outcome).toBe('nothing');
    expect(resolveCraft(mkItem({ gradeDesc: '白色' }), corrupt, { forcedOutcome: 'gradeDown' }).outcome).toBe('nothing');
  });

  it('没有可缩放的攻防数值时 combatUp 退化为无事', () => {
    expect(resolveCraft(mkItem({ combatStat: '' }), corrupt, { forcedOutcome: 'combatUp' }).outcome).toBe('nothing');
    expect(resolveCraft(mkItem(), corrupt, { forcedOutcome: 'combatUp' }).combatPct).toBeGreaterThan(0);
  });

  it('rollOutcome 按权重分布（权重 0 的结果永不出现）', () => {
    const table = [{ kind: 'gradeUp' as const, weight: 0 }, { kind: 'brick' as const, weight: 10 }];
    for (const r of [0, 0.3, 0.99]) expect(rollOutcome(table, () => r)).toBe('brick');
  });
});

describe('落库补丁', () => {
  it('加词缀 = 追加到末尾，原有词缀一条不动', () => {
    const it = mkItem();
    const res = resolveCraft(it, forge);
    const patch = craftPatch(it, res, '【新生】：受击时回气');
    expect(patch.affix).toContain('裂空');
    expect(patch.affix).toContain('饮血');
    expect(patch.affix).toContain('新生');
  });

  it('升华/重铸 = 就地替换第 N 条，其余不动', () => {
    const it = mkItem();
    const res = resolveCraft(it, corrupt, { rand: () => 0, forcedOutcome: 'upgradeAffix' });
    const patch = craftPatch(it, res, '【裂空·极】：斩击附带 30% 破甲');
    expect(patch.affix).toContain('裂空·极');
    expect(patch.affix).not.toContain('15% 破甲');
    expect(patch.affix).toContain('饮血');
  });

  it('剥落 = 删掉那一条', () => {
    const it = mkItem();
    const res = resolveCraft(it, corrupt, { rand: () => 0, forcedOutcome: 'removeAffix' });
    const patch = craftPatch(it, res);
    expect(patch.affix).not.toContain('裂空');
    expect(patch.affix).toContain('饮血');
  });

  it('品级变动会同步写死评分与 numeric.grade（防被 normalizeGrades 钳回）', () => {
    const it = mkItem();
    const res = resolveCraft(it, corrupt, { forcedOutcome: 'gradeUp' });
    const patch = craftPatch(it, res);
    expect(patch.gradeDesc).toBe('暗紫色');
    expect(Number(patch.score)).toBeGreaterThan(0);
    expect((patch.numeric as any)?.grade).toBe(5);
  });

  it('崩毁会锁死后续一切工艺', () => {
    const it = mkItem();
    const patch = craftPatch(it, resolveCraft(it, corrupt, { forcedOutcome: 'brick' }));
    expect(patch.craft?.corrupted).toBe(true);
    expect(patch.craft?.bricked).toBe(true);
    expect(canCraft({ ...it, ...patch } as InventoryItem, forge).ok).toBe(false);
  });

  it('每次施艺都累加潜力消耗', () => {
    const it = mkItem({ craft: { potUsed: 3 } });
    const patch = craftPatch(it, resolveCraft(it, forge));
    expect(patch.craft?.potUsed).toBe(3 + forge.potCost);
  });

  it('攻防缩放只改数字、保留文案', () => {
    expect(scaleCombat('攻击力 100-140', 20)).toBe('攻击力 120-168');
    expect(scaleCombat('攻击力 100', -20)).toBe('攻击力 80');
    expect(scaleCombat('', 20)).toBe('');
  });

  it('spliceAffix 越界时退化为追加，不丢已有词缀', () => {
    expect(spliceAffix('【A】：x', 9, '【B】：y').split('\n')).toHaveLength(2);
  });
});

describe('精髓', () => {
  it('affixName 抽得出词缀名', () => {
    expect(affixName('【裂空】：斩击附带破甲')).toBe('裂空');
    expect(affixName('无括号的说明')).toBeTruthy();
  });

  it('灌注门槛：高阶精髓灌不进低太多档的装备', () => {
    const highEssence = { gradeNum: 12 };   // 不朽级
    expect(canInfuse(highEssence, { gradeDesc: '不朽级' })).toBe(true);
    expect(canInfuse(highEssence, { gradeDesc: '史诗级' })).toBe(true);    // 差 2 档，恰好允许
    expect(canInfuse(highEssence, { gradeDesc: '传说级' })).toBe(false);   // 差 3 档，拦住
    expect(canInfuse(highEssence, { gradeDesc: '白色' })).toBe(false);
  });

  it('旧存档缺 gradeNum 时从品级文本回推', () => {
    expect(gradeNumOfEssence({ fromGrade: '暗金' })).toBe(8);
    expect(gradeNumOfEssence({ gradeNum: 11, fromGrade: '白色' })).toBe(11);
  });
});

describe('费用', () => {
  it('费用随品级递增，且锚定公允价（不自拍曲线）', () => {
    const cheap = craftCost(forge, { gradeDesc: '白色', category: '武器' });
    const pricey = craftCost(forge, { gradeDesc: '不朽级', category: '武器' });
    expect(pricey).toBeGreaterThan(cheap * 10);
  });

  it('乐园币不足时按汇率动用魂币并找零；钱不够返回 null', () => {
    expect(planCraftPayment(1000, { park: 5000, soul: 0 })).toEqual({ parkDelta: -1000, soulDelta: 0 });
    // 恰好整除：50000 乐园币 + 1 魂币(=150000) 正好付掉 200000，无找零
    expect(planCraftPayment(200000, { park: 50000, soul: 5 })).toEqual({ parkDelta: -50000, soulDelta: -1 });
    // 有找零：没有乐园币、只能兑 1 枚魂币付 60000，多兑的 90000 退回乐园币
    const change = planCraftPayment(60000, { park: 0, soul: 1 });
    expect(change).toEqual({ parkDelta: 90000, soulDelta: -1 });
    expect(planCraftPayment(1e9, { park: 10, soul: 0 })).toBeNull();
  });
});

describe('自创工艺的平衡护栏', () => {
  it('非法 kind 一律降级为 nothing，超界权重被夹', () => {
    const p = sanitizeProcess({ name: 'X', outcomes: [{ kind: 'giveMeGodItem', weight: 999 }] });
    expect(p.outcomes[0].kind).toBe('nothing');
    expect(p.outcomes[0].weight).toBeLessThanOrEqual(100);
  });

  it('同一 kind 写多条会被合并权重（防伪造高概率）', () => {
    const p = sanitizeProcess({ name: 'X', outcomes: [{ kind: 'gradeUp', weight: 5 }, { kind: 'gradeUp', weight: 5 }, { kind: 'brick', weight: 90 }] });
    expect(p.outcomes.filter((o) => o.kind === 'gradeUp')).toHaveLength(1);
    expect(p.outcomes.find((o) => o.kind === 'gradeUp')!.weight).toBe(10);
  });

  it('潜力消耗与费用比例被夹进合法区间（负数/天文数字都无效）', () => {
    const p = sanitizeProcess({ name: 'X', potCost: -50, costRatio: 999, outcomes: [{ kind: 'nothing', weight: 1 }] });
    expect(p.potCost).toBeGreaterThanOrEqual(0);
    expect(p.potCost).toBeLessThanOrEqual(POT_COST_MAX);
    expect(p.costRatio).toBeGreaterThan(0);
  });

  it('「稳赚」工艺被自动加价：净得利越高越贵越费潜力', () => {
    const greedy = sanitizeProcess({ name: '白嫖', potCost: 1, costRatio: 0.02, outcomes: [{ kind: 'gradeUp', weight: 1 }] });
    const fair = sanitizeProcess({ name: '对赌', potCost: 1, costRatio: 0.02, outcomes: [{ kind: 'gradeUp', weight: 1 }, { kind: 'brick', weight: 1 }] });
    expect(greedy.costRatio).toBeGreaterThan(fair.costRatio);
    expect(greedy.potCost).toBeGreaterThanOrEqual(fair.potCost);
    expect(expectedValue(greedy.outcomes)).toBeGreaterThan(expectedValue(fair.outcomes));
  });

  it('纯赌博（负期望）不额外罚价', () => {
    const before = 0.1;
    expect(riskPricing(-3, 4, before).costRatio).toBeCloseTo(before, 5);
  });

  it('空结果表兜底成「无事发生」，不会产出无法结算的工艺', () => {
    const p = sanitizeProcess({ name: 'X', outcomes: [] });
    expect(p.outcomes).toEqual([{ kind: 'nothing', weight: 1 }]);
    expect(isPreviewMode(p)).toBe(true);
  });

  it('自创工艺一律非内置（不会伪装成系统工艺、也就不会被恢复默认覆盖）', () => {
    expect(sanitizeProcess({ name: 'X', builtin: true }).builtin).toBe(false);
  });

  it('内置三工艺自身参数合法：确定性工艺单结果、腐化是多结果赌局', () => {
    expect(isPreviewMode(forge)).toBe(true);
    expect(isPreviewMode(corrupt)).toBe(false);
    expect(corrupt.potCost).toBe(0);   // 腐化在潜力体系之外
    for (const p of BUILTIN_PROCESSES) {
      expect(p.outcomes.length).toBeGreaterThan(0);
      expect(p.potCost).toBeLessThanOrEqual(POT_COST_MAX);
    }
  });
});
