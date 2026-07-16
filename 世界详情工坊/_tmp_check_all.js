const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = [];
for (const b of [329, 330, 331]) {
  for (const f of fs.readdirSync('产出/批次' + b).filter((x) => x.endsWith('.md'))) {
    files.push(path.join('产出', '批次' + b, f));
  }
}
let ok = 0,
  fail = 0;
for (const f of files) {
  try {
    const o = execFileSync('node', ['scripts/compile-worldbook.mjs', '--check', f], {
      encoding: 'utf8',
    });
    const line = o
      .trim()
      .split(/\n/)
      .filter((l) => /过关|错误|警告/.test(l))
      .join(' | ');
    console.log(line || o.slice(0, 200));
    if (/✓ 过关|过关/.test(o) && !/错误/.test(o)) ok++;
    else fail++;
  } catch (e) {
    fail++;
    console.log('EXC', f, (e.stdout || e.message || '').toString().slice(0, 400));
  }
}
console.log({ ok, fail, total: files.length });
