import { describe, it, expect } from 'vitest';
import { generateRaidLoot, generateRaidReward } from './raidLoot';
import { gradeToNum } from '../store/itemStore';

// 品级守卫：这批副本曾用 DNF 色系「橙色/红色」当品级——ITEM_GRADES 里不存在，gradeToNum 全部
// fallback 成 1（白色），最高难度副本掉的装备按白装定价/强化/进阶。此测试锁死"掉落品级必须是
// 真实档位且随难度单调"，防止将来再漂回枚举外。
describe('raidLoot 品级都在 ITEM_GRADES 枚举内', () => {
  it('讨伐掉落：S 档品级必须被 gradeToNum 识别（>1，非白装 fallback）', () => {
    for (const tier of ['C', 'B', 'A', 'S']) {
      const loot = generateRaidLoot(tier, '试验BOSS');
      for (const it2 of loot.items) {
        expect(gradeToNum(it2.gradeDesc), `${tier} 档「${it2.gradeDesc}」不在品级枚举`) .toBeGreaterThan(1);
      }
    }
  });

  it('通关豪华奖励：全部难度的装备/材料/宝箱品级都被识别', () => {
    for (const diff of ['normal', 'hard', 'nightmare', 'abyss']) {
      const r = generateRaidReward('bakal', diff, 0.8);
      for (const it2 of r.items) {
        expect(gradeToNum(it2.gradeDesc), `${diff}「${it2.name}」品级「${it2.gradeDesc}」不在品级枚举`).toBeGreaterThan(1);
      }
    }
  });

  it('品级随难度单调不降（abyss ≥ hard ≥ normal 的装备档）', () => {
    const g = (diff: string) => gradeToNum(generateRaidReward('bakal', diff, 0.8).items[0].gradeDesc);
    expect(g('hard')).toBeGreaterThanOrEqual(g('normal'));
    expect(g('abyss')).toBeGreaterThanOrEqual(g('hard'));
  });
});
