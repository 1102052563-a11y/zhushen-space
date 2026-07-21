// 只读审计脚本：不写任何文件，只输出报告。
// 覆盖 产出/ 下全部 md：
//   A) 结构完整性（多重H1/多重meta/多重章节 = 疑似两世界内容被拼接）
//   B) README 禁止的凑字/灌水标记
//   C) 复用 compile-worldbook.mjs 同款字数/段落/阶位覆盖/顶点用语校验
//   D) 跨文件 / 文件内 大段重复正文（≥150字，规范化后逐字相同）
//   E) 文件名 / 标题 / 清单名 一致性
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '产出');
const LIST_DIR = path.join(ROOT, '清单');
const MIN_PLOT = 10000, MIN_PLOT_LEISURE = 6000, MIN_ENTRY = 1500, MIN_SOURCES = 3;

const manifest = JSON.parse(fs.readFileSync(path.join(LIST_DIR, 'manifest.json'), 'utf8'));
const byName = new Map(manifest.worlds.map((w) => [w.name, w]));

const BANNED_MARKERS = [
  '【扩写·', '【补密', '【阶段档案', '【剧情补述', '【可介入事件·清单', '【细目',
  '【加厚·', '【加厚·档案', '【加厚·二轮', '【加厚·三轮', '【细则·', '【补段',
  '【扩段', '【再补', '【终卷补强', '【叙事执行细则',
];
const GENERIC_FILLER = ['跨媒介流行作品', '可被契约者切入的完整任务世界'];

const charCount = (s) => (s || '').replace(/\s/g, '').length;

function* walkMd(dir) {
  if (!fs.existsSync(dir)) return;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) yield* walkMd(p);
    else if (it.name.endsWith('.md') && !it.name.startsWith('_')) yield p;
  }
}

function parseMd(file, text) {
  const nameMatches = [...text.matchAll(/^#\s+(.+?)\s*$/gm)];
  const metaMatches = [...text.matchAll(/<!--\s*meta\s+([^>]*?)-->/g)];
  const secRe = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const secHeaderMatches = [...text.matchAll(secRe)];
  const sections = {};
  const marks = secHeaderMatches.map((m) => ({ name: m[1], start: m.index, bodyStart: m.index + m[0].length }));
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    // 若同名段落出现多次，后面覆盖前面（validate 走 compile 同款逻辑）；重复本身在结构检查里单独报
    sections[marks[i].name] = text.slice(marks[i].bodyStart, end).trim();
  }
  return {
    file, text,
    name: nameMatches[0] ? nameMatches[0][1].trim() : '',
    nameCount: nameMatches.length,
    metaCount: metaMatches.length,
    secHeaderMatches,
    sections,
  };
}

function structuralIssues(doc) {
  const issues = [];
  if (doc.nameCount > 1) issues.push(`发现 ${doc.nameCount} 个一级标题(# )，疑似两份内容被拼接`);
  if (doc.metaCount > 1) issues.push(`发现 ${doc.metaCount} 条 <!--meta...--> 行，疑似两份内容被拼接`);
  const counts = {};
  for (const m of doc.secHeaderMatches) counts[m[1]] = (counts[m[1]] || 0) + 1;
  for (const [k, v] of Object.entries(counts)) if (v > 1) issues.push(`「## ${k}」出现 ${v} 次，疑似重复/拼接`);
  return issues;
}

function markerIssues(text) {
  const hits = [];
  for (const m of BANNED_MARKERS) if (text.includes(m)) hits.push(m);
  for (const m of GENERIC_FILLER) if (text.includes(m)) hits.push(m);
  return hits;
}

function validate(doc) {
  const errors = [], warnings = [];
  if (/status=ABORT|reason=age-policy|## ABORT/.test(doc.text)) return { errors, warnings, abort: true, world: byName.get(doc.name) };
  const world = byName.get(doc.name);
  if (doc.name && !world) errors.push(`世界名「${doc.name}」不在清单manifest里`);
  const isLeisure = world && world.lib === '休闲';
  const plot = doc.sections['剧情'], src = doc.sections['来源'];
  const entry = doc.sections['阶位切入点'] || doc.sections['休闲切入点'];
  const minPlot = isLeisure ? MIN_PLOT_LEISURE : MIN_PLOT;
  if (!plot) errors.push('缺 `## 剧情` 段');
  if (!entry) errors.push('缺 切入点 段');
  if (plot && charCount(plot) < minPlot) errors.push(`剧情 ${charCount(plot)} 字 < ${minPlot}`);
  if (entry && charCount(entry) < MIN_ENTRY) errors.push(`切入点 ${charCount(entry)} 字 < ${MIN_ENTRY}`);
  const REQ = isLeisure
    ? ['【作品来源】', '【世界观 · 舞台设定】', '【故事主线 · 情感线】', '【可攻略角色 / 主要人物】', '【氛围基调 · 雷区】']
    : ['【作品来源】', '【世界观 · 力量体系】', '【世界剧情线】', '【主要人物】', '【贵重物品】', '【隐藏剧情 · 伏笔】'];
  if (plot) for (const seg of REQ) if (!plot.includes(seg)) warnings.push(`剧情缺段落 ${seg}`);
  if (world && world.lib === '主库') {
    if (plot && !plot.includes('乐园阶位映射')) warnings.push('剧情缺「乐园阶位映射」锚定行');
    if (entry && !entry.includes('阶位↔')) warnings.push('切入点缺「阶位↔」对照行');
    if (entry) {
      const missing = world.tiers.filter((t) => !entry.includes(`${t}阶`));
      if (missing.length) warnings.push(`切入点未覆盖清单阶位：${missing.join('、')}`);
    }
  }
  const links = (src || '').match(/\]\(https?:\/\/[^)]+\)/g) || [];
  if (links.length < MIN_SOURCES) warnings.push(`来源链接 ${links.length} 条 < ${MIN_SOURCES}`);
  for (const bad of ['被封印', '被削弱', '战力限制', '任务公证限制']) {
    if (entry && entry.includes(bad)) warnings.push(`切入点疑似"${bad}"式顶点解释`);
  }
  return { errors, warnings, world };
}

