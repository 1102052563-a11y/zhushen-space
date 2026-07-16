const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const batches = [335, 336, 337];
let ok = 0, warn = 0, fail = 0;
const rows = [];
for (const b of batches) {
  const dir = path.join('产出', '批次' + b);
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const f = path.join(dir, name);
    let o = '';
    try {
      o = execSync('node scripts/compile-worldbook.mjs --check "' + f + '"', { encoding: 'utf8' });
    } catch (e) {
      o = (e.stdout || '') + (e.stderr || '') + String(e);
    }
    let status = 'FAIL';
    if (o.includes('有警')) status = 'WARN';
    else if (o.includes('过关')) status = 'OK';
    if (status === 'OK') ok++;
    else if (status === 'WARN') warn++;
    else fail++;
    const m = o.match(/剧情\s*(\d+).*切入[点點]\s*(\d+)/);
    rows.push({ batch: b, name, status, plot: m ? m[1] : '?', ent: m ? m[2] : '?' });
    console.log(status, 'B' + b, name, m ? m[1] + '/' + m[2] : '');
  }
}
console.log('SUMMARY', JSON.stringify({ ok, warn, fail }));
fs.writeFileSync('_tmp_b335_337_report.json', JSON.stringify(rows, null, 2), 'utf8');
