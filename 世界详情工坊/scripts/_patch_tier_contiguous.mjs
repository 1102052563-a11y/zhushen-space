// 就地把 manifest.json 里主库世界的 tiers 补齐为「一阶 ~ 最高阶」的连续区间。
// 铁则：一个世界既然存在高阶切入点，就必然也存在所有低阶切入点，不能只有高阶。
// 会先备份 manifest.json → manifest.json.bak_tier
//   node scripts/_patch_tier_contiguous.mjs --dry   只看不改
//   node scripts/_patch_tier_contiguous.mjs         实际写入
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MP = path.join(ROOT, '清单', 'manifest.json');
const DRY = process.argv.includes('--dry');
const ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const m = JSON.parse(fs.readFileSync(MP, 'utf8'));
let changed = 0;
const samples = [];
for (const w of m.worlds) {
  if (w.lib !== '主库' || !w.tiers || !w.tiers.length) continue;
  const maxIdx = Math.max(...w.tiers.map((t) => ORDER.indexOf(t)));
  if (maxIdx < 0) continue;
  const full = ORDER.slice(0, maxIdx + 1);
  if (full.length !== w.tiers.length || !full.every((t, i) => w.tiers[i] === t)) {
    if (samples.length < 15) samples.push(`${w.name}：${w.tiers.join('、')} → ${full.join('、')}`);
    w.tiers = full;
    changed++;
  }
}
console.log(`需要补齐的主库世界：${changed} 个`);
for (const s of samples) console.log('  · ' + s);
if (changed > 15) console.log(`  …等共 ${changed} 个`);

if (!DRY && changed) {
  fs.copyFileSync(MP, MP + '.bak_tier');
  fs.writeFileSync(MP, JSON.stringify(m, null, 1), 'utf8');
  console.log(`\n已写入 ${path.relative(ROOT, MP)}（原文件备份为 manifest.json.bak_tier）`);
} else if (DRY) {
  console.log('\n[DRY RUN] 未写入');
}
