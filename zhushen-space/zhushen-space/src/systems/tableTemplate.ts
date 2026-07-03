/* ── 表格数据库 · native 模板解析（读路径 6a·纯 JS 同步无依赖）────────────────
   移植 ACU 的读路径里**不需要 SQL 引擎**的那部分，让预设/世界书能引用表数据、做条件：
     · 计算标签：<random min max [id]> / <calc id expr> / <max id values> / <min id values> + $random:/$calc:/$max:/$min:
     · 条件模板：<if cell="表/行/列 op 值">…<else>…</if>、<if seed="关键词(,|&|!()语法)">…</if>、<if cond="cell:…&seed:…|random:…">（复合条件·递归+嵌套）
     · 取值 cell:表名/行名/列名（读 tableStore 当前态）
   SQL 专属（{[db]}/{[sql]}/<if db|sql>）走懒加载 sql.js（Step 6b），本模块不管：未知条件类型一律判否（隐藏该块）。
   接入：App.tsx buildPresetMessages 里，在 processMacros 之前对每个预设块 content 调 resolveTableTemplates。
   设计文档：`指导/ACU星数据库-移植-设计.md` §4.3/§4.4/§4.5 + §6 Step 6。 */
import { useTables } from '../store/tableStore';
import { resolveDbSqlTemplates, evaluateDbCondition, evaluateSqlCondition } from './tableSqlite';   // 6b sql.js：{[db]}/{[sql]}/<if db|sql>

export interface TableTplCtx {
  /** 最新一条 AI 正文（供 <if seed> 关键词检测）。 */
  seedContent?: string;
  /** 随机源（默认 Math.random）。 */
  random?: () => number;
}

// 计算变量存储（每次 resolveTableTemplates 调用时重置，跨标签共享）
let randomVars: Record<string, number> = {};
let calcVars: Record<string, number> = {};
let maxVars: Record<string, number> = {};
let minVars: Record<string, number> = {};

// ── cell 取值（native·读 tableStore）─────────────────────────────────────
/** cell:表名/行名/列名 → 值（数字优先）。行名在任意列匹配；找不到返回 {ok:false}。 */
function getCellValue(tableName: string, rowName: string, colName: string): { ok: boolean; value: number | string } {
  const sheets = Object.values(useTables.getState().tables);
  const table = sheets.find((s) => s.name.trim() === tableName.trim());
  if (!table || !Array.isArray(table.content) || table.content.length < 1) return { ok: false, value: '' };
  const header = table.content[0];
  const col = header.findIndex((h) => String(h ?? '').trim() === colName.trim());
  if (col === -1) return { ok: false, value: '' };
  const rn = rowName.trim();
  const row = table.content.slice(1).find((r) => r.some((c) => String(c ?? '').trim() === rn));
  if (!row) return { ok: false, value: '' };
  const raw = row[col];
  const n = parseFloat(String(raw));
  if (!isNaN(n) && isFinite(n)) return { ok: true, value: n };
  return { ok: true, value: String(raw ?? '') };
}

// ── <if cell="表/行/列 op 值"> 求值 ──────────────────────────────────────
const CMP_OPS = ['>=', '<=', '!=', '==', '>', '<'];
function normalizeOps(expr: string): string {
  return expr.replace(/＞/g, '>').replace(/＜/g, '<').replace(/＝/g, '==').replace(/≥/g, '>=').replace(/≦/g, '<=').replace(/≤/g, '<=').replace(/≠/g, '!=');
}
function compareValue(cell: number | string, op: string, cmp: string): boolean {
  const cmpN = parseFloat(cmp);
  if (!isNaN(cmpN) && typeof cell === 'number') {
    switch (op) { case '>': return cell > cmpN; case '<': return cell < cmpN; case '>=': return cell >= cmpN; case '<=': return cell <= cmpN; case '==': return cell === cmpN; case '!=': return cell !== cmpN; default: return false; }
  }
  const a = String(cell), b = String(cmp);
  switch (op) { case '==': return a === b; case '!=': return a !== b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b; default: return false; }
}
export function evaluateCellExpr(expression: string): boolean {
  const expr = normalizeOps(expression);
  let op = '', ref = '', cmp = '';
  for (const o of CMP_OPS) { const i = expr.indexOf(o); if (i !== -1) { ref = expr.slice(0, i).trim(); cmp = expr.slice(i + o.length).trim(); op = o; break; } }
  if (!op) return false;
  const parts = ref.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    let r = getCellValue(parts[0], parts[1], parts[2]);
    if (r.ok) return compareValue(r.value, op, cmp);
    r = getCellValue(parts[0], parts[2], parts[1]);
    return r.ok ? compareValue(r.value, op, cmp) : op === '!=';
  }
  return false;
}

