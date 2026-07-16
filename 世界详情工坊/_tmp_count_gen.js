const fs = require('fs');
const code = fs.readFileSync('_gen_b341_343.js', 'utf8');
const re = /name: '([^']+)'[\s\S]*?plot: `([\s\S]*?)`\s*,\s*\n\s*cut: `([\s\S]*?)`/g;
let m;
let n = 0;
while ((m = re.exec(code))) {
  n++;
  console.log(m[1], 'plot', m[2].replace(/\s/g, '').length, 'cut', m[3].replace(/\s/g, '').length);
}
console.log('found', n);
