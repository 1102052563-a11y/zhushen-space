import { describe, it, expect } from 'vitest';
import { decideNpcTick, runNpcAutonomy, homeParadise, addRelation, findRival, boundedGrowth, powerOf, arenaWinProb, profKey } from './npcAutonomy';
import { makeRng, getCorpus, pickDeed } from './autonomyCorpus';
import { defaultNpcRecord, useNpc, type NpcRecord } from '../store/npcStore';
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

describe('npcAutonomy · war/试炼做深 · HP重算', () => {
  it('HP/EP 随六维重算：涨六维则 maxHp=体×20、maxMp=智×15（只抬上限）', () => {
    const n = npc({ realm: '五阶·Lv.50', attrs: { str: 30, agi: 30, con: 30, int: 30, cha: 30, luck: 30 } });
    const g = boundedGrowth(n, makeRng(7), { attrGain: 6 });
    expect(g.attrs).toBeTruthy();
    expect(g.maxHp).toBe((g.attrs!.con ?? 0) * 20);
    expect(g.maxMp).toBe((g.attrs!.int ?? 0) * 15);
  });

  it('war 战利品：世界争夺战胜归至少产出一件满耐久装备', () => {
    const strong = npc({ realm: '九阶·Lv.90', bioStrength: 'T9·至强', auto: { phase: 'mission', turns: 1, world: '世界争夺战' } });
    let spoils = 0;
    for (let t = 1; t <= 200; t++) {
      const out = decideNpcTick(strong, t);
      if (out.grant?.equip) {
        spoils++;
        expect(out.grant.equip.name).toBeTruthy();
        expect(out.grant.equip.durability).toBe('100/100');
        expect(out.deed?.description).toBeTruthy();
      }
    }
    expect(spoils).toBeGreaterThan(0);
  });

  it('试炼晋阶：七阶强者多次通过试炼，偶尔阶位晋升至八阶（一次只晋一阶）', () => {
    const n = npc({ realm: '七阶·Lv.70', bioStrength: 'T7·绝强', auto: { phase: 'mission', turns: 1, world: '试炼世界' } });
    let promo = 0;
    for (let t = 1; t <= 400; t++) {
      const out = decideNpcTick(n, t);
      if (out.patch?.realm && /八阶/.test(out.patch.realm)) {
        promo++;
        expect(out.patch.realm).not.toMatch(/九阶/);
        expect(out.deed?.description).toMatch(/八阶/);   // 晋阶经历点名新阶位
      }
    }
    expect(promo).toBeGreaterThan(0);
  });

  it('试炼晋阶封顶：九阶通过试炼也绝不越过九阶', () => {
    const n = npc({ realm: '九阶·Lv.90', bioStrength: 'T9·至强', auto: { phase: 'mission', turns: 1, world: '试炼世界' } });
    for (let t = 1; t <= 300; t++) {
      const r = decideNpcTick(n, t).patch?.realm;
      if (r) expect(r).toMatch(/九阶/);
    }
  });
});

