/* 运行时「见到即记录」：DomI18n 每处理一个界面中文节点，就把它的源文(core)记进这里。
   保证凡是**真正渲染过**的中文（含 systems/ 里的动态文案、枚举等静态提取漏掉的）都能进导出翻译表——
   哪怕静态脚本没扫到那个文件。持久化到 localStorage，跨会话累积。 */
const KEY = 'drpg-i18n-seen';
const CAP = 15000;

let SEEN: Set<string> | null = null;
function load(): Set<string> {
  if (SEEN) return SEEN;
  SEEN = new Set();
  try { const r = localStorage.getItem(KEY); if (r) for (const s of JSON.parse(r) as string[]) SEEN.add(s); } catch { /* */ }
  return SEEN;
}

let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null; if (!dirty) return; dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify([...(SEEN as Set<string>)])); } catch { /* 配额满则跳过·内存仍在 */ }
  }, 4000);
}

/** 记录一条源文（已是去装饰的 core）。去重、封顶、去抖持久化。 */
export function recordSeen(core: string): void {
  if (!core) return;
  const set = load();
  if (set.has(core) || set.size >= CAP) return;
  set.add(core); dirty = true; saveSoon();
}

export function getSeen(): string[] {
  return [...load()];
}
