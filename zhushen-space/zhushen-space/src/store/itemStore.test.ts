import { describe, it, expect } from 'vitest';
import { normalizeGradeLabel, scoreToGradeNum } from './itemStore';

describe('scoreToGradeNum（评分 → 物品档位 1-14，区间同 ITEM_GRADE_TABLE_RULE）', () => {
  it('区间边界', () => {
    expect(scoreToGradeNum(10)).toBe(1);   // 白色上界
    expect(scoreToGradeNum(11)).toBe(2);   // 绿色下界
    expect(scoreToGradeNum(100)).toBe(4);  // 紫色 71~150
    expect(scoreToGradeNum(450)).toBe(8);  // 暗金 401~530
    expect(scoreToGradeNum(700)).toBe(9);  // 传说上界
    expect(scoreToGradeNum(701)).toBe(10); // 史诗下界
    expect(scoreToGradeNum(8001)).toBe(14); // 永恒（8000+）
  });
  it('缺失/非法 → 0', () => {
    expect(scoreToGradeNum(undefined)).toBe(0);
    expect(scoreToGradeNum(0)).toBe(0);
    expect(scoreToGradeNum('abc')).toBe(0);
  });
  it('容忍带文字的评分串', () => {
    expect(scoreToGradeNum('约120分')).toBe(4); // 120 → 紫色
  });
});

describe('normalizeGradeLabel（一物一档·复合品级收敛护栏）', () => {
  it('★复合品级 + 评分 → 评分定档（评分权威）', () => {
    expect(normalizeGradeLabel('紫色/史诗', { score: 100 })).toEqual({ grade: '紫色', changed: true });
    // 同一复合标签、评分落在史诗区间 → 反向也信评分
    expect(normalizeGradeLabel('紫色/史诗', { score: 800 })).toEqual({ grade: '史诗级', changed: true });
  });

  it('★复合品级 + 多种分隔符（·/、）都能折叠', () => {
    expect(normalizeGradeLabel('暗金·史诗级', { score: 450 }).grade).toBe('暗金');
    expect(normalizeGradeLabel('暗金/史诗级', { score: 450 }).grade).toBe('暗金');
  });

  it('★剥离误用的技能品级词（普通/精良/稀有/奥义/极境）', () => {
    expect(normalizeGradeLabel('白色·普通')).toEqual({ grade: '白色', changed: true });
    expect(normalizeGradeLabel('蓝色/稀有')).toEqual({ grade: '蓝色', changed: true });
    expect(normalizeGradeLabel('蓝色·精良')).toEqual({ grade: '蓝色', changed: true });
  });

  it('复合品级无评分 → 取较低档（防越级爆品）', () => {
    expect(normalizeGradeLabel('紫色/史诗').grade).toBe('紫色');
  });

  it('numeric.grade 兜底定档（无评分时）', () => {
    expect(normalizeGradeLabel('紫色/史诗', { grade: 10 }).grade).toBe('史诗级');
  });

  it('折叠后保留尾部描述', () => {
    expect(normalizeGradeLabel('紫色/史诗·晓组织信物', { score: 100 }).grade).toBe('紫色·晓组织信物');
  });

  it('单一品级 + 合法描述后缀 → 原样保留（不误伤）', () => {
    expect(normalizeGradeLabel('紫色·带3条强化词缀的护甲', { score: 100 })).toEqual({
      grade: '紫色·带3条强化词缀的护甲',
      changed: false,
    });
  });

  it('★关键反例：描述里含品级字（金属/紫水晶）不被误判成复合', () => {
    expect(normalizeGradeLabel('暗金·金属之心', { score: 450 })).toEqual({ grade: '暗金·金属之心', changed: false });
    expect(normalizeGradeLabel('紫色·镶紫水晶', { score: 100 }).changed).toBe(false);
  });

  it('已是单一品级 / 空值 → 不动', () => {
    expect(normalizeGradeLabel('史诗级')).toEqual({ grade: '史诗级', changed: false });
    expect(normalizeGradeLabel('')).toEqual({ grade: '', changed: false });
    expect(normalizeGradeLabel(undefined)).toEqual({ grade: '', changed: false });
  });
});
