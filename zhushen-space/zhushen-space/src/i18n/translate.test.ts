import { describe, it, expect } from 'vitest';
import { translateToEn, convert, hasCJK } from './translate';

describe('i18n · hasCJK', () => {
  it('识别中日韩表意文字', () => {
    expect(hasCJK('设置')).toBe(true);
    expect(hasCJK('abc')).toBe(false);
    expect(hasCJK('12:30')).toBe(false);
    expect(hasCJK('Lv 5')).toBe(false);
  });
});

describe('i18n · translateToEn', () => {
  it('精确词库命中', () => {
    expect(translateToEn('保存')).toBe('Save');
    expect(translateToEn('取消')).toBe('Cancel');
    expect(translateToEn('设置')).toBe('Settings');
  });

  it('保留首尾空白，只翻中间实体', () => {
    expect(translateToEn('  取消 ')).toBe('  Cancel ');
    expect(translateToEn('\n保存\n')).toBe('\nSave\n');
  });

  it('插值正则规则命中', () => {
    expect(translateToEn('等级 5')).toBe('Level 5');
    expect(translateToEn('第3页')).toBe('Page 3');
  });

  it('未命中回退原文（不报错、保持中文）', () => {
    const s = '这是一段还没有翻译的界面文字';
    expect(translateToEn(s)).toBe(s);
  });
});

describe('i18n · convert 语言分派', () => {
  it('en 走英文词库', () => {
    expect(convert('保存', 'en', null)).toBe('Save');
  });
  it('zh-Hant 委托给传入的转换函数', () => {
    const fakeTw = (s: string) => s.replace(/设置/g, '設定');
    expect(convert('系统设置', 'zh-Hant', fakeTw)).toBe('系统設定');
  });
  it('zh-Hant 转换器未就绪时原样返回', () => {
    expect(convert('设置', 'zh-Hant', null)).toBe('设置');
  });
});
