import { describe, it, expect } from 'vitest';
import { parseEk, hasDetailDoc, parseSpans, parseDocBlocks } from './codexDetail';

describe('parseEk / hasDetailDoc', () => {
  it('拆得出 kind 与 id（id 里含斜杠也不能拆错）', () => {
    expect(parseEk('o:诡秘之主/克莱恩·莫雷蒂')).toEqual({ kind: 'wchar', id: '诡秘之主/克莱恩·莫雷蒂' });
    expect(parseEk('w:苏晓')).toEqual({ kind: 'wiki', id: '苏晓' });
    expect(parseEk('v:我欲封天/铜镜')).toEqual({ kind: 'witem', id: '我欲封天/铜镜' });
  });

  it('非法 ek → null', () => {
    expect(parseEk('')).toBeNull();
    expect(parseEk('苏晓')).toBeNull();
    expect(parseEk('zz:x')).toBeNull();
  });

  it('详情页只对原著档案开放，本档实体走各自面板', () => {
    expect(hasDetailDoc('w:苏晓')).toBe(true);
    expect(hasDetailDoc('o:诡秘之主/克莱恩')).toBe(true);
    expect(hasDetailDoc('v:我欲封天/铜镜')).toBe(true);
    expect(hasDetailDoc('n:C1')).toBe(false);      // NPC
    expect(hasDetailDoc('r:绝强')).toBe(false);     // 阶位
  });
});

describe('parseSpans（内链是「一路点下去」的关键）', () => {
  it('wiki 内链还原成可点 span，目标去掉 .md 与路径', () => {
    const s = parseSpans('他与[苏晓](人物/苏晓.md)并肩作战。');
    expect(s[0]).toEqual({ text: '他与' });
    expect(s[1]).toEqual({ text: '苏晓', link: '苏晓' });
    expect(s[2]).toEqual({ text: '并肩作战。' });
  });

  it('锚点与 URL 编码都剥干净', () => {
    expect(parseSpans('[诺一](%E8%AF%BA%E4%B8%80.md#%E7%AE%80%E4%BB%8B)')[0].link).toBe('诺一');
  });

  it('图片整段剥掉，不留空壳', () => {
    expect(parseSpans('![立绘](a.png)苏晓')).toEqual([{ text: '苏晓' }]);
  });

  it('剥粗体记号但保留空格——详情页是拿来读的，不做 stripMd 那种压空白', () => {
    expect(parseSpans('**顶峰** 星界 监守者')).toEqual([{ text: '顶峰 星界 监守者' }]);
  });

  it('纯文字不产生空 span', () => {
    expect(parseSpans('普通一行')).toEqual([{ text: '普通一行' }]);
    expect(parseSpans('   ')).toEqual([]);
  });
});

describe('parseDocBlocks', () => {
  const MD = `---
title: 苏晓
身份: 契约者
---
# 苏晓

正文首段，提到[诺一](诺一.md)。

## 经历
- 第一条
- 第二条含[链接](x.md)

> 引用一句

---
结尾段。
`;
  const blocks = parseDocBlocks(MD);

  it('前言区跳过（字段已进 meta，不该在正文重复一遍）', () => {
    expect(blocks.some((b) => b.t !== 'hr' && b.spans.some((s) => s.text.includes('title:')))).toBe(false);
  });

  it('标题带级别', () => {
    expect(blocks[0]).toMatchObject({ t: 'h', level: 1 });
    expect(blocks.find((b) => b.t === 'h' && b.level === 2)).toBeTruthy();
  });

  it('列表 / 引用 / 分隔线各归其位', () => {
    expect(blocks.filter((b) => b.t === 'li')).toHaveLength(2);
    expect(blocks.filter((b) => b.t === 'quote')).toHaveLength(1);
    expect(blocks.filter((b) => b.t === 'hr')).toHaveLength(1);
  });

  it('正文里的内链保留下来（跨块都要能点）', () => {
    const links = blocks.flatMap((b) => (b.t === 'hr' ? [] : b.spans)).filter((s) => s.link);
    expect(links.map((l) => l.link)).toEqual(['诺一', 'x']);
  });

  it('空 md 不炸', () => {
    expect(parseDocBlocks('')).toEqual([]);
  });
});
