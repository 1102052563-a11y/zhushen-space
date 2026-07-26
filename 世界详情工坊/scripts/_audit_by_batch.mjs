import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '产出');
const AUDIT_PATH = path.join(ROOT, 'scripts', '_audit_report.json');
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));

const REPAIRED = /<!--\s*(?:repaired|qa)\b[^>]*-->/i;
const ABORT = /status=ABORT|reason=(?:age-policy|unverified-source)|##\s+ABORT/i;
const explicitPatterns = [
  ['禁止灌水标记', /【(?:扩写·|补密|阶段档案|剧情补述|可介入事件·清单|细目|加厚·|细则·|补段|扩段|再补|终卷补强|叙事执行细则|独有细描)/g],
  ['卷段推演', /卷段推演\s*\d+/g],
  ['人物微弧', /人物微弧\s*\d+/g],
  ['因果补述', /因果补述\s*\d+/g],
  ['场景执行', /场景执行\s*\d+/g],
  ['现场记录', /【?现场记录(?:·|：|\s)/g],
  ['窗口模板', /(?:一|二|三|四|五|六|七|八|九)阶[·：]?窗口[A-ZＡ-Ｚ]/g],
  ['开局账本', /开局账本/g],
  ['开局三问', /开局三问/g],
  ['场景调用备忘', /场景调用备忘/g],
  ['档案齐备', /档案齐备/g],
  ['要求契约者', /要求契约者/g],
  ['可观察动作', /可观察动作/g],
  ['奖励不越级', /奖励不越级/g],
  ['关键NPC必须加粗', /关键\s*NPC\s*必须加粗|关键NPC必须加粗/g],
  ['本阶补充', /本阶补充/g],
  ['阶段纪要', /阶段纪要/g],
  ['人物补录', /人物补录/g],
  ['契约者锚点', /契约者锚点/g],
  ['元写作句', /本段用于|写作时应|本段只追加|本段据公开资料|供开局加厚|写卡自检|验收自检/g],
];

function charCount(value) {
  return (value || '').replace(/\s/g, '').length;
}

function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'm'));
  return match ? match[1].trim() : '';
}

