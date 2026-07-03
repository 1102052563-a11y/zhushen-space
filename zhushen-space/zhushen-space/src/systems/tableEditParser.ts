/* ── ACU 表格数据库 · 填表指令解析（写路径）────────────────────────────────
   复刻 ACU native 适配器的 applyEdits（= table-edit-parser.ts 的 ops 函数式方言），
   把「填表AI」输出里的编辑指令解析出来、写进 tableStore。AI 输出形如：
     <content><tableEdit>
       insertRow(表, {"0":"值","1":"值"})
       updateRow(表, 行号, {"0":"值"})
       deleteRow(表, 行号)
     </tableEdit></content>
   健壮性照抄 ACU：只取最后一对 <tableEdit>、无标签时从含命令的 <!-- --> 注释块兜底、
   跨行指令重组、一行多条拆分、剥行内 // 注释、JSON 走 lenientJsonParse 抢救。
   表引用比 ACU 更稳：数字序号(ACU 兼容) / uid / 中文表名 都认。
   设计文档：`指导/ACU星数据库-移植-设计.md` §3 + §6 Step 3。 */
import { lenientJsonParse } from './stateParser';
import { useTables } from '../store/tableStore';

export type TableEditCommand = 'insertRow' | 'updateRow' | 'deleteRow';

export interface ParsedTableCommand {
  command: TableEditCommand;
  /** 解析后的参数：insert=[表引用, data]；update=[表引用, 行号, data]；delete=[表引用, 行号] */
  args: unknown[];
  raw: string;
}

export interface TableEditResult {
  applied: number;
  failed: number;
  modifiedUids: string[];
  errors: string[];
}

const CMD_RE = /(insertRow|updateRow|deleteRow)\s*\(/;

// ── 1. 提取 <tableEdit> 内层 ──────────────────────────────────────────────
/** 取最后一对 <tableEdit>…</tableEdit>；没有标签则从含命令的 <!-- --> 注释块兜底。返回内层文本或 null。 */
export function extractTableEditInner(text: string): string | null {
  if (typeof text !== 'string' || !text) return null;
  const cleaned = normalize(text);

  // 优先：最后一对 <tableEdit>
  const re = /<tableEdit>([\s\S]*?)<\/tableEdit>/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) last = m;
  if (last && typeof last[1] === 'string') return last[1];

  // 兜底：含命令的 <!-- --> 注释块（取最后一个）
  const commentRe = /<!--([\s\S]*?)-->/g;
  let chosen: string | null = null;
  let cm: RegExpExecArray | null;
  while ((cm = commentRe.exec(cleaned)) !== null) {
    if (CMD_RE.test(cm[1] ?? '')) chosen = cm[1];
  }
  if (chosen != null) return chosen;

  // 再兜底：整段里直接有裸命令
  if (CMD_RE.test(cleaned)) return cleaned;
  return null;
}

/** 预清洗（照 ACU normalizeAiResponseForTableEditParsing）。 */
function normalize(text: string): string {
  let c = text.trim();
  c = c.replace(/'\s*\+\s*'/g, '');          // 'a' + 'b' 拼接
  if (c.startsWith("'") && c.endsWith("'")) c = c.slice(1, -1); // 外层单引号
  c = c.replace(/\\n/g, '\n');               // 字面 \n → 换行
  c = c.replace(/：/g, ':');                  // 全角冒号
  return c;
}

// ── 2. 拆成一条条命令 ─────────────────────────────────────────────────────
/** 把内层文本拆成命令字符串数组：跨行重组(按花括号配平) + 一行多条拆分 + 剥行内 // 注释。 */
export function splitCommands(inner: string): string[] {
  const editsString = inner.replace(/<!--|-->/g, '').trim();
  if (!editsString) return [];

  // 第一趟：跨行重组（JSON 块可能跨行，用花括号配平判断是否续行）
  const reconstructed: string[] = [];
  let buf = '';
  let inJson = false;
  for (const rawLine of editsString.split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    // 剥行内 // 注释（不在字符串里的）
    if (!inJson && line.includes('//') && !line.includes('"//') && !line.includes("'//")) {
      line = line.split('//')[0].trim();
    }
    if (!line) continue;

    if (!inJson && /^(insertRow|updateRow|deleteRow)/.test(line)) {
      if (buf) reconstructed.push(buf);
      buf = line;
    } else {
      buf += ' ' + line;
    }
    const open = (buf.match(/{/g) || []).length;
    const close = (buf.match(/}/g) || []).length;
    inJson = open > close;
  }
  if (buf) reconstructed.push(buf);

  // 第二趟：一行里挤了多条 → 按 ; + 命令前缀拆
  const out: string[] = [];
  for (const line of reconstructed) {
    const re = /(?:^|;\s*)((?:insertRow|updateRow|deleteRow)\s*\()/g;
    const positions: number[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(line)) !== null) positions.push(mm.index + (mm[0].length - mm[1].length));
    if (positions.length <= 1) {
      out.push(line.replace(/;\s*$/, ''));
    } else {
      for (let i = 0; i < positions.length; i++) {
        const start = positions[i];
        const end = i + 1 < positions.length ? positions[i + 1] : line.length;
        const sub = line.substring(start, end).replace(/;\s*$/, '').trim();
        if (sub) out.push(sub);
      }
    }
  }
  return out;
}

