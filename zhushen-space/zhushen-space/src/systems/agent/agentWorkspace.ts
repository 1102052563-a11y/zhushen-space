/* Agent 正文模式 · 内存虚拟工作区（仿 TauriTavern workspace 语义）
   - 根目录：output/ scratch/ plan/（run 级，run 结束即弃；persist/ 属 P1 暂未开）
   - read-before-edit 全套粘性规则（照抄其行为）：
       replace 写已存在文件须先读过；patch 须先读过；部分读下 patch 失败一次即置「必须整读」粘性标志；
       内容 hash 乐观锁防陈旧写；old_string 非唯一要求补上下文或 replace_all。
   - 读返回「元数据首行 + 带行号正文」；写类只回一行摘要（控制上下文膨胀）。
   纯内存、无 store 依赖 → 可单测。 */
import type { AgentToolResult } from './agentTypes';

export const WORKSPACE_ROOTS = ['output', 'scratch', 'plan', 'summaries', 'persist'] as const;   // persist/=跨回合持久（P1·finish 后 promote）；summaries/=阶段小结/子代理结论（对齐 TT 五根）
export const MAIN_ARTIFACT_PATH = 'output/main.md';
export const DIRECT_OUTPUT_PATH = 'output/direct_output.md';

const MAX_READ_CHARS = 30000;   // 单次读上限（它 80k，按 RPG 缩小）
const MAX_READ_LINES = 800;
const MAX_LIST_ENTRIES = 100;
const MAX_SEARCH_HITS = 20;

interface ReadState {
  hash: string;
  fullRead: boolean;
  observed: string[];        // 已读过的文本片段（部分读 patch 的 old_string 必须出自这里）
  needFullRead: boolean;     // 粘性标志：部分读下 patch 失败过 → 下次必须整读
}

/** fnv1a 32-bit → 8 位十六进制（浏览器同步可用，替代 sha256 做陈旧检测） */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function words(s: string): number { return (s.match(/\S+/g) || []).length; }

function err(code: string, message: string): AgentToolResult {
  return { ok: false, content: message, structured: { error: { code, message } }, errorCode: code };
}

/** 路径规范化：拒绝 ..、绝对路径、反斜杠、根外路径；返回 null=非法 */
export function normalizePath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const s = p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.startsWith('/') || s.includes('..') || /^[a-zA-Z]:/.test(s)) return null;
  const root = s.split('/')[0];
  if (!(WORKSPACE_ROOTS as readonly string[]).includes(root)) return null;
  if (s.endsWith('/')) return null;
  return s;
}

export class AgentWorkspace {
  files = new Map<string, string>();
  private readStates = new Map<string, ReadState>();

  listFiles(pathPrefix?: unknown): AgentToolResult {
    const prefix = typeof pathPrefix === 'string' && pathPrefix.trim() ? pathPrefix.trim().replace(/\\/g, '/').replace(/\/$/, '') + '/' : '';
    const rows: string[] = [];
    for (const [p, txt] of this.files) {
      if (prefix && !p.startsWith(prefix)) continue;
      rows.push(`${p}  (${txt.length} chars / ${words(txt)} words)`);
      if (rows.length >= MAX_LIST_ENTRIES) break;
    }
    const content = rows.length ? rows.join('\n') : 'No visible workspace files found.';
    return { ok: true, content, structured: { count: rows.length } };
  }

