import { describe, it, expect } from 'vitest';
import { expandStMacros, buildPlayGuideBlock, MAX_SELECTED_PLAYS, type JoyPlayLib } from './joyPlays';

const rand0 = () => 0;          // 恒取第一支
const randLast = () => 0.999;   // 恒取最后一支

describe('expandStMacros ST变体宏展开', () => {
  it('基本形 {{random::A::B}} 按随机数取一支', () => {
    expect(expandStMacros('她{{random::坐下::躺下}}了', rand0)).toBe('她坐下了');
    expect(expandStMacros('她{{random::坐下::躺下}}了', randLast)).toBe('她躺下了');
  });
  it('多个宏各自独立展开', () => {
    expect(expandStMacros('{{random::A::B}}和{{random::C::D}}', rand0)).toBe('A和C');
  });
  it('嵌套宏内层优先', () => {
    expect(expandStMacros('{{random::外{{random::内1::内2}}层::备选}}', rand0)).toBe('外内1层');
  });
  it('残破未闭合标记清理干净（V3.2 源数据个别缺闭合）', () => {
    const out = expandStMacros('前缀 {{random::甲::乙 后文没有闭合', rand0);
    expect(out).not.toContain('{{random::');
    expect(out).toContain('前缀');
  });
  it('无宏文本原样返回', () => {
    expect(expandStMacros('平常句子，没有宏', rand0)).toBe('平常句子，没有宏');
    expect(expandStMacros('', rand0)).toBe('');
  });
});

describe('buildPlayGuideBlock 按选注入块', () => {
  const lib: JoyPlayLib = {
    version: 1,
    categories: ['体位', '侍奉'],
    plays: [
      { name: '玩法甲', category: '体位', content: '<玩法甲>\n她{{random::慢慢::快速}}动作\n</玩法甲>' },
      { name: '玩法乙', category: '侍奉', content: '<玩法乙>\n内容乙\n</玩法乙>' },
      { name: '玩法丙', category: '体位', content: '<玩法丙>\n内容丙\n</玩法丙>' },
      { name: '玩法丁', category: '体位', content: '<玩法丁>\n内容丁\n</玩法丁>' },
    ],
  };
  it('选中项拼进块且宏已展开', () => {
    const b = buildPlayGuideBlock(['玩法甲', '玩法乙'], lib, rand0);
    expect(b).toContain('共 2 项');
    expect(b).toContain('她慢慢动作');
    expect(b).toContain('内容乙');
    expect(b).not.toContain('{{random::');
  });
  it('查无此名跳过；全查无 / 空选择 = 空串', () => {
    expect(buildPlayGuideBlock(['不存在', '玩法乙'], lib, rand0)).toContain('内容乙');
    expect(buildPlayGuideBlock(['不存在'], lib, rand0)).toBe('');
    expect(buildPlayGuideBlock([], lib, rand0)).toBe('');
  });
  it(`超过上限截断到 ${MAX_SELECTED_PLAYS} 个`, () => {
    const b = buildPlayGuideBlock(['玩法甲', '玩法乙', '玩法丙', '玩法丁'], lib, rand0);
    expect(b).toContain(`共 ${MAX_SELECTED_PLAYS} 项`);
    expect(b).not.toContain('内容丁');
  });
});