describe('npcAutonomy · 土著成长 & 陨落', () => {
  function native(patch: Partial<NpcRecord>): NpcRecord {
    return {
      ...defaultNpcRecord('C7'), name: '阿木', npcTag: '土著', personality: '老实本分', onScene: false,
      attrs: { str: 25, agi: 18, con: 20, int: 16, cha: 14, luck: 12 }, ...patch,
    };
  }

  it('土著成长：苦练/扬名中六维微涨，封顶自身峰值且同步重算 HP/EP', () => {
    let grew = 0;
    for (let t = 1; t <= 200; t++) {
      const out = decideNpcTick(native({}), t, ['二柱', '王婶'], { allowDeath: false });
      const a = out.patch?.attrs;
      if (a) {
        grew++;
        expect(a.str ?? 0).toBeLessThanOrEqual(25);   // 不越既定峰值
        expect(a.con ?? 0).toBeLessThanOrEqual(25);
        expect(a.int ?? 0).toBeLessThanOrEqual(25);
        if (a.con) expect(out.patch?.maxHp).toBe(a.con * 20);
        if (a.int) expect(out.patch?.maxMp).toBe(a.int * 15);
      }
    }
    expect(grew).toBeGreaterThan(0);
  });

  it('土著陨落：开关关绝不死；开关开非保护偶殒命（带故土经历）；好友永不死', () => {
    for (let t = 1; t <= 300; t++) expect(decideNpcTick(native({}), t, ['二柱'], { allowDeath: false }).patch?.isDead).toBeFalsy();
    let deaths = 0;
    for (let t = 1; t <= 3000; t++) {
      const out = decideNpcTick(native({}), t, ['二柱'], { allowDeath: true });
      if (out.patch?.isDead) { deaths++; expect(out.deed?.location).toBe('故土'); expect(out.deed?.description).not.toMatch(/\{/); }
    }
    expect(deaths).toBeGreaterThan(0);
    for (let t = 1; t <= 3000; t++) expect(decideNpcTick(native({ isFriend: true }), t, ['二柱'], { allowDeath: true }).patch?.isDead).toBeFalsy();
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
    expect(profKey(npc({ profession: '刀客' }))).toBe('刀客');         // 新增·不被"刀"误判成剑士
    expect(profKey(npc({ profession: '毒师' }))).toBe('毒师');         // 新增·不被"丹/药"误判成炼丹师
    expect(profKey(npc({ profession: '幻术师' }))).toBe('幻术师');     // 新增·不被"术"误判成术士/法师
    expect(profKey(npc({ profession: '蛊师' }))).toBe('蛊师');         // 新增
    expect(profKey(npc({ profession: '死亡骑士' }))).toBe('死亡骑士'); // 西方·"亡灵骑士"不被死灵法师吞、"骑士"不归重装
    expect(profKey(npc({ profession: '亡灵骑士' }))).toBe('死亡骑士'); // 须排在死灵法师前
    expect(profKey(npc({ profession: '猎魔人' }))).toBe('猎魔人');     // 西方·"魔"不误判成法师
    expect(profKey(npc({ profession: '审判官' }))).toBe('审判官');     // 西方·不误判成圣骑士
    expect(profKey(npc({ profession: '刀' }))).toBe('剑士');           // 泛"刀"仍归剑士(刀客只认刀客/刀法等)
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

describe('npcAutonomy · 真获得装备/技能/天赋（写进面板）', () => {
  it('偶尔产出可写进面板的装备/技能/天赋，且带必需字段', () => {
    let gotEquip = false, gotSkill = false, gotTalent = false;
    const n = npc({ profession: '剑客' });
    for (let t = 1; t <= 1000; t++) {
      const g = decideNpcTick(n, t, []).grant;
      if (g?.equip) { gotEquip = true; expect(g.equip.name).toBeTruthy(); expect(g.equip.category).toBeTruthy(); expect(g.equip.id).toMatch(/^I_/); }
      if (g?.skill) { gotSkill = true; expect(g.skill.name).toBeTruthy(); expect(g.skill.id).toMatch(/^S_/); }
      if (g?.talent) { gotTalent = true; expect(g.talent.name).toBeTruthy(); expect(g.talent.rarity).toBeTruthy(); }
    }
    expect(gotEquip).toBe(true);
    expect(gotSkill).toBe(true);
    expect(gotTalent).toBe(true);
  });
  it('装备损坏：有已装备物品时偶尔损坏（itemPatch 标 0 耐久并卸下）', () => {
    const n = npc({ items: [{ id: 'I_C1_w', name: '裂空细剑', category: '武器', gradeDesc: '稀有', effect: '加成', quantity: 1, equipped: true, durability: '100/100', addedAt: 0 }] });
    let broke = false;
    for (let t = 1; t <= 1200; t++) {
      const ip = decideNpcTick(n, t, []).itemPatch;
      if (ip?.patch.durability === '0/100' && ip.patch.equipped === false) broke = true;
    }
    expect(broke).toBe(true);
  });
  it('修复：有损坏装备时 repair 复原耐久并重新装备', () => {
    const n = npc({ items: [{ id: 'I_C1_d', name: '裂空细剑', category: '武器', gradeDesc: '稀有', effect: '加成【已损坏】', quantity: 1, equipped: false, durability: '0/100', addedAt: 0 }] });
    let repaired = false;
    for (let t = 1; t <= 1200; t++) {
      const ip = decideNpcTick(n, t, []).itemPatch;
      if (ip?.patch.durability === '100/100' && ip.patch.equipped === true) repaired = true;
    }
    expect(repaired).toBe(true);
  });
});

describe('npcAutonomy · runNpcAutonomy（开关守卫）', () => {
  it('开关关闭时不动任何 NPC（返回 0）', () => {
    useSettings.getState().setNpcAutonomyOn(false);
    expect(runNpcAutonomy(1)).toBe(0);
  });
  it('每 N 回合一次：非整除回合不运行（返回 0），人数上限生效', () => {
    useNpc.getState().clearAll();
    for (let i = 1; i <= 8; i++) useNpc.getState().upsertNpc(`C${i}`, { name: `甲${i}`, personality: '功利精明', realm: '三阶·Lv.25', onScene: false, bioStrength: 'T3·勇士' });
    useSettings.getState().setNpcAutonomyOn(true);
    useSettings.getState().setNpcAutonomyEvery(5);
    expect(runNpcAutonomy(1)).toBe(0);   // 1%5≠0 不运行
    expect(runNpcAutonomy(2)).toBe(0);
    expect(runNpcAutonomy(4)).toBe(0);
    // 人数上限：每次≤设定值
    useSettings.getState().setNpcAutonomyEvery(1);
    useSettings.getState().setNpcAutonomyMax(2);
    expect(runNpcAutonomy(10)).toBeLessThanOrEqual(2);
    useSettings.getState().setNpcAutonomyMax(16);
    useSettings.getState().setNpcAutonomyOn(false);
    useNpc.getState().clearAll();
  });
});
