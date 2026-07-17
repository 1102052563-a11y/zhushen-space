const fs = require('fs');
const path = require('path');

let t = fs.readFileSync('清单/批次表.md', 'utf8').replace(/^\uFEFF/, '');
const m = JSON.parse(fs.readFileSync('清单/manifest.json', 'utf8'));
const byName = new Map(m.worlds.map((w) => [w.name, w]));

const batches = {};
const re = /## 批次(\d+)[^\n]*\n([\s\S]*?)(?=\n## 批次|\s*$)/g;
let x;
while ((x = re.exec(t))) {
  const n = +x[1];
  if (n < 601 || n > 700) continue;
  const names = [];
  for (const line of x[2].split(/\n/)) {
    const mm = line.match(/^- \[[ xX]\] (.+)$/);
    if (!mm) continue;
    let name = mm[1].trim();
    name = name.replace(/（新增[^）]*）\s*$/, '').trim();
    name = name.replace(/（主库[^）]*）\s*$/, '').trim();
    name = name.replace(/（休闲[^）]*）\s*$/, '').trim();
    names.push(name);
  }
  batches[n] = names;
}

const missing = [];
const short = [];
for (let n = 601; n <= 700; n++) {
  const names = batches[n] || [];
  const dir = path.join('产出', '批次' + n);
  const have = new Set();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      have.add(f.slice(0, -3));
    }
  }
  for (const name of names) {
    if (!have.has(name)) {
      const w = byName.get(name);
      missing.push({
        n,
        name,
        lib: w ? w.lib : '?',
        tiers: w ? w.tiers.join('、') : '?',
      });
    }
  }
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      const plot = (txt.match(/## 剧情[\s\S]*?(?=\n## |$)/) || [''])[0].replace(/\s/g, '').length;
      const tier = (txt.match(/## 阶位切入点[\s\S]*?(?=\n## |$)/) || [''])[0].replace(/\s/g, '').length;
      const lei = (txt.match(/## 休闲切入点[\s\S]*?(?=\n## |$)/) || [''])[0].replace(/\s/g, '').length;
      const pad = /【扩写|【补密|【加厚|【再补|【补段|【剧情补述|【细目\d|跨媒介流行作品/.test(txt);
      const links = ((txt.match(/## 来源[\s\S]*$/) || [''])[0].match(/https?:\/\/[^\s)\]]+/g) || []).length;
      if (plot < 10000 || (tier < 1500 && lei < 1500) || pad || links < 3) {
        short.push({ n, f, plot, tier, lei, pad, links });
      }
    }
  }
}

console.log('parsed batches', Object.keys(batches).length);
console.log('B621', batches[621]);
console.log('B622', batches[622]);
console.log('B625', batches[625]);
console.log('MISSING', missing.length);
console.log(missing.map((x) => `B${x.n}\t${x.name}\t${x.lib}\t${x.tiers}`).join('\n'));
console.log('\nNEED_FIX', short.length);
console.log(short.map((x) => `B${x.n}\t${x.f}\tp${x.plot}\tt${x.tier}\tl${x.lei}\tsrc${x.links}${x.pad ? '\tPAD' : ''}`).join('\n'));
fs.writeFileSync('_tmp_missing601700.json', JSON.stringify({ missing, short }, null, 2), 'utf8');
