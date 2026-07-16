const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '产出');
for (let n = 601; n <= 700; n++) {
  const dir = path.join(base, '批次' + n);
  if (!fs.existsSync(dir)) {
    console.log('B' + n + ' MISSING');
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  let ok = 0;
  const bad = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const plotM = t.match(/## 剧情[\s\S]*?(?=\n## |$)/);
    const tierM = t.match(/## 阶位切入点[\s\S]*?(?=\n## |$)/);
    const leiM = t.match(/## 休闲切入点[\s\S]*?(?=\n## |$)/);
    const plot = plotM ? plotM[0].replace(/\s/g, '').length : 0;
    const tier = tierM ? tierM[0].replace(/\s/g, '').length : 0;
    const lei = leiM ? leiM[0].replace(/\s/g, '').length : 0;
    const srcM = t.match(/## 来源[\s\S]*$/m);
    const src = srcM ? srcM[0] : '';
    const links = (src.match(/https?:\/\/[^\s)\]]+/g) || []).length;
    const pad = /【扩写|【补密|【加厚|【剧情补述|【细目\d|跨媒介流行作品/.test(t);
    const pass = plot >= 10000 && (tier >= 1500 || lei >= 1500) && links >= 3 && !pad;
    if (pass) ok++;
    else
      bad.push(
        f +
          '(p' +
          plot +
          '/t' +
          tier +
          '/l' +
          lei +
          '/src' +
          links +
          (pad ? '/PAD' : '') +
          ')'
      );
  }
  console.log(
    'B' +
      n +
      ' files=' +
      files.length +
      ' ok=' +
      ok +
      ' fail=' +
      bad.length +
      (bad.length ? ' ' + bad.join('; ') : '')
  );
}