  searchFiles(query: unknown, limit?: unknown): AgentToolResult {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return err('tool.invalid_arguments', 'query is required');
    const max = Math.max(1, Math.min(MAX_SEARCH_HITS, Number(limit) || 10));
    const hits: string[] = [];
    outer: for (const [p, txt] of this.files) {
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q.toLowerCase())) {
          hits.push(`${p}:${i + 1}: ${lines[i].slice(0, 200)}`);
          if (hits.length >= max) break outer;
        }
      }
    }
    return { ok: true, content: hits.length ? hits.join('\n') : `No matches for "${q}".`, structured: { count: hits.length } };
  }

  readFile(args: Record<string, unknown>): AgentToolResult {
    const path = normalizePath(args.path);
    if (!path) return err('workspace.invalid_path', `invalid workspace path: ${String(args.path ?? '')}`);
    const txt = this.files.get(path);
    if (txt === undefined) return err('workspace.file_not_found', `${path} does not exist`);
    const hasLineMode = args.start_line != null || args.line_count != null;
    const hasCharMode = args.start_char != null;
    if (hasLineMode && hasCharMode) return err('workspace.mixed_read_range', 'line-based and char-based ranges cannot be mixed');

    const allLines = txt.split('\n');
    const hash = textHash(txt);
    let body: string; let observedSlice: string; let full: boolean;
    let meta: string;
    if (hasCharMode) {
      const start = Math.max(0, Math.floor(Number(args.start_char) || 0));
      const maxC = Math.max(1, Math.min(MAX_READ_CHARS, Number(args.max_chars) || MAX_READ_CHARS));
      observedSlice = txt.slice(start, start + maxC);
      body = observedSlice;
      full = start === 0 && start + maxC >= txt.length;
      meta = `${path} chars ${start}-${Math.min(txt.length, start + maxC)} of ${txt.length}, words ${words(observedSlice)} of ${words(txt)}, hash ${hash}${full ? '' : ' (truncated)'}`;
    } else {
      const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
      const wantCount = args.line_count != null ? Math.max(1, Math.floor(Number(args.line_count))) : MAX_READ_LINES;
      const count = Math.min(wantCount, MAX_READ_LINES);
      const slice = allLines.slice(start - 1, start - 1 + count);
      let acc = 0; const kept: string[] = [];
      for (const ln of slice) { if (acc + ln.length > MAX_READ_CHARS && kept.length) break; kept.push(ln); acc += ln.length + 1; }
      observedSlice = kept.join('\n');
      body = kept.map((ln, i) => `${start + i}: ${ln}`).join('\n');
      const end = start + kept.length - 1;
      full = start === 1 && end >= allLines.length;
      meta = `${path} lines ${start}-${end} of ${allLines.length}, chars ${observedSlice.length} of ${txt.length}, hash ${hash}${full ? '' : ' (partial)'}`;
    }
    const st = this.readStates.get(path);
    if (full) this.readStates.set(path, { hash, fullRead: true, observed: [txt], needFullRead: false });
    else this.readStates.set(path, { hash, fullRead: st?.fullRead === true && st.hash === hash, observed: [...(st?.hash === hash ? st.observed : []), observedSlice], needFullRead: st?.hash === hash ? (st?.needFullRead ?? false) : false });
    return { ok: true, content: `${meta}\n${body}`, structured: { path, hash, totalChars: txt.length, fullRead: full } };
  }

  writeFile(args: Record<string, unknown>): AgentToolResult {
    const path = normalizePath(args.path);
    if (!path) return err('workspace.invalid_path', `invalid workspace path: ${String(args.path ?? '')}`);
    const content = typeof args.content === 'string' ? args.content : null;
    if (content === null) return err('tool.invalid_arguments', 'content must be a string');
    const mode = args.mode === 'append' ? 'append' : 'replace';
    const existing = this.files.get(path);
    if (mode === 'replace' && existing !== undefined) {
      const st = this.readStates.get(path);
      if (!st) return err('workspace.write_requires_read', `${path} already exists; read it with workspace_read_file before rewriting it`);
      if (st.hash !== textHash(existing)) return err('workspace.write_stale_file', `${path} changed since you last read it; read it again before rewriting`);
    }
    const next = mode === 'append' && existing !== undefined ? existing + content : content;
    this.files.set(path, next);
    // 写后视作已知全文（自己刚写的内容自己当然知道）
    this.readStates.set(path, { hash: textHash(next), fullRead: true, observed: [next], needFullRead: false });
    const verb = mode === 'append' && existing !== undefined ? 'Appended' : 'Wrote';
    return { ok: true, content: `${verb} ${content.length} chars / ${words(content)} words to ${path}.`, structured: { path, mode, chars: next.length, words: words(next), hash: textHash(next) } };
  }

  applyPatch(args: Record<string, unknown>): AgentToolResult {
    const path = normalizePath(args.path);
    if (!path) return err('workspace.invalid_path', `invalid workspace path: ${String(args.path ?? '')}`);
    const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
    const newStr = typeof args.new_string === 'string' ? args.new_string : '';
    const replaceAll = args.replace_all === true;
    if (!oldStr) return err('workspace.patch_empty_old_string', 'old_string must not be empty');
    if (oldStr === newStr) return err('workspace.patch_no_change', 'old_string and new_string are identical');
    const txt = this.files.get(path);
    if (txt === undefined) return err('workspace.file_not_found', `${path} does not exist`);
    const st = this.readStates.get(path);
    if (!st) return err('workspace.patch_requires_read', 'file must be read with workspace_read_file before applying a patch');
    if (st.needFullRead) return err('workspace.patch_requires_full_read', 'a previous patch attempt for this file failed. Fully read the file with workspace_read_file before applying another patch.');
    if (st.hash !== textHash(txt)) return err('workspace.patch_stale_file', `${path} changed since you last read it; read it again before patching`);
    if (!st.fullRead && replaceAll) {
      st.needFullRead = true;
      return err('workspace.patch_requires_full_read', 'replace_all can modify text outside the range you read. Fully read the file with workspace_read_file before using replace_all.');
    }
    if (!st.fullRead && !st.observed.some((t) => t.includes(oldStr))) {
      st.needFullRead = true;
      return err('workspace.patch_requires_full_read', 'old_string was not in the text you have read for this file. Fully read the file with workspace_read_file before retrying the patch.');
    }
    const count = txt.split(oldStr).length - 1;
    if (count === 0) {
      if (!st.fullRead) st.needFullRead = true;
      return err('workspace.patch_old_string_not_found', 'old_string was not found in the file. Read the file and use the exact current text.');
    }
    if (count > 1 && !replaceAll) {
      return err('workspace.patch_old_string_not_unique', `old_string matched ${count} times; provide more context or set replace_all=true`);
    }
    const next = replaceAll ? txt.split(oldStr).join(newStr) : txt.replace(oldStr, newStr);
    this.files.set(path, next);
    const wasFull = st.fullRead;
    this.readStates.set(path, wasFull
      ? { hash: textHash(next), fullRead: true, observed: [next], needFullRead: false }
      : { hash: textHash(next), fullRead: false, observed: st.observed.map((t) => t.includes(oldStr) ? t.split(oldStr).join(newStr) : t), needFullRead: false });
    return { ok: true, content: `Patched ${path} with ${replaceAll ? count : 1} replacement(s); file now has ${next.length} chars / ${words(next)} words.`, structured: { path, replacements: replaceAll ? count : 1, chars: next.length, hash: textHash(next) } };
  }
}
