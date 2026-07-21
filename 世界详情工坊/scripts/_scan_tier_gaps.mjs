// 扫描 manifest 里"阶位覆盖不连续"或"不从一阶开始"的世界。
// 规则：主库世界的切入点覆盖应当是 一阶 ~ 最高阶 的【连续区间】，不能只有高阶、不能跳级。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '清单', 'manifest.json'), 'utf8'));
const ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const idx = (t) => ORDER.indexOf(t);

const bad = [];
for (const w of manifest.worlds) {
  if (w.lib !== '主库') continue;
  if (!w.tiers || !w.tiers.length) continue;
  const sorted = w.tiers.slice().sort((a, b) => idx(a) - idx(b));
  const max = idx(sorted[sorted.length - 1]);
  const expected = ORDER.slice(0, max + 1);
  const isContiguousFromOne = sorted.length === expected.length && sorted.every((t, i) => t === expected[i]);
  if (!isContiguousFromOne) {
    bad.push({
      name: w.name,
      now: sorted.join('、'),
      should: expected.join('、'),
      missing: expected.filter((t) => !sorted.includes(t)).join('、'),
    });
  }
}
console.log(`主库世界总数：${manifest.worlds.filter((w) => w.lib === '主库').length}`);
console.log(`阶位覆盖不连续/不从一阶起的世界：${bad.length}\n`);
for (const b of bad.slice(0, 40)) {
  console.log(`· ${b.name}`);
  console.log(`    现有：${b.now}    应为：${b.should}    缺：${b.missing}`);
}
if (bad.length > 40) console.log(`\n…等共 ${bad.length} 个`);
fs.writeFileSync(path.join(ROOT, 'scripts', '_tier_gaps.json'), JSON.stringify(bad, null, 1), 'utf8');
console.log(`\n完整清单已写入 scripts/_tier_gaps.json`);
