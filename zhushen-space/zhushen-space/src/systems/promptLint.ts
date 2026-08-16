/* ── 🩺 提示词模板语法体检（P2·借鉴 ST-PT getSyntaxErrorInfo 思想·全自写）──────
   对预设中心 / 世界书编辑中的文本做 dry-run 静态检查，返回问题清单（只提示·绝不阻断保存）。
   纯函数无副作用；known 集合由调用方传（vars=runtimeVarCatalog 名 / snippets=片段名）——不传就跳过对应检查。 */

export interface LintIssue { level: 'error' | 'warn'; msg: string; }

const KNOWN_IF = new Set(['seed', 'cell', 'cond', 'db', 'sql', 'var']);
const OPS_RE = /(>=|<=|==|!=|~=|>|<|＝|≥|≤|≦|≠|＞|＜)/;

export function lintPromptTemplate(text: string, known?: { vars?: Set<string>; snippets?: Set<string> }): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!text) return issues;
  // 1) <if 类型合法性
  for (const m of text.matchAll(/<if\s+([a-zA-Z]+)\s*=/g)) {
    const t = (m[1] || '').toLowerCase();
    if (!KNOWN_IF.has(t)) issues.push({ level: 'error', msg: `未知条件类型 <if ${m[1]}>（可用 var/cell/seed/cond/db/sql）` });
  }
  // 2) <if> / </if> 配平
  const opens = (text.match(/<if\s+[a-zA-Z]+\s*=/g) || []).length;
  const closes = (text.match(/<\/if>/gi) || []).length;
  if (opens !== closes) issues.push({ level: 'error', msg: `<if> 与 </if> 数量不配平（${opens} 开 / ${closes} 闭）——不配平的块会原样漏进提示词` });
  // 3) <if var="…">：要有比较运算符；变量名已知性
  for (const m of text.matchAll(/<if\s+var\s*=\s*"([^"]*)"/gi)) {
    const expr = (m[1] || '').trim();
    if (!OPS_RE.test(expr)) issues.push({ level: 'error', msg: `<if var="${expr}"> 缺比较运算符（>= <= == != ~= > <）` });
    else if (known?.vars) {
      const name = expr.split(OPS_RE)[0]?.trim();
      if (name && !known.vars.has(name)) issues.push({ level: 'warn', msg: `变量「${name}」当前未定义（条件按"未知变量"处理：仅 != 判真）` });
    }
  }
  // 4) {{include::名}} 片段存在性
  if (known?.snippets) for (const m of text.matchAll(/\{\{include::([^{}]+?)\}\}/g)) {
    const n = (m[1] || '').trim();
    if (n && !known.snippets.has(n)) issues.push({ level: 'warn', msg: `片段「${n}」不存在（发送时会被置空）` });
  }
  // 5) {{getvar::名}} 已知性
  if (known?.vars) for (const m of text.matchAll(/\{\{getvar::([^}]+)\}\}/g)) {
    const n = (m[1] || '').trim();
    if (n && !known.vars.has(n)) issues.push({ level: 'warn', msg: `{{getvar::${n}}} 当前无此变量（按通道可能置空或原样保留）` });
  }
  // 6) 花括号配平（粗检·${…} 占位符不管——那是合法的原样保留场景）
  const lb = (text.match(/\{\{/g) || []).length, rb = (text.match(/\}\}/g) || []).length;
  if (lb !== rb) issues.push({ level: 'warn', msg: `{{ 与 }} 数量不配平（${lb} / ${rb}）——宏可能没闭合` });
  return issues;
}

/** activeWhen / <if cond> 表达式体检（原子前缀合法性 + var: 名已知性 + var: 缺运算符）。空串=零问题。 */
export function lintCondExpr(expr: string, vars?: Set<string>): LintIssue[] {
  const issues: LintIssue[] = [];
  const e = (expr || '').trim();
  if (!e) return issues;
  const atoms = e.split(/[,|&()]/).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^!+/, '').trim()).filter(Boolean);
  for (const a of atoms) {
    const m = a.match(/^([a-zA-Z]+):/);
    if (!m) continue;   // 无前缀原子按 cell 表达式处理，不检
    const p = m[1].toLowerCase();
    if (!['cell', 'seed', 'var', 'db', 'sql', 'random'].includes(p)) {
      issues.push({ level: 'error', msg: `未知原子前缀「${m[1]}:」（可用 var:/cell:/seed:/random:/db:/sql:）` });
      continue;
    }
    if (p === 'var') {
      const body = a.slice(4).trim();
      if (!OPS_RE.test(body)) issues.push({ level: 'error', msg: `var: 原子「${body}」缺比较运算符` });
      else if (vars) {
        const name = body.split(OPS_RE)[0]?.trim();
        if (name && !vars.has(name)) issues.push({ level: 'warn', msg: `变量「${name}」当前未定义` });
      }
    }
  }
  return issues;
}
