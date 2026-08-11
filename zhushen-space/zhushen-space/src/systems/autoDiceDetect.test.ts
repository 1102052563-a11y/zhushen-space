import { describe, it, expect } from 'vitest';
import { detectAutoAction, detectDifficulty, parseCheckTags, stripCheckTags } from './autoDiceDetect';

describe('detectAutoAction 关键词门', () => {
  it('战斗类 → str', () => {
    expect(detectAutoAction('我挥剑砍向敌人')?.attrKey).toBe('str');
    expect(detectAutoAction('拔刀与他交手')?.attrKey).toBe('str');
  });
  it('社交类 → cha', () => {
    expect(detectAutoAction('我试着说服守卫放行')?.attrKey).toBe('cha');
    expect(detectAutoAction('恐吓那个商人')?.attrKey).toBe('cha');
  });
  it('敏捷/智力/体质/幸运各归其位', () => {
    expect(detectAutoAction('悄悄潜行绕到背后')?.attrKey).toBe('agi');
    expect(detectAutoAction('仔细分析这道阵法')?.attrKey).toBe('int');
    expect(detectAutoAction('硬抗住这一击')?.attrKey).toBe('con');
    expect(detectAutoAction('赌一把手气')?.attrKey).toBe('luck');
  });
  it('日常/闲聊/情感 → null（不 roll）', () => {
    expect(detectAutoAction('我坐下来吃了顿饭')).toBeNull();
    expect(detectAutoAction('和她聊聊今天的天气')).toBeNull();
    expect(detectAutoAction('静静看着远方，心里五味杂陈')).toBeNull();
    expect(detectAutoAction('')).toBeNull();
    expect(detectAutoAction('   ')).toBeNull();
  });
  it('多类命中时按优先级：社交先于力量', () => {
    // 「挥」(str) 与「威胁」(cha) 同现 → cha 优先（先扫社交，降误判为纯武力）
    expect(detectAutoAction('我一边挥拳一边威胁他快说')?.attrKey).toBe('cha');
  });
});

describe('detectDifficulty 措辞粗判', () => {
  it('默认普通', () => {
    expect(detectDifficulty('我砍他一刀')).toBe('普通');
  });
  it('困难 / 极难 / 几乎不可能 / 简单', () => {
    expect(detectDifficulty('这一击非常艰难')).toBe('困难');
    expect(detectDifficulty('简直难如登天')).toBe('极难');
    expect(detectDifficulty('这几乎不可能完成')).toBe('几乎不可能');
    expect(detectDifficulty('轻松跃过矮墙')).toBe('简单');
  });
  it('优先级：几乎不可能 > 极难 > 困难', () => {
    // 同时含「困难」与「几乎不可能」→ 取最高档
    expect(detectDifficulty('虽然困难，但几乎不可能完成')).toBe('几乎不可能');
  });
});

describe('parseCheckTags 剧情选项·检定标记（借鉴V3.2检定建议表）', () => {
  it('基本形：🎲[属性·难度]', () => {
    const t = parseCheckTags('趁夜翻墙潜入库房 🎲[敏捷·困难]');
    expect(t).toHaveLength(1);
    expect(t[0].attrKey).toBe('agi');
    expect(t[0].attrLabel).toBe('敏捷');
    expect(t[0].difficulty).toBe('困难');
  });
  it('全角括号【】与其它分隔符也认', () => {
    expect(parseCheckTags('说服典狱长放人 🎲【魅力、极难】')[0]?.difficulty).toBe('极难');
    expect(parseCheckTags('硬闯正门 🎲[力量:普通]')[0]?.attrKey).toBe('str');
  });
  it('难度同义词归一：中等→普通、容易→简单；缺难度=普通', () => {
    expect(parseCheckTags('赌一把 🎲[幸运·中等]')[0]?.difficulty).toBe('普通');
    expect(parseCheckTags('翻过矮墙 🎲[敏捷·容易]')[0]?.difficulty).toBe('简单');
    expect(parseCheckTags('破解阵法 🎲[智力]')[0]?.difficulty).toBe('普通');
  });
  it('认不出属性的标记跳过（宁可不roll不乱roll）；无标记=空数组', () => {
    expect(parseCheckTags('冲上去 🎲[气势·困难]')).toHaveLength(0);
    expect(parseCheckTags('平静地喝茶')).toHaveLength(0);
    expect(parseCheckTags('')).toHaveLength(0);
  });
  it('多标记（可多选叠加）：各自解析，按属性+难度去重', () => {
    const t = parseCheckTags('撬开锁 🎲[敏捷·困难]，同时分心听动静 🎲[智力·普通]');
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.attrKey)).toEqual(['agi', 'int']);
    const dup = parseCheckTags('A 🎲[敏捷·困难] B 🎲[敏捷·困难]');
    expect(dup).toHaveLength(1);
  });
  it('stripCheckTags 剥净标记、正文不动', () => {
    expect(stripCheckTags('趁夜翻墙潜入库房 🎲[敏捷·困难]')).toBe('趁夜翻墙潜入库房');
    expect(stripCheckTags('A 🎲[敏捷·困难]，B 🎲【魅力·普通】')).toBe('A ，B');
    expect(stripCheckTags('没有标记的句子')).toBe('没有标记的句子');
  });
});
