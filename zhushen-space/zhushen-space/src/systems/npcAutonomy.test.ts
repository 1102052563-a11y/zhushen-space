import { describe, it, expect } from 'vitest';
import { decideNpcTick, runNpcAutonomy, homeParadise, addRelation, findRival, boundedGrowth } from './npcAutonomy';
import { makeRng } from './autonomyCorpus';
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

describe('npcAutonomy · runNpcAutonomy（开关守卫）', () => {
  it('开关关闭时不动任何 NPC（返回 0）', () => {
    useSettings.getState().setNpcAutonomyOn(false);
    expect(runNpcAutonomy(1)).toBe(0);
  });
});