function templateLineGroups(text) {
  const groups = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 70) continue;
    const normalized = line
      .replace(/[0-9０-９]+/g, '#')
      .replace(/[a-f0-9]{4,}/gi, '<hex>')
      .replace(/[一二三四五六七八九十百]+(?=页|卷|段|阶|条|轮|幕|章)/g, '#')
      .replace(/[\s*_`>#-]/g, '');
    if (normalized.length < 60) continue;
    const item = groups.get(normalized) || { count: 0, sample: line.slice(0, 100) };
    item.count++;
    groups.set(normalized, item);
  }
  return [...groups.values()].filter((item) => item.count >= 3).sort((a, b) => b.count - a.count);
}

const auditByFile = new Map(audit.report.map((entry) => [entry.file.replace(/\\/g, '/'), entry]));
const crossByFile = new Map();
audit.crossDup.forEach((group, index) => {
  const worlds = new Set(group.map((item) => item.name)).size;
  for (const occurrence of group) {
    const key = occurrence.file.replace(/\\/g, '/');
    const list = crossByFile.get(key) || [];
    list.push({ group: index + 1, occurrences: group.length, worlds, snippet: occurrence.snippet });
    crossByFile.set(key, list);
  }
});

const batchDirs = fs.readdirSync(OUT_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^批次\d+$/.test(entry.name))
  .sort((a, b) => Number(a.name.slice(2)) - Number(b.name.slice(2)));

const batches = [];
for (const dirent of batchDirs) {
  const batch = Number(dirent.name.slice(2));
  const dir = path.join(OUT_DIR, dirent.name);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_'))
    .map((entry) => path.join(dir, entry.name));
  const row = {
    batch,
    directory: `产出/${dirent.name}`,
    files: files.length,
    repaired: 0,
    abort: 0,
    hardErrors: 0,
    warnings: 0,
    filenameIssues: 0,
    structuralIssues: 0,
    internalDuplicates: 0,
    crossDuplicateGroups: 0,
    explicitTemplateHits: 0,
    repeatedTemplateGroups: 0,
    status: '自动初筛通过',
    details: [],
  };
  const batchCrossGroups = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const title = (text.match(/^#\s+(.+?)\s*$/m) || [])[1] || path.basename(file, '.md');
    const repaired = REPAIRED.test(text);
    const abort = ABORT.test(text);
    if (repaired) row.repaired++;
    if (abort) row.abort++;

    const entry = auditByFile.get(rel);
    const issues = entry?.issues || [];
    const hard = issues.filter((issue) => issue.type === '机检-错误').flatMap((issue) => issue.detail);
    const warnings = issues.filter((issue) => issue.type === '机检-警告').flatMap((issue) => issue.detail);
    const names = issues.filter((issue) => issue.type === '文件名不符').flatMap((issue) => issue.detail);
    const structures = issues.filter((issue) => issue.type === '结构').flatMap((issue) => issue.detail);
    const internal = issues.filter((issue) => issue.type === '文件内重复段').flatMap((issue) => issue.detail);
    row.hardErrors += hard.length;
    row.warnings += warnings.length;
    row.filenameIssues += names.length;
    row.structuralIssues += structures.length;
    row.internalDuplicates += internal.length;

    const fingerprints = [];
    for (const [label, pattern] of explicitPatterns) {
      const matches = text.match(pattern) || [];
      if (matches.length) {
        row.explicitTemplateHits += matches.length;
        fingerprints.push(`${label}×${matches.length}`);
      }
    }
    const repeated = templateLineGroups(text);
    row.repeatedTemplateGroups += repeated.length;

    const cross = crossByFile.get(rel) || [];
    for (const group of cross) batchCrossGroups.add(group.group);

    if (hard.length || warnings.length || names.length || structures.length || internal.length || fingerprints.length || repeated.length || abort) {
      row.details.push({
        file: rel,
        title,
        repaired,
        abort,
        plotChars: charCount(section(text, '剧情')),
        entryChars: charCount(section(text, '阶位切入点') || section(text, '休闲切入点')),
        hard,
        warnings,
        filename: names,
        structure: structures,
        internalDuplicates: internal,
        fingerprints,
        repeatedTemplates: repeated.slice(0, 5),
        crossGroups: cross.slice(0, 10),
      });
    }
  }
  row.crossDuplicateGroups = batchCrossGroups.size;
  if (row.hardErrors || row.structuralIssues || row.internalDuplicates || row.explicitTemplateHits || row.repeatedTemplateGroups) {
    row.status = '明确问题';
  } else if (row.warnings || row.filenameIssues || row.crossDuplicateGroups || row.abort) {
    row.status = '需人工复核';
  }
  batches.push(row);
}

const summary = {
  generatedAt: new Date().toISOString(),
  batchDirectories: batches.length,
  files: batches.reduce((sum, row) => sum + row.files, 0),
  statuses: Object.fromEntries(['自动初筛通过', '需人工复核', '明确问题'].map((status) => [status, batches.filter((row) => row.status === status).length])),
};

fs.writeFileSync(path.join(ROOT, 'scripts', '_batch_audit.json'), JSON.stringify({ summary, batches }, null, 1), 'utf8');

const md = [];
md.push('# 世界详情工坊 · 全批次逐一确认表');
md.push('');
md.push(`> 生成时间：${summary.generatedAt}`);
md.push(`> 实际批次目录：**${summary.batchDirectories}**；世界文件：**${summary.files}**。`);
md.push(`> 状态：自动初筛通过 **${summary.statuses['自动初筛通过']}**；需人工复核 **${summary.statuses['需人工复核']}**；明确问题 **${summary.statuses['明确问题']}**。`);
md.push('');
md.push('## 判定说明');
md.push('');
md.push('- `自动初筛通过`：当前没有机检错误、显式元模板、文件内重复或审计警告；仍需批次人工确认后才能标为最终确认。');
md.push('- `需人工复核`：存在跨文件重复、软警告、ABORT 或文件名兼容字符等，需要判断是否合理。');
md.push('- `明确问题`：存在机检错误、结构重复、文件内重复、显式模板指纹或同文件机械复写。');
md.push('');
md.push('| 批次 | 状态 | 文件 | 已标记 | ABORT | 硬错误 | 警告 | 文件名 | 结构/内重 | 模板命中 | 机械复写组 | 跨文件重复组 |');
md.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const row of batches) {
  md.push(`| ${row.batch} | ${row.status} | ${row.files} | ${row.repaired} | ${row.abort} | ${row.hardErrors} | ${row.warnings} | ${row.filenameIssues} | ${row.structuralIssues + row.internalDuplicates} | ${row.explicitTemplateHits} | ${row.repeatedTemplateGroups} | ${row.crossDuplicateGroups} |`);
}
md.push('');
md.push('## 问题明细');
md.push('');
for (const row of batches.filter((item) => item.status !== '自动初筛通过')) {
  md.push(`### 批次 ${row.batch} · ${row.status}`);
  md.push('');
  for (const detail of row.details) {
    const issues = [];
    if (detail.abort) issues.push('ABORT');
    if (detail.hard.length) issues.push(`硬错误：${detail.hard.join('；')}`);
    if (detail.warnings.length) issues.push(`警告：${detail.warnings.join('；')}`);
    if (detail.filename.length) issues.push(`文件名：${detail.filename.join('；')}`);
    if (detail.structure.length) issues.push(`结构：${detail.structure.join('；')}`);
    if (detail.internalDuplicates.length) issues.push(`文件内重复：${detail.internalDuplicates.join('；')}`);
    if (detail.fingerprints.length) issues.push(`模板：${detail.fingerprints.join('、')}`);
    if (detail.repeatedTemplates.length) issues.push(`机械复写：${detail.repeatedTemplates.map((item) => `${item.count}×${item.sample}`).join('；')}`);
    if (detail.crossGroups.length) issues.push(`跨文件重复组：${detail.crossGroups.map((item) => `#${item.group}`).join('、')}`);
    md.push(`- **${detail.title}**：\`${detail.file}\`（剧情 ${detail.plotChars} / 切入 ${detail.entryChars}）${detail.repaired ? ' · 已有修复标记' : ''}`);
    if (issues.length) md.push(`  ${issues.join('；')}`);
  }
  md.push('');
}
fs.writeFileSync(path.join(ROOT, '全批次逐一确认表.md'), md.join('\n'), 'utf8');

console.log(JSON.stringify(summary, null, 2));
console.log('已生成 scripts/_batch_audit.json 与 全批次逐一确认表.md');
