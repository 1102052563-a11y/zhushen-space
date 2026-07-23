import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), 'utf8'));
const output = [];
const write = (line = '') => output.push(line);
const escapeTable = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const repetitionTypes = new Set(['灌水标记', '文件内重复段', '结构']);

const localIssues = data.report.filter((entry) => entry.issues.some((issue) => repetitionTypes.has(issue.type)));
const crossFiles = new Set(data.crossDup.flatMap((group) => group.map((occurrence) => occurrence.file)));

write('# 产出库重复与无意义内容审计');
write();
write('> 生成时间：2026-07-23。扫描范围：`产出/` 下全部 Markdown 文件。');
write();
write('## 判定口径');
write();
write('- **灌水标记**：README 明确禁止的扩写、补段、阶段档案、叙事执行细则等元写作或编号凑字标记。');
write('- **文件内重复**：同一文件内去除空白与 Markdown 符号后完全相同、且长度不少于 150 字的段落。');
write('- **结构性重复**：重复一级标题、meta 行或关键 `##` 章节，通常意味着内容被拼接或整段重复。');
write('- **跨世界重复**：不同世界文件间出现去除空白与 Markdown 符号后完全相同、且长度不少于 150 字的正文段落。此项为机器筛查结果，个别作品共用的官方简介仍建议人工复核。');
write();
write('## 汇总');
write();
write(`- 已扫描文件：**${data.files}**`);
write(`- 命中灌水标记、文件内重复或结构性重复的文件：**${localIssues.length}**`);
write(`- 涉及跨世界重复的段落组：**${data.crossDup.length}**`);
write(`- 涉及跨世界重复的世界文件：**${crossFiles.size}**`);
write();
write('## 文件内无意义或重复内容');
write();
write('| 世界 | 文件 | 检测类型 | 检测详情 |');
write('|---|---|---|---|');
for (const entry of localIssues.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'))) {
  const issues = entry.issues.filter((issue) => repetitionTypes.has(issue.type));
  write(`| ${escapeTable(entry.name || '（无标题）')} | \`${escapeTable(entry.file)}\` | ${escapeTable(issues.map((issue) => issue.type).join('、'))} | ${escapeTable(issues.map((issue) => issue.detail.join('；')).join('；'))} |`);
}
write();
write('## 跨世界重复大段');
write();
write('以下每一组均列出所有命中的世界文件与检测到的重复正文片段。组号仅用于本报告内定位。');
write();
const groups = [...data.crossDup].sort((a, b) => b.length - a.length || a[0].file.localeCompare(b[0].file, 'zh-CN'));
groups.forEach((group, index) => {
  const names = [...new Set(group.map((occurrence) => occurrence.name || '（无标题）'))];
  write(`### 组 ${index + 1}（${names.length} 个世界，${group.length} 处命中）`);
  write();
  write(`> 片段：${escapeTable(group[0].snippet)}`);
  write();
  for (const occurrence of group) {
    write(`- **${escapeTable(occurrence.name || '（无标题）')}**：\`${escapeTable(occurrence.file)}\``);
  }
  write();
});

const destination = path.join(ROOT, '产出重复无意义内容审计.md');
fs.writeFileSync(destination, output.join('\n'), 'utf8');
console.log(`已生成 ${path.basename(destination)}，共 ${output.length} 行。`);
