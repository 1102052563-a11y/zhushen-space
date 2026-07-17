const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = __dirname;
let pass = 0, fail = 0, fails = [], noSrc = 0, pad = 0, padList = [];
const padRe = /【(扩写|补密|加厚|补段|扩段|再补|终卷补强|剧情补述|细目|阶段档案)/;
for (let b = 701; b <= 800; b++) {
  const dir = path.join(root, '产出', '批次' + b);
  if (!fs.existsSync(dir)) {
    fails.push({ b, err: 'no dir' });
    continue;
  }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !x.startsWith('_'))) {
    const full = path.join(dir, f);
    const c = fs.readFileSync(full, 'utf8');
    if (padRe.test(c)) {
      pad++;
      padList.push(b + ':' + f);
    }
    const urls = (c.match(/https?:\/\//g) || []).length;
    if (urls < 3) noSrc++;
    try {
      const out = execSync(
        'node scripts/compile-worldbook.mjs --check ' + JSON.stringify(path.join('产出', '批次' + b, f)),
        { encoding: 'utf8', timeout: 20000, cwd: root }
      );
      if (out.includes('过关')) pass++;
      else {
        fail++;
        fails.push({ b, f, out: out.slice(0, 150) });
      }
    } catch (e) {
      fail++;
      fails.push({ b, f, err: (e.stdout || e.message || '').toString().slice(0, 200) });
    }
  }
}
console.log(JSON.stringify({ pass, fail, noSrc, pad, padList: padList.slice(0, 40), fails: fails.slice(0, 40) }, null, 2));
