/* 楼内 HTML/CSS 渲染硬化：scopeCss 作用域化 / <style> 抽取 / HTML 块整块组装（不再被 <br> 打碎）。
   node 环境无 DOM → DOMPurify.isSupported=false，sanitizeHtmlBlock 透传；这里只测结构与 CSS 逻辑，
   消毒本体是 DOMPurify 库职责（浏览器端才真跑）。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { scopeCss, extractStyleBlocks, dropExternalCssUrls, renderScopedStyles, extractHtmlFences } from './htmlSanitize';
import { toHtmlWithImages } from './narrativeHtml';
import { useSettings } from '../store/settingsStore';

const SCOPE = '.narrative-content';

describe('scopeCss 选择器作用域化', () => {
  it('普通选择器加前缀；多选择器逐个加', () => {
    expect(scopeCss('.card{color:red}', SCOPE)).toBe('.narrative-content .card{color:red}');
    expect(scopeCss('.a,.b{x:1}', SCOPE)).toBe('.narrative-content .a,.narrative-content .b{x:1}');
  });
  it('body/html/:root 视为作用域容器本身（美化卡常写 body{背景}）', () => {
    expect(scopeCss('body{background:#000}', SCOPE)).toBe('.narrative-content{background:#000}');
    expect(scopeCss(':root{--x:1}', SCOPE)).toBe('.narrative-content{--x:1}');
    expect(scopeCss('body .foo{x:1}', SCOPE)).toBe('.narrative-content .foo{x:1}');
    expect(scopeCss('body.dark .foo{x:1}', SCOPE)).toBe('.narrative-content .foo{x:1}');
  });
  it('已带作用域不重复加', () => {
    expect(scopeCss('.narrative-content .a{x:1}', SCOPE)).toBe('.narrative-content .a{x:1}');
  });
  it('@media/@supports 递归处理内部；内部掏空则整个丢弃', () => {
    expect(scopeCss('@media (max-width:600px){.a{color:red}}', SCOPE))
      .toBe('@media (max-width:600px){.narrative-content .a{color:red}}');
    expect(scopeCss('@media screen{@import url(x);}', SCOPE)).toBe('');
  });
  it('@keyframes/@font-face 原样保留（内部不是元素选择器）', () => {
    const kf = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(1turn)}}';
    expect(scopeCss(kf, SCOPE)).toBe(kf);
    expect(scopeCss('@-webkit-keyframes s{from{opacity:0}}', SCOPE)).toBe('@-webkit-keyframes s{from{opacity:0}}');
  });
  it('@import/@charset 等 at 语句一律丢弃', () => {
    expect(scopeCss('@import url(https://evil.example/x.css);.a{x:1}', SCOPE))
      .toBe('.narrative-content .a{x:1}');
  });
  it('字符串里的花括号/逗号不干扰解析', () => {
    expect(scopeCss('.a::before{content:"{,}"}', SCOPE)).toBe('.narrative-content .a::before{content:"{,}"}');
    expect(scopeCss('.a[data-x="1,2"],.b{x:1}', SCOPE))
      .toBe('.narrative-content .a[data-x="1,2"],.narrative-content .b{x:1}');
    expect(scopeCss(':is(.a,.b){x:1}', SCOPE)).toBe('.narrative-content :is(.a,.b){x:1}');
  });
  it('注释被剥掉；未闭合块吃到结尾不炸', () => {
    expect(scopeCss('/* c */.a{x:1}', SCOPE)).toBe('.narrative-content .a{x:1}');
    expect(scopeCss('.a{x:1', SCOPE)).toBe('.narrative-content .a{x:1}');   // 自动补闭合

  });
  it('dropExternalCssUrls：外链 url() 置 none，本地/data: 不动', () => {
    expect(dropExternalCssUrls('.a{background:url(https://evil.example/x.png)}')).toBe('.a{background:none}');
    expect(dropExternalCssUrls(".a{background:url('//evil.example/x.png')}")).toBe('.a{background:none}');
    const keep = '.a{background:url(/portraits/x.webp),url(data:image/png;base64,AA)}';
    expect(dropExternalCssUrls(keep)).toBe(keep);
  });
  it('renderScopedStyles：剥 </style 防逃逸；空样式吐空串', () => {
    useSettings.setState({ htmlExternalMedia: true } as any);
    const [tag] = renderScopedStyles(['.a{content:"</style><img>"}'], SCOPE);
    expect(tag).not.toContain('</style><img>');
    expect(renderScopedStyles([' '], SCOPE)).toEqual(['']);
  });
});

