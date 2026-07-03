import { describe, it, expect } from 'vitest';
import { inferViewScopes } from './settingsStore';
import type { RegexScript } from './settingsStore';

const base: RegexScript = { id: 'x', scriptName: 's', findRegex: '', replaceString: '', trimStrings: [], placement: [1], disabled: false, flags: 'g' };
const mk = (o: Partial<RegexScript>): RegexScript => ({ ...base, ...o });

describe('inferViewScopes 自动视图作用域（照 ST 惯例，用户无需手动调）', () => {
  it('replaceString 产出 HTML → markdownOnly（美化框只作用显示）', () => {
    const [r] = inferViewScopes([mk({ findRegex: '<htm1fenge>([\\s\\S]*?)</htm1fenge>', replaceString: '<div style="x">$1</div>' })]);
    expect(r.markdownOnly).toBe(true);
    expect(r.promptOnly).toBeUndefined();
  });

  it('配套删框：删空 + 标签被某美化正则包成 HTML → promptOnly（对AI隐藏，不从屏幕删空）', () => {
    const out = inferViewScopes([
      mk({ id: 'render', findRegex: '<htm1fenge>([\\s\\S]*?)</htm1fenge>', replaceString: '<div>$1</div>' }),
      mk({ id: 'hide', findRegex: '<htm1fenge>[\\s\\S]*?</htm1fenge>', replaceString: '' }),
    ]);
    expect(out.find((s) => s.id === 'render')!.markdownOnly).toBe(true);
    expect(out.find((s) => s.id === 'hide')!.promptOnly).toBe(true);
    expect(out.find((s) => s.id === 'hide')!.markdownOnly).toBeUndefined();
  });

  it('删空但标签无对应美化（反极其 / 杀缩进类）→ 不动，保持 alter-chat 两视图都跑', () => {
    const [r] = inferViewScopes([mk({ findRegex: '极其', replaceString: '' })]);
    expect(r.markdownOnly).toBeUndefined();
    expect(r.promptOnly).toBeUndefined();
  });

  it('删空 + 有标签但该标签没被美化（如 <thinking>）→ 不动（等同内置思考剥离，两视图都剥）', () => {
    const [r] = inferViewScopes([mk({ findRegex: '<thinking>[\\s\\S]*?</thinking>', replaceString: '' })]);
    expect(r.markdownOnly).toBeUndefined();
    expect(r.promptOnly).toBeUndefined();
  });

  it('显式 markdownOnly/promptOnly 绝不被推断覆盖', () => {
    const [r] = inferViewScopes([mk({ findRegex: '<x>([\\s\\S]*?)</x>', replaceString: '<div>$1</div>', markdownOnly: false, promptOnly: true })]);
    expect(r.markdownOnly).toBe(false);
    expect(r.promptOnly).toBe(true);
  });

  it('纯文本替换（非 HTML、非删空）→ 不动，保持 alter-chat', () => {
    const [r] = inferViewScopes([mk({ findRegex: 'foo', replaceString: 'bar' })]);
    expect(r.markdownOnly).toBeUndefined();
    expect(r.promptOnly).toBeUndefined();
  });

  it('幂等：对已推断结果再跑一次不变（applyRegex 使用时兜底也安全）', () => {
    const once = inferViewScopes([
      mk({ id: 'render', findRegex: '<box>([\\s\\S]*?)</box>', replaceString: '<div>$1</div>' }),
      mk({ id: 'hide', findRegex: '<box>[\\s\\S]*?</box>', replaceString: '' }),
    ]);
    const twice = inferViewScopes(once);
    expect(twice.find((s) => s.id === 'render')!.markdownOnly).toBe(true);
    expect(twice.find((s) => s.id === 'hide')!.promptOnly).toBe(true);
  });
});
