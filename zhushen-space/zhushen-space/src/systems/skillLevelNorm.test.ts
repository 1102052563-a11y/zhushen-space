import { describe, it, expect } from 'vitest';
import { normalizeSkillLevel, SKILL_RARITIES } from './skillLevelNorm';

describe('normalizeSkillLevel · 把 AI 塞进 level 的品级剥出来', () => {
  it('剥掉品级前缀，等级部分原样留下', () => {
    expect(normalizeSkillLevel('传说·Lv. 1', '传说')).toEqual({ level: 'Lv. 1', rarity: '传说' });
  });

  it('rarity 缺失时用剥出来的补上 —— 信息不能丢', () => {
    expect(normalizeSkillLevel('史诗·Lv.7', undefined)).toEqual({ level: 'Lv.7', rarity: '史诗' });
  });

  it('rarity 已有则以它为准，不被 level 里的旧值覆盖（质变后 level 前缀是陈旧的）', () => {
    // 黄金质变把品级升到「奥义」，level 里还留着老的「传说」→ 必须听 rarity 的
    expect(normalizeSkillLevel('传说·Lv.9', '奥义')).toEqual({ level: 'Lv.9', rarity: '奥义' });
  });

  it('level 整串就是个品级 → 等级清空、品级捞回来', () => {
    expect(normalizeSkillLevel('传说', undefined)).toEqual({ level: '', rarity: '传说' });
  });

  it('干净的 level 一个字都不动', () => {
    expect(normalizeSkillLevel('Lv. 1', '传说')).toEqual({ level: 'Lv. 1', rarity: '传说' });
    expect(normalizeSkillLevel('入门·Lv.15', '精良')).toEqual({ level: '入门·Lv.15', rarity: '精良' });
    expect(normalizeSkillLevel('大成', '稀有')).toEqual({ level: '大成', rarity: '稀有' });
  });

  it('⚠ 不误伤名字/词组里恰好含品级字的串 —— 只认整段', () => {
    // 「传说之刃」含「传说」但不是独立一段，不能被剥
    expect(normalizeSkillLevel('传说之刃·Lv.3', '史诗')).toEqual({ level: '传说之刃·Lv.3', rarity: '史诗' });
    expect(normalizeSkillLevel('普通话精通', undefined).level).toBe('普通话精通');
  });

  it('带「级」字后缀的写法也认（"传说级·Lv.2"）', () => {
    expect(normalizeSkillLevel('传说级·Lv.2', undefined)).toEqual({ level: 'Lv.2', rarity: '传说' });
  });

  it('空/缺省安全', () => {
    expect(normalizeSkillLevel(undefined, undefined)).toEqual({ level: '', rarity: undefined });
    expect(normalizeSkillLevel('', '传说')).toEqual({ level: '', rarity: '传说' });
  });

  it('七档品级全都剥得掉', () => {
    for (const r of SKILL_RARITIES) {
      expect(normalizeSkillLevel(`${r}·Lv.5`, undefined)).toEqual({ level: 'Lv.5', rarity: r });
    }
  });

  it('空格/竖线等其它分隔符同样处理', () => {
    expect(normalizeSkillLevel('奥义 Lv.4', undefined)).toEqual({ level: 'Lv.4', rarity: '奥义' });
    expect(normalizeSkillLevel('极境|Lv.10', undefined)).toEqual({ level: 'Lv.10', rarity: '极境' });
  });
});
