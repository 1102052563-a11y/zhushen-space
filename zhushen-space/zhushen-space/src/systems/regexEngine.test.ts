import { describe, it, expect } from 'vitest';
import { runRegexReplace, filterString, compileFindRegex, regexScriptApplies, escapeRegexLiteral } from './regexEngine';

const S = (replaceString: string, trimStrings: string[] = []) => ({ replaceString, trimStrings });

describe('runRegexReplace（照搬 ST runRegexScript 替换语义）', () => {
  it('$1 捕获组：美化框常见写法', () => {
    const r = runRegexReplace('<htm1fenge>你好世界</htm1fenge>', /<htm1fenge>([\s\S]*?)<\/htm1fenge>/g, S('<div>$1</div>'));
    expect(r).toBe('<div>你好世界</div>');
  });

  it('{{match}} 与 $0 = 整个匹配', () => {
    expect(runRegexReplace('foo', /foo/g, S('[{{match}}]'))).toBe('[foo]');
    expect(runRegexReplace('foo', /foo/g, S('[$0]'))).toBe('[foo]');
  });

  it('$<name> 命名捕获组', () => {
    const r = runRegexReplace('<b>标题</b>', /<b>(?<t>[\s\S]*?)<\/b>/g, S('<h1>$<t></h1>'));
    expect(r).toBe('<h1>标题</h1>');
  });

  it('$$ → 字面 $（不当捕获）', () => {
    expect(runRegexReplace('x', /x/g, S('价格$$5'))).toBe('价格$5');
  });

  it('trimStrings：捕获内容插入前先过滤（ST 行为，原生裸替换没有）', () => {
    const r = runRegexReplace('<x>hello**</x>', /<x>([\s\S]*?)<\/x>/g, S('<i>$1</i>', ['**']));
    expect(r).toBe('<i>hello</i>');   // 原生 replace 会得到 <i>hello**</i>
  });

  it('无捕获组时 $1 原样保留（不误插 offset/字符串）', () => {
    // /foo/ 无捕获组，回调 args=[match,offset,string]；naive 实现会把 offset(数字)当 $1
    expect(runRegexReplace('foo', /foo/g, S('[$1]'))).toBe('[$1]');
  });

  it('$n 超出捕获组数：原样保留', () => {
    expect(runRegexReplace('<a>Z</a>', /<a>([\s\S]*?)<\/a>/g, S('$1$2$3'))).toBe('Z$2$3');
  });

  it('捕获内容含 $ 序列：字面插入，绝不二次解析', () => {
    const r = runRegexReplace('<b>价格 $5 与 $1</b>', /<b>([\s\S]*?)<\/b>/g, S('<i>$1</i>'));
    expect(r).toBe('<i>价格 $5 与 $1</i>');
  });

  it('多处匹配（g 标志）全部替换', () => {
    const r = runRegexReplace('<c>甲</c>和<c>乙</c>', /<c>([\s\S]*?)<\/c>/g, S('「$1」'));
    expect(r).toBe('「甲」和「乙」');
  });

  it('filterString：逐个删除 trimStrings', () => {
    expect(filterString('a**b**c', ['**'])).toBe('abc');
    expect(filterString('keep', [])).toBe('keep');
  });

  // ── 宏（照 ST substituteParams，只作用替换模板）──
  const fakeMacro = (s: string) => s.replace(/\{\{char\}\}/g, '林源').replace(/\$\{世界\}/g, '轮回乐园');

  it('模板宏先展开、再回填捕获', () => {
    const r = runRegexReplace('<b>台词</b>', /<b>([\s\S]*?)<\/b>/g, S('<p>{{char}}说：$1</p>'), fakeMacro);
    expect(r).toBe('<p>林源说：台词</p>');
  });

  it('${名} 运行时变量宏也在模板层展开', () => {
    const r = runRegexReplace('<b>x</b>', /<b>([\s\S]*?)<\/b>/g, S('[${世界}]$1'), fakeMacro);
    expect(r).toBe('[轮回乐园]x');
  });

  it('捕获内容里的 {{char}} 不被展开（防注入·比 ST 稳）', () => {
    const r = runRegexReplace('<b>{{char}}</b>', /<b>([\s\S]*?)<\/b>/g, S('<p>$1</p>'), fakeMacro);
    expect(r).toBe('<p>{{char}}</p>');
  });

  it('{{match}} 在宏展开前已转 $0，不被"未识别宏清空"吞掉', () => {
    const stripUnknown = (s: string) => s.replace(/\{\{[^}]+\}\}/g, '');   // 模拟宏引擎清掉未识别宏
    const r = runRegexReplace('foo', /foo/g, S('[{{match}}]'), stripUnknown);
    expect(r).toBe('[foo]');
  });
});

