import { describe, it, expect } from 'vitest';
import { narratedMaxTurns, clampTurnsInText } from './statusCommands';

/* 忠于正文·状态时长守卫：治"技能描述3回合、状态却给15回合"的自相矛盾。 */
describe('narratedMaxTurns（正文明确声明的最长回合时长）', () => {
  it('抓「接下来的N个回合」', () => {
    expect(narratedMaxTurns('法术命中，接下来的3个回合内每秒受到3点酸蚀残留烧伤。')).toBe(3);
  });
  it('多处声明取最大', () => {
    expect(narratedMaxTurns('眩晕持续2回合，灼烧维持4回合，减速接连5回合。')).toBe(5);
  });
  it('「N回合内」也算', () => {
    expect(narratedMaxTurns('需在5回合内击破护盾。')).toBe(5);
  });
  it('先剥 <state>/<upstore>，不把指令自身的回合数当正文声明', () => {
    const reply = '接下来的3个回合内持续掉血。<upstore>\naddStatus("B1",{name:"酸蚀灼伤",duration:"15回合"})\n</upstore>';
    expect(narratedMaxTurns(reply)).toBe(3);   // 只认正文的 3，不认指令里的 15
  });
  it('忽略「第N回合 / N回合前」等非时长数字', () => {
    expect(narratedMaxTurns('这是第3回合，10回合前他就走了。')).toBe(0);
  });
  it('没有明确时长声明 → 0（不夹）', () => {
    expect(narratedMaxTurns('他挥剑劈砍，造成18点伤害。')).toBe(0);
  });
});

describe('clampTurnsInText（把文本里超上限的「N回合」夹下来）', () => {
  it('用户实例：状态里「持续15回合」在上限 3 下 → 「持续3回合」，其余不动', () => {
    expect(clampTurnsInText('酸蚀灼伤:🧪(每回合生命流失3点|被高酸孢囊迎面喷淋|持续15回合|窒息酸蚀孢子雾)', 3))
      .toBe('酸蚀灼伤:🧪(每回合生命流失3点|被高酸孢囊迎面喷淋|持续3回合|窒息酸蚀孢子雾)');
  });
  it('不超过上限的回合数不动', () => {
    expect(clampTurnsInText('眩晕持续2回合', 3)).toBe('眩晕持续2回合');
  });
  it('上限=0（正文没声明）→ 原样不动', () => {
    expect(clampTurnsInText('持续15回合', 0)).toBe('持续15回合');
  });
  it('只动「数字+回合」，不碰「每回合」与无关数字', () => {
    expect(clampTurnsInText('每回合-3点，持续15回合', 3)).toBe('每回合-3点，持续3回合');
  });
});
