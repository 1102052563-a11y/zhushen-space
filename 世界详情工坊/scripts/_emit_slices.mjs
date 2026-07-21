import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, '清单', '修复清单.json'), 'utf8'));
const p0 = reg.rows.filter((r) => r.priority === 'P0' && r.status === '待修复');
// 切段：[起,止] 批次闭区间
const slices = {
  A: [0, 177], B: [178, 188], C: [189, 200], D: [201, 610], E: [611, 782], F: [783, 9999],
};
const out = {};
for (const [k, [lo, hi]] of Object.entries(slices)) {
  out[k] = p0.filter((r) => r.batch >= lo && r.batch <= hi);
}
for (const [k, arr] of Object.entries(out)) {
  console.log(`\n===== 段${k}（${arr.length}个）=====`);
  for (const r of arr) console.log(`${r.lib === '休闲' ? '[休闲]' : '[主库]'} ${r.file}  <<${r.issue}>>`);
}
fs.writeFileSync(path.join(ROOT, 'scripts', '_p0_slices.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('\n段大小：', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
