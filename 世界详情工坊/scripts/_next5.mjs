// 打印"下一批待修复文件"，供修复执行者每轮取活。
//   node scripts/_next5.mjs        → 默认取 5 个
//   node scripts/_next5.mjs 5      → 取 5 个
//   node scripts/_next5.mjs 5 P0   → 只从 P0 里取 5 个
// 判定"待修复"＝该文件当前【没有】 <!--repaired--> 标志（实时读文件，已修完的自动跳过，无需重跑全库审计）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, '清单', '修复清单.json'), 'utf8'));
const N = parseInt(process.argv[2] || '5', 10);
const onlyPri = process.argv[3] || null; // 'P0'|'P1'|'P2' 或空
const MARK = /<!--\s*repaired[^>]*-->/;

let rows = reg.rows.slice();
if (onlyPri) rows = rows.filter((r) => r.priority === onlyPri);

const remaining = [];
let doneCount = 0, missingCount = 0;
for (const r of rows) {
  const abs = path.join(ROOT, r.file);
  if (!fs.existsSync(abs)) { missingCount++; continue; }
  const txt = fs.readFileSync(abs, 'utf8');
  if (MARK.test(txt)) { doneCount++; continue; }
  remaining.push(r);
}

const batch = remaining.slice(0, N);
console.log(`\n本轮要修复的 ${batch.length} 个世界（共剩 ${remaining.length} 个待修复；已完成 ${doneCount}${onlyPri ? ' [仅' + onlyPri + ']' : ''}）：\n`);
batch.forEach((r, i) => {
  console.log(`${i + 1}. [${r.priority}] [${r.lib}]  ${r.name}`);
  console.log(`   文件：${r.file}`);
  console.log(`   问题：${r.issue}\n`);
});
if (!batch.length) console.log('（没有待修复的了——全部完成，或该优先级已清空）\n');
