// 把"下一批待修复文件"自动切成互不重叠的 K 组，供最多 K 个 agent 并行修复。
//   node scripts/_split_batches.mjs            → 默认 5 组 × 每组 5 个 = 25 个
//   node scripts/_split_batches.mjs 5 5        → 5 组，每组 5 个
//   node scripts/_split_batches.mjs 5 4 P0     → 5 组每组 4 个，只取 P0
// 判定"待修复"＝文件当前没有 <!--repaired--> 标志（实时读文件，已修好的自动跳过）。
// 组与组之间绝不重叠，可安全并行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, '清单', '修复清单.json'), 'utf8'));
const K = parseInt(process.argv[2] || '5', 10);        // 组数（= agent 数，最多5）
const PER = parseInt(process.argv[3] || '5', 10);      // 每组文件数
const onlyPri = process.argv[4] || null;
const MARK = /<!--\s*repaired[^>]*-->/;

let rows = reg.rows.slice();
if (onlyPri) rows = rows.filter((r) => r.priority === onlyPri);

const remaining = [];
let doneCount = 0;
for (const r of rows) {
  const abs = path.join(ROOT, r.file);
  if (!fs.existsSync(abs)) continue;
  if (MARK.test(fs.readFileSync(abs, 'utf8'))) { doneCount++; continue; }
  remaining.push(r);
}

const take = remaining.slice(0, K * PER);
console.log(`\n剩余待修复 ${remaining.length} 个 · 已完成 ${doneCount} 个 · 本轮取 ${take.length} 个，切成 ${Math.min(K, Math.ceil(take.length / PER))} 组\n`);

for (let g = 0; g < K; g++) {
  const group = take.slice(g * PER, (g + 1) * PER);
  if (!group.length) break;
  console.log(`########## 第 ${g + 1} 组（交给第 ${g + 1} 个 agent，共 ${group.length} 个）##########`);
  group.forEach((r, i) => {
    console.log(`${i + 1}) [${r.priority}][${r.lib}] ${r.name}`);
    console.log(`   ${r.file}`);
    console.log(`   问题：${r.issue}`);
  });
  console.log('');
}
if (!take.length) console.log('（没有待修复的了——全部完成）\n');
