import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), 'utf8'));

const lines = [];
const p = (s) => lines.push(s);

p(`# 世界详情工坊 · 全库审计报告`);
p(``);
p(`总文件数：${data.files}　有问题文件数：${data.report.length}　跨世界重复段组数：${data.crossDup.length}`);
p(``);

function section(title, filterType) {
  const items = data.report.filter((e) => e.issues.some((i) => i.type === filterType));
  p(`## ${title}（${items.length}）`);
  for (const e of items) {
    const iss = e.issues.filter((i) => i.type === filterType);
    for (const i of iss) p(`- \`${e.file}\`：${i.detail.join('；')}`);
  }
  p(``);
}

section('结构异常（疑似两世界内容拼接）', '结构');
section('机检-错误（不过关：字数/段落/清单名）', '机检-错误');
section('文件名与标题不一致', '文件名不符');

{
  const items = data.report.filter((e) => e.issues.some((i) => i.type === '灌水标记'));
  const byMarker = {};
  for (const e of items) for (const i of e.issues.filter((x) => x.type === '灌水标记')) for (const m of i.detail) {
    (byMarker[m] ??= []).push(e.file);
  }
  p(`## 灌水/凑字标记命中（涉及 ${items.length} 个文件）`);
  for (const [m, files] of Object.entries(byMarker).sort((a, b) => b[1].length - a[1].length)) {
    p(`- 「${m}」× ${files.length}：${files.slice(0, 15).join('、')}${files.length > 15 ? ` …等${files.length}个` : ''}`);
  }
  p(``);
}

{
  const items = data.report.filter((e) => e.issues.some((i) => i.type === '机检-警告'));
  p(`## 机检警告（${items.length} 个文件，非致命但值得复核）`);
  const byWarn = {};
  for (const e of items) for (const i of e.issues.filter((x) => x.type === '机检-警告')) for (const w of i.detail) {
    const key = w.replace(/[0-9]+/g, 'N').replace(/：.*$/, '');
    (byWarn[key] ??= []).push(e.file);
  }
  for (const [w, files] of Object.entries(byWarn).sort((a, b) => b[1].length - a[1].length)) {
    p(`- ${w} × ${files.length}：${files.slice(0, 10).join('、')}${files.length > 10 ? ` …等${files.length}个` : ''}`);
  }
  p(``);
}

{
  const items = data.report.filter((e) => e.issues.some((i) => i.type === '文件内重复段'));
  p(`## 文件内大段重复（${items.length} 个文件命中，按重复条数排序，仅列前60）`);
  const withCount = items.map((e) => ({ file: e.file, n: e.issues.filter((i) => i.type === '文件内重复段').length, sample: e.issues.find((i) => i.type === '文件内重复段').detail[0] }));
  withCount.sort((a, b) => b.n - a.n);
  for (const it of withCount.slice(0, 60)) p(`- \`${it.file}\`：重复 ${it.n} 处，例如「${it.sample}」`);
  p(``);
}

{
  p(`## 跨世界重复大段正文（${data.crossDup.length} 组，仅列前80组，每组给出片段与涉及文件）`);
  const sorted = [...data.crossDup].sort((a, b) => b.length - a.length);
  for (const occ of sorted.slice(0, 80)) {
    const names = [...new Set(occ.map((o) => o.name))];
    p(`- 涉及世界【${names.join('、')}】共 ${occ.length} 处：「${occ[0].snippet}」`);
    for (const o of occ) p(`    - \`${o.file}\``);
  }
  p(``);
}

fs.writeFileSync(path.join(ROOT, '_audit_全库_20260721.md'), lines.join('\n'), 'utf8');
console.log('written to _audit_全库_20260721.md, total lines:', lines.length);