// ── <if seed="关键词"> 求值（,=或 &=与 !=非 ()分组·大小写不敏感 contains）──
export function evaluateSeed(expression: string, content: string): boolean {
  const expr = (expression ?? '').trim();
  if (!expr || !content) return false;
  const lower = content.toLowerCase();
  const checkKw = (kw: string): boolean => {
    const k = kw.trim();
    if (!k) return false;
    if (k.startsWith('!')) { const a = k.slice(1).trim(); return a ? !lower.includes(a.toLowerCase()) : true; }
    return lower.includes(k.toLowerCase());
  };
  const checkAnd = (g: string) => { const ks = g.split('&').map((x) => x.trim()).filter(Boolean); return ks.length > 0 && ks.every(checkKw); };
  const paren: Record<string, boolean> = {};
  const proc = (e: string): boolean => {
    let p = e; const re = /\(([^()]+)\)/g; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(e)) !== null) { const r = proc(m[1]); p = p.replace(m[0], `__P${i}__`); paren[`__P${i}__`] = r; i++; }
    const ors = p.split(',').map((x) => x.trim()).filter(Boolean);
    const one = (part: string) => (paren[part] !== undefined ? paren[part] : part.includes('&') ? checkAnd(part) : checkKw(part));
    return ors.length > 1 ? ors.some(one) : one(ors[0] || '');
  };
  return proc(expr);
}

// ── 计算表达式：cell:/$random:/$calc:/$max:/$min:/字面数字 → 数值 ──────────
function resolveExprValue(expr: string): number | null {
  const t = expr.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t.startsWith('cell:')) { const p = t.slice(5).split('/').map((x) => x.trim()); if (p.length !== 3) return null; const r = getCellValue(p[0], p[1], p[2]); return r.ok && typeof r.value === 'number' ? r.value : null; }
  const g = (store: Record<string, number>, re: RegExp) => { const m = t.match(re); return m && store[m[1]] !== undefined ? store[m[1]] : null; };
  const r1 = g(randomVars, /^\$random:([a-zA-Z_]\w*)$/); if (r1 !== null) return r1;
  const c1 = g(calcVars, /^\$calc:([a-zA-Z_]\w*)$/); if (c1 !== null) return c1;
  const x1 = g(maxVars, /^\$max:([a-zA-Z_]\w*)$/); if (x1 !== null) return x1;
  const n1 = g(minVars, /^\$min:([a-zA-Z_]\w*)$/); if (n1 !== null) return n1;
  return null;
}
/** 计算含四则+括号的表达式（cell:/$ref 先代入·new Function 白名单求值）。 */
function evalCalc(expr: string): number | null {
  let e = expr.trim();
  // cell 路径允许 `/`（表/行/列分隔），只在空格及其它运算符处断开（`cell:表/行/列 + 5` 靠空格消歧，别写 `列/2` 紧贴）
  e = e.replace(/cell:([^\s+\-*%()]+)/g, (_m, path) => { const p = String(path).split('/').map((x: string) => x.trim()); if (p.length !== 3) return 'NaN'; const r = getCellValue(p[0], p[1], p[2]); return r.ok && typeof r.value === 'number' ? String(r.value) : 'NaN'; });
  const sub = (re: RegExp, store: Record<string, number>) => { e = e.replace(re, (_m, id) => (store[id] !== undefined ? String(store[id]) : 'NaN')); };
  sub(/\$random:([a-zA-Z_]\w*)/g, randomVars); sub(/\$calc:([a-zA-Z_]\w*)/g, calcVars); sub(/\$max:([a-zA-Z_]\w*)/g, maxVars); sub(/\$min:([a-zA-Z_]\w*)/g, minVars);
  if (e.includes('NaN') || !/^[\d+\-*/%().\s]+$/.test(e)) return null;
  try { const v = new Function('return ' + e)() as number; return typeof v === 'number' && isFinite(v) ? Math.floor(v) : null; } catch { return null; }
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];