// ── 主流程 ──
const files = [...walkMd(OUT_DIR)];
console.error(`共 ${files.length} 个文件，开始审计…`);

const paraMap = new Map(); // normalizedPara -> [{file,name}]
const report = [];
let idx = 0;
for (const file of files) {
  idx++;
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const doc = parseMd(file, text);
  const rel = path.relative(ROOT, file);
  const entry = { file: rel, name: doc.name, issues: [] };

  const struct = structuralIssues(doc);
  if (struct.length) entry.issues.push({ type: '结构', detail: struct });

  const markers = markerIssues(text);
  if (markers.length) entry.issues.push({ type: '灌水标记', detail: markers });

  const v = validate(doc);
  if (v.errors.length) entry.issues.push({ type: '机检-错误', detail: v.errors });
  if (v.warnings.length) entry.issues.push({ type: '机检-警告', detail: v.warnings });

  // 文件名 vs 标题
  const base = path.basename(file, '.md');
  if (doc.name && base !== doc.name) {
    // 允许因非法字符被替换为全角－的情况
    const normBase = base.replace(/－/g, '');
    const normName = doc.name.replace(/[\\/:*?"<>|]/g, '');
    if (normBase !== normName) entry.issues.push({ type: '文件名不符', detail: [`文件名「${base}」≠ 标题「${doc.name}」`] });
  }

  // 段落级重复采集（>=150字，规范化：去空白/去markdown符号）
  const allBody = (doc.sections['剧情'] || '') + '\n' + (doc.sections['阶位切入点'] || doc.sections['休闲切入点'] || '');
  const paras = allBody.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  const seenInFile = new Set();
  for (const p of paras) {
    const norm = p.replace(/[\s*#>`_-]/g, '');
    if (norm.length < 150) continue;
    if (seenInFile.has(norm)) {
      entry.issues.push({ type: '文件内重复段', detail: [p.slice(0, 60) + '…'] });
      continue;
    }
    seenInFile.add(norm);
    if (!paraMap.has(norm)) paraMap.set(norm, []);
    paraMap.get(norm).push({ file: rel, name: doc.name, snippet: p.slice(0, 80) });
  }

  if (entry.issues.length) report.push(entry);
  if (idx % 500 === 0) console.error(`  …已处理 ${idx}/${files.length}`);
}

// 跨文件重复段：同一规范化段落出现在 ≥2 个不同世界名的文件里
const crossDup = [];
for (const [, occ] of paraMap) {
  const names = new Set(occ.map((o) => o.name));
  if (names.size > 1) crossDup.push(occ);
}

fs.writeFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), JSON.stringify({ files: files.length, report, crossDup }, null, 1), 'utf8');

console.log(`\n=== 审计完成 ===`);
console.log(`总文件数：${files.length}`);
console.log(`有问题的文件数：${report.length}`);
console.log(`跨世界重复段组数：${crossDup.length}`);
const byType = {};
for (const e of report) for (const i of e.issues) byType[i.type] = (byType[i.type] || 0) + 1;
console.log('按类型汇总：', byType);
console.log('详情见 scripts/_audit_report.json');
