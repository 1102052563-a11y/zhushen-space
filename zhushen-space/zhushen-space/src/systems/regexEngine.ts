// 正则替换引擎：照搬 SillyTavern public/scripts/extensions/regex/engine.js 的 runRegexScript「替换」语义。
// 关键区别（昕白指出的点）：ST 不是用原生 String.replace(re, replaceString) 把捕获文本「直接」塞进 $1，
// 而是用 replacer 回调，对每个 token 精确回填——且每个捕获值先经 filterString(trimStrings) 过滤再插入。
// 我们此前用原生替换：$1 纯场景结果一样，但漏了 {{match}}/$0、命名组 $<name>、trimStrings 过滤，且原生会多解析 $'/$` 等。
import type { RegexScript } from '../store/settingsStore';

/* filterString：照 ST，把 trimStrings 里每个串从捕获内容中逐个删除（用于清掉标签残渣/多余空白等）。 */
export function filterString(s: string, trimStrings?: string[]): string {
  let out = s;
  for (const t of trimStrings ?? []) if (t) out = out.split(t).join('');
  return out;
}

/* 照 ST 的替换：单次 replace 用回调，token 一次扫描精确回填，绝不把「插入的捕获内容」再当模板二次解析。
   支持：{{match}} 与 $0 = 整个匹配；$1..$n = 编号捕获组；$<name> = 命名捕获组；$$ = 字面 $；$& = 整个匹配。
   每个捕获值插入前先经 filterString(trimStrings)（ST 行为）。
   宏（substituteParams）：照 ST，对替换「模板」展开一次（{{char}}/{{user}}/{{getvar::x}}/${名} 等，由调用方传 expandMacros）；
   与 ST 唯一差别——只展开模板、不展开回填后的捕获内容，故 AI 正文里的 {{…}} 不会被二次展开（防注入，比 ST 更稳）。 */
export function runRegexReplace(
  rawString: string,
  findRegex: RegExp,
  script: Pick<RegexScript, 'replaceString' | 'trimStrings'>,
  expandMacros?: (s: string) => string,
): string {
  const trim = script.trimStrings;
  // 模板级处理（每次匹配都相同，提到回调外算一次）：
  //   ① {{match}} → $0（先保护，避免被下面的宏引擎当未知宏清掉）
  //   ② 宏展开（{{char}}/{{user}}/{{getvar::x}}/${名}…，照 ST 的 substituteParams）——只作用模板；
  //      捕获值($N)在其后才回填，故 AI 正文里的 {{…}} 不会被二次展开（防注入，这点比 ST 稳）
  let tpl = (script.replaceString ?? '').replace(/\{\{match\}\}/gi, '$0');
  if (expandMacros) { try { tpl = expandMacros(tpl); } catch { /* 宏展开失败则用原模板，不阻断替换 */ } }
  return rawString.replace(findRegex, (...args: any[]) => {
    // args = [match, p1, p2, …, offset, string, groups?]；命名组对象（若有）在末尾
    const last = args[args.length - 1];
    const hasGroups = last !== null && typeof last === 'object';
    const groups: Record<string, string> | undefined = hasGroups ? last : undefined;
    const nCaptures = args.length - 3 - (hasGroups ? 1 : 0);   // 编号捕获组个数（尾部固定是 offset,string[,groups]）
    const match0 = String(args[0] ?? '');
    // 单次扫描所有 token 精确回填（不重扫已插入内容）
    return tpl.replace(
      /\$\$|\$&|\$<([^>]+)>|\$(\d+)/g,
      (tok: string, name?: string, num?: string) => {
        if (tok === '$$') return '$';
        if (tok === '$&') return filterString(match0, trim);
        if (name != null) return filterString(String(groups?.[name] ?? ''), trim);
        const i = Number(num);
        if (i === 0) return filterString(match0, trim);                                 // $0 = 整个匹配
        if (i >= 1 && i <= nCaptures) return filterString(args[i] != null ? String(args[i]) : '', trim);
        return tok;   // 超出捕获组范围：原样保留 $n（同原生行为，绝不误插 offset/undefined）
      },
    );
  });
}