/** 解析计算标签：定义变量 + 内联无 id 的 <random>。 */
function parseComputedTags(text: string, rng: () => number): string {
  let out = text;
  out = out.replace(/<random\s+([^>]*?)\s*\/?>/gi, (m, a) => {
    const id = attr(a, 'id'); const min = parseInt(attr(a, 'min') ?? '', 10); const max = parseInt(attr(a, 'max') ?? '', 10);
    if (isNaN(min) || isNaN(max)) return m;
    const lo = Math.min(min, max), hi = Math.max(min, max); const v = Math.floor(rng() * (hi - lo + 1)) + lo;
    if (id) { randomVars[id] = v; return ''; } return String(v);
  });
  out = out.replace(/<calc\s+([^>]*?)\s*\/?>/gi, (m, a) => { const id = attr(a, 'id'); const ex = attr(a, 'expr'); if (!id || ex == null) return m; const v = evalCalc(ex); if (v === null) return m; calcVars[id] = v; return ''; });
  const listTag = (tag: string, store: Record<string, number>, pick: (ns: number[]) => number) =>
    out = out.replace(new RegExp(`<${tag}\\s+([^>]*?)\\s*/?>`, 'gi'), (m, a) => {
      const id = attr(a, 'id'); const vals = attr(a, 'values'); if (!id || vals == null) return m;
      const ns: number[] = []; for (const part of vals.split(',').map((x: string) => x.trim()).filter(Boolean)) { const v = resolveExprValue(part); if (v === null) return m; ns.push(v); }
      if (!ns.length) return m; store[id] = pick(ns); return '';
    });
  listTag('max', maxVars, (ns) => Math.max(...ns)); listTag('min', minVars, (ns) => Math.min(...ns));
  return out;
}

/** 替换 $random:/$calc:/$max:/$min: 引用。 */
function replaceRefs(text: string): string {
  return text
    .replace(/\$random:([a-zA-Z_]\w*)/g, (m, id) => (randomVars[id] !== undefined ? String(randomVars[id]) : m))
    .replace(/\$calc:([a-zA-Z_]\w*)/g, (m, id) => (calcVars[id] !== undefined ? String(calcVars[id]) : m))
    .replace(/\$max:([a-zA-Z_]\w*)/g, (m, id) => (maxVars[id] !== undefined ? String(maxVars[id]) : m))
    .replace(/\$min:([a-zA-Z_]\w*)/g, (m, id) => (minVars[id] !== undefined ? String(minVars[id]) : m));
}

// ── <if cond="…"> 复合条件：原子按前缀分派 + &(与) ,|(或) !(非) ()分组 ──────
/** 单个原子求值：`cell:表/行/列 op 值` / `seed:关键词` / `db:…` / `sql:…` / `random:百分比` / 无前缀默认 cell 表达式。允许前导 `!` 取反。 */
function evalCondAtom(raw: string, ctx: TableTplCtx): boolean {
  let a = (raw ?? '').trim();
  if (!a) return false;
  let neg = false;
  while (a.startsWith('!')) { neg = !neg; a = a.slice(1).trim(); }   // 前导 !（注意 cell 里的 != 不在开头，安全）
  const lower = a.toLowerCase();
  let r: boolean;
  if (lower.startsWith('cell:')) r = evaluateCellExpr(a.slice(5));
  else if (lower.startsWith('seed:')) r = evaluateSeed(a.slice(5), ctx.seedContent ?? '');
  else if (lower.startsWith('db:')) r = evaluateDbCondition(a.slice(3));
  else if (lower.startsWith('sql:')) r = evaluateSqlCondition(a.slice(4));
  else if (lower.startsWith('random:')) { const p = parseFloat(a.slice(7)); r = !isNaN(p) && (ctx.random ?? Math.random)() * 100 < p; }
  else r = evaluateCellExpr(a);   // 兼容 <if cond="表/行/列 > 5">（无前缀＝当 cell 表达式）
  return neg ? !r : r;
}
/** <if cond="…"> 复合条件：`,`或`|`＝或、`&`＝与、`!`＝非、`()`＝分组（与 <if seed> 同款逻辑，但原子是带前缀的子条件）。 */
export function evaluateCond(expression: string, ctx: TableTplCtx): boolean {
  const expr = (expression ?? '').trim();
  if (!expr) return false;
  const paren: Record<string, boolean> = {};
  const proc = (e: string): boolean => {
    let p = e; const re = /\(([^()]+)\)/g; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(e)) !== null) { const r = proc(m[1]); const key = `__C${i}__`; p = p.replace(m[0], key); paren[key] = r; i++; }
    const one = (part: string): boolean => {
      const t = part.trim();
      if (paren[t] !== undefined) return paren[t];
      if (t.includes('&')) return t.split('&').map((x) => x.trim()).filter(Boolean).every((x) => (paren[x] !== undefined ? paren[x] : evalCondAtom(x, ctx)));
      return evalCondAtom(t, ctx);
    };
    const ors = p.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
    return ors.length > 1 ? ors.some(one) : one(ors[0] || '');
  };
  return proc(expr);
}

