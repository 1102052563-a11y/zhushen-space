// 验证并打"已修复"标志。执行者每修完一个文件调用：
//   node scripts/_verify_and_mark.mjs "产出/批次NN/<世界名>.md"
// 通过全部门禁 → 在 meta 行后插入 <!--repaired: 20260721--> 标志并退出0；
// 不通过 → 打印原因，退出2，不打标志（说明还得继续修）。
//
// 门禁（一个文件"算修好"的标准）：
//   1. 机检无错误（复用 compile-worldbook 的字数/必备段落/阶位覆盖/清单名规则）
//   2. 标题、meta 的 lib / tiers 与 manifest 精确一致
//   3. 剧情正文只使用模板规定的【】段落，无 README 禁止的灌水标记
//   4. 无文件内 >=150字 完全重复段
//   5. 有且仅有一个来源段，且包含至少 3 个 https 链接
//   （跨世界重复由全库审计统一复核，不在单文件门禁内——但会提示）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '<!--repaired: 20260721-->';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '清单', 'manifest.json'), 'utf8'));
const byName = new Map(manifest.worlds.map((world) => [world.name, world]));

const BANNED_MARKERS = [
  '【扩写·', '【补密', '【补详', '【阶段档案', '【剧情补述', '【可介入事件·清单', '【细目',
  '【加厚·', '【细则·', '【补段', '【扩段', '【再补', '【终卷补强', '【叙事执行细则',
  '【原作信息增密', '【原作细节增补', '【独有细描',
];
const GENERIC_FILLER = ['跨媒介流行作品', '可被契约者切入的完整任务世界'];
const PLOT_HEADINGS = new Set([
  '作品来源', '世界定位', '世界观 · 力量体系', '地理 · 舞台', '世界剧情线', '主要人物',
  '势力图谱', '贵重物品', '隐藏剧情 · 伏笔', '大事记时间线', '叙事基调 · 雷区',
]);
const norm = (s) => s.replace(/[\s*#>`_-]/g, '');

const rel = process.argv[2];
if (!rel) { console.error('用法：node scripts/_verify_and_mark.mjs "产出/批次NN/<世界名>.md"'); process.exit(1); }
const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
if (!fs.existsSync(abs)) { console.error('文件不存在：' + abs); process.exit(1); }

const problems = [];

// 1. 机检
try {
  execFileSync('node', [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', abs], { stdio: 'pipe' });
} catch (e) {
  const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
  const errs = out.split('\n').filter((l) => l.includes('[错误]'));
  problems.push('机检不过关：' + (errs.join(' ; ') || out.trim().split('\n').slice(-3).join(' ')));
}

const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');

// 2. manifest 与 meta 一致性
const title = text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
const metaMatches = [...text.matchAll(/<!--\s*meta\s+([^>]*?)-->/g)];
const world = title && byName.get(title);
if (!title) problems.push('缺文件首行 `# 世界名` 标题');
else if (!world) problems.push(`标题「${title}」不在 manifest.json`);
if (metaMatches.length !== 1) {
  problems.push(`meta 行应恰有 1 条，实际为 ${metaMatches.length} 条`);
} else if (world) {
  const meta = Object.fromEntries(metaMatches[0][1].trim().split(/\s+/).map((part) => part.split('=')));
  const tiers = (meta.tiers || '').split('、').filter(Boolean);
  if (meta.lib !== world.lib) problems.push(`meta lib=${meta.lib || '缺失'}，manifest 要求 ${world.lib}`);
  if (tiers.join('、') !== world.tiers.join('、')) {
    problems.push(`meta tiers=${meta.tiers || '缺失'}，manifest 要求 ${world.tiers.join('、')}`);
  }
}

// 3. 灌水标记和模板外段落
const hitMarkers = [...BANNED_MARKERS, ...GENERIC_FILLER].filter((m) => text.includes(m));
if (hitMarkers.length) problems.push('仍含灌水标记/套话：' + hitMarkers.join('、'));
const plotStart = text.search(/^##\s+剧情\s*$/m);
const entryStart = text.search(/^##\s+(阶位切入点|休闲切入点)\s*$/m);
if (plotStart !== -1 && entryStart !== -1 && entryStart > plotStart) {
  const plot = text.slice(plotStart, entryStart);
  // All standalone bold plot headings must be one of the template's 【】 headings.
  // Checking only bracketed headings would let unbracketed "补述" sections bypass QA.
  const extraHeadings = [...plot.matchAll(/^\*\*(.+?)\*\*\s*$/gm)]
    .map((match) => match[1])
    .filter((heading) => {
      const templateHeading = heading.match(/^【(.+?)】$/)?.[1];
      return !templateHeading || !PLOT_HEADINGS.has(templateHeading);
    });
  if (extraHeadings.length) problems.push('剧情含模板外【】段落：' + [...new Set(extraHeadings)].join('、'));
}

// 4. 文件内重复段
{
  const secRe = /^##\s+(剧情|阶位切入点|休闲切入点)\s*$/gm;
  const marks = [];
  let m;
  while ((m = secRe.exec(text)) !== null) marks.push({ start: m.index, bodyStart: m.index + m[0].length });
  let dup = 0;
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(marks[i].bodyStart, end);
    const seen = new Set();
    for (const paragraph of body.split(/\n{2,}/)) {
      const n = norm(paragraph.trim());
      if (n.length >= 150) { if (seen.has(n)) dup++; else seen.add(n); }
    }
  }
  if (dup) problems.push(`文件内仍有 ${dup} 处重复段`);
}

// 5. 来源必须是单独的末尾段，避免把正文中的链接误算为可溯源资料。
const sourceMatches = [...text.matchAll(/^##\s+来源\s*$/gm)];
if (sourceMatches.length !== 1) {
  problems.push(`来源段应恰有 1 条，实际为 ${sourceMatches.length} 条`);
} else {
  const sourceText = text.slice(sourceMatches[0].index + sourceMatches[0][0].length);
  const links = sourceText.match(/https:\/\/[^\s)]+/g) || [];
  if (links.length < 3) problems.push(`来源段 https 链接 ${links.length} 条 < 3 条`);
}

if (problems.length) {
  console.log(`❌ 未通过（不打标志），${path.basename(abs)}：`);
  for (const p of problems) console.log('   - ' + p);
  process.exit(2);
}

// 通过 → 插入标志（幂等）
if (!text.includes(MARK)) {
  let newText;
  const metaM = text.match(/^(<!--\s*meta[^>]*-->)\s*$/m);
  if (metaM) {
    newText = text.replace(metaM[0], metaM[0] + '\n' + MARK);
  } else {
    // 没有 meta 行则插在首行标题后
    const titleM = text.match(/^(#\s+.+)$/m);
    newText = titleM ? text.replace(titleM[0], titleM[0] + '\n' + MARK) : MARK + '\n' + text;
  }
  fs.writeFileSync(abs, newText, 'utf8');
}
console.log(`✅ 通过并已打「已修复」标志：${path.basename(abs)}`);
process.exit(0);