describe('extractStyleBlocks', () => {
  it('闭合 <style> 抽成占位符，可多块', () => {
    const { text, styles } = extractStyleBlocks('前<style>.a{x:1}</style>中<STYLE>.b{y:2}</STYLE>后');
    expect(styles).toEqual(['.a{x:1}', '.b{y:2}']);
    expect(text).toContain('@@ZSSTYLE0@@');
    expect(text).toContain('@@ZSSTYLE1@@');
    expect(text).not.toContain('<style');
  });
  it('未闭合 <style>（流式中途）→ 截断 + PENDING 占位', () => {
    const { text, styles } = extractStyleBlocks('正文\n<style>.a{color:');
    expect(styles).toEqual([]);
    expect(text).toContain('正文');
    expect(text).toContain('@@ZSSTYLEPENDING@@');
    expect(text).not.toContain('.a{color:');
  });
  it('无 style 原样返回', () => {
    expect(extractStyleBlocks('纯正文').text).toBe('纯正文');
  });
});

describe('extractHtmlFences（前端卡围栏 → 沙箱）', () => {
  it('```html 围栏抽出，正文留占位行', () => {
    const { text, fences } = extractHtmlFences('前文\n```html\n<div>卡</div>\n```\n后文');
    expect(fences).toEqual(['<div>卡</div>']);
    expect(text).toContain('【🧩 前端卡 1');
    expect(text).not.toContain('```');
  });
  it('无语言标注但内容是完整 HTML 文档也认；```js 等普通代码块不碰', () => {
    const doc = '<!DOCTYPE html>\n<html><body>hi</body></html>';
    expect(extractHtmlFences('```\n' + doc + '\n```').fences).toEqual([doc]);
    const js = '```js\nconsole.log(1)\n```';
    expect(extractHtmlFences(js)).toEqual({ text: js, fences: [] });
  });
  it('未闭合围栏（流式中途）不抽、原样返回', () => {
    const s = '```html\n<div>半截';
    expect(extractHtmlFences(s)).toEqual({ text: s, fences: [] });
  });
});

describe('正文管线 e2e（node 下消毒透传，验结构）', () => {
  beforeEach(() => {
    // 关掉悬浮图鉴（省去建索引的 store 装配）与外链限制
    useSettings.setState({ reading: { codexHl: false } as any, htmlExternalMedia: true } as any);
  });
  it('多行 HTML 块整块透传：块内不再被 <br> 打碎', () => {
    const html = toHtmlWithImages('<div class="card">\n<table><tr><td>1</td></tr></table>\n</div>');
    expect(html).toContain('<div class="card">\n<table><tr><td>1</td></tr></table>\n</div>');
    expect(html).not.toContain('card"><br>');
  });
  it('楼内 <style> 作用域化后还原成 <style> 标签', () => {
    const html = toHtmlWithImages('<style>.x{color:red}</style>\n正文继续。');
    expect(html).toContain('<style>.narrative-content .x{color:red}</style>');
    expect(html).toContain('正文继续。');
  });
  it('HTML 块内部的 <style> 同样被抽出作用域化（不残留裸 style）', () => {
    const html = toHtmlWithImages('<div class="wrap">\n<style>.y{margin:0}</style>\n<span>hi</span>\n</div>');
    expect(html).toContain('<style>.narrative-content .y{margin:0}</style>');
    expect(html).not.toContain('<style>.y{margin:0}</style>');
  });
  it('流式未闭合 <style> → 显示「样式加载中」占位，半截 CSS 不裸奔', () => {
    const html = toHtmlWithImages('正文。\n<style>.x{col');
    expect(html).toContain('样式加载中');
    expect(html).not.toContain('.x{col');
  });
  it('外链媒体关闭时，楼内 CSS 的外链 url() 被置 none', () => {
    useSettings.setState({ htmlExternalMedia: false } as any);
    const html = toHtmlWithImages('<style>.x{background:url(https://evil.example/a.png)}</style>');
    expect(html).toContain('background:none');
    expect(html).not.toContain('evil.example');
  });
  it('details 仍默认展开；> 结算块与 HTML 共存不互吃', () => {
    const html = toHtmlWithImages('<details><summary>s</summary>\n<p>body</p>\n</details>\n> 【时间结算】辰时');
    expect(html).toContain('<details open');
    expect(html).toContain('时间结算');
  });
});
