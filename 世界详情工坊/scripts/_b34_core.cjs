const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '产出', '批次34');
const cc = s => (s || '').replace(/\s/g, '').length;

function write(name, body) {
  fs.writeFileSync(path.join(OUT, name), body, 'utf8');
  const plot = (body.split('## 剧情')[1] || '').split('## 阶位切入点')[0];
  const entry = (body.split('## 阶位切入点')[1] || '').split('## 来源')[0];
  const src = body.split('## 来源')[1] || '';
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  const st = !plot.includes('【作品来源】') || cc(plot) < 10000 || cc(entry) < 1500 || links < 3 ? 'FAIL' : 'OK';
  console.log(st, name, 'plot', cc(plot), 'entry', cc(entry), 'links', links);
}

// dense paragraph builder for unique expansion
function densify(blocks) {
  return blocks.filter(Boolean).join('\n\n');
}

