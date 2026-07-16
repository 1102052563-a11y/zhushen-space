import { describe, it, expect } from 'vitest';
import { parseDbAdvancePreset, buildModuleMessages, normalizeDbRole } from './dbAdvancePreset';

/* 数据库推进预设 · role 归一 —— 治「导入后消息归属显示错乱／推进模块上面全是 system」
   根因：Stitches 原始预设 role 大小写混乱（SYSTEM/USER 大写、assistant 小写），解析时原样存；
        编辑器 <select> 的 option 全小写 → value="USER" 匹配不到任何 option → 浏览器静默显示第一项 system。*/

describe('normalizeDbRole', () => {
  it('大写折成小写（Stitches 预设里的 SYSTEM / USER）', () => {
    expect(normalizeDbRole('SYSTEM')).toBe('system');
    expect(normalizeDbRole('USER')).toBe('user');
    expect(normalizeDbRole('Assistant')).toBe('assistant');
  });
  it('带空白照样认', () => {
    expect(normalizeDbRole('  USER \n')).toBe('user');
  });
  it('未知/缺失 role → 回落 system', () => {
    expect(normalizeDbRole(undefined)).toBe('system');
    expect(normalizeDbRole('')).toBe('system');
    expect(normalizeDbRole('Al')).toBe('system');
    expect(normalizeDbRole(123)).toBe('system');
  });
});

describe('★解析即归一：存进来的 role 必须能被小写 <select> 选中（否则显示成 system＝谎报归属）', () => {
  const raw = {
    name: 'stitches-mof',
    plotTasks: [{
      id: 'recall', name: '召回', order: 0, extractTags: 'recall', extractInjectTags: '', minLength: 0,
      promptGroup: [
        { role: 'SYSTEM', content: '[RESET ROLE AND TASK]' },
        { role: 'USER', content: 'User：以下是输出格式要求' },
        { role: 'assistant', content: 'Edward:了解了。' },
      ],
    }],
    finalSystemDirective: '',
  };

  it('★SYSTEM/USER 大写 → 解析后就是小写规范值', () => {
    const p = parseDbAdvancePreset(raw)!;
    expect(p.plotTasks[0].promptGroup.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('★归一后的值全部落在编辑器 <select> 的选项集合内（不会再回退显示第一项）', () => {
    const OPTIONS = ['system', 'user', 'assistant'];   // 与 DbAdvancePresetEditor 的 ROLES 同一套
    const p = parseDbAdvancePreset(raw)!;
    for (const m of p.plotTasks[0].promptGroup) expect(OPTIONS).toContain(m.role);
  });

  it('buildModuleMessages 送出的 role 也是规范小写（兜老存档里的大写残留）', () => {
    const mod = { id: 'x', name: '推进', order: 0, extractTags: '', extractInjectTags: '', minLength: 0,
      promptGroup: [{ role: 'USER', content: '$8' }] };
    expect(buildModuleMessages(mod, { input: '我出剑' })).toEqual([{ role: 'user', content: '我出剑' }]);
  });
});