// ── 递归 <if ...>…<else>…</if>（seed/cell/cond 求值·db/sql 走镜像）─────────
const IF_OPEN = /<if\s+(seed|cell|cond|db|sql)\s*=\s*"([^"]*)"\s*>/i;
function evalCond(type: string, expr: string, ctx: TableTplCtx): boolean {
  const t = type.toLowerCase();
  if (t === 'cell') return evaluateCellExpr(expr);
  if (t === 'seed') return evaluateSeed(expr, ctx.seedContent ?? '');
  if (t === 'cond') return evaluateCond(expr, ctx);   // 复合条件（cell:/seed:/db:/sql:/random: 混合 + &,|!()）
  if (t === 'db') return evaluateDbCondition(expr);   // 6b：sql.js 镜像未就绪则判否
  if (t === 'sql') return evaluateSqlCondition(expr);
  return false;
}
function parseIfBlocks(content: string, ctx: TableTplCtx, depth: number): string {
  if (depth > 10) return content;
  let out = '', i = 0;
  while (i < content.length) {
    const rest = content.slice(i);
    const open = rest.match(IF_OPEN);
    if (!open) { out += rest; break; }
    const openAt = i + (open.index ?? 0);
    out += content.slice(i, openAt);
    const parsed = parseSingleIf(content, openAt, open[1], open[2], ctx, depth);
    if (parsed) { out += parsed.text; i = parsed.end; } else { out += open[0]; i = openAt + open[0].length; }
  }
  return out;
}
function parseSingleIf(content: string, start: number, type: string, expr: string, ctx: TableTplCtx, depth: number): { text: string; end: number } | null {
  const openM = content.slice(start).match(/<if\s+(?:seed|cell|cond|db|sql)\s*=\s*"[^"]*"\s*>/i);
  if (!openM) return null;
  let idx = start + openM[0].length, level = 1;
  const bodyStart = idx;
  while (idx < content.length && level > 0) {
    const rest = content.slice(idx);
    const nIf = rest.match(/<if\s+(?:seed|cell|cond|db|sql)\s*=\s*"[^"]*"\s*>/i);
    const nEnd = rest.match(/<\/if>/i);
    const nElse = rest.match(/<else>/i);
    const pos: { t: string; i: number; l: number }[] = [];
    if (nIf) pos.push({ t: 'if', i: idx + (nIf.index ?? 0), l: nIf[0].length });
    if (nEnd) pos.push({ t: 'end', i: idx + (nEnd.index ?? 0), l: nEnd[0].length });
    if (nElse && level === 1) pos.push({ t: 'else', i: idx + (nElse.index ?? 0), l: nElse[0].length });
    if (!pos.length) return null;
    pos.sort((a, b) => a.i - b.i);
    const near = pos[0];
    if (near.t === 'if') { level++; idx = near.i + near.l; }
    else if (near.t === 'end') {
      level--;
      if (level === 0) {
        const body = content.slice(bodyStart, near.i);
        const end = near.i + near.l;
        const elseAt = body.indexOf('<else>');
        const ifC = elseAt !== -1 ? body.slice(0, elseAt) : body;
        const elseC = elseAt !== -1 ? body.slice(elseAt + 6) : '';
        const chosen = evalCond(type, expr, ctx) ? ifC : elseC;
        return { text: parseIfBlocks(replaceRefs(chosen), ctx, depth + 1), end };
      }
      idx = near.i + near.l;
    } else { idx = near.i + near.l; }
  }
  return null;
}

const MARKER = /<if\s|<random|<calc|<max|<min|\$random:|\$calc:|\$max:|\$min:|\{\[/;

/** 解析预设/世界书内容里的表格模板（native + sql.js）。无标记则原样快速返回。
   注：{[db]}/{[sql]}/<if db|sql> 需调用方先 await ensureSqliteMirror()（App.tsx 在拼预设前做），否则镜像未就绪→原样/判否。 */
export function resolveTableTemplates(text: string, ctx: TableTplCtx = {}): string {
  if (!text || !MARKER.test(text)) return text;
  randomVars = {}; calcVars = {}; maxVars = {}; minVars = {};
  const rng = ctx.random ?? Math.random;
  let out = parseComputedTags(text, rng);      // 定义/内联计算变量
  out = resolveDbSqlTemplates(out);            // {[db]}/{[sql]} 查询（镜像就绪才动·否则原样）
  out = parseIfBlocks(out, ctx, 0);            // 条件模板（cell/seed/db/sql·选中分支已替 $ref）
  out = replaceRefs(out);                       // 剩余 $random/$calc/$max/$min
  return out;
}
