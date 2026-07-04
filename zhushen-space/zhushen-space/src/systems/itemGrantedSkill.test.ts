import { describe, it, expect } from 'vitest';
import { skillNameIsItemGranted, narrativeInternalizes } from './itemGrantedSkill';

describe('物品附带技能护栏 · skillNameIsItemGranted', () => {
  it('名字被【】包裹 → 判为物品附带', () => {
    expect(skillNameIsItemGranted('烈焰斩', ['挥砍时可施展【烈焰斩】，造成火焰伤害'])).toBe(true);
  });
  it('名字出现 + 赋予触发词 → 物品附带', () => {
    expect(skillNameIsItemGranted('疾风步', ['装备后可使用疾风步，移速提升'])).toBe(true);
    expect(skillNameIsItemGranted('寒冰护盾', ['持有时施展寒冰护盾抵挡攻击'])).toBe(true);
    expect(skillNameIsItemGranted('地裂', ['催动此法宝放出地裂之力'])).toBe(true);
  });
  it('只是 flavor 提到、无赋予触发词 → 不算（防误伤真习得）', () => {
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

describe('物品附带技能护栏 · narrativeInternalizes（放行"内化成自身本领"）', () => {
  it('招式名附近有内化措辞 → 放行', () => {
    expect(narrativeInternalizes('烈焰斩', '他参透剑谱，此后不持此剑也能施展烈焰斩。')).toBe(true);
    expect(narrativeInternalizes('雷遁', '将法宝之力炼化入体，雷遁化为己用。')).toBe(true);
  });
  it('招式名出现但无内化措辞 → 不放行', () => {
    expect(narrativeInternalizes('烈焰斩', '他拔剑一记烈焰斩，劈碎了石柱。')).toBe(false);
  });
  it('正文没提到该招式名 → 不放行（内化词离得远也不算）', () => {
    expect(narrativeInternalizes('烈焰斩', '他终于融会贯通，领悟了另一门无关的心法。')).toBe(false);
  });
  it('空参数 → false', () => {
    expect(narrativeInternalizes('烈焰斩', '')).toBe(false);
    expect(narrativeInternalizes('', '融会贯通')).toBe(false);
  });
});
