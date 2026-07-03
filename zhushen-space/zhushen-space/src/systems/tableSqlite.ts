/* ── 表格数据库 · sql.js 只读镜像（读路径 6b·方案 A）──────────────────────
   懒加载 sql.js（≈1MB wasm·独立 chunk·只在预设真用到 {[db]}/{[sql]} 时才拉），
   从 tableStore 当前态**现建一个内存 SQLite**，给预设/世界书跑 ORM `{[db.表.where().get()]}` /
   原生 `{[sql "SELECT…"]}` / `<if db|sql>`。tableStore 仍是唯一真相；这里只读、每回合重建（<10ms）。
   **表名/列名直接用中文**（= tableStore 的 sheet.name + 中文表头，SQLite 支持中文标识符，建表时加引号），
   零翻译零跨表撞车；列类型按当前数据推断（纯数字→INTEGER/REAL·否则 TEXT），数值比较才正确。
   移植自 ACU sql-query-var.ts（NameMapper 因中文直用而省去）。设计文档：`指导/…-设计.md` §4.5 + §6 Step 6b。 */
import { useTables } from '../store/tableStore';
import type { SqlJsDatabase, SqlJsStatic } from 'sql.js';

let _sqlStatic: SqlJsStatic | null = null;
let _db: SqlJsDatabase | null = null;
let _loadFailed = false;