// ── 3. 解析一条命令 ───────────────────────────────────────────────────────
/** 解析 `insertRow(表,{...})` / `updateRow(表,行,{...})` / `deleteRow(表,行)` → 结构；失败返回 null。 */
export function parseCommandLine(rawLine: string): ParsedTableCommand | null {
  let line = rawLine.trim();
  // 尾部 ) 后的 // 注释
  if (/\)\s*;?\s*\/\/.*$/.test(line)) line = line.replace(/\/\/.*$/, '').trim();
  const match = line.match(/^(insertRow|updateRow|deleteRow)\s*\(([\s\S]*)\)\s*;?$/);
  if (!match) return null;
  const command = match[1] as TableEditCommand;
  const argsString = match[2];

  const firstBrace = argsString.indexOf('{');
  let args: unknown[];
  if (firstBrace === -1) {
    // 无数据对象（deleteRow，或 AI 少写了）
    const parsed = lenientJsonParse(`[${normalizeParams(argsString)}]`);
    if (parsed === undefined || !Array.isArray(parsed)) return null;
    args = parsed;
  } else {
    const paramsPart = normalizeParams(argsString.substring(0, firstBrace)).replace(/,\s*$/, '');
    const jsonPart = quoteNumericKeys(argsString.substring(firstBrace));
    const params = lenientJsonParse(`[${paramsPart}]`);
    const data = lenientJsonParse(jsonPart);
    if (params === undefined || !Array.isArray(params) || data === undefined) return null;
    args = [...params, data];
  }
  return { command, args, raw: line };
}

/** 参数区（表引用/行号）容错：全角逗号→半角、去首尾空白。全角冒号已在 normalize 全局处理。 */
function normalizeParams(s: string): string {
  return s.replace(/，/g, ',').trim();
}

/** 给裸数字键补引号（AI 常把 `{"0":..}` 漏成 `{0:..}`；共享的 lenientJsonParse 只认字母开头的键）。 */
function quoteNumericKeys(s: string): string {
  return s.replace(/([{,]\s*)(\d+)(\s*):/g, '$1"$2":');
}

/** 纯解析：文本 → 命令数组（供测试/预览，不写 store）。 */
export function parseTableEdits(text: string): ParsedTableCommand[] {
  const inner = extractTableEditInner(text);
  if (!inner) return [];
  const cmds: ParsedTableCommand[] = [];
  for (const line of splitCommands(inner)) {
    const p = parseCommandLine(line);
    if (p) cmds.push(p);
  }
  return cmds;
}

// ── 4. 解析并应用到 tableStore ────────────────────────────────────────────
/** 表引用（数字序号/uid/中文表名）→ uid；找不到返回 null。 */
function resolveUid(ref: unknown): string | null {
  const st = useTables.getState();
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref))) {
    const idx = typeof ref === 'number' ? ref : parseInt(ref, 10);
    const sheet = st.sortedSheets()[idx];
    return sheet ? sheet.uid : null;
  }
  const s = String(ref ?? '').trim();
  if (!s) return null;
  if (st.getSheet(s)) return s;                                   // 直接是 uid
  const byName = st.sortedSheets().find((sh) => sh.name === s);   // 中文表名
  return byName ? byName.uid : null;
}

function toRowIndex(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function asData(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = val == null ? '' : String(val);
  }
  return out;
}

/** 解析 AI 文本里的填表指令并写进 tableStore。返回应用统计。 */
export function applyTableEdits(text: string): TableEditResult {
  const result: TableEditResult = { applied: 0, failed: 0, modifiedUids: [], errors: [] };
  const commands = parseTableEdits(text);
  const st = useTables.getState();
  const touched = new Set<string>();

  for (const { command, args, raw } of commands) {
    try {
      const uid = resolveUid(args[0]);
      if (!uid) { result.failed++; result.errors.push(`表未匹配：${raw}`); continue; }

      if (command === 'insertRow') {
        const data = asData(args[1]);
        if (!data) { result.failed++; result.errors.push(`insertRow 数据无效：${raw}`); continue; }
        const ri = st.insertRow(uid, data);
        if (ri < 0) { result.failed++; result.errors.push(`insertRow 被拒（单行表？）：${raw}`); continue; }
      } else if (command === 'updateRow') {
        const ri = toRowIndex(args[1]);
        const data = asData(args[2]);
        if (!Number.isFinite(ri) || !data) { result.failed++; result.errors.push(`updateRow 参数无效：${raw}`); continue; }
        if (!st.updateRow(uid, ri, data)) { result.failed++; result.errors.push(`updateRow 未命中行：${raw}`); continue; }
      } else {
        const ri = toRowIndex(args[1]);
        if (!Number.isFinite(ri)) { result.failed++; result.errors.push(`deleteRow 行号无效：${raw}`); continue; }
        if (!st.deleteRow(uid, ri)) { result.failed++; result.errors.push(`deleteRow 未命中/被拒：${raw}`); continue; }
      }
      result.applied++;
      touched.add(uid);
    } catch (e) {
      result.failed++;
      result.errors.push(`应用异常：${raw} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  result.modifiedUids = [...touched];
  return result;
}
