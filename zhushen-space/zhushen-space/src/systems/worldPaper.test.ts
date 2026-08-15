// 📰 本世界日报解析单测：头条缺失整期作废、栏目/来信裁剪与兜底、中英字段名兼容。
import { describe, it, expect } from 'vitest';
import { parsePaperReply } from './worldNews';

describe('parsePaperReply', () => {
  it('完整一期：报馆/期号/头条/栏目/来信', () => {
    const p = parsePaperReply(JSON.stringify({
      outlet: '青云坊市传讯', issueLabel: '天启三年·霜月第二刊',
      headline: { title: '南坊大火疑云', body: '昨夜南坊三间铺面焚毁，火因成谜，坊卫已封锁现场。' },
      articles: [
        { column: '要闻', title: '灵石涨价', body: '下品灵石对铜钱兑价再涨一成。' },
        { column: '市井', title: '茶楼新说书', body: '醉仙楼新来的说书人把大火讲成了妖祟作乱。' },
      ],
      letters: [
        { id: '南坊老王', body: '我铺子就在隔壁，官府说法根本对不上！' },
        { id: '理中客', body: '别急着传妖祟，等坊卫结论。' },
      ],
    }));
    expect(p).not.toBeNull();
    expect(p!.outlet).toBe('青云坊市传讯');
    expect(p!.headline.column).toBe('头条');
    expect(p!.headline.title).toBe('南坊大火疑云');
    expect(p!.articles.length).toBe(2);
    expect(p!.letters.length).toBe(2);
  });

  it('头条缺失 → 整期作废返回 null', () => {
    expect(parsePaperReply(JSON.stringify({ outlet: 'X', articles: [{ column: 'a', title: 't', body: 'b' }] }))).toBeNull();
    expect(parsePaperReply('不是JSON')).toBeNull();
  });

  it('中文字段名兼容 + 空壳剔除 + 超额裁剪 + 署名兜底', () => {
    const p = parsePaperReply(JSON.stringify({
      '报馆': '晨报', '期号': '第3期',
      '头条': { '标题': 'T', '正文': 'B' },
      '栏目文章': [
        { '栏目': '要闻', '标题': 'a', '正文': 'x' },
        { title: '', body: '' },   // 空壳剔除
        ...Array.from({ length: 6 }, (_, i) => ({ column: 'c', title: `t${i}`, body: 'b' })),
      ],
      '读者来信': [{ '内容': '只有内容没署名' }, {}, ...Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, body: 'x' }))],
    }));
    expect(p!.outlet).toBe('晨报');
    expect(p!.articles.length).toBe(4);           // 上限4
    expect(p!.letters.length).toBe(5);            // 上限5
    expect(p!.letters[0].id).toBe('匿名读者');    // 署名兜底
  });
});
