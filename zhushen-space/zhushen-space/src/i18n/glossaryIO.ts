/* 翻译映射表 导出 / 导入。
   导出：把「全站界面中文全集（public/ui-strings.json）∪ 内置词库 key ∪ 已有覆盖 key」
        逐条配上当前译文（覆盖 > 内置 > 空）→ 下载 JSON。玩家线下编辑优化后再导入。
   导入：JSON（对象 {中文:译文} 或数组 [[中文,译文]]）→ 只保留非空条目 → 存进 settings.userGlossary。 */
import { EN_EXACT } from './en';
import { VI_EXACT } from './vi';
import { getSeen } from './seen';
import { useSettings, type UiLang } from '../store/settingsStore';

const BUILTIN: Partial<Record<UiLang, Record<string, string>>> = { en: EN_EXACT, vi: VI_EXACT };

/** 组装某语言的可编辑映射表：{中文源: 译文或空}，按中文排序。 */
export async function buildGlossaryTable(lang: UiLang): Promise<Record<string, string>> {
  let sources: string[] = [];
  try {
    const res = await fetch('/ui-strings.json', { cache: 'no-cache' });
    if (res.ok) { const j = await res.json(); if (Array.isArray(j)) sources = j.map(String); }
  } catch { /* 取不到源全集就只用词库 key */ }
  const builtin = BUILTIN[lang] || {};
  const override = useSettings.getState().userGlossary?.[lang] || {};
  // 源字符串全集：静态提取(ui-strings.json) ∪ 运行时真渲染过的(SEEN·补静态漏掉的动态文案) ∪ 内置词库 ∪ 已有覆盖
  const keys = new Set<string>([...sources, ...getSeen(), ...Object.keys(builtin), ...Object.keys(override)]);
  const table: Record<string, string> = {};
  for (const k of [...keys].sort((a, b) => a.localeCompare(b, 'zh-Hans'))) {
    table[k] = override[k] ?? builtin[k] ?? '';
  }
  return table;
}

/** 触发浏览器下载一个 JSON 文件。 */
export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 解析导入的映射表：容忍 {中文:译文} 对象 或 [[中文,译文]] 数组；只保留「有中文源 + 有非空译文」的条目。 */
export function parseGlossaryImport(raw: string): Record<string, string> {
  const data = JSON.parse(raw);
  const out: Record<string, string> = {};
  const put = (k: unknown, v: unknown) => {
    const key = String(k ?? '').trim();
    const val = String(v ?? '').trim();
    if (key && val) out[key] = val;   // 空译文=未翻，跳过（不覆盖）
  };
  if (Array.isArray(data)) {
    for (const row of data) if (Array.isArray(row)) put(row[0], row[1]);
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) put(k, v);
  }
  return out;
}

/** 导出当前语言的映射表并下载。 */
export async function exportGlossary(lang: UiLang): Promise<number> {
  const table = await buildGlossaryTable(lang);
  downloadJson(table, `zhushen-translation-${lang}.json`);
  return Object.keys(table).length;
}
