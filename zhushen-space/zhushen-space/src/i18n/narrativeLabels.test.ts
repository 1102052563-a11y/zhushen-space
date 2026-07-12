import { describe, it, expect } from 'vitest';
import { translateNarrativeLabels as T } from './translate';

const CJK = /[㐀-鿿]/;

describe('translateNarrativeLabels — 结算块结构化标签本地化 (vi)', () => {
  it('时间结算块标题+字段', () => {
    expect(T('【时间结算块｜固定放开头】', 'vi')).toBe('【Khối Kết Toán Thời Gian｜Cố Định Đặt Ở Đầu】');
    expect(T('时间结算： +180分钟 ｜ 任务世界时间 00:00 -> 03:00', 'vi'))
      .toBe('Kết Toán Thời Gian： +180phút ｜ Thời Gian Thế Giới Nhiệm Vụ 00:00 -> 03:00');
    expect(T('任务期限（任务世界绝对时刻）： 7天 ｜ 剩余 06天21小时00分', 'vi'))
      .toBe('Thời Hạn Nhiệm Vụ（Thời Khắc Tuyệt Đối Thế Giới Nhiệm Vụ）： 7ngày ｜ Còn Lại 06ngày21giờ00phút');
    expect(T('（临界：正常）', 'vi')).toBe('（Ngưỡng：Bình Thường）');
  });

  it('任务块字段（保留已是越南语的内容）', () => {
    expect(T('任务目标: Ghi danh tại "Trung tâm tị nạn Sector 13"', 'vi'))
      .toBe('Mục Tiêu Nhiệm Vụ: Ghi danh tại "Trung tâm tị nạn Sector 13"');
    expect(T('任务简介: Chào mừng đến với Neon Rust.', 'vi')).toBe('Tóm Tắt Nhiệm Vụ: Chào mừng đến với Neon Rust.');
    expect(T('任务区域: Khu ổ chuột Sector 13', 'vi')).toBe('Khu Vực Nhiệm Vụ: Khu ổ chuột Sector 13');
    expect(T('🎁奖励: 300 Lạc Viên Tệ', 'vi')).toBe('🎁Phần Thưởng: 300 Lạc Viên Tệ');
    expect(T('⚠惩罚: Xóa sổ', 'vi')).toBe('⚠Hình Phạt: Xóa sổ');
    expect(T('【📋任务】', 'vi')).toBe('【📋Nhiệm Vụ】');
  });

  it('结算块标题全译无残留中文', () => {
    for (const s of ['【时间结算块｜固定放开头】', '时间结算： +180分钟', '（临界：正常）', '🎁奖励: x', '任务目标: y']) {
      expect(CJK.test(T(s, 'vi'))).toBe(false);
    }
  });

  it('不误拆正文词（今天/天空不会变成 今ngày）', () => {
    expect(T('今天', 'vi')).not.toContain('ngày');   // 整串匹配，未收录则保留
    expect(T('天空', 'vi')).not.toContain('ngày');
  });

  it('非 en/vi 原样返回', () => {
    expect(T('时间结算', 'zh-Hant')).toBe('时间结算');
  });
});
