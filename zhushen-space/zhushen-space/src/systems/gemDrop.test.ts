import { describe, it, expect } from 'vitest';
import { hasHighTierKill, gemDropGrade, rollGemDrops, GEM_DROP_DEFAULT } from './gemDrop';

describe('hasHighTierKill（只认"击杀强敌"·弱敌/无关叙述不算）', () => {
  it('击杀动词近旁有强敌词 → 真', () => {
    expect(hasHighTierKill('你一剑斩杀了那头盘踞已久的魔王。')).toBe(true);
    expect(hasHighTierKill('诛杀了名震一方的妖王。')).toBe(true);
    expect(hasHighTierKill('你击杀了那名精英统领。')).toBe(true);
  });
  it('弱敌（游魂/杂鱼等）击杀 → 假', () => {
    expect(hasHighTierKill('你随手斩杀了一个游魂。')).toBe(false);
    expect(hasHighTierKill('击杀了几只杂鱼喽啰。')).toBe(false);
  });
  it('无关叙述里出现击杀字样（开门/尸体）→ 假（治"开门都会爆"）', () => {
    expect(hasHighTierKill('你推开房门，屋内散落着几具早已被斩杀的尸体。')).toBe(false);
    expect(hasHighTierKill('你打开宝箱，里面是一卷记载着诛杀之术的秘籍。')).toBe(false);
  });
  it('<击杀结算> 块里"越阶"击杀 → 真；"碾压"弱敌 → 假', () => {
    expect(hasHighTierKill('<击杀结算>\n头\n魔将|越阶|主角+1\n</击杀结算>')).toBe(true);
    expect(hasHighTierKill('<击杀结算>\n头\n游魂|碾压|主角+1\n</击杀结算>')).toBe(false);
  });
  it('主角自身被击杀 → 假', () => {
    expect(hasHighTierKill('主角被那魔王一击击杀，当场身亡。')).toBe(false);
  });
  it('强敌在场但杀的是近旁的弱敌 → 假', () => {
    expect(hasHighTierKill('魔王冷眼旁观，你只是斩杀了他脚边的一只游魂。')).toBe(false);
  });
  it('平静叙述 → 假', () => expect(hasHighTierKill('风和日丽，你在乐园里散步。')).toBe(false));
});

describe('gemDropGrade（品级随主角进度缩放）', () => {
  it('一阶普通掉落 → 白色（rng=0.5，不跳档）', () => expect(gemDropGrade('一阶', 1, () => 0.5)).toBe('白色'));
  it('跳档惊喜（rng<0.12 → +2）', () => expect(gemDropGrade('一阶', 1, () => 0.05)).toBe('蓝色'));
});

describe('rollGemDrops（仅击杀强敌·每回合至多 1 颗）', () => {
  const bossNarr = '你斩杀了那头盘踞多年的魔王。';
  const weakNarr = '你随手斩杀了一个游魂。';
  it('弱敌击杀 → 空（即便 rng=0）', () => {
    expect(rollGemDrops(weakNarr, { tier: '三阶', level: 25, rng: () => 0 })).toEqual([]);
  });
  it('无强敌击杀 → 空', () => {
    expect(rollGemDrops('你打开了乐园的大门。', { tier: '三阶', level: 25, rng: () => 0 })).toEqual([]);
  });
  it('击杀强敌 + rng<rate → 恰 1 颗，标记击杀掉落', () => {
    const drops = rollGemDrops(bossNarr, { tier: '五阶', level: 45, rng: () => 0 });
    expect(drops).toHaveLength(1);
    expect(drops[0].category).toBe('宝石');
    expect(drops[0].acquisition).toBe('击杀掉落');
    expect(drops[0].tags).toContain('掉落');
  });
  it('禁用 → 空', () => {
    expect(rollGemDrops(bossNarr, { tier: '五阶', level: 45, config: { ...GEM_DROP_DEFAULT, enabled: false }, rng: () => 0 })).toEqual([]);
  });
  it('rng≥rate → 空', () => {
    expect(rollGemDrops(bossNarr, { tier: '五阶', level: 45, config: { enabled: true, rate: 0.4, maxPerTurn: 1 }, rng: () => 0.99 })).toEqual([]);
  });
  it('boss 掉率翻倍：rng=0.6 时 boss 掉、普通强敌不掉', () => {
    // boss(魔王) rate=0.4*1.8=0.72 > 0.6 → 掉
    expect(rollGemDrops('斩杀了魔王。', { tier: '五阶', level: 45, config: { enabled: true, rate: 0.4, maxPerTurn: 1 }, rng: () => 0.6 })).toHaveLength(1);
    // 普通强敌(宗师·非boss) rate=0.4 < 0.6 → 不掉
    expect(rollGemDrops('斩杀了那位剑道宗师。', { tier: '五阶', level: 45, config: { enabled: true, rate: 0.4, maxPerTurn: 1 }, rng: () => 0.6 })).toEqual([]);
  });
  it('maxPerTurn 封顶（即便 rate=1）', () => {
    const drops = rollGemDrops(bossNarr, { tier: '五阶', level: 45, config: { enabled: true, rate: 1, maxPerTurn: 1 }, rng: () => 0 });
    expect(drops).toHaveLength(1);
  });
});
