import { describe, it, expect } from 'vitest';
import { decideNpcTick, runNpcAutonomy, homeParadise, addRelation, findRival, boundedGrowth, powerOf, arenaWinProb, profKey } from './npcAutonomy';
import { makeRng, getCorpus, pickDeed } from './autonomyCorpus';
import { defaultNpcRecord, type NpcRecord } from '../store/npcStore';
import { useSettings } from '../store/settingsStore';

function npc(patch: Partial<NpcRecord>): NpcRecord {
  return {
    ...defaultNpcRecord('C1'),
    name: '凌薇', personality: '冷静谨慎', realm: 'B阶·Lv.7', onScene: false,
    ...patch,
  };
}

describe('npcAutonomy · decideNpcTick（纯函数·确定性）', () => {
  it('同 NPC 同回合结果可复现', () => {
    const n = npc({});
    const a = decideNpcTick(n, 10);
    const b = decideNpcTick(n, 10);
    expect(a.deed?.description).toBe(b.deed?.description);
    expect(a.patch?.auto).toEqual(b.patch?.auto);
  });

  it('任务世界相·未到期：只递减回合、不刷经历', () => {
    const n = npc({ auto: { phase: 'mission', turns: 3, world: '丧尸围城' } });
    const out = decideNpcTick(n, 5);
    expect(out.deed).toBeUndefined();
    expect(out.patch?.auto).toEqual({ phase: 'mission', turns: 2, world: '丧尸围城' });
    expect(out.patch?.status).toContain('执行任务中');
  });

  it('任务世界相·到期：出「归来」经历并切回主神空间', () => {
    const n = npc({ auto: { phase: 'mission', turns: 1, world: '永夜监狱' } });
    const out = decideNpcTick(n, 6);
    expect(out.deed?.description).toBeTruthy();
    expect(out.patch?.auto?.phase).toBe('hub');
    expect(out.deed?.description).not.toMatch(/\{/);
  });

  it('主神空间相：跨多回合既会出任务也会留守（非千篇一律）', () => {
    const n = npc({ personality: '好斗嗜杀' });
    let toMission = 0, stayed = 0;
    for (let t = 1; t <= 80; t++) {
      const out = decideNpcTick(n, t); // auto 始终 undefined → 每次独立从 hub 决策
      if (out.patch?.auto?.phase === 'mission') toMission++; else stayed++;
    }
    expect(toMission).toBeGreaterThan(0);
    expect(stayed).toBeGreaterThan(0);
  });

  it('生成的经历不残留占位符', () => {
    for (let t = 1; t <= 60; t++) {
      const out = decideNpcTick(npc({}), t, ['周岩', '陈默']);
      if (out.deed) expect(out.deed.description).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it('契约者归属乐园取自七乐园库且稳定可复现', () => {
    const SEVEN = ['轮回乐园', '曙光乐园', '死亡乐园', '圣域乐园', '守望乐园', '圣光乐园', '天启乐园'];
    for (const id of ['C1', 'C2', 'C9', 'G3', 'C17', 'C88']) {
      expect(SEVEN).toContain(homeParadise(id));
      expect(homeParadise(id)).toBe(homeParadise(id));
    }
  });
});

describe('npcAutonomy · 土著本地生活分支', () => {
  function native(patch: Partial<NpcRecord>): NpcRecord {
    return { ...defaultNpcRecord('C7'), name: '阿木', npcTag: '土著', personality: '老实本分', onScene: false, ...patch };
  }

  it('土著永不进任务世界相（不参与主神空间循环）', () => {
    const n = native({});
    for (let t = 1; t <= 80; t++) {
      expect(decideNpcTick(n, t, ['二柱', '王婶']).patch?.auto?.phase).not.toBe('mission');
    }
  });

  it('土著经历绝不泄露乐园术语，且无残留占位符', () => {
    const FORBIDDEN = /乐园|契约者|主神空间|任务世界|乐园币|魂币|阶位|竞技场|世界之源|烙印|强化大厅/;
    let got = 0;
    for (let t = 1; t <= 120; t++) {
      const out = decideNpcTick(native({}), t, ['二柱', '王婶']);
      if (out.deed) {
        got++;
        expect(out.deed.description).not.toMatch(FORBIDDEN);
        expect(out.deed.description).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
    expect(got).toBeGreaterThan(0);
  });

  it('土著结果可复现', () => {
    const n = native({});
    expect(decideNpcTick(n, 9, ['二柱']).deed?.description).toBe(decideNpcTick(n, 9, ['二柱']).deed?.description);
  });
});

describe('npcAutonomy · 关系网（档A）', () => {
  it('addRelation 追加并按名去重', () => {
    expect(addRelation('', '周岩', '宿敌')).toBe('周岩:宿敌');
    expect(addRelation('周岩:盟友', '周岩', '宿敌')).toBe('周岩:宿敌');                  // 同名覆盖
    expect(addRelation('陈默:盟友', '周岩', '宿敌')).toBe('陈默:盟友;周岩:宿敌');        // 不同名追加
    expect(addRelation('陈默:盟友;周岩:盟友', '周岩', '宿敌')).toBe('陈默:盟友;周岩:宿敌'); // 多条中覆盖一条
  });
  it('findRival 找出 relations 里仍在场的宿敌', () => {
    expect(findRival(npc({ relations: '周岩:宿敌;陈默:盟友' }), ['陈默', '周岩'])).toBe('周岩');
    expect(findRival(npc({ relations: '' }), ['周岩'])).toBeUndefined();
    expect(findRival(npc({ relations: '周岩:宿敌' }), ['陈默'])).toBeUndefined();        // 宿敌不在场
  });
});

describe('npcAutonomy · 档内有界成长 & 陨落（档B）', () => {
  it('boundedGrowth：六维按档封顶、等级不越阶', () => {
    const n = npc({ realm: '五阶·Lv.50', attrs: { str: 319, agi: 319, con: 319, int: 319, cha: 319, luck: 50 } });
    const g = boundedGrowth(n, makeRng(123), { levelUp: true, attrGain: 5 });
    if (g.realm) expect(g.realm).toContain('Lv.50');   // 已在五阶顶，不越阶
    if (g.attrs) {
      expect(g.attrs.str).toBeLessThanOrEqual(320);     // 五阶单属性上限 320
      expect(g.attrs.con).toBeLessThanOrEqual(320);
    }
  });
  it('boundedGrowth：阶中可升级（四阶 Lv.35 → Lv.36）', () => {
    const g = boundedGrowth(npc({ realm: '四阶·Lv.35' }), makeRng(1), { levelUp: true });
    expect(g.realm).toContain('Lv.36');
  });
  it('陨落：致死开关关时绝不死', () => {
    const dying = npc({ bioStrength: 'T0·杂鱼', auto: { phase: 'mission', turns: 1, world: '丧尸围城' } });
    for (let t = 1; t <= 200; t++) expect(decideNpcTick(dying, t, [], { allowDeath: false }).patch?.isDead).toBeFalsy();
  });
  it('陨落：开关开时低阶非保护会死、好友永不死', () => {
    const weak = npc({ bioStrength: 'T0·杂鱼', auto: { phase: 'mission', turns: 1, world: '丧尸围城' } });
    let deaths = 0;
    for (let t = 1; t <= 200; t++) if (decideNpcTick(weak, t, [], { allowDeath: true }).patch?.isDead) deaths++;
    expect(deaths).toBeGreaterThan(0);
    const friend = npc({ bioStrength: 'T0·杂鱼', isFriend: true, auto: { phase: 'mission', turns: 1, world: '丧尸围城' } });
    for (let t = 1; t <= 200; t++) expect(decideNpcTick(friend, t, [], { allowDeath: true }).patch?.isDead).toBeFalsy();
  });
});

describe('npcAutonomy · 竞技场战力加权（档C）', () => {
  it('arenaWinProb：高战力胜率远高于低战力、同档五五开', () => {
    expect(arenaWinProb(7, 4)).toBeGreaterThan(0.8);   // 七阶水准打四阶水准
    expect(arenaWinProb(1, 4)).toBeLessThan(0.2);       // 一阶打四阶水准，难赢
    expect(arenaWinProb(5, 5)).toBeCloseTo(0.5, 5);
  });
  it('powerOf：取阶位与 bioStrength 档的较高者', () => {
    expect(powerOf(npc({ realm: '七阶·Lv.65', bioStrength: 'T3·勇士' }))).toBe(7);
    expect(powerOf(npc({ realm: '一阶·Lv.5', bioStrength: 'T6·强者' }))).toBe(6);
  });
});

describe('npcAutonomy · 装备库 / 技能天赋库', () => {
  it('按职业细分：剑士强化出剑类装备、兑换出剑类技能/天赋（前缀×词根组合）', () => {
    const b = getCorpus().banks;
    const sword = b.profGear?.['剑士'];
    expect((b.gearPrefix ?? []).length).toBeGreaterThan(10);
    expect((sword?.weapon ?? []).length).toBeGreaterThan(5);
    const distinctSkill = (sword?.skill ?? []).filter((s) => s.length >= 2); // 多字招式(剑意/剑域…)，不与"斩落"等误撞
    let hitW = false, hitS = false;
    const n = npc({ profession: '剑客' }); // → 剑士
    for (let t = 1; t <= 400; t++) {
      const d = decideNpcTick(n, t, []).deed?.description ?? '';
      if ((sword?.weapon ?? []).some((w) => d.includes(w))) hitW = true;
      if (distinctSkill.some((s) => d.includes(s)) || (sword?.talent ?? []).some((s) => d.includes(s))) hitS = true;
    }
    expect(hitW).toBe(true);   // 强化/交易出现剑士武器词根
    expect(hitS).toBe(true);   // 兑换出现剑士招式/天赋
  });

  it('职业分类：含通用字的细分职业不被误判（细分优先排序）', () => {
    expect(profKey(npc({ profession: '死灵法师' }))).toBe('死灵法师'); // 不被"法"误判成法师
    expect(profKey(npc({ profession: '阵法师' }))).toBe('阵法师');
    expect(profKey(npc({ profession: '圣骑士' }))).toBe('圣骑士');     // 不被"骑士"误判成重装
    expect(profKey(npc({ profession: '狂战士' }))).toBe('狂战士');     // 不被"战士"误判成重装
    expect(profKey(npc({ profession: '御兽师' }))).toBe('御兽师');     // 不被误判成召唤师
    expect(profKey(npc({ profession: '吟游诗人' }))).toBe('吟游诗人');
    expect(profKey(npc({ profession: '魔剑士' }))).toBe('魔剑士');     // 不被"剑/魔"误判成剑士/法师
    expect(profKey(npc({ profession: '火元素使' }))).toBe('元素使');   // 不被"元素"误判成法师
    expect(profKey(npc({ profession: '暗影术士' }))).toBe('术士');     // 不被"术"误判成法师
    expect(profKey(npc({ profession: '龙骑士' }))).toBe('龙骑士');     // 不被"骑士"误判成重装
    expect(profKey(npc({ profession: '剑客' }))).toBe('剑士');         // 通用职业仍正常
    expect(profKey(npc({ profession: '路人甲' }))).toBe('通用');       // 无命中回退
  });
});

describe('npcAutonomy · 新增行为事件（v11）', () => {
  it('7 契约者 + 5 土著新事件齐备且可填充', () => {
    const ev = getCorpus().events;
    for (const k of ['socialize', 'joy', 'black_market', 'mentor', 'inner_demon', 'encounter_violator', 'windfall',
      'native_craft', 'native_worship', 'native_hunt', 'native_journey', 'native_legend']) {
      expect(ev[k]?.length ?? 0, k).toBeGreaterThan(0);
    }
    expect(pickDeed('joy', { name: '凌薇', personality: '享乐' }, 1)).toContain('凌薇');
    expect(pickDeed('native_worship', { name: '阿木' }, 1)).toContain('阿木');
  });
  it('新契约者行为会被触发（社交/欢愉宫/黑市/心魔/奇遇 多种现身）', () => {
    const NEW = ['结识', '攀谈', '小聚', '欢愉宫', '寻欢', '黑市', '虚空商会', '黑渊', '拜入', '徒弟', '讨教', '心魔', '梦魇', '违规者', '横财', '奇遇', '捡漏', '机缘'];
    const seen = new Set<string>();
    const n = npc({ personality: '享乐放纵' });
    for (let t = 1; t <= 400; t++) {
      const d = decideNpcTick(n, t, ['周岩']).deed?.description ?? '';
      for (const w of NEW) if (d.includes(w)) seen.add(w);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('npcAutonomy · runNpcAutonomy（开关守卫）', () => {
  it('开关关闭时不动任何 NPC（返回 0）', () => {
    useSettings.getState().setNpcAutonomyOn(false);
    expect(runNpcAutonomy(1)).toBe(0);
  });
});
