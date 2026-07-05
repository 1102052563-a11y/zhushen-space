import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacters, type Skill, type Talent } from './characterStore';
import { useLoadout } from './loadoutStore';

/* ★铁则：技能/天赋进替补席再拿回来，信息一字不能少（治「塞进领地拿出来词缀全没了」同类）。
   覆盖：单条 bench→activate、批量 apply→unapply、JSON 序列化（bench 持久化到 drpg-loadout）。 */

const richSkill = (): Skill => ({
  id: 'S_B1_07', name: '烈焰斩', level: '大成·Lv.40', cooldown: '2回合',
  desc: '横斩带火', effect: '造成法术伤害并灼烧', layers: '3', layerProgress: '2/3',
  cost: '中', layerEffects: '一层灼烧/二层爆燃/三层地狱火',
  skillType: '主动', rarity: '史诗', target: '单体', damage: '法术攻击200%',
  attrBonus: '力量+5', tags: ['火', '斩杀'], note: '「烈焰吞噬一切。」',
  numeric: {
    kind: 'skill', grade: 3, element: 'fire',
    resCost: { id: '怒气', amount: 20 }, resGate: { id: '怒气', amount: 80 },
    combat: { phases: [{ dmg: 200 }, { dmg: 300 }], flags: { aoe: true, stun: false } } as any,
  },
  addedAt: 1700000000000,
});

const richTalent = (): Talent => ({
  name: '剑心通明', desc: '与剑共鸣', source: '顿悟升华', effect: '暴击+15%、剑技伤害+20%',
  rarity: 'S', category: '技巧类', level: '觉醒·Lv.3', attrBonus: '敏捷+8', note: '「人剑合一。」',
  numeric: { kind: 'talent', rarity: 's', profile: 'crit', extra: { tiers: [1, 2, 3] } } as any,
  addedAt: 1700000000001,
});

const setB1 = (skills: Skill[], traits: Talent[]) =>
  useCharacters.setState({ characters: { B1: { id: 'B1', skills, traits } } });
const b1Skills = () => useCharacters.getState().characters['B1'].skills;
const b1Traits = () => useCharacters.getState().characters['B1'].traits;

beforeEach(() => {
  useLoadout.setState({ builds: [], activeBuildId: null, bench: { skills: [], traits: [] } });
});

describe('替补席：技能信息零丢失（单条 bench → activate）', () => {
  it('技能进替补席=整份对象，回出战区后逐字段 deep-equal（含 numeric/tags/resCost/习得时间）', () => {
    const orig = richSkill();
    setB1([orig], []);
    useLoadout.getState().benchSkill('烈焰斩');
    // 进替补席后：出战区已无、替补席持有完整对象
    expect(b1Skills()).toHaveLength(0);
    expect(useLoadout.getState().bench.skills[0]).toEqual(orig);
    // 拿回来：出战区技能与原始逐字段相等（含 addedAt）
    useLoadout.getState().activateSkill('烈焰斩');
    expect(useLoadout.getState().bench.skills).toHaveLength(0);
    expect(b1Skills()[0]).toEqual(orig);
  });

  it('天赋同理：进替补席再上场逐字段 deep-equal', () => {
    const orig = richTalent();
    setB1([], [orig]);
    useLoadout.getState().benchTalent('剑心通明');
    expect(useLoadout.getState().bench.traits[0]).toEqual(orig);
    useLoadout.getState().activateTalent('剑心通明');
    expect(b1Traits()[0]).toEqual(orig);
  });
});

describe('替补席：批量 apply → unapply 零丢失', () => {
  it('应用只留一技能的模板→烈焰斩进替补席保持完整→卸载后原样回流', () => {
    const flame = richSkill();
    const other: Skill = { id: 'S_B1_01', name: '基础剑术', level: '入门·Lv.1', desc: '', effect: '', rarity: '普通', addedAt: 5 };
    setB1([flame, other], []);
    // 存一个只含「基础剑术」的模板并应用
    const id = useLoadout.getState().saveBuildFromNames('纯剑流', ['基础剑术'], []);
    useLoadout.getState().applyBuild(id);
    expect(b1Skills().map((s) => s.name)).toEqual(['基础剑术']);
    expect(useLoadout.getState().bench.skills.find((s) => s.name === '烈焰斩')).toEqual(flame);
    // 卸载 → 全部回流，烈焰斩逐字段完好
    useLoadout.getState().unapplyBuild();
    expect(useLoadout.getState().bench.skills).toHaveLength(0);
    expect(b1Skills().find((s) => s.name === '烈焰斩')).toEqual(flame);
  });
});

describe('替补席：持久化序列化零丢失（bench 存入 drpg-loadout）', () => {
  it('JSON round-trip 后替补席对象仍 deep-equal（嵌套 numeric/combat/数组不丢）', () => {
    const orig = richSkill();
    setB1([orig], []);
    useLoadout.getState().benchSkill('烈焰斩');
    const revived = JSON.parse(JSON.stringify(useLoadout.getState().bench));
    expect(revived.skills[0]).toEqual(orig);
  });
});
