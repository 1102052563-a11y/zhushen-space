const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '_write_b239_all.cjs');
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('_b239_densify')) {
  s = s.replace(
    "const outDir = path.join(__dirname, '../产出/批次239');",
    "const outDir = path.join(__dirname, '../产出/批次239');\nconst dens = require('./_b239_densify.cjs');"
  );
}

const mapFn = `function densifyBlocks(name) {
  const map = {
    '黑兽魔王觉醒-大陆统一': dens.densUnify,
    '黑兽魔王觉醒-女神堕落': dens.densGoddess,
    '黑兽魔王觉醒-沃尔特进化': dens.densVolt,
    '魔界骑士深渊大门-大门开启': dens.densGate,
    '魔界骑士深渊大门-英格丽德深渊化': dens.densAbyssIngrid,
  };
  return map[name]();
}`;

s = s.replace(/function densifyBlocks\(name\) \{[\s\S]*?return map\[name\]\(\);\n\}/, mapFn);

const a = s.indexOf('function densUnify()');
const b = s.indexOf('/* ===================== WORLD 1');
if (a > 0 && b > a) {
  s = s.slice(0, a) + s.slice(b);
}

// also remove entryDensify old densifyBlocks leftovers if any
fs.writeFileSync(p, s);
console.log('patched', s.length, 'removed old dens', a > 0 && b > a);
