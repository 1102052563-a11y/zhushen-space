const fs = require('fs');
const path = require('path');
const base = process.argv[2];

const SIG = [
  '可介入事件示例：①护送一批硬通货',
  '**原作主角（若已登场）**',
  '跨媒介流行作品',
  '可被契约者切入的完整任务世界',
  '资源牙人',
  '本地压迫者',
];

const byBatch = {};
const polluted = [];
let clean = 0, dirty = 0;

for (let b = 101; b <= 200; b++) {
  const dir = path.join(base, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  let d = 0, c = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md') && !x.startsWith('_'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const hits = SIG.filter(s => text.includes(s));
    if (hits.length >= 1) {
      dirty++; d++;
      polluted.push({ b, f, hits: hits.length, keys: hits });
    } else { clean++; c++; }
  }
  byBatch[b] = { dirty: d, clean: c };
}

// find first dirty and first clean samples
const firstDirty = polluted[0];
const samplePath = path.join(base, `批次${firstDirty.b}`, firstDirty.f);
const sample = fs.readFileSync(samplePath, 'utf8');
// extract one tier section
const tierM = sample.match(/\*\*[一二三四五六七八九]阶[\s\S]{0,800}/);
console.log(JSON.stringify({
  dirty, clean, total: dirty+clean,
  dirtyPct: (dirty/(dirty+clean)*100).toFixed(1)+'%',
  firstDirtyBatch: firstDirty.b,
  firstDirtyFile: firstDirty.f,
  byBatchSummary: Object.entries(byBatch).filter(([,v])=>v.dirty>0).map(([k,v])=>`${k}:${v.dirty}d/${v.clean}c`).join(', '),
  cleanBatches: Object.entries(byBatch).filter(([,v])=>v.dirty===0).map(([k])=>k).join(','),
  dirtyBatches: Object.entries(byBatch).filter(([,v])=>v.dirty>0).map(([k])=>k).join(','),
}, null, 2));
console.log('\n=== SAMPLE TIER SNIPPET ===\n');
console.log((tierM ? tierM[0] : sample.slice(0,500)).slice(0,600));
