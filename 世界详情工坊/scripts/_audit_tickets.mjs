// 把 _audit_report.json 整理成"每文件一张修复工单"，并按批次聚类，方便分派给agent。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), 'utf8'));

const tickets = new Map(); // file -> {file, name, issues:[], crossDupGroups:[]}
for (const e of data.report) {
  tickets.set(e.file, { file: e.file, name: e.name, issues: e.issues, crossDupGroups: [] });
}
// 附加跨世界重复组信息（含关联文件，方便agent知道"和谁重复"）
let gid = 0;
for (const grp of data.crossDup) {
  gid++;
  const names = [...new Set(grp.map((o) => o.name))];
  for (const o of grp) {
    if (!tickets.has(o.file)) tickets.set(o.file, { file: o.file, name: o.name, issues: [], crossDupGroups: [] });
    tickets.get(o.file).crossDupGroups.push({ gid, size: grp.length, names, snippet: o.snippet });
  }
}

const arr = [...tickets.values()];
fs.writeFileSync(path.join(ROOT, 'scripts', '_audit_tickets.json'), JSON.stringify(arr, null, 1), 'utf8');
console.log('总工单数（含仅跨世界重复但无其他issue的）：', arr.length);

// 按批次号聚类统计
const byBatch = {};
for (const t of arr) {
  const m = t.file.match(/批次(\d+)/);
  const b = m ? parseInt(m[1]) : -1;
  (byBatch[b] ??= []).push(t.file);
}
const batches = Object.keys(byBatch).map(Number).sort((a, b) => a - b);
console.log('涉及批次数：', batches.length);
console.log('批次范围：', batches[0], '-', batches[batches.length - 1]);

// 两大重复组的文件清单单独导出，方便Stage1直接使用
const group1 = data.crossDup.slice().sort((a, b) => b.length - a.length)[0];
const group2 = data.crossDup.slice().sort((a, b) => b.length - a.length)[1];
fs.writeFileSync(path.join(ROOT, 'scripts', '_stage1_group1.json'), JSON.stringify(group1, null, 1), 'utf8');
fs.writeFileSync(path.join(ROOT, 'scripts', '_stage1_group2.json'), JSON.stringify(group2, null, 1), 'utf8');
console.log('group1 size', group1.length, 'group2 size', group2.length);

// 检查 group1/group2 涉及批次范围
const g1batches = [...new Set(group1.map((o) => parseInt(o.file.match(/批次(\d+)/)[1])))].sort((a, b) => a - b);
const g2batches = [...new Set(group2.map((o) => parseInt(o.file.match(/批次(\d+)/)[1])))].sort((a, b) => a - b);
console.log('group1 批次范围：', g1batches[0], '-', g1batches[g1batches.length - 1], '共', g1batches.length, '个批次');
console.log('group2 批次范围：', g2batches[0], '-', g2batches[g2batches.length - 1], '共', g2batches.length, '个批次');

// 其余跨世界重复涉及的文件（排除group1/group2成员）
const g1files = new Set(group1.map(o=>o.file)), g2files = new Set(group2.map(o=>o.file));
const restCross = new Set();
for (const grp of data.crossDup) for (const o of grp) if (!g1files.has(o.file) && !g2files.has(o.file)) restCross.add(o.file);
console.log('除两大组外，还有多少文件涉及跨世界重复：', restCross.size);
fs.writeFileSync(path.join(ROOT, 'scripts', '_stage2_restcross.json'), JSON.stringify([...restCross], null, 1), 'utf8');
