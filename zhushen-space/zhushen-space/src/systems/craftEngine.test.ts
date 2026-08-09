import { describe, it, expect } from 'vitest';
import {
  craftMode, rollCraftQuality, craftCost, craftOutputSlots, perfectChance,
  inputMaxGrade, type CraftInput,
} from './craftEngine';
import { gradeMidPark } from './itemPricing';
import { ITEM_GRADES, clampAffixEntries, maxAffixEntriesFor } from '../store/itemStore';

const inp = (gradeDesc: string, qty = 1, name = '材料'): CraftInput =>
  ({ itemId: `i_${name}_${gradeDesc}`, name, qty, gradeDesc });

describe('perfectChance：完美(+1档)概率随投入档递减、传说级+ 封墙（治"叠叠乐"逐档爬到传说）', () => {
  it('低档全额、高档收紧：白色 10% > 紫色 8% > 淡金 5% > 暗金 2%', () => {
    expect(perfectChance(1, 0)).toBeCloseTo(0.10);
    expect(perfectChance(4, 0)).toBeCloseTo(0.08);
    expect(perfectChance(6, 0)).toBeCloseTo(0.05);
    expect(perfectChance(8, 0)).toBeCloseTo(0.02);
  });
  it('★ 传说级及以上：完美概率恒为 0（合成工坊不产神，升档只能走强化所进阶/正文）', () => {
    for (let base = 9; base <= 15; base++) {
      expect(perfectChance(base, 0)).toBe(0);
      expect(perfectChance(base, 0.22)).toBe(0);   // 契合加成也顶不开这堵墙
    }
  });
  it('★ 契合加成对完美档打折：暗金起完全无效（堆 30 件垃圾刷不出三成上档率）', () => {
    expect(perfectChance(1, 0.22)).toBeCloseTo(0.32);    // 低档：全额
    expect(perfectChance(4, 0.22)).toBeCloseTo(0.19);    // 紫档：减半
    expect(perfectChance(8, 0.22)).toBeCloseTo(0.02);    // 暗金：加成归零
  });
});

describe('rollCraftQuality：产出上限守恒（rng 注入测试）', () => {
  const fuse = craftMode('fuse');
  it('暗金投料 + 必中完美(rng→0) → 上限传说级（仍允许暗金→传说这最后一跳，只是概率 2%）', () => {
    const q = rollCraftQuality([inp('暗金'), inp('白色')], fuse, () => 0);
    expect(q.tier).toBe('perfect');
    expect(q.ceilingGrade).toBe(9);
  });
  it('★ 传说级投料：rng→0 也出不了完美，上限＝投入档（横向重塑可以、抬档绝不）', () => {
    for (const rng of [0, 0.3, 0.6]) {
      const q = rollCraftQuality([inp('传说级'), inp('白色', 30)], fuse, () => rng);
      expect(q.tier === 'perfect').toBe(false);
      expect(q.ceilingGrade).toBeLessThanOrEqual(9);
    }
  });
  it('失败档（rng→0.99）：上限白色、词缀预算 0', () => {
    const q = rollCraftQuality([inp('暗金'), inp('暗金')], fuse, () => 0.99);
    expect(q.tier).toBe('fail');
    expect(q.ceilingGrade).toBe(1);
    expect(q.affixBudget).toBe(0);
  });
  it('词缀预算封顶 4 条', () => {
    const q = rollCraftQuality([inp('创世'), inp('创世')], fuse, () => 0.5);
    expect(q.affixBudget).toBeLessThanOrEqual(4);
  });
});

describe('craftCost 锚定公允价表（堵「合成升档比强化所进阶便宜三个量级」的套利黑洞）', () => {
  it('★ 高档手工费 = 投入档公允价中位 × 1.5%：暗金 3 万、传说 12 万+（旧曲线仅 8 千/1.4 万）', () => {
    expect(craftCost([inp('暗金')])).toBe(Math.round(gradeMidPark(8) * 0.015));
    expect(craftCost([inp('暗金')])).toBeGreaterThanOrEqual(30_000);
    expect(craftCost([inp('传说级')])).toBeGreaterThanOrEqual(100_000);
  });
  it('★ 期望套利平衡：暗金重骰到完美(2%)的期望总开销与强化所进阶同量级（都是百万级）', () => {
    const evClimb = craftCost([inp('暗金')]) / perfectChance(8, 0);
    expect(evClimb).toBeGreaterThan(1_000_000);
  });
  it('低档仍走轻曲线，玩家日常合成无感（白色 200、蓝色几百）', () => {
    expect(craftCost([inp('白色')])).toBe(200);
    expect(craftCost([inp('蓝色')])).toBeLessThan(1_000);
  });
  it('逐档递增；系数 0 = 免费', () => {
    for (let g = 2; g <= 15; g++) {
      expect(craftCost([inp(ITEM_GRADES[g - 1])])).toBeGreaterThan(craftCost([inp(ITEM_GRADES[g - 2])]));
    }
    expect(craftCost([inp('创世')], 0)).toBe(0);
  });
});

describe('craftOutputSlots：分解绝不越级（守 outHint「品级不超过被拆物」）', () => {
  const salvage = craftMode('salvage');
  it('★ 完美档拆暗金：回收材料仍是暗金（旧逻辑会拆出传说级材料），改为多回收一份', () => {
    const qPerfect = rollCraftQuality([inp('暗金', 1, '暗金剑')], salvage, () => 0);
    expect(qPerfect.tier).toBe('perfect');
    const slots = craftOutputSlots(salvage, qPerfect);
    for (const s of slots) expect(s.gradeDesc).toBe('暗金');
    const qSuccess = rollCraftQuality([inp('暗金', 1, '暗金剑')], salvage, () => 0.5);
    expect(slots.length).toBe(craftOutputSlots(salvage, qSuccess).length + 1);
  });
});

describe('词缀条数硬夹取（治「叠叠乐词缀墙 ≥7 条、物品卡截断」）', () => {
  const wall = ['【幸运暴击】：A', '【天音无歌】：B', '【波纹传导】：C', '【学纹L】：D', '【学纹P】：E', '【因果偏析】：F', '【命运青睐】：G'].join('');
  it('clampAffixEntries：7 条夹到上限、不足上限原样返回、空值透传', () => {
    expect(clampAffixEntries(wall, 4)!.match(/【/g)!.length).toBe(4);
    expect(clampAffixEntries('【独门】：唯一一条', 4)).toBe('【独门】：唯一一条');
    expect(clampAffixEntries('', 4)).toBeUndefined();
    expect(clampAffixEntries(wall, 0)).toBeUndefined();
  });
  it('★ maxAffixEntriesFor：封顶 6 条（玩家实测 <7 条才显示得全）', () => {
    expect(maxAffixEntriesFor(8)).toBe(4);    // 暗金
    expect(maxAffixEntriesFor(9)).toBe(5);    // 传说
    expect(maxAffixEntriesFor(15)).toBe(6);   // 创世也不越显示红线
    for (let g = 1; g <= 15; g++) expect(maxAffixEntriesFor(g)).toBeLessThan(7);
  });
});

describe('inputMaxGrade：品级识别', () => {
  it('取投入最高档；未标品级为 0', () => {
    expect(inputMaxGrade([inp('紫色'), inp('暗金'), { itemId: 'x', name: '无品级', qty: 1 }])).toBe(8);
    expect(inputMaxGrade([{ itemId: 'x', name: '无品级', qty: 1 }])).toBe(0);
  });
});
