import { describe, it, expect } from 'vitest';
import { skillNameIsItemGranted, narrativeShowsAcquisition } from './itemGrantedSkill';

describe('物品附带/待学技能护栏 · skillNameIsItemGranted', () => {
  it('装备类：名字被【】包裹 → 判为物品附带', () => {
    expect(skillNameIsItemGranted('烈焰斩', ['挥砍时可施展【烈焰斩】，造成火焰伤害'])).toBe(true);
  });
  it('装备类：名字出现 + 赋予触发词 → 物品附带', () => {
    expect(skillNameIsItemGranted('疾风步', ['装备后可使用疾风步，移速提升'])).toBe(true);
    expect(skillNameIsItemGranted('寒冰护盾', ['持有时施展寒冰护盾抵挡攻击'])).toBe(true);
    expect(skillNameIsItemGranted('地裂', ['催动此法宝放出地裂之力'])).toBe(true);
  });
  it('卷轴类：「捏碎后你将学会【X】」→ 判为待学技能（复现 bug 那张卷轴）', () => {
    const eff = '捏碎后，你将学会专属控制型技能【极乐咏唱】。';
    expect(skillNameIsItemGranted('极乐咏唱', [eff])).toBe(true);
    expect(skillNameIsItemGranted('御剑术', ['使用后学会御剑术，可御剑飞行'])).toBe(true);
  });
  it('只是 flavor 提到、无触发词 → 不算（防误伤真习得）', () => {
    expect(skillNameIsItemGranted('冲锋', ['一把适合冲锋陷阵的长枪'])).toBe(false);
  });
  it('名字没出现在任何物品文本 → 不算', () => {
    expect(skillNameIsItemGranted('火球术', ['附带【寒冰箭】的法杖'])).toBe(false);
  });
  it('单字名 → 不判定（太短易误伤）', () => {
    expect(skillNameIsItemGranted('斩', ['附带【斩】'])).toBe(false);
  });
  it('空技能名 / 无物品文本 → false', () => {
    expect(skillNameIsItemGranted('任意招式', [])).toBe(false);
    expect(skillNameIsItemGranted('', ['附带【某招】'])).toBe(false);
  });
  it('归一化：括号/空格差异也能匹配', () => {
    expect(skillNameIsItemGranted('烈焰 斩', ['附带【烈焰斩】效果'])).toBe(true);
  });
});

describe('物品附带/待学技能护栏 · narrativeShowsAcquisition（放行真正的获得动作）', () => {
  it('装备招式内化 → 放行', () => {
    expect(narrativeShowsAcquisition('烈焰斩', '他参透剑谱，此后不持此剑也能施展烈焰斩。')).toBe(true);
    expect(narrativeShowsAcquisition('雷遁', '将法宝之力炼化入体，雷遁化为己用。')).toBe(true);
  });
  it('卷轴/秘籍被使用·消耗掉 → 放行', () => {
    expect(narrativeShowsAcquisition('极乐咏唱', '你捏碎卷轴，脑海中多了极乐咏唱的秘法。')).toBe(true);
    expect(narrativeShowsAcquisition('御剑术', '翻阅秘籍良久，你终于学会了御剑术。')).toBe(true);
    expect(narrativeShowsAcquisition('回春', '服下丹药后，你掌握了回春之法。')).toBe(true);
  });
  it('只是拿到卷轴、没有使用 → 不放行（复现 bug 场景，应被拦）', () => {
    expect(narrativeShowsAcquisition('极乐咏唱', '你获得了 异魔导书的残篇：极乐咏唱卷轴（暗紫色）。')).toBe(false);
  });
  it('招式名出现但无获得动作 → 不放行', () => {
    expect(narrativeShowsAcquisition('烈焰斩', '他拔剑一记烈焰斩，劈碎了石柱。')).toBe(false);
  });
  it('正文没提到该招式名 → 不放行（获得动作离得远也不算）', () => {
    expect(narrativeShowsAcquisition('极乐咏唱', '他捏碎了另一张无关的符纸。')).toBe(false);
  });
  it('空参数 → false', () => {
    expect(narrativeShowsAcquisition('极乐咏唱', '')).toBe(false);
    expect(narrativeShowsAcquisition('', '捏碎卷轴')).toBe(false);
  });
});
