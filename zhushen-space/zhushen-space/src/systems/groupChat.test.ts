import { describe, it, expect } from 'vitest';
import { parseGroupReply, groupMsgToHistoryText } from './groupChat';

const OPTS = { playerName: '苏白', memberNames: ['林岚', '阿玖', '白芷'] };

describe('parseGroupReply', () => {
  it('标准多条+成员互聊', () => {
    const r = parseGroupReply(['林岚|今天副本掉的核心谁要？', '阿玖|我要我要！', '白芷｜阿玖你上次的账还没还', '阿玖|……装没看见'].join('\n'), OPTS);
    expect(r).toHaveLength(4);
    expect(r[2].sender).toBe('白芷');
    expect(r[2].text).toContain('还没还');
  });

  it('硬过滤：冒充主角与名单外发言人都丢弃', () => {
    const r = parseGroupReply(['苏白|我来发言', '主角|嗯', '我|好', '路人甲|插个嘴', '林岚|就剩我了'].join('\n'), OPTS);
    expect(r).toHaveLength(1);
    expect(r[0].sender).toBe('林岚');
  });

  it('无竖线行并进上一条（多行消息）；开头散文丢弃', () => {
    const r = parseGroupReply(['（群里安静了一会儿）', '林岚|我说两句', '第二行补充', '阿玖|收到'].join('\n'), OPTS);
    expect(r).toHaveLength(2);
    expect(r[0].text).toContain('第二行补充');
  });

  it('注释行跳过 + 代码围栏剥离 + 条数上限8', () => {
    const lines = ['# 注释', ...Array.from({ length: 12 }, (_, i) => `林岚|第${i}条`)];
    const r = parseGroupReply('```\n' + lines.join('\n') + '\n```', OPTS);
    expect(r).toHaveLength(8);
  });

  it('发言人名带空格也能对上（归一比对）', () => {
    const r = parseGroupReply('林 岚|在吗', OPTS);
    expect(r).toHaveLength(1);
    expect(r[0].sender).toBe('林岚');
  });

  it('空输入/纯散文返回空', () => {
    expect(parseGroupReply('', OPTS)).toHaveLength(0);
    expect(parseGroupReply('没有任何协议行的散文。', OPTS)).toHaveLength(0);
  });

  it('历史压缩：换行拍平', () => {
    expect(groupMsgToHistoryText('林岚', '两行\n消息')).toBe('林岚: 两行 消息');
  });

  it('表情包：名字|贴:名称 → sticker；续行不污染表情包名', () => {
    const r = parseGroupReply('林岚|贴: 猫猫点头\n散落的一行\n阿玖|哈哈', OPTS);
    expect(r[0].kind).toBe('sticker');
    expect(r[0].text).toBe('猫猫点头');
    expect(r[1].sender).toBe('阿玖');
  });
});
