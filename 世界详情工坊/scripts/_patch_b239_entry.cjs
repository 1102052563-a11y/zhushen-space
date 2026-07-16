const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '_write_b239_all.cjs');
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('_entry_b239')) {
  s = s.replace(
    "const dens = require('./_b239_densify.cjs');",
    "const dens = require('./_b239_densify.cjs');\nconst { entryDensify: entryDensifyExt } = require('./_entry_b239.cjs');"
  );
}
// replace function entryDensify(...) { ... } with wrapper
const start = s.indexOf('function entryDensify(name)');
const end = s.indexOf('/* ========== densify content generators ========== */');
if (start < 0 || end < 0) throw new Error('markers missing ' + start + ' ' + end);
const wrapper = `function entryDensify(name) {
  return entryDensifyExt(name);
}

`;
s = s.slice(0, start) + wrapper + s.slice(end);
fs.writeFileSync(p, s);
console.log('ok', s.length);
