import { describe, it, expect, afterEach } from 'vitest';
import { parseGlossaryImport } from './glossaryIO';
import { setUserDict } from './userDict';
import { translateToVi } from './translate';

describe('glossaryIO · parseGlossaryImport', () => {
  it('对象格式，空译文跳过（不覆盖）', () => {
    expect(parseGlossaryImport('{"保存":"Lưu","取消":"","删除":"Xóa"}')).toEqual({ 保存: 'Lưu', 删除: 'Xóa' });
  });
  it('数组格式 [[中文,译文]]', () => {
    expect(parseGlossaryImport('[["保存","Lưu"],["删除","Xóa"],["x",""]]')).toEqual({ 保存: 'Lưu', 删除: 'Xóa' });
  });
});

describe('用户导入的翻译表优先于内置词库', () => {
  afterEach(() => setUserDict({}));
  it('override 赢过内置', () => {
    setUserDict({ vi: { 保存: 'LƯU-TÙY-CHỈNH' } });
    expect(translateToVi('保存')).toBe('LƯU-TÙY-CHỈNH');
  });
  it('override 没这条则回退内置', () => {
    setUserDict({ vi: { 保存: 'X' } });
    expect(translateToVi('取消')).toBe('Hủy');   // 内置 取消→Hủy
  });
});
