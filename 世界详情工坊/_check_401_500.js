const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const base = path.join(__dirname, '产出');
const script = path.join(__dirname, 'scripts', 'compile-worldbook.mjs');
let pass = 0,
  fail = 0;
const fails = [];
for (let b = 401; b <= 500; b++) {
  const dir = path.join(base, '批次' + b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    try {
      const out = execSync(`node "${script}" --check "${fp}"`, {
        encoding: 'utf8',
      });
      if (out.includes('✓') || (out.includes('过关') && !out.includes('不过关')))
        pass++;
      else {
        fail++;
        fails.push({ key: b + '/' + f, out: out.slice(0, 200) });
      }
    } catch (e) {
      fail++;
      fails.push({
        key: b + '/' + f,
        out: (e.stdout || e.message || '').toString().slice(0, 200),
      });
    }
  }
}
console.log('pass', pass, 'fail', fail);
const by = {};
for (const x of fails) {
  const b = x.key.split('/')[0];
  by[b] = (by[b] || 0) + 1;
}
console.log('byBatch', JSON.stringify(by));
console.log('sample fails:');
fails.slice(0, 15).forEach((f) => console.log(f.key, f.out.replace(/\n/g, ' | ')));
fs.writeFileSync(
  path.join(__dirname, '_fail_list_401_500.json'),
  JSON.stringify(fails, null, 2),
);
