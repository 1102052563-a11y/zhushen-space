const fs = require('fs');
const path = require('path');
const root = __dirname;
const patterns = [
  [/独有日常切片：掩饰→真心/g, 'pad_slice'],
  [/合法身份互动\+物证钩子/g, 'pad_hook'],
  [/【切入\d+】/g, 'pad_entry_n'],
  [/·\d+】独有日常/g, 'pad_named_n'],
  [/本阶可刷/g, 'tier_fill'],
  [/跨媒介流行作品/g, 'generic'],
  [/【加厚/g, 'thicken'],
  [/【扩写/g, 'expand'],
];
const bad = [];
let total = 0;
for (let b = 701; b <= 800; b++) {
  const dir = path.join(root, '产出', '批次' + b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !x.startsWith('_'))) {
    total++;
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    const hits = [];
    for (const [re, name] of patterns) {
      const m = c.match(re);
      if (m && m.length) hits.push(name + ':' + m.length);
    }
    // plot length rough
    const plotM = c.match(/## 剧情([\s\S]*?)(?=\n## |$)/);
    const plot = plotM ? plotM[1].replace(/\s/g, '').length : 0;
    const entryM = c.match(/## 休闲切入点([\s\S]*?)(?=\n## |$)/);
    const entry = entryM ? entryM[1].replace(/\s/g, '').length : 0;
    if (hits.length || plot < 6000 || entry < 1500) {
      bad.push({ b, f: f.slice(0, 60), plot, entry, hits, urls: (c.match(/https?:\/\//g) || []).length });
    }
  }
}
bad.sort((a, b) => (b.hits?.length || 0) - (a.hits?.length || 0) || a.plot - b.plot);
console.log(JSON.stringify({ total, badCount: bad.length, sample: bad.slice(0, 40), byBatch: bad.reduce((m, x) => { m[x.b] = (m[x.b] || 0) + 1; return m; }, {}) }, null, 2));
