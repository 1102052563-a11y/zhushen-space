import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), 'utf8'));

// 需要"内容级修复"（字数不够/跨世界重复雷同）的文件——按批次聚类
const need = new Map();
for (const e of data.report) {
  const wc = e.issues.find(i => i.type === '机检-错误');
  const dupline = e.issues.find(i => i.type === '文件内重复段');
  if (wc || dupline) {
    need.set(e.file, { file: e.file, name: e.name, wcIssues: wc ? wc.detail : [], dupLeft: !!dupline });
  }
}
for (const grp of data.crossDup) {
  for (const o of grp) {
    if (!need.has(o.file)) continue; // 只标注已经因字数问题在册的文件，避免把"仅巧合2处重复"的低价值项也拉进来
    const t = need.get(o.file);
    t.crossDupSnippet ??= [];
    if (t.crossDupSnippet.length < 2) t.crossDupSnippet.push(grp[0].snippet);
  }
}
const arr = [...need.values()];
console.log('需要内容级修复的文件总数：', arr.length);

const byBatch = {};
for (const t of arr) {
  const m = t.file.match(/批次(\d+)/);
  const b = m ? parseInt(m[1]) : -1;
  (byBatch[b] ??= []).push(t);
}
const batches = Object.keys(byBatch).map(Number).sort((a,b)=>a-b);
console.log('涉及批次：', batches.length, '范围', batches[0], '-', batches[batches.length-1]);
fs.writeFileSync(path.join(ROOT, 'scripts', '_fix_worklist.json'), JSON.stringify({byBatch, batches}, null, 1), 'utf8');

// 打印批次->文件数，方便分派
for (const b of batches) console.log(`批次${b}: ${byBatch[b].length}个 -> ${byBatch[b].map(t=>t.name).join('、')}`);
