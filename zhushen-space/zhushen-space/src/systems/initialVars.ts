import { lenientJsonParse } from './stateParser';
import { useVariables, type GameVariable } from '../store/variableStore';
import type { WorldBook } from '../store/settingsStore';

/* ── 🌱 内容包初始变量（P2·借鉴 ST-PT [InitialVariables] 思想）────────────────
   世界书条目标题为 [初始变量] / [InitialVariables] 的条目＝变量种子（建议作者把该条目**禁用**，
   免得 JSON 漏进提示词——识别不看 enabled，禁用照样能提取）。内容两种形态（lenientJsonParse 宽容解析）：
     · 简写对象：{"好感度": 0, "阵营": "中立", "已觉醒": false}（类型按值推断·label=key）
     · 全量数组：[{key, label?, type?, value?, min?, max?, desc?, showInStatusBar?}, ...]
   种入铁则：**已存在的 key 一律跳过**——绝不覆盖玩家定义或进行中的值（配合"数据库只存不删"精神）。
   入口：设置 → 世界书 →「🌱 提取初始变量」按钮（显式操作·不在导入时自动魔法）。 */

const TITLE_RE = /^\[?\s*(初始变量|InitialVariables)\s*\]?$/i;
export function isInitialVarEntry(comment: string | undefined): boolean { return TITLE_RE.test((comment || '').trim()); }

function inferType(v: unknown): GameVariable['type'] { return typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'; }

function coerceValue(type: GameVariable['type'], value: unknown): GameVariable['value'] {
  if (type === 'number') return Number(value) || 0;
  if (type === 'boolean') return Boolean(value);
  return value == null ? '' : String(value);
}

function normDef(raw: unknown): GameVariable | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = String(r.key ?? '').trim();
  if (!key) return null;
  const type: GameVariable['type'] = r.type === 'number' || r.type === 'boolean' || r.type === 'string' ? r.type : inferType(r.value);
  return {
    key,
    label: String(r.label ?? key),
    type,
    value: coerceValue(type, r.value ?? (type === 'number' ? 0 : type === 'boolean' ? false : '')),
    ...(typeof r.min === 'number' ? { min: r.min } : {}),
    ...(typeof r.max === 'number' ? { max: r.max } : {}),
    showInStatusBar: Boolean(r.showInStatusBar ?? false),
    ...(r.desc ? { desc: String(r.desc) } : {}),
  };
}

export function parseInitialVars(content: string): { defs: GameVariable[]; error?: string } {
  let data: unknown;
  try { data = lenientJsonParse(content); } catch { data = undefined; }
  if (data == null || typeof data !== 'object') return { defs: [], error: '内容不是合法 JSON（对象或数组）' };
  const defs: GameVariable[] = [];
  if (Array.isArray(data)) {
    for (const raw of data) { const d = normDef(raw); if (d) defs.push(d); }
  } else {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const key = String(k).trim();
      if (!key) continue;
      const type = inferType(v);
      defs.push({ key, label: key, type, value: coerceValue(type, v), showInStatusBar: false });
    }
  }
  return { defs };
}

/** 扫描全部世界书的 [初始变量] 条目并种入变量管理。已存在 key 跳过；返回统计（面板 toast 用）。 */
export function seedInitialVars(books: WorldBook[]): { entryCount: number; seeded: string[]; skipped: string[]; errors: string[] } {
  const seeded: string[] = [], skipped: string[] = [], errors: string[] = [];
  let entryCount = 0;
  const existing = new Set(useVariables.getState().variables.map((v) => v.key));
  for (const b of books ?? []) {
    for (const e of b.entries ?? []) {
      if (!isInitialVarEntry(e.comment)) continue;
      entryCount++;
      const { defs, error } = parseInitialVars(e.content || '');
      if (error) { errors.push(`《${b.name}》[${e.comment}]：${error}`); continue; }
      for (const d of defs) {
        if (existing.has(d.key)) { skipped.push(d.key); continue; }
        useVariables.getState().upsertDefinition(d);
        existing.add(d.key);
        seeded.push(d.key);
      }
    }
  }
  return { entryCount, seeded, skipped, errors };
}
