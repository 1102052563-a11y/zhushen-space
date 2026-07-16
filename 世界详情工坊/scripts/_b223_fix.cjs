const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', '产出', '批次223');
const CHECK = path.join(__dirname, 'compile-worldbook.mjs');

const pc = (t) => (t.split('## 剧情')[1] || '').split('## 阶位切入点')[0].replace(/\s/g, '').length;
const ec = (t) => (t.split('## 阶位切入点')[1] || '').split('## 来源')[0].replace(/\s/g, '').length;

const names = ['黑兽-黑暗女王屈服', '黑兽-侍从双堕', '黑兽-佣兵堕落'];

for (const name of names) {
  const p = path.join(DIR, name + '.md');
  let t = fs.readFileSync(p, 'utf8');
  // literal backslash-n → real newline
  t = t.split('\\n').join('\n');
  // ensure headers at line start
  t = t.replace(/([^\n])(## 阶位切入点)/g, '$1\n\n$2');
  t = t.replace(/([^\n])(## 来源)/g, '$1\n\n$2');
  // collapse excessive blank lines
  t = t.replace(/\n{4,}/g, '\n\n\n');
  fs.writeFileSync(p, t, 'utf8');
  const r = spawnSync(process.execPath, [CHECK, '--check', p], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  console.log((r.stdout || '') + (r.stderr || ''));
  console.log(`[count] ${name} plot=${pc(t)} entry=${ec(t)} exit=${r.status}`);
}

// also recheck first two
for (const name of ['黑兽-表妹堕落', '黑兽-圣骑士长陷落']) {
  const p = path.join(DIR, name + '.md');
  const t = fs.readFileSync(p, 'utf8');
  // remove 被封印 if any remain
  let fixed = t.replace(/被封印/g, '被重创').replace(/严禁硬刚称已削弱/g, '严禁宣称佣兵王战力可无条件归零');
  if (fixed !== t) fs.writeFileSync(p, fixed, 'utf8');
  const r = spawnSync(process.execPath, [CHECK, '--check', p], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  console.log((r.stdout || '') + (r.stderr || ''));
}
