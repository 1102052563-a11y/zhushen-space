const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../产出/批次212');
const order = ['假面骑士ZO.md', '游戏王GX.md', "游戏王5D's.md", '假面骑士J.md', '游戏王ZEXAL.md'];
const bad = ['跨媒介流行作品', '可被契约者切入', '【加厚'];
for (const f of order) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0];
  const entry = t.split('## 阶位切入点')[1].split('## 来源')[0];
  const pn = plot.replace(/\s/g, '').length;
  const en = entry.replace(/\s/g, '').length;
  const hits = bad.filter((b) => t.includes(b));
  console.log(`${f.replace('.md', '')}\t剧情${pn}\t切入点${en}\t${hits.length ? hits.join(',') : 'clean'}`);
}
