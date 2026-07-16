const fs = require('fs');
const path = require('path');
const root = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出';
const files = [];
for (const b of ['批次735', '批次736']) {
  for (const f of fs.readdirSync(path.join(root, b))) {
    if (f.endsWith('.md')) files.push(path.join(root, b, f));
  }
}
const secRe = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
for (const fp of files) {
  let s = fs.readFileSync(fp, 'utf8');
  // literal \n -> real newline
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 92 && s[i + 1] === 'n') {
      out += '\n';
      i++;
    } else {
      out += s[i];
    }
  }
  out = out.replace(/([^\n])(## (?:剧情|休闲切入点|来源))/g, '$1\n\n$2');
  // collapse excessive blank lines
  out = out.replace(/\n{4,}/g, '\n\n\n');
  fs.writeFileSync(fp, out, 'utf8');
  const m = [...out.matchAll(secRe)];
  const i1 = out.indexOf('## 剧情');
  const i2 = out.indexOf('## 休闲切入点');
  const i3 = out.indexOf('## 来源');
  const pl = i1 >= 0 && i2 >= 0 ? out.slice(i1, i2).replace(/\s/g, '').length : 0;
  const el = i2 >= 0 && i3 >= 0 ? out.slice(i2, i3).replace(/\s/g, '').length : 0;
  console.log(
    path.basename(fp).slice(0, 40),
    'hdrs=' + m.length,
    'plot=' + pl,
    'entry=' + el,
    m.length >= 3 && pl >= 6000 && el >= 1500 ? 'OK' : 'FIX'
  );
}
