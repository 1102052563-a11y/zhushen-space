const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '产出', '批次851');
const bad = [
  '【扩写',
  '【加厚',
  '【补密',
  '【剧情补述',
  '跨媒介流行作品',
  '可被契约者切入的完整任务世界',
  '细节落到器物',
  '【世界细则】',
];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  const hits = bad.filter((b) => c.includes(b));
  const srcs = c.match(/https?:\/\/[^\s)]+/g) || [];
  const hasSobqg = srcs.some((s) => s.includes('sobqg'));
  const plot = (c.match(/## 剧情[\s\S]*?(?=## 阶位切入点)/) || [''])[0].replace(/\s/g, '');
  const seen = new Map();
  let dups = 0;
  for (let i = 0; i < plot.length - 50; i += 30) {
    const g = plot.slice(i, i + 50);
    if (seen.has(g)) dups++;
    else seen.set(g, 1);
  }
  console.log(
    JSON.stringify({
      f,
      hits,
      srcCount: srcs.length,
      hasSobqg,
      dups50: dups,
      map: c.includes('乐园阶位映射'),
      arrow: c.includes('阶位↔'),
    })
  );
}

// mark batch table
const table = path.join(__dirname, '..', '清单', '批次表.md');
let t = fs.readFileSync(table, 'utf8');
const names = ['伊塔之柱', '亡灵天灾从坟场魔开始', '天命游戏平台', '天运玩家', '三国神话世界'];
let n = 0;
for (const name of names) {
  const from = `- [ ] ${name}`;
  const to = `- [x] ${name}`;
  if (t.includes(from)) {
    t = t.replace(from, to);
    n++;
  }
}
fs.writeFileSync(table, t, 'utf8');
console.log('batch marked', n);
