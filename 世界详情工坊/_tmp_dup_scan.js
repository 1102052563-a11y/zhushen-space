const fs = require('fs');
const path = require('path');

const base = process.argv[2];
const files = [];
for (let b = 101; b <= 200; b++) {
  const dir = path.join(base, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md') && !x.startsWith('_'))) {
    files.push({ batch: b, name: f, full: path.join(dir, f) });
  }
}

function normalize(s) {
  return s.replace(/\s+/g, '').replace(/[，。、；：""''（）【】\-\—·…]/g, '');
}

// Extract sentences/paragraphs >= 40 chars (normalized)
function chunks(text) {
  const parts = text.split(/(?:\r?\n){2,}|。|！|？/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const n = normalize(p);
    if (n.length >= 40) out.push({ raw: p.slice(0, 120), n, len: n.length });
  }
  return out;
}

const withinDup = [];
const hashToFiles = new Map(); // chunk hash -> [{file, batch}]
const fileMeta = [];

const badMarkers = /【加厚|【扩写|【补密|【剧情补述|【可介入事件·清单|【细目\d|【补段|【扩段|【再补|【终卷补强|【叙事执行细则|【加厚·档案|【加厚·二轮|【加厚·三轮/;
const genericPhrases = [
  '跨媒介流行作品',
  '可被契约者切入的完整任务世界',
  '本阶可刷：假货、护送',
  '转化为可观察细节',
  '应转化为可观察',
];

const markerFiles = [];
const genericFiles = [];

for (const f of files) {
  const c = fs.readFileSync(f.full, 'utf8');
  if (badMarkers.test(c)) markerFiles.push(`${f.batch}/${f.name}`);
  for (const g of genericPhrases) {
    if (c.includes(g)) genericFiles.push(`${f.batch}/${f.name} :: ${g}`);
  }

  // within-file: identical normalized chunks of len>=60 appearing 2+
  const ch = chunks(c);
  const cnt = new Map();
  for (const x of ch) {
    if (x.len < 60) continue;
    cnt.set(x.n, (cnt.get(x.n) || 0) + 1);
  }
  const dups = [];
  for (const [n, count] of cnt) {
    if (count >= 2) {
      const sample = ch.find(x => x.n === n);
      dups.push({ count, len: n.length, sample: sample.raw.replace(/\s+/g, ' ').slice(0, 80) });
    }
  }
  if (dups.length) {
    dups.sort((a,b) => b.count * b.len - a.count * a.len);
    withinDup.push({ file: `${f.batch}/${f.name}`, dups: dups.slice(0, 5), totalDupKinds: dups.length });
  }

  // cross-file: index long chunks >= 80
  for (const x of ch) {
    if (x.len < 80) continue;
    // skip very common structural labels
    if (/^阶位|切入身份|初始事件|开场白|关键NPC|主线钩子|危险度|任务方向|作品来源|世界定位/.test(x.raw.trim())) continue;
    const key = x.n.slice(0, 200); // first 200 normalized chars as key for near-dup
    if (!hashToFiles.has(key)) hashToFiles.set(key, []);
    const arr = hashToFiles.get(key);
    // only store one entry per file
    if (!arr.some(e => e.full === f.full)) {
      arr.push({ batch: f.batch, name: f.name, full: f.full, sample: x.raw.replace(/\s+/g, ' ').slice(0, 100), len: x.len });
    }
  }
}

// cross-file dups: same chunk in 2+ different files
const cross = [];
for (const [key, arr] of hashToFiles) {
  if (arr.length >= 2) {
    // only care if different files
    const names = [...new Set(arr.map(a => a.name))];
    if (names.length >= 2 || arr.length >= 2) {
      cross.push({
        files: arr.map(a => `${a.batch}/${a.name}`),
        len: arr[0].len,
        sample: arr[0].sample,
        fileCount: arr.length
      });
    }
  }
}
cross.sort((a,b) => b.fileCount * b.len - a.fileCount * a.len);

// Also check pairwise similarity of full 剧情 sections for series clones
function plotSection(c) {
  const m = c.match(/## 剧情\s*([\s\S]*?)(?=## 阶位切入点|## 来源|$)/);
  return m ? normalize(m[1]) : '';
}

// Jaccard on 50-char shingles for same-batch / similar-name pairs would be heavy;
// instead: exact 200-char window fingerprint collisions already covered.

const out = {
  totalFiles: files.length,
  markerFiles: [...new Set(markerFiles)],
  genericFiles: [...new Set(genericFiles)],
  withinDupTop: withinDup.sort((a,b) => b.totalDupKinds - a.totalDupKinds).slice(0, 40),
  withinDupCount: withinDup.length,
  crossTop: cross.slice(0, 50),
  crossCount: cross.length,
};

const outPath = path.join(base, '..', '_dup_report_101_200.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({
  totalFiles: out.totalFiles,
  markerFiles: out.markerFiles.length,
  genericFiles: out.genericFiles.length,
  withinDupFiles: out.withinDupCount,
  crossBlocks: out.crossCount,
  outPath
}, null, 2));
// print top within
console.log('\n=== TOP WITHIN-FILE DUPS ===');
for (const w of out.withinDupTop.slice(0, 25)) {
  console.log(`\n${w.file} kinds=${w.totalDupKinds}`);
  for (const d of w.dups.slice(0, 3)) console.log(`  x${d.count} len=${d.len} | ${d.sample}`);
}
console.log('\n=== TOP CROSS-FILE DUPS ===');
for (const c of out.crossTop.slice(0, 30)) {
  console.log(`\nx${c.fileCount} len=${c.len} | ${c.sample}`);
  console.log('  ' + c.files.join(' || '));
}
console.log('\n=== MARKERS ===');
console.log(out.markerFiles.slice(0, 30).join('\n'));
console.log('\n=== GENERIC ===');
console.log(out.genericFiles.slice(0, 30).join('\n'));
