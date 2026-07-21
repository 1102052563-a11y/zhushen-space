// Track1修复：文件内大段重复(行级，>=150字规范化后完全相同)——保留首次出现，删除后续重复行；
// 若被删行前面紧跟一个"孤立短标题行"（如 **【原作细节增补·1234】**），一并删除该标题行。
// 用法：node scripts/_fix_dedup_infile.mjs --dry   （先只报告，不写盘）
//      node scripts/_fix_dedup_infile.mjs         （实际写盘）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '产出');
const DRY = process.argv.includes('--dry');

function* walkMd(dir) {
  if (!fs.existsSync(dir)) return;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) yield* walkMd(p);
    else if (it.name.endsWith('.md') && !it.name.startsWith('_')) yield p;
  }
}

const norm = (s) => s.replace(/[\s*#>`_-]/g, '');
const HEADER_ONLY = /^\*\*【[^】]{1,60}】\*\*\s*$/;

function dedupeSection(body) {
  const lines = body.split('\n');
  const seen = new Set();
  const kept = [];
  let removed = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (t) {
      const n = norm(t);
      if (n.length >= 150) {
        if (seen.has(n)) {
          // 若上一保留行是孤立短标题行，且紧邻（说明是它的专属标题），一并撤回
          if (kept.length && HEADER_ONLY.test(kept[kept.length - 1].trim())) kept.pop();
          removed++;
          continue;
        }
        seen.add(n);
      }
    }
    kept.push(raw);
  }
  // 折叠三个以上连续空行为两个
  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  return { text, removed };
}

const results = [];
for (const file of walkMd(OUT_DIR)) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const secRe = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const marks = [];
  let m;
  while ((m = secRe.exec(text)) !== null) marks.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length });
  if (!marks.length) continue;
  let changed = false;
  let totalRemoved = 0;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].name === '来源') continue;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(marks[i].bodyStart, end);
    const { text: newBody, removed } = dedupeSection(body);
    if (removed > 0) {
      changed = true;
      totalRemoved += removed;
      text = text.slice(0, marks[i].bodyStart) + newBody + text.slice(end);
    }
  }
  if (changed) {
    const rel = path.relative(ROOT, file);
    results.push({ file: rel, removed: totalRemoved });
    if (!DRY) fs.writeFileSync(file, text, 'utf8');
  }
}

results.sort((a, b) => b.removed - a.removed);
console.log(`${DRY ? '[DRY RUN] ' : ''}处理完成，共 ${results.length} 个文件被去重（累计移除 ${results.reduce((s, r) => s + r.removed, 0)} 处重复行）`);
for (const r of results.slice(0, 40)) console.log(`  ${r.file}: -${r.removed}`);
fs.writeFileSync(path.join(ROOT, 'scripts', '_fix_dedup_result.json'), JSON.stringify(results, null, 1), 'utf8');
