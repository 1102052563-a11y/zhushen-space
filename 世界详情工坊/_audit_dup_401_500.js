const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '产出');

const padMarkers = [
  '【扩写', '【加厚', '【细目', '【补段', '【补密', '【扩段', '【再补',
  '【细则', '【剧情补述', '【阶段档案', '【可介入事件', '【终卷补强',
  '【叙事执行细则', '跨媒介流行作品', '可被契约者切入的完整任务世界',
];
const battle = ['力量体系', '战力', '阶位', '巅峰战力'];

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function ngrams(text, n = 80) {
  const t = text.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i + n <= t.length; i += Math.floor(n / 2)) {
    set.add(t.slice(i, i + n));
  }
  return set;
}

const files = [];
for (let b = 401; b <= 500; b++) {
  const dir = path.join(base, '批次' + b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    const c = fs.readFileSync(fp, 'utf8');
    files.push({ key: b + '/' + f, b, f, fp, c });
  }
}

const padHits = [];
const battleHits = [];
const shortFiles = [];
const lowSrc = [];
const bodyMap = new Map();
const titleMap = new Map();
const charNameReuse = new Map();

for (const item of files) {
  const { key, c } = item;
  for (const m of padMarkers) if (c.includes(m)) padHits.push(key + ':' + m);
  if (c.includes('lib=休闲')) {
    for (const m of battle) if (c.includes(m)) battleHits.push(key + ':' + m);
  }
  const plotM = c.match(/## 剧情([\s\S]*?)(?=\n## )/);
  const plot = plotM ? plotM[1] : '';
  const plotLen = plot.replace(/\s/g, '').length;
  if (plotLen < 6000) shortFiles.push(key + ':' + plotLen);
  const srcM = c.match(/## 来源([\s\S]*)$/);
  const src = srcM ? srcM[1] : '';
  const links = (src.match(/https?:\/\//g) || []).length;
  if (links < 3) lowSrc.push(key + ':links=' + links);

  const body = c
    .replace(/^#[^\n]+\n/, '')
    .replace(/<!--meta[^>]+-->/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const h = hash(body);
  if (!bodyMap.has(h)) bodyMap.set(h, []);
  bodyMap.get(h).push(key);

  // character names like **Name（
  const names = [...c.matchAll(/\*\*([^*（\n]{2,20})（/g)].map((m) => m[1]);
  for (const n of names) {
    if (!charNameReuse.has(n)) charNameReuse.set(n, new Set());
    charNameReuse.get(n).add(key);
  }

  // shared boilerplate sentences (long unique-looking lines)
  item.body = body;
  item.plot = plot;
  item.ng = ngrams(plot, 100);
}

const exactDups = [...bodyMap.entries()].filter(([, v]) => v.length > 1);

// near-duplicate: jaccard on 100-char ngrams, sample pairs within same batch theme groups
// compare each file to next 5 files for speed + random cross
const nearDups = [];
for (let i = 0; i < files.length; i++) {
  for (let j = i + 1; j < Math.min(i + 8, files.length); j++) {
    const a = files[i].ng;
    const b = files[j].ng;
    if (!a.size || !b.size) continue;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const uni = a.size + b.size - inter;
    const jac = inter / uni;
    if (jac >= 0.25) {
      nearDups.push({
        a: files[i].key,
        b: files[j].key,
        jac: jac.toFixed(3),
        inter,
      });
    }
  }
}
// also sample cross-batch: every 50th vs every other 50th
for (let i = 0; i < files.length; i += 25) {
  for (let j = i + 50; j < files.length; j += 50) {
    const a = files[i].ng;
    const b = files[j].ng;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const uni = a.size + b.size - inter;
    const jac = inter / uni;
    if (jac >= 0.2) {
      nearDups.push({
        a: files[i].key,
        b: files[j].key,
        jac: jac.toFixed(3),
        inter,
        cross: true,
      });
    }
  }
}

// template phrase frequency
const phrases = [
  '无单一出版长篇原作',
  '情景档案',
  '点到氛围为止',
  '学会说不',
  '可随时叫停',
  '关店后的告白',
  '欢迎毛巾',
  '见习',
  '契约者',
  '轮回乐园休闲库',
  '整体气质',
  '媒介印象：同人',
  '不写露骨',
  '河堤散步',
  '茶水角',
];
const phraseStats = {};
for (const p of phrases) {
  phraseStats[p] = files.filter((f) => f.c.includes(p)).length;
}

// character names reused across many worlds
const reusedNames = [...charNameReuse.entries()]
  .filter(([, s]) => s.size >= 5)
  .map(([n, s]) => ({ name: n, count: s.size, samples: [...s].slice(0, 5) }))
  .sort((a, b) => b.count - a.count);

// identical opening 200 chars groups
const openMap = new Map();
for (const f of files) {
  const open = f.plot.replace(/\s+/g, ' ').slice(0, 200);
  const h = hash(open);
  if (!openMap.has(h)) openMap.set(h, []);
  openMap.get(h).push(f.key);
}
const openDups = [...openMap.entries()].filter(([, v]) => v.length > 1);

console.log('=== AUDIT 401-500 ===');
console.log('TOTAL', files.length);
console.log('PAD_HITS', padHits.length);
if (padHits.length) console.log(padHits.slice(0, 30).join('\n'));
console.log('BATTLE_HITS', battleHits.length);
if (battleHits.length) console.log(battleHits.slice(0, 40).join('\n'));
console.log('SHORT_PLOT', shortFiles.length);
if (shortFiles.length) console.log(shortFiles.slice(0, 20).join('\n'));
console.log('LOW_SRC', lowSrc.length);
if (lowSrc.length) console.log(lowSrc.slice(0, 20).join('\n'));
console.log('EXACT_BODY_DUP_GROUPS', exactDups.length);
for (const [, v] of exactDups.slice(0, 15)) console.log('  ', v.join(' == '));
console.log('OPEN200_DUP_GROUPS', openDups.length);
for (const [, v] of openDups.slice(0, 15)) console.log('  ', v.join(' == '));
console.log('NEAR_DUP_PAIRS(jac>=0.25 local / 0.2 cross)', nearDups.length);
nearDups
  .sort((a, b) => b.jac - a.jac)
  .slice(0, 25)
  .forEach((d) =>
    console.log(
      `  ${d.jac} ${d.a} <-> ${d.b}${d.cross ? ' [cross]' : ''} inter=${d.inter}`,
    ),
  );
console.log('PHRASE_FREQ');
for (const [p, n] of Object.entries(phraseStats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}\t${p}`);
}
console.log('REUSED_NAMES_TOP20 (>=5 worlds)');
for (const r of reusedNames.slice(0, 20)) {
  console.log(`  ${r.count}\t${r.name}\t${r.samples.join(', ')}`);
}

// write report json
const report = {
  total: files.length,
  padHits,
  battleHits,
  shortFiles,
  lowSrc,
  exactDups: exactDups.map(([, v]) => v),
  openDups: openDups.map(([, v]) => v),
  nearDups: nearDups.slice(0, 50),
  phraseStats,
  reusedNames: reusedNames.slice(0, 40),
};
fs.writeFileSync(
  path.join(__dirname, '_dup_report_401_500.json'),
  JSON.stringify(report, null, 2),
  'utf8',
);
console.log('WROTE _dup_report_401_500.json');