/** SQLite 标识符加引号（中文/特殊字符安全）。 */
function q(id: string): string { return '"' + String(id).replace(/"/g, '""') + '"'; }

/** 按整列数据推断类型：全数字→INTEGER/REAL，含非数字或空列→TEXT。 */
function inferType(content: string[][], ci: number): 'INTEGER' | 'REAL' | 'TEXT' {
  let allInt = true, seen = false;
  for (const row of content.slice(1)) {
    const v = row[ci];
    if (v == null || v === '') continue;
    seen = true;
    const n = Number(v);
    if (!Number.isFinite(n)) return 'TEXT';
    if (!Number.isInteger(n)) allInt = false;
  }
  return !seen ? 'TEXT' : allInt ? 'INTEGER' : 'REAL';
}

/** 从 tableStore 现建内存 SQLite 镜像（中文表/列·引号·按数据推断类型）+ 灌当前行。 */
function rebuildMirror(SQL: SqlJsStatic): void {
  const db = new SQL.Database();
  for (const sheet of Object.values(useTables.getState().tables)) {
    const cols = sheet.content[0] ?? [];   // [row_id, 中文列…]
    if (cols.length === 0) continue;
    const defs = cols.map((c, ci) => `${q(String(c))} ${inferType(sheet.content, ci)}`).join(', ');
    try { db.run(`CREATE TABLE ${q(sheet.name)} (${defs});`); } catch (e) { console.warn('[TableSqlite] 建表失败', sheet.name, e); continue; }
    const colList = cols.map((c) => q(String(c))).join(', ');
    for (const row of sheet.content.slice(1)) {
      const vals = cols.map((_c, ci) => escapeParam(row[ci] ?? '')).join(', ');
      try { db.run(`INSERT INTO ${q(sheet.name)} (${colList}) VALUES (${vals});`); } catch { /* 单行坏数据跳过 */ }
    }
  }
  if (_db) { try { _db.close(); } catch { /* */ } }
  _db = db;
}

/** 懒加载 sql.js 并（重）建镜像。返回是否就绪。任何环节失败 → false（读路径静默降级）。 */
export async function ensureSqliteMirror(): Promise<boolean> {
  if (_loadFailed) return false;
  try {
    if (!_sqlStatic) {
      const initSqlJs = (await import('sql.js')).default;
      let config: { locateFile?: (f: string) => string } | undefined;
      if (typeof window !== 'undefined') {
        // 浏览器：Vite `?url` 把 wasm 当静态资源发，locateFile 指过去
        try { const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default; config = { locateFile: () => wasmUrl }; } catch { config = undefined; }
      } // node/vitest：无 window，config=undefined，sql.js 自行定位 node_modules 里的 wasm
      _sqlStatic = await initSqlJs(config);
    }
    rebuildMirror(_sqlStatic);
    return true;
  } catch (e) {
    _loadFailed = true;
    console.warn('[TableSqlite] sql.js 加载/建库失败，{[db]}/{[sql]} 降级为空:', e);
    return false;
  }
}

/** 镜像是否就绪（同步·供模板解析判断）。 */
export function isSqliteReady(): boolean { return !!_db; }

/** 判断某段文本是否用到 sql.js（决定是否值得懒加载）。 */
export function needsSqlite(text: string): boolean {
  return typeof text === 'string' && (/\{\[(db\.|sql\s)/.test(text) || /<if\s+(db|sql)\s*=/i.test(text));
}

// ── 底层查询 ──────────────────────────────────────────────────────────────
function rawQuery(sql: string): { columns: string[]; values: unknown[][] } {
  if (!_db) return { columns: [], values: [] };
  try { const r = _db.exec(sql); return r.length ? { columns: r[0].columns, values: r[0].values } : { columns: [], values: [] }; }
  catch (e) { console.warn(`[TableSqlite] 查询失败: ${sql}`, e); return { columns: [], values: [] }; }
}
function escapeParam(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── ORM 查询构建器（链式 → SQL → rawQuery·标识符全加引号）──────────────────
interface Where { column: string; operator: string; value: any; }
class QueryBuilder {
  private table: string;
  private conds: Where[] = [];
  private orGroups: Where[][] = [];
  private _orderBy: string | null = null;
  private _limit: number | null = null;
  private _offset: number | null = null;
  private _distinct = false;
  private _groupBy: string | null = null;
  private _having: string | null = null;
  constructor(table: string) { this.table = table; }   // 中文表名直用
  where(col: string, opOrVal: any, val?: any): this { if (val !== undefined) this.conds.push({ column: col, operator: String(opOrVal), value: val }); else this.conds.push({ column: col, operator: '=', value: opOrVal }); return this; }
  orWhere(col: string, opOrVal: any, val?: any): this { if (this.conds.length) { this.orGroups.push([...this.conds]); this.conds = []; } return this.where(col, opOrVal, val); }
  whereIn(col: string, values: any[]): this { if (!values?.length) this.conds.push({ column: '1', operator: '=', value: 0 }); else this.conds.push({ column: col, operator: '__IN__', value: values.map(escapeParam).join(', ') }); return this; }
  whereBetween(col: string, min: any, max: any): this { this.conds.push({ column: col, operator: '__BETWEEN__', value: { min, max } }); return this; }
  whereLike(col: string, pat: any): this { this.conds.push({ column: col, operator: '__LIKE__', value: pat }); return this; }
  orderBy(col: string, dir = 'ASC'): this { this._orderBy = `${q(col)} ${/desc/i.test(dir) ? 'DESC' : 'ASC'}`; return this; }
  limit(n: number): this { this._limit = n; return this; }
  offset(n: number): this { this._offset = n; return this; }
  distinct(): this { this._distinct = true; return this; }
  groupBy(col: string): this { this._groupBy = q(col); return this; }
  having(expr: string): this { this._having = expr; return this; }
  private buildSelect(sel: string): string {
    let sql = `SELECT ${this._distinct ? 'DISTINCT ' : ''}${sel} FROM ${q(this.table)}`;
    const andGroup = (cs: Where[]) => cs.map((c) => {
      if (c.operator === '__IN__') return `${q(c.column)} IN (${c.value})`;
      if (c.operator === '__BETWEEN__') return `${q(c.column)} BETWEEN ${escapeParam(c.value.min)} AND ${escapeParam(c.value.max)}`;
      if (c.operator === '__LIKE__') return `${q(c.column)} LIKE ${escapeParam(c.value)}`;
      if (c.column === '1') return '1 = 0';
      if (c.value === null) return c.operator === '=' ? `${q(c.column)} IS NULL` : `${q(c.column)} IS NOT NULL`;
      return `${q(c.column)} ${c.operator} ${escapeParam(c.value)}`;
    }).join(' AND ');
    const groups: Where[][] = [...this.orGroups]; if (this.conds.length) groups.push(this.conds);
    if (groups.length === 1) sql += ` WHERE ${andGroup(groups[0])}`;
    else if (groups.length > 1) sql += ` WHERE ${groups.map((g) => `(${andGroup(g)})`).join(' OR ')}`;
    if (this._groupBy) sql += ` GROUP BY ${this._groupBy}`;
    if (this._having) sql += ` HAVING ${this._having}`;
    if (this._orderBy) sql += ` ORDER BY ${this._orderBy}`;
    if (this._limit !== null) sql += ` LIMIT ${this._limit}`; else if (this._offset !== null) sql += ' LIMIT -1';
    if (this._offset !== null) sql += ` OFFSET ${this._offset}`;
    return sql;
  }
  get(col: string): string | number | null { const r = rawQuery(this.buildSelect(q(col)) + ' LIMIT 1'); return r.values.length ? (r.values[0][0] as any) : null; }
  first(): Record<string, any> | null { const r = rawQuery(this.buildSelect('*') + ' LIMIT 1'); if (!r.values.length) return null; const o: Record<string, any> = {}; r.columns.forEach((c, i) => (o[c] = r.values[0][i])); return o; }
  all(): Record<string, any>[] { const r = rawQuery(this.buildSelect('*')); return r.values.map((row) => { const o: Record<string, any> = {}; r.columns.forEach((c, i) => (o[c] = row[i])); return o; }); }
  count(): number { const r = rawQuery(this.buildSelect('COUNT(*)')); return r.values.length ? Number(r.values[0][0]) || 0 : 0; }
  sum(col: string): number { const r = rawQuery(this.buildSelect(`SUM(${q(col)})`)); return r.values.length ? Number(r.values[0][0]) || 0 : 0; }
  avg(col: string): number { const r = rawQuery(this.buildSelect(`AVG(${q(col)})`)); return r.values.length ? Number(r.values[0][0]) || 0 : 0; }
  max(col: string): number { const r = rawQuery(this.buildSelect(`MAX(${q(col)})`)); return r.values.length ? Number(r.values[0][0]) || 0 : 0; }
  min(col: string): number { const r = rawQuery(this.buildSelect(`MIN(${q(col)})`)); return r.values.length ? Number(r.values[0][0]) || 0 : 0; }
  exists(): boolean { const r = rawQuery(`SELECT EXISTS(${this.buildSelect('1')}) AS e`); return r.values.length ? r.values[0][0] === 1 : false; }
}

function createDbProxy(): Record<string, any> {
  return new Proxy({} as Record<string, any>, { get(_t, prop: string) { return new QueryBuilder(prop); } });
}

// ── 结果格式化 / truthy ────────────────────────────────────────────────────
function formatResult(result: any): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'boolean') return result ? 'true' : 'false';
  if (typeof result === 'number' || typeof result === 'string') return String(result);
  if (Array.isArray(result)) return result.length === 0 ? '' : typeof result[0] === 'object'
    ? result.map((o) => Object.entries(o).map(([k, v]) => `${k}: ${v ?? ''}`).join(', ')).join('\n')
    : result.map(String).join(', ');
  if (typeof result === 'object') return Object.entries(result).map(([k, v]) => `${k}: ${v ?? ''}`).join(', ');
  return String(result);
}
function isTruthy(v: any): boolean {
  if (v === null || v === undefined || v === '' || v === 'false' || v === '0') return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  return true;
}

// ── 表达式求值 ────────────────────────────────────────────────────────────
function evalOrm(expr: string): string {
  try { const e = expr.trim(); if (!e) return ''; const full = e.startsWith('db.') ? e : 'db.' + e; return formatResult(new Function('db', `return ${full}`)(createDbProxy())); }
  catch (err) { console.warn(`[TableSqlite] ORM 失败: ${expr}`, err); return ''; }
}
function evalRawSql(sqlContent: string): string {
  const r = rawQuery(sqlContent.trim());
  if (!r.values.length) return '';
  if (r.values.length === 1 && r.columns.length === 1) return String(r.values[0][0] ?? '');
  if (r.columns.length === 1) return r.values.map((row) => String(row[0] ?? '')).join('\n');
  return r.values.map((row) => r.columns.map((c, i) => `${c}: ${row[i] ?? ''}`).join(', ')).join('\n');
}

// ── as 变量存储 + $v: 引用 ─────────────────────────────────────────────────
let _vars: Record<string, string | number> = {};
function inlineVarRefs(expr: string): string { return expr.replace(/\$v:([a-zA-Z_]\w*)/g, (m, n) => (_vars[n] !== undefined ? String(_vars[n]) : m)); }
function replaceVarRefs(text: string): string { return text.replace(/\$v:([a-zA-Z_]\w*)/g, (m, n) => (_vars[n] !== undefined ? String(_vars[n]) : m)); }

/** 替换 {[db.…]}（括号深度解析，容忍嵌套 []/引号）。 */
function replaceDbExpr(content: string): string {
  const marker = '{[db.'; let out = ''; let i = 0;
  while (i < content.length) {
    const at = content.indexOf(marker, i);
    if (at === -1) { out += content.slice(i); break; }
    out += content.slice(i, at);
    let depth = 1, j = at + 2, sq = false, dq = false, found = false;
    while (j < content.length) {
      const ch = content[j];
      if (ch === "'" && !dq) { sq = !sq; j++; continue; }
      if (ch === '"' && !sq) { dq = !dq; j++; continue; }
      if (!sq && !dq) {
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { if (content[j + 1] === '}') {
          const full = content.slice(at + 2, j); const asM = full.match(/^(.+?)\s+as\s+([a-zA-Z_]\w*)\s*$/);
          if (asM) { const v = evalOrm(inlineVarRefs(asM[1].trim())); _vars[asM[2]] = isNaN(Number(v)) ? v : Number(v); }
          else out += evalOrm(inlineVarRefs(full));
          i = j + 2; found = true; break;
        } else depth++; } }
      }
      j++;
    }
    if (!found) { out += marker; i = at + marker.length; }
  }
  return out;
}
/** 替换 {[sql "…" (as X)?]}。 */
function replaceSqlExpr(content: string): string {
  return content.replace(/\{\[sql\s+(["'])([\s\S]*?)\1(?:\s+as\s+([a-zA-Z_]\w*))?\s*\]\}/g, (_m, _qch, sql, varName) => {
    const v = evalRawSql(sql);
    if (varName) { _vars[varName] = isNaN(Number(v)) || v === '' ? v : Number(v); return ''; }
    return v;
  });
}

// ── 对外：解析 {[db]}/{[sql]}（同步·镜像须已 ensureSqliteMirror）────────────
export function resolveDbSqlTemplates(content: string): string {
  if (!content || !_db || !/\{\[(db\.|sql\s)/.test(content)) return content;
  _vars = {};
  let out = replaceDbExpr(content);
  out = replaceSqlExpr(out);
  out = replaceVarRefs(out);
  return out;
}
/** <if db="…"> 求值。 */
export function evaluateDbCondition(expr: string): boolean {
  if (!_db) return false;
  try { const e = expr.trim(); if (!e) return false; const full = e.startsWith('db.') ? e : 'db.' + e; const r = new Function('db', `return ${full}`)(createDbProxy()); return typeof r === 'boolean' ? r : isTruthy(r); }
  catch { return false; }
}
/** <if sql="…"> 求值。 */
export function evaluateSqlCondition(expr: string): boolean {
  if (!_db) return false;
  const r = rawQuery(expr.trim());
  return r.values.length ? isTruthy(r.values[0][0]) : false;
}
