import { describe, it, expect } from 'vitest';
import { detectLang, needsAutoTranslate } from './autoTranslate';

describe('autoTranslate · detectLang', () => {
  it('按脚本判语言', () => {
    expect(detectLang('赤霄剑')).toBe('zh');
    expect(detectLang('Kiếm Xích Tiêu')).toBe('vi');   // 有越南语声调符
    expect(detectLang('Flame Sword')).toBe('en');
    expect(detectLang('12,300')).toBe('other');
  });
});

describe('autoTranslate · needsAutoTranslate（源≠目标才译）', () => {
  it('英文 viewer：中文/越南语要译，英文不译', () => {
    expect(needsAutoTranslate('赤霄剑', 'en')).toBe(true);
    expect(needsAutoTranslate('Kiếm Xích Tiêu', 'en')).toBe(true);
    expect(needsAutoTranslate('Flame Sword', 'en')).toBe(false);
  });
  it('越南语 viewer：中文/英文要译，越南语不译', () => {
    expect(needsAutoTranslate('赤霄剑', 'vi')).toBe(true);
    expect(needsAutoTranslate('Kiếm Xích Tiêu', 'vi')).toBe(false);
  });
  it('简体 viewer：中文不译，外文才译', () => {
    expect(needsAutoTranslate('赤霄剑', 'zh-Hans')).toBe(false);
    expect(needsAutoTranslate('Flame Sword', 'zh-Hans')).toBe(true);
  });
  it('繁體 viewer：中文也要（走 OpenCC 转繁）', () => {
    expect(needsAutoTranslate('赤霄剑', 'zh-Hant')).toBe(true);
  });
  it('纯数字/符号永不译', () => {
    expect(needsAutoTranslate('9999', 'en')).toBe(false);
  });
});