describe('compileFindRegex（/pattern/flags 兼容 + flags 消毒）', () => {
  it('裸 pattern + 独立 flags', () => {
    const c = compileFindRegex('极其', 'g')!;
    expect(c.pattern).toBe('极其');
    expect(c.flags).toBe('g');
    expect('极其好'.replace(c.re, '')).toBe('好');
  });
  it('/pattern/flags 包裹格式：斜线内 flags 优先合并', () => {
    const c = compileFindRegex('/foo/i', 'g')!;
    expect(c.pattern).toBe('foo');
    expect([...c.flags].sort().join('')).toBe('gi');
  });
  it('非法 flags 字符被剔除、缺省补 g', () => {
    expect(compileFindRegex('a', 'gxz')!.flags).toBe('g');
    expect(compileFindRegex('a', '')!.flags).toBe('g');
  });
  it('空 pattern / 非法正则 → null（不抛）', () => {
    expect(compileFindRegex('', 'g')).toBeNull();
    expect(compileFindRegex('([', 'g')).toBeNull();
  });
});

describe('regexScriptApplies（stage/target/depth 统一过滤谓词）', () => {
  const base = { disabled: false, findRegex: 'x', placement: [1] as number[], markdownOnly: undefined, promptOnly: undefined, minDepth: undefined, maxDepth: undefined };
  it('三视图（本项目改编版）：display 跳过 promptOnly、prompt 跳过 markdownOnly、alter-chat 两边都跑', () => {
    expect(regexScriptApplies({ ...base, promptOnly: true }, { stage: 'display' })).toBe(false);
    expect(regexScriptApplies({ ...base, promptOnly: true }, { stage: 'prompt' })).toBe(true);
    expect(regexScriptApplies({ ...base, markdownOnly: true }, { stage: 'prompt' })).toBe(false);
    expect(regexScriptApplies({ ...base, markdownOnly: true }, { stage: 'display' })).toBe(true);
    expect(regexScriptApplies(base, { stage: 'display' })).toBe(true);
    expect(regexScriptApplies(base, { stage: 'prompt' })).toBe(true);
  });
  it('placement 分流：target=user 只认 0；target=ai 认 1/2（ST 旧码兼容）', () => {
    expect(regexScriptApplies({ ...base, placement: [0] }, { stage: 'prompt', target: 'user' })).toBe(true);
    expect(regexScriptApplies({ ...base, placement: [0] }, { stage: 'prompt' })).toBe(false);
    expect(regexScriptApplies({ ...base, placement: [1] }, { stage: 'prompt', target: 'user' })).toBe(false);
    expect(regexScriptApplies({ ...base, placement: [2] }, { stage: 'prompt' })).toBe(true);
  });
  it('Min/Max Depth：仅在传入 depth 时过滤，缺省/null 不限', () => {
    const s = { ...base, minDepth: 2, maxDepth: 5 };
    expect(regexScriptApplies(s, { stage: 'prompt', depth: 0 })).toBe(false);   // 最新楼在范围外
    expect(regexScriptApplies(s, { stage: 'prompt', depth: 2 })).toBe(true);
    expect(regexScriptApplies(s, { stage: 'prompt', depth: 5 })).toBe(true);
    expect(regexScriptApplies(s, { stage: 'prompt', depth: 6 })).toBe(false);
    expect(regexScriptApplies(s, { stage: 'prompt' })).toBe(true);              // 不传 depth = 不按深度过滤
    expect(regexScriptApplies({ ...base, minDepth: null, maxDepth: null }, { stage: 'prompt', depth: 99 })).toBe(true);
  });
  it('bakedPromptOnly（旧楼层无 raw）：只放行 promptOnly 脚本', () => {
    expect(regexScriptApplies(base, { stage: 'prompt', bakedPromptOnly: true })).toBe(false);            // alter-chat 已烙进 content，不重跑
    expect(regexScriptApplies({ ...base, promptOnly: true }, { stage: 'prompt', bakedPromptOnly: true })).toBe(true);
  });
  it('disabled / 空 findRegex 恒不跑', () => {
    expect(regexScriptApplies({ ...base, disabled: true }, { stage: 'display' })).toBe(false);
    expect(regexScriptApplies({ ...base, findRegex: '' }, { stage: 'display' })).toBe(false);
  });
});

describe('escapeRegexLiteral（substituteRegex=2 转义模式）', () => {
  it('正则特殊字符全部转义成字面量', () => {
    const name = '林源(主角)+.星?';
    const re = new RegExp(escapeRegexLiteral(name), 'g');
    expect('提到林源(主角)+.星?了'.replace(re, 'X')).toBe('提到X了');
  });
});
