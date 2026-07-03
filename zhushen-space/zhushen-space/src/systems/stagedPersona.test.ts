import { describe, it, expect, beforeEach } from 'vitest';
import { buildStagedPersona, STAGED_PERSONA_EXAMPLE } from './stagedPersona';
import { resolveTableTemplates } from './tableTemplate';
import { useTables } from '../store/tableStore';

describe('buildStagedPersona（表单→嵌套 <if cell> 串）', () => {
  it('缺表/行/列 或 无有效阶段 → 空串', () => {
    expect(buildStagedPersona({ table: '', row: 'a', column: 'b', stages: [{ min: 1, text: 'x' }] })).toBe('');
    expect(buildStagedPersona({ table: 't', row: 'r', column: 'c', stages: [] })).toBe('');
    expect(buildStagedPersona({ table: 't', row: 'r', column: 'c', stages: [{ min: NaN, text: 'x' }, { min: 1, text: '' }] })).toBe('');
  });

  it('阈值高的在最外层·带 fallback', () => {
    const s = buildStagedPersona({
      table: '好感表', row: '小红', column: '好感',
      stages: [{ min: 50, text: '中' }, { min: 90, text: '高' }], fallback: '低',
    });
    expect(s).toBe('<if cell="好感表/小红/好感 >= 90">高<else><if cell="好感表/小红/好感 >= 50">中<else>低</if></if>');
  });

  it('无 fallback → 最低阶段无 else', () => {
    const s = buildStagedPersona({ table: 't', row: 'r', column: 'c', stages: [{ min: 10, text: 'A' }] });
    expect(s).toBe('<if cell="t/r/c >= 10">A</if>');
  });
});

describe('分阶段人设 round-trip（经 resolveTableTemplates 选中正确阶段）', () => {
  beforeEach(() => {
    useTables.getState().resetAll();
    useTables.getState().insertRow('inventory', { 物品名称: '亲密度', 数量: '70' });   // 复用现有表：行名=亲密度·数量列=70
  });

  it('值 70 → 命中 >=50 阶段（不到 90）', () => {
    const tpl = buildStagedPersona({
      table: '背包物品表', row: '亲密度', column: '数量',
      stages: [{ min: 50, text: '中层人设' }, { min: 90, text: '顶层人设' }], fallback: '底层人设',
    });
    expect(resolveTableTemplates(tpl)).toBe('中层人设');
  });

  it('值 70 → 低于最低阈值 80 时走 fallback', () => {
    const tpl = buildStagedPersona({
      table: '背包物品表', row: '亲密度', column: '数量',
      stages: [{ min: 80, text: '高' }], fallback: '兜底',
    });
    expect(resolveTableTemplates(tpl)).toBe('兜底');
  });

  it('内置示例结构可编译（非空·外层为最高 80 阶）', () => {
    const s = buildStagedPersona(STAGED_PERSONA_EXAMPLE);
    expect(s.startsWith('<if cell="好感度表/{{char}}/好感度 >= 80">')).toBe(true);
  });
});
