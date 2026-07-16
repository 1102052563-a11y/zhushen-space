const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '产出', '批次34');
const cc = (s) => (s || '').replace(/\s/g, '').length;
function write(name, body) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, body, 'utf8');
  const plot = (body.split('## 剧情')[1] || '').split('## 阶位切入点')[0];
  const entry = (body.split('## 阶位切入点')[1] || '').split('## 来源')[0];
  const src = (body.split('## 来源')[1] || '');
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  console.log(name, 'plot', cc(plot), 'entry', cc(entry), 'links', links);
  if (cc(plot) < 10000) console.log('  NEED PLOT', 10000 - cc(plot));
  if (cc(entry) < 1500) console.log('  NEED ENTRY', 1500 - cc(entry));
  if (links < 3) console.log('  NEED LINKS');
}
