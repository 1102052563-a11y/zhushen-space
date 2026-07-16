const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, '_gen_b365_367.js'), 'utf8');
const lines = src.split(/\n/);
const head = lines
  .slice(0, 171)
  .join('\n')
  .replace('批次365-367 全15世界', '批次368-372 全25世界');
const tail = `
// DATA PLACEHOLDER

// ── run ──
const report = [];
for (const w of DATA) {
  const body = pack(w);
  const fp = path.join(ROOT, w.file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body, 'utf8');
  const plotC = cc(body.split('## 休闲切入点')[0].split('## 剧情')[1]);
  const cutC = cc(body.split('## 休闲切入点')[1].split('## 来源')[0]);
  const chk = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', w.file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const ok = chk.status === 0;
  report.push({ name: w.name, file: w.file, plot: plotC, cut: cutC, ok, out: (chk.stdout || '') + (chk.stderr || '') });
  console.log((ok ? '✓' : '✗'), w.name, 'plot', plotC, 'cut', cutC);
  if (!ok) console.log(chk.stdout || chk.stderr);
}
fs.writeFileSync(path.join(ROOT, '_tmp_b368_372_report.json'), JSON.stringify(report, null, 2));
const pass = report.filter((r) => r.ok).length;
console.log('\\nPASS', pass, '/', report.length);
process.exit(pass === report.length ? 0 : 2);
`;
fs.writeFileSync(path.join(ROOT, '_gen_b368_372.js'), head + '\n\n' + tail, 'utf8');
console.log('scaffold', fs.statSync(path.join(ROOT, '_gen_b368_372.js')).size);
