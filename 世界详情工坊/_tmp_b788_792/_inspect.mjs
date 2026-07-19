import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const t = fs.readFileSync(path.join(dir, 'gen_base.js'), 'utf8');
console.log('len', t.length);
const names = [...t.matchAll(/name:\s*['"]([^'"]+)/g)].map((m) => m[1]);
console.log(names.join('\n'));
console.log('---head---');
console.log(t.slice(0, 2500));
console.log('---tail---');
console.log(t.slice(-2000));
