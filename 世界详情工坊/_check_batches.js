const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = process.cwd();
const OUT = path.join(ROOT, '产出');
const results = [];
for (let b = 301; b <= 400; b++) {
  const dir = path.join(OUT, `批次${b}`);
  if (!fs.existsSync(dir)) { results.push({b, status:'NO_DIR'}); continue; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  let ok=0, bad=0, details=[];
  for (const f of files) {
    const full = path.join(dir, f);
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], {encoding:'utf8', cwd:ROOT});
    const out = (r.stdout||'') + (r.stderr||'');
    const pass = out.includes('过关') && !out.includes('不过关');
    if (pass) ok++; else { bad++; details.push(f + ' => ' + out.split('\n').filter(l=>l.includes('错误')||l.includes('不过')).slice(0,3).join(' | ')); }
  }
  results.push({b, n:files.length, ok, bad, details: details.slice(0,2)});
}
for (const r of results) {
  if (r.status==='NO_DIR') console.log(`B${r.b} NO_DIR`);
  else console.log(`B${r.b} n=${r.n} ok=${r.ok} bad=${r.bad}` + (r.bad? ' :: '+JSON.stringify(r.details):''));
}
const totalOk = results.filter(r=>r.ok===5).length;
const totalBad = results.filter(r=>r.bad>0).length;
console.log('---');
console.log('batches_all_ok', results.filter(r=>r.ok===5 && r.n===5).map(r=>r.b).join(','));
console.log('batches_with_bad', results.filter(r=>r.bad>0).map(r=>r.b).join(','));
console.log('no_dir', results.filter(r=>r.status==='NO_DIR').map(r=>r.b).join(','));
